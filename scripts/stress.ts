import { _electron as electron } from "playwright";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { cpus, release, totalmem } from "node:os";
import type {
  Plan,
  Request,
  ResponseMap,
  State,
} from "../src/shared/contracts";

interface ProcessRow {
  pid: number;
  parent: number;
  name: string;
  role: string;
  workingSet: number;
  privateBytes: number;
}
interface Frame {
  at: string;
  processes: ProcessRow[];
}
const samplerScript = `
$sentryRoot = [int]$env:SENTRY_STRESS_ROOT_PID
while ($true) {
  $sentryAll = @(Get-CimInstance Win32_Process)
  $sentryIds = [System.Collections.Generic.HashSet[int]]::new()
  [void]$sentryIds.Add($sentryRoot)
  do {
    $sentryAdded = $false
    foreach ($sentryRow in $sentryAll) {
      if ($sentryIds.Contains([int]$sentryRow.ParentProcessId) -and -not $sentryIds.Contains([int]$sentryRow.ProcessId)) { [void]$sentryIds.Add([int]$sentryRow.ProcessId); $sentryAdded = $true }
    }
  } while ($sentryAdded)
  $sentryRows = @()
  foreach ($sentryRow in $sentryAll) {
    if (-not $sentryIds.Contains([int]$sentryRow.ProcessId)) { continue }
    try {
      $sentryProcess = Get-Process -Id $sentryRow.ProcessId -ErrorAction Stop
      $sentryRole = 'helper'
      if ($sentryRow.ProcessId -eq $sentryRoot) { $sentryRole = 'main' }
      elseif ($sentryRow.CommandLine -match 'worker[.]cjs') { $sentryRole = 'worker' }
      elseif ($sentryRow.CommandLine -match '--type=renderer') { $sentryRole = 'renderer' }
      elseif ($sentryRow.CommandLine -match '--type=gpu-process') { $sentryRole = 'gpu' }
      elseif ($sentryRow.Name -match '^restic') { $sentryRole = 'restic' }
      elseif ($sentryRow.Name -match '^rclone') { $sentryRole = 'rclone' }
      $sentryRows += @{ pid = [int]$sentryRow.ProcessId; parent = [int]$sentryRow.ParentProcessId; name = [string]$sentryRow.Name; role = $sentryRole; workingSet = [double]$sentryProcess.WorkingSet64; privateBytes = [double]$sentryProcess.PrivateMemorySize64 }
    } catch {}
  }
  @{ at = [DateTime]::UtcNow.ToString('o'); processes = @($sentryRows) } | ConvertTo-Json -Depth 4 -Compress
  Start-Sleep -Milliseconds 750
}
`;

if (typeof Bun !== "undefined")
  throw new Error("Use Node to launch the packaged Electron test.");
