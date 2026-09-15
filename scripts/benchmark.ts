import { _electron as electron, type ElectronApplication } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, writeFile, stat, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { cpus, totalmem, release } from "node:os";
import { createHash } from "node:crypto";

interface ProcessSample {
  pid: number;
  parent: number;
  created: string;
  role: string;
  name: string;
  cpuSeconds: number;
  workingSet: number;
  privateBytes: number;
  privateWorkingSet: number | null;
}
interface Frame {
  at: string;
  samplerPid: number;
  processes: ProcessSample[];
}
interface Observation {
  name: string;
  frames: Frame[];
  elapsedSeconds: number;
  cpuSeconds: number;
  cpuOneCorePercent: number;
  cpuMachinePercent: number;
  averageWorkingSetMiB: number;
  peakWorkingSetMiB: number;
  averagePrivateBytesMiB: number;
  averagePrivateWorkingSetMiB: number | null;
  processes: Array<{
    pid: number;
    role: string;
    name: string;
    cpuSeconds: number;
    averageWorkingSetMiB: number;
    peakWorkingSetMiB: number;
    averagePrivateBytesMiB: number;
  }>;
}

// Fixed PowerShell source: the root PID is an environment value, never generated shell code.
// This sampler is a sibling of Sentry under the Node test runner, not part of the measured tree.
const samplerScript = `
$ErrorActionPreference = 'Stop'
$sentryRoot = [int]$env:SENTRY_BENCHMARK_ROOT_PID
$sentryAll = @(Get-CimInstance Win32_Process)
$sentryIds = [System.Collections.Generic.HashSet[int]]::new()
[void]$sentryIds.Add($sentryRoot)
do {
  $sentryAdded = $false
  foreach ($sentryRow in $sentryAll) {
    if ($sentryIds.Contains([int]$sentryRow.ParentProcessId) -and -not $sentryIds.Contains([int]$sentryRow.ProcessId)) {
      [void]$sentryIds.Add([int]$sentryRow.ProcessId)
      $sentryAdded = $true
    }
  }
} while ($sentryAdded)
$sentryPrivate = @{}
try { foreach ($sentryPerf in Get-CimInstance Win32_PerfRawData_PerfProc_Process) { if ($sentryIds.Contains([int]$sentryPerf.IDProcess)) { $sentryPrivate[[int]$sentryPerf.IDProcess] = [double]$sentryPerf.WorkingSetPrivate } } } catch {}
$sentryRows = @()
foreach ($sentryRow in $sentryAll) {
  if (-not $sentryIds.Contains([int]$sentryRow.ProcessId)) { continue }
  try {
    $sentryProcess = Get-Process -Id $sentryRow.ProcessId -ErrorAction Stop
    $sentryRole = 'helper'
    if ($sentryRow.ProcessId -eq $sentryRoot) { $sentryRole = 'main' }
    elseif ($sentryRow.CommandLine -match 'worker[.]cjs') { $sentryRole = 'backup-worker' }
    elseif ($sentryRow.CommandLine -match '--type=gpu-process') { $sentryRole = 'gpu' }
    elseif ($sentryRow.CommandLine -match '--type=renderer') { $sentryRole = 'renderer' }
    elseif ($sentryRow.CommandLine -match '--type=utility') { $sentryRole = 'chromium-utility' }
    elseif ($sentryRow.Name -match '^restic') { $sentryRole = 'restic' }
    elseif ($sentryRow.Name -match '^rclone') { $sentryRole = 'rclone' }
    elseif ($sentryRow.Name -match '^powershell') { $sentryRole = 'policy-helper' }
    $sentryPws = $null
    if ($sentryPrivate.ContainsKey([int]$sentryRow.ProcessId)) { $sentryPws = $sentryPrivate[[int]$sentryRow.ProcessId] }
    $sentryRows += @{ pid = [int]$sentryRow.ProcessId; parent = [int]$sentryRow.ParentProcessId; created = $sentryRow.CreationDate.ToUniversalTime().ToString('o'); role = $sentryRole; name = [string]$sentryRow.Name; cpuSeconds = [double]$sentryProcess.TotalProcessorTime.TotalSeconds; workingSet = [double]$sentryProcess.WorkingSet64; privateBytes = [double]$sentryProcess.PrivateMemorySize64; privateWorkingSet = $sentryPws }
  } catch {}
}
@{ at = [DateTime]::UtcNow.ToString('o'); samplerPid = $PID; processes = @($sentryRows) } | ConvertTo-Json -Depth 5 -Compress
`;

