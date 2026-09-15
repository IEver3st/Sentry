import { _electron as electron } from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import type { State, Request, ResponseMap } from "../src/shared/contracts";

const run = resolve("outputs/recovery-qa", String(Date.now()));
await mkdir(run, { recursive: true });
const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string")), SENTRY_QA: "1", SENTRY_DATA_DIR: join(run, "profile") };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: resolve("node_modules/electron/dist/electron.exe"), args: [resolve(".")], env, timeout: 30000 });
const page = await app.firstWindow();
const errors: string[] = [];
page.on("pageerror", error => errors.push(error.message));
const evidence: Record<string, unknown> = { run };
async function request<T extends Request>(value: T): Promise<ResponseMap[T["type"]]> { return page.evaluate(r => window.sentry.request(r), value) as Promise<ResponseMap[T["type"]]>; }
async function wait(ids: string[]) {
  const deadline = Date.now() + 180000;
  while (true) {
    const state = await request({ type: "state" });
    const jobs = ids.map(id => state.jobs.find(j => j.id === id));
    if (!state.busy && jobs.every(j => j && !["running", "queued"].includes(j.status))) { jobs.forEach(j => assert.equal(j!.status, "success", j!.error)); return state; }
    if (Date.now() > deadline) throw new Error("Native recovery timed out");
    await new Promise(r => setTimeout(r, 200));
  }
}
async function shot(name: string) {
  await page.waitForTimeout(200);
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString("base64"));
  await writeFile(join(run, name + ".png"), Buffer.from(png, "base64"));
  evidence[name] = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth }));
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Page overflow in " + name);
}
try {
  await page.waitForFunction(() => !!window.sentry);
  let state: State = await request({ type: "state" });
  await request({ type: "settings", settings: { ...state.settings, onboardingDismissed: true } });
  await page.reload(); await page.locator(".sidebar").waitFor();
  evidence.security = await app.evaluate(({ BrowserWindow }) => ({ visible: BrowserWindow.getAllWindows()[0].isVisible(), offscreen: BrowserWindow.getAllWindows()[0].webContents.isOffscreen() }));
  assert.equal((evidence.security as { visible: boolean }).visible, false);
  const source = join(run, "Project"); await mkdir(source);
  await writeFile(join(source, "notes.txt"), "Project notes\nKeep an independent copy.\nVersion one.\n");
  await writeFile(join(source, "config.json"), '{"mode":"local","enabled":true}');
  for (const id of ["qa-local", "qa-second"]) await request({ type: "add-destination", id, name: id === "qa-local" ? "Project drive" : "Second copy", location: join(run, id), password: "native-recovery-fixture-password", existing: false, kind: "local" });
  await request({ type: "save-plan", plan: { id: "qa-project", name: "Project files", sources: [source], destinationIds: ["qa-local", "qa-second"], enabled: true, includes: [], excludes: [], schedule: { kind: "manual", time: "18:00", minutes: 60, day: 1, weekday: 0 }, retention: { daily: 7, weekly: 4, monthly: 12 }, priority: 5, pruningSuspended: false, replicateFrom: "qa-local", recoveryDrillDays: 0 } });
  state = await wait(await request({ type: "run", planId: "qa-project", name: "Before configuration change", checkpointDays: 7 }));
  await writeFile(join(source, "notes.txt"), "Project notes\nKeep an independent copy.\nVersion two: settings updated.\n");
  state = await wait(await request({ type: "run", planId: "qa-project", name: "After configuration change" }));
  await page.getByRole("button", { name: "Restore", exact: true }).first().click();
  await page.getByRole("button", { name: "Find a file's history", exact: true }).click();
  await page.getByLabel("File history path", { exact: true }).fill(join(source, "notes.txt"));
  await page.getByRole("button", { name: "Find versions", exact: true }).click();
  await page.locator(".saved-preview pre").waitFor({ timeout: 60000 });
  assert((await page.locator(".saved-preview pre").innerText()).includes("Version two"));
  await shot("01-file-history-dark");
  await page.getByRole("combobox", { name: "Compare file version" }).click();
  await page.getByRole("option").last().click();
  await page.locator(".preview-pair .saved-preview").nth(1).waitFor({ timeout: 60000 });
  await shot("02-compare-text-dark");
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(820, 600));
  await shot("03-history-compact");
  await page.getByRole("button", { name: "Restore this version", exact: true }).click();
  await page.getByLabel("Restore into folder", { exact: true }).fill(join(run, "recovered"));
  await shot("04-restore-selected-version");
  await page.getByRole("button", { name: "Restore files", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  state = await request({ type: "state" });
  await wait(state.jobs.filter(j => j.kind === "restore").map(j => j.id));
  const output = join(run, "recovered", source.replace(/^([A-Z]):/i, "$1"), "notes.txt");
  assert((await readFile(output, "utf8")).includes("Version two"));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1180, 780));
  await page.getByRole("button", { name: "Changes", exact: true }).click();
  await page.locator(".change-row").waitFor({ timeout: 60000 });
  await shot("05-snapshot-changes");
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("tab", { name: "Recovery", exact: true }).click();
  await shot("06-recovery-settings");
  await page.getByRole("button", { name: "Practice recovery", exact: true }).click();
  await page.getByLabel("Practice recovery password", { exact: true }).fill("native-recovery-fixture-password");
  await page.getByLabel("Practice recovery folder", { exact: true }).fill(join(run, "practice"));
  await page.getByRole("button", { name: "Test recovery", exact: true }).click();
  await page.getByText(/1 file restored and verified/).waitFor({ timeout: 60000 });
  assert.equal(await page.getByLabel("Practice recovery password", { exact: true }).inputValue(), "");
  await shot("07-practice-verified");
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  state = await request({ type: "state" });
  await request({ type: "settings", settings: { ...state.settings, theme: "light", uiScale: 200 } });
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light" && innerWidth <= 600);
  await shot("08-recovery-light-200");
  assert.equal(errors.length, 0, errors.join("\n"));
  evidence.errors = errors;
  await writeFile(join(run, "results.json"), JSON.stringify(evidence, null, 2));
  console.log("Recovery native QA passed: " + run);
} finally { await app.close(); }
