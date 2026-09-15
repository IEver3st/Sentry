import { _electron as electron } from "playwright";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
const root = resolve("outputs/background-qa", String(Date.now()));
await mkdir(root, { recursive: true });
const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string")), SENTRY_QA: "1", SENTRY_DATA_DIR: join(root, "profile") };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = resolve("node_modules/electron/dist/electron.exe");
const host = spawn(executablePath, [resolve("."), "--service-host", "--background"], { env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
let hostError = "";
host.stderr.on("data", chunk => { hostError = (hostError + String(chunk)).slice(-4000); });
host.stdout.on("data", () => {});
const stopped = new Promise<void>(resolve => host.once("exit", () => resolve()));
const readyDeadline = Date.now() + 30000;
while (!(await stat(join(root, "profile", "sentry.sqlite")).catch(() => null))) { if (Date.now() > readyDeadline || host.exitCode !== null) throw new Error("Background host did not start: " + hostError); await new Promise(r => setTimeout(r, 100)); }
let client: Awaited<ReturnType<typeof electron.launch>> | undefined;
try {
  assert.equal(host.exitCode, null);
  client = await electron.launch({ executablePath, args: [resolve(".")], env });
  let page = await client.firstWindow();
  await page.waitForFunction(() => !!window.sentry);
  let state = await page.evaluate(() => window.sentry.request({ type: "state" }));
  assert.equal(state.background?.mode, "service");
  await page.evaluate(settings => window.sentry.request({ type: "settings", settings: { ...settings, onboardingDismissed: true } }), state.settings);
  const source = join(root, "sources"); await mkdir(source); await writeFile(join(source, "notes.txt"), "Background backup proof");
  await page.evaluate(location => window.sentry.request({ type: "add-destination", id: "background-repo", name: "Background fixture", kind: "local", location, password: "background-fixture-password", existing: false }), join(root, "repository"));
  await page.evaluate(source => window.sentry.request({ type: "save-plan", plan: { id: "background-plan", name: "Background plan", sources: [source], destinationIds: ["background-repo"], enabled: true, includes: [], excludes: [], schedule: { kind: "manual", time: "18:00", minutes: 60, weekday: 0, day: 1 }, retention: { daily: 7, weekly: 0, monthly: 0 }, priority: 5, pruningSuspended: false } }), source);
  const ids = await page.evaluate(() => window.sentry.request({ type: "run", planId: "background-plan" }));
  await client.close(); client = undefined;
  assert.equal(host.exitCode, null);
  client = await electron.launch({ executablePath, args: [resolve(".")], env });
  page = await client.firstWindow(); await page.waitForFunction(() => !!window.sentry);
  const deadline = Date.now() + 120000;
  do {
    state = await page.evaluate(() => window.sentry.request({ type: "state" }));
    if (!state.busy && ids.every(id => state.jobs.some(j => j.id === id && j.status === "success"))) break;
    if (Date.now() > deadline) throw new Error("Background backup did not complete after desktop disconnected");
    await new Promise(r => setTimeout(r, 200));
  } while (Date.now() <= deadline);
  assert.equal(state.background?.mode, "service");
  const snapshots = await page.evaluate(() => window.sentry.request({ type: "snapshots", destinationId: "background-repo" }));
  assert.equal(snapshots.length, 1);
  const result = await page.evaluate(target => window.sentry.request({ type: "practice-recovery", destinationId: "background-repo", password: "background-fixture-password", target }), join(root, "recovered"));
  assert.equal(result.files, 1);
  await writeFile(join(root, "results.json"), JSON.stringify({ hostPid: host.pid, hostMode: "service-host without BrowserWindow creation", backgroundConnected: true, desktopClosePreservedBackup: true, reconnectedToSameCatalog: true, recoveredFiles: result.files, scope: "Hidden Electron service-host lifecycle; not SCM installation, signed-out operation or reboot proof." }, null, 2));
  console.log("Background native QA passed: " + root);
} finally { await client?.close(); await writeFile(join(root, "profile", "service-stop"), "stop"); await stopped; }