async function sample(rootPid: number): Promise<Frame> {
  return new Promise((resolveSample, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", samplerScript],
      {
        env: { ...process.env, SENTRY_BENCHMARK_ROOT_PID: String(rootPid) },
        windowsHide: true,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    let error = "";
    let settled = false;
    const finish = (failure?: Error, frame?: Frame) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (failure) reject(failure);
      else if (frame) resolveSample(frame);
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error("Windows process sampler timed out."));
    }, 20_000);
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 1_000_000) {
        child.kill();
        finish(new Error("Process sampler output exceeded limit."));
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      error = (error + chunk.toString()).slice(-2000);
    });
    child.once("error", (failure) => finish(failure));
    child.once("close", (code) => {
      if (code !== 0) {
        finish(new Error(`Windows process sampler failed: ${error}`));
        return;
      }
      try {
        const frame = JSON.parse(output) as Frame;
        if (
          !Array.isArray(frame.processes) ||
          !frame.processes.some((process) => process.pid === rootPid) ||
          frame.processes.some((process) => process.pid === frame.samplerPid)
        )
          throw new Error(
            "Measured tree did not contain the app root or included the sampler.",
          );
        finish(undefined, frame);
      } catch (failure) {
        finish(
          failure instanceof Error
            ? failure
            : new Error("Invalid sampler response"),
        );
      }
    });
  });
}
const delay = (ms: number) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
const mib = (bytes: number) => bytes / 1024 / 1024;
function summarize(name: string, frames: Frame[]): Observation {
  const elapsedSeconds =
    (Date.parse(frames.at(-1)!.at) - Date.parse(frames[0].at)) / 1000;
  const seen = new Map<string, ProcessSample[]>();
  for (const frame of frames)
    for (const process of frame.processes) {
      const identity = `${process.pid}:${process.created}`;
      const rows = seen.get(identity) ?? [];
      rows.push(process);
      seen.set(identity, rows);
    }
  const processes = [...seen.values()].map((rows) => ({
    pid: rows[0].pid,
    role: rows[0].role,
    name: rows[0].name,
    cpuSeconds: Math.max(0, rows.at(-1)!.cpuSeconds - rows[0].cpuSeconds),
    averageWorkingSetMiB: mib(
      rows.reduce((sum, process) => sum + process.workingSet, 0) / rows.length,
    ),
    peakWorkingSetMiB: mib(
      Math.max(...rows.map((process) => process.workingSet)),
    ),
    averagePrivateBytesMiB: mib(
      rows.reduce((sum, process) => sum + process.privateBytes, 0) /
        rows.length,
    ),
  }));
  const totals = frames.map((frame) =>
    frame.processes.reduce((sum, process) => sum + process.workingSet, 0),
  );
  const privateTotals = frames.map((frame) =>
    frame.processes.reduce((sum, process) => sum + process.privateBytes, 0),
  );
  const privateWorkingTotals = frames.map((frame) =>
    frame.processes.every((process) => process.privateWorkingSet !== null)
      ? frame.processes.reduce(
          (sum, process) => sum + process.privateWorkingSet!,
          0,
        )
      : null,
  );
  const cpuSeconds = processes.reduce(
    (sum, process) => sum + process.cpuSeconds,
    0,
  );
  return {
    name,
    frames,
    elapsedSeconds,
    cpuSeconds,
    cpuOneCorePercent: (cpuSeconds / elapsedSeconds) * 100,
    cpuMachinePercent: (cpuSeconds / elapsedSeconds / cpus().length) * 100,
    averageWorkingSetMiB: mib(
      totals.reduce((sum, value) => sum + value, 0) / totals.length,
    ),
    peakWorkingSetMiB: mib(Math.max(...totals)),
    averagePrivateBytesMiB: mib(
      privateTotals.reduce((sum, value) => sum + value, 0) /
        privateTotals.length,
    ),
    averagePrivateWorkingSetMiB: privateWorkingTotals.every(
      (value) => value !== null,
    )
      ? mib(
          privateWorkingTotals.reduce((sum, value) => sum + value!, 0) /
            privateWorkingTotals.length,
        )
      : null,
    processes,
  };
}
async function observe(
  name: string,
  rootPid: number,
  durationMs: number,
): Promise<Observation> {
  const frames = [await sample(rootPid)];
  const started = Date.now();
  while (Date.now() - started < durationMs) {
    await delay(5000);
    frames.push(await sample(rootPid));
  }
  const result = summarize(name, frames);
  console.log(
    JSON.stringify({
      phase: name,
      seconds: result.elapsedSeconds,
      workingSetMiB: result.averageWorkingSetMiB,
      privateWorkingSetMiB: result.averagePrivateWorkingSetMiB,
      cpuMachinePercent: result.cpuMachinePercent,
      cpuOneCorePercent: result.cpuOneCorePercent,
      roles: result.processes.map((process) => process.role),
    }),
  );
  return result;
}

async function closeOwned(app: ElectronApplication): Promise<void> {
  try {
    await app.close();
  } catch {
    if (app.process().exitCode === null) app.process().kill();
  }
}