const output = resolve("outputs/stress", Date.now().toString());
const source = join(output, "sources", "Development fixture");
await mkdir(source, { recursive: true });
await pipeline(
  Readable.from(
    (async function* () {
      for (let i = 0; i < 128; i++) yield randomBytes(1024 * 1024);
    })(),
  ),
  createWriteStream(join(source, "large-incompressible.bin")),
);
let smallBytes = 0;
for (let directory = 0; directory < 100; directory++) {
  const folder = join(
    source,
    `project-${directory.toString().padStart(3, "0")}`,
  );
  await mkdir(folder);
  for (let file = 0; file < 40; file++) {
    const content =
      `Real stress fixture ${directory}/${file}\n` +
      "Backup scanning and responsive navigation.\n".repeat(20);
    smallBytes += Buffer.byteLength(content);
    await writeFile(
      join(folder, `notes-${file.toString().padStart(2, "0")}.txt`),
      content,
    );
  }
}
console.log(
  JSON.stringify({
    phase: "fixture-created",
    output,
    files: 4001,
    bytes: 128 * 1024 ** 2 + smallBytes,
  }),
);
const env: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      (pair): pair is [string, string] => typeof pair[1] === "string",
    ),
  ),
  SENTRY_QA: "1",
  SENTRY_DATA_DIR: join(output, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: resolve("release/win-unpacked/Sentry.exe"),
  args: [],
  env,
  timeout: 45000,
});
let sampler: ReturnType<typeof spawn> | undefined;
const frames: Frame[] = [];
const rendererErrors: string[] = [];
const latency: Array<{
  action: string;
  milliseconds: number;
  phase: string;
  status: string;
  keyboardFocus?: string;
  measuredAt?: string;
  engineActive?: boolean;
  sampleAt?: string;
}> = [];
function record(measurement: (typeof latency)[number]) {
  const frame = frames.at(-1);
  latency.push({
    ...measurement,
    measuredAt: new Date().toISOString(),
    engineActive: frame?.processes.some((p) => p.role === "restic"),
    sampleAt: frame?.at,
  });
}
try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => rendererErrors.push(error.message));
  await page.waitForSelector(".sidebar", { timeout: 30000 });
  const native = await app.evaluate(({ app: nativeApp, BrowserWindow }) => ({
    pid: process.pid,
    packaged: nativeApp.isPackaged,
    versions: process.versions,
    windows: BrowserWindow.getAllWindows().map((w) => ({
      visible: w.isVisible(),
      offscreen: w.webContents.isOffscreen(),
    })),
  }));
  if (!native.packaged || native.windows.some((w) => w.visible || !w.offscreen))
    throw new Error("Stress test requires hidden, offscreen packaged windows.");
  async function request<T extends Request>(
    value: T,
  ): Promise<ResponseMap[T["type"]]> {
    return page.evaluate((r) => window.sentry.request(r), value) as Promise<
      ResponseMap[T["type"]]
    >;
  }
  const initial = await request({ type: "state" });
  await request({
    type: "settings",
    settings: {
      ...initial.settings,
      pauseOnBattery: false,
      idleOnly: false,
      allowMetered: true,
    },
  });
  const destinationId = randomUUID();
  await request({
    type: "add-destination",
    id: destinationId,
    name: "Stress fixture repository",
    kind: "local",
    location: join(output, "repository"),
    password: "stress-fixture-recovery-password",
    existing: false,
  });
  const plan: Plan = {
    id: randomUUID(),
    name: "Development stress fixture",
    sources: [source],
    destinationIds: [destinationId],
    enabled: true,
    includes: [],
    excludes: [],
    schedule: {
      kind: "manual",
      minutes: 60,
      time: "18:00",
      weekday: 0,
      day: 1,
    },
    retention: { daily: 7, weekly: 4, monthly: 3 },
    priority: 5,
    pruningSuspended: false,
  };
  await request({ type: "save-plan", plan });
  await page.reload();
  await page.waitForSelector(".ledger-plan");
  let pending = "";
  sampler = spawn(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", samplerScript],
    {
      env: { ...process.env, SENTRY_STRESS_ROOT_PID: String(native.pid) },
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  sampler.stdout?.on("data", (chunk: Buffer) => {
    pending += chunk.toString();
    let newline: number;
    while ((newline = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      try {
        frames.push(JSON.parse(line) as Frame);
      } catch {
        /* Ignore incomplete observer records. */
      }
    }
    if (pending.length > 1000000) sampler?.kill();
  });
  sampler.on("error", (error) =>
    rendererErrors.push(`Sampler: ${error.message}`),
  );
  const started = Date.now();
  const [jobId] = await request({ type: "run", planId: plan.id });
  let state: State;
  do {
    state = await request({ type: "state" });
    if (Date.now() - started > 30000)
      throw new Error("Stress job did not start.");
    if (state.jobs.find((j) => j.id === jobId)?.status !== "running")
      await new Promise((r) => setTimeout(r, 50));
  } while (state.jobs.find((j) => j.id === jobId)?.status !== "running");
  await page.reload();
  await page.waitForSelector(".sidebar");
  for (const name of [
    "Backup Plans",
    "Activity",
    "Settings",
    "Overview",
    "Activity",
  ]) {
    const current = (await request({ type: "state" })).jobs.find(
      (j) => j.id === jobId,
    );
    if (current?.status !== "running") break;
    const before = performance.now();
    await page
      .locator(".sidebar")
      .getByRole("button", { name, exact: true })
      .click();
    await page.getByRole("heading", { name, exact: true }).waitFor();
    record({
      action: `Navigate to ${name}`,
      milliseconds: performance.now() - before,
      phase: current.phase,
      status: current.status,
    });
    const keyStart = performance.now();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    const focus = await page.evaluate(
      () => document.activeElement?.textContent?.slice(0, 100) ?? "",
    );
    record({
      action: "Tab and Shift+Tab",
      milliseconds: performance.now() - keyStart,
      phase: current.phase,
      status: current.status,
      keyboardFocus: focus,
    });
  }
  const busyState = await request({ type: "state" });
  const busyJob = busyState.jobs.find((j) => j.id === jobId);
  if (busyJob?.status === "running") {
    // Reload reads the real running state because hidden windows deliberately stop live subscriptions.
    await page.reload();
    await page.waitForSelector(".sidebar");
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "Activity", exact: true })
      .click();
    await page.screenshot({ path: join(output, "busy-activity.png") });
  }
  let transferShot = false;
  let turn = 0;
  do {
    state = await request({ type: "state" });
    if (Date.now() - started > 180000)
      throw new Error("Stress backup exceeded three minutes.");
    const activeJob = state.jobs.find((j) => j.id === jobId);
    if (activeJob?.status === "running") {
      const name = turn++ % 2 === 0 ? "Backup Plans" : "Activity";
      const before = performance.now();
      await page
        .locator(".sidebar")
        .getByRole("button", { name, exact: true })
        .click();
      await page.getByRole("heading", { name, exact: true }).waitFor();
      record({
        action: `Navigate to ${name}`,
        milliseconds: performance.now() - before,
        phase: activeJob.phase,
        status: activeJob.status,
      });
      const keyStart = performance.now();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      record({
        action: "Tab and Shift+Tab",
        milliseconds: performance.now() - keyStart,
        phase: activeJob.phase,
        status: activeJob.status,
        keyboardFocus: await page.evaluate(
          () => document.activeElement?.textContent?.slice(0, 100) ?? "",
        ),
      });
      if (!transferShot && activeJob.phase !== "Scanning") {
        await page.reload();
        await page.waitForSelector(".sidebar");
        await page
          .locator(".sidebar")
          .getByRole("button", { name: "Activity", exact: true })
          .click();
        await page.screenshot({ path: join(output, "busy-engine.png") });
        transferShot = true;
      }
    }
    if (activeJob?.status === "running" || state.busy)
      await new Promise((r) => setTimeout(r, 500));
  } while (
    state.jobs.find((j) => j.id === jobId)?.status === "running" ||
    state.busy
  );
  const job = state.jobs.find((j) => j.id === jobId);
  const elapsedSeconds = (Date.now() - started) / 1000;
  if (job?.status !== "success")
    throw new Error(`Stress backup did not succeed: ${JSON.stringify(job)}`);
  if (
    job.added !== 4001 ||
    job.bytes !== 128 * 1024 ** 2 + smallBytes ||
    job.skipped !== 0
  )
    throw new Error(
      "The successful job did not account for every generated fixture file and byte.",
    );
  if (latency.length < 4)
    throw new Error(
      "Not enough real UI interactions overlapped the active backup.",
    );
  if (
    !latency.some((m) => m.phase === "Backing up" || m.phase === "Transferring")
  )
    throw new Error(
      "Active backup progress was never exposed through the application state.",
    );
  if (rendererErrors.length) throw new Error(rendererErrors.join("\n"));
  const peakWorkingSetMiB =
    Math.max(
      ...frames.map((f) =>
        f.processes.reduce((sum, p) => sum + p.workingSet, 0),
      ),
    ) /
    1024 ** 2;
  const evidence = {
    output,
    at: new Date().toISOString(),
    archiveSha256: createHash("sha256")
      .update(
        await readFile(resolve("release/win-unpacked/resources/app.asar")),
      )
      .digest("hex"),
    native,
    environment: {
      os: release(),
      node: process.version,
      cpu: cpus()[0]?.model,
      logicalProcessors: cpus().length,
      memoryGiB: totalmem() / 1024 ** 3,
    },
    fixture: {
      files: 4001,
      bytes: 128 * 1024 ** 2 + smallBytes,
      streamedChunkBytes: 1024 ** 2,
    },
    elapsedSeconds,
    job,
    busyJob,
    latency,
    peakWorkingSetMiB,
    frames,
    rendererErrors,
    limits: [
      "Hidden/offscreen software-rendered window; not visible display or hardware GPU proof.",
      "Interaction timing includes Playwright instrumentation, not an input-to-photon measurement.",
      "Sampler is outside the measured process tree; its host overhead can still affect timings.",
      "Approximately 750ms plus query-time sampling can miss shorter helper processes and memory peaks.",
      "Working sets sum shared pages more than once.",
      "One fixture size does not prove memory usage independent of total backup bytes.",
      "Fixture files, repository, and job history are real test data in an isolated profile.",
    ],
  };
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        output,
        elapsedSeconds,
        jobStatus: job.status,
        interactions: latency.length,
        maxInteractionMs: Math.max(...latency.map((l) => l.milliseconds)),
        peakWorkingSetMiB,
        samples: frames.length,
        roles: [
          ...new Set(frames.flatMap((f) => f.processes.map((p) => p.role))),
        ],
      },
      null,
      2,
    ),
  );
} finally {
  sampler?.kill();
  await app.close();
}