async function main(): Promise<void> {
  if (process.platform !== "win32")
    throw new Error("This benchmark uses Windows process counters.");
  if (typeof Bun !== "undefined")
    throw new Error(
      "Run the built benchmark with Node. Bun cannot launch Playwright Electron reliably.",
    );
  const executable = resolve("release/win-unpacked/Sentry.exe");
  const archive = resolve("release/win-unpacked/resources/app.asar");
  const executableStat = await stat(executable);
  const archiveStat = await stat(archive);
  const output = resolve("outputs/performance", Date.now().toString());
  await mkdir(join(output, "profile"), { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SENTRY_QA: "1",
    SENTRY_DATA_DIR: join(output, "profile"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const launchEnvironment = Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  const app = await electron.launch({
    executablePath: executable,
    args: [],
    env: launchEnvironment,
    timeout: 45_000,
  });
  // Playwright's Windows child can be a cmd.exe launcher. Start at Electron's own
  // PID so the instrumentation launcher is excluded from the measured app tree.
  const rootPid = await app.evaluate(() => process.pid);
  if (!rootPid) {
    await closeOwned(app);
    throw new Error("Packaged app PID was not available.");
  }
  try {
    const page = await app.firstWindow();
    await page.waitForSelector(".sidebar", { timeout: 30_000 });
    await page.waitForFunction(
      async () => {
        const state = await window.sentry.request({ type: "state" });
        return !state.busy && state.engineVersion.startsWith("restic ");
      },
      undefined,
      { timeout: 30_000 },
    );
    const initial = await app.evaluate(({ app: nativeApp, BrowserWindow }) => ({
      versions: process.versions,
      packaged: nativeApp.isPackaged,
      metrics: nativeApp.getAppMetrics(),
      windows: BrowserWindow.getAllWindows().map((window) => ({
        visible: window.isVisible(),
        offscreen: window.webContents.isOffscreen(),
      })),
    }));
    if (
      !initial.packaged ||
      initial.windows.some((window) => window.visible || !window.offscreen)
    )
      throw new Error(
        "Benchmark requires the packaged app and hidden offscreen windows.",
      );
    await delay(10_000);
    console.log(
      JSON.stringify({
        phase: "starting-renderer-retained-hidden-observation",
        output,
        rootPid,
      }),
    );
    const retained = await observe(
      "Renderer retained, hidden/offscreen idle proxy",
      rootPid,
      30_000,
    );
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.close();
    });
    await delay(10_000);
    const tray = await app.evaluate(({ app: nativeApp, BrowserWindow }) => ({
      windows: BrowserWindow.getAllWindows().length,
      metrics: nativeApp.getAppMetrics(),
    }));
    if (tray.windows !== 0)
      throw new Error("App window was not destroyed for the tray measurement.");
    const closed = await observe(
      "Tray idle, no BrowserWindow",
      rootPid,
      30_000,
    );
    if (
      !closed.frames.every((frame) =>
        frame.processes.some((process) => process.role === "backup-worker"),
      )
    )
      throw new Error("Backup worker did not remain alive in the tray.");
    if (
      closed.frames.some((frame) =>
        frame.processes.some((process) => process.role === "renderer"),
      )
    )
      throw new Error("A renderer survived the tray stabilization period.");
    const evidence = {
      at: new Date().toISOString(),
      executable,
      executableModified: executableStat.mtime.toISOString(),
      archiveModified: archiveStat.mtime.toISOString(),
      archiveSha256: createHash("sha256")
        .update(await readFile(archive))
        .digest("hex"),
      profile: join(output, "profile"),
      environment: {
        platform: process.platform,
        osRelease: release(),
        node: process.version,
        logicalProcessors: cpus().length,
        cpu: cpus()[0]?.model,
        installedMemoryGiB: totalmem() / 1024 ** 3,
      },
      initial,
      tray,
      observations: [retained, closed],
      limits: [
        "Renderer-retained phase is hidden/offscreen, not visible-window proof.",
        "Process working sets are summed and can count shared pages more than once; private working set is reported separately.",
        "PowerShell sampler is a sibling outside the Sentry tree. Its overhead is excluded from app CPU counters.",
        "Five-second sampling can miss a helper that starts and exits between frames. No backup jobs are scheduled in this fresh profile.",
        "Playwright instrumentation remains connected to main. Its app-side debugging overhead is included.",
        "This is short-window empty-profile idle measurement, not a large catalog or transfer soak.",
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
          archiveSha256: evidence.archiveSha256,
          observations: evidence.observations.map(
            ({ frames: _frames, ...summary }) => summary,
          ),
        },
        null,
        2,
      ),
    );
  } finally {
    await closeOwned(app);
  }
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
