import { _electron as electron, type Page } from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { State, Request, ResponseMap } from "../src/shared/contracts";
const directory = resolve("outputs/native-qa");
await mkdir(directory, { recursive: true });
const run = join(directory, Date.now().toString());
await mkdir(join(run, "profile"), { recursive: true });
const packaged = process.argv.includes("--packaged");
const env: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      (pair): pair is [string, string] => typeof pair[1] === "string",
    ),
  ),
  SENTRY_QA: "1",
  SENTRY_DATA_DIR: join(run, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: packaged
    ? resolve("release/win-unpacked/Sentry.exe")
    : resolve("node_modules/electron/dist/electron.exe"),
  args: packaged ? [] : [resolve(".")],
  env,
  timeout: 30000,
});
const page = await app.firstWindow();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.waitForSelector(".sidebar", { timeout: 30000 });
async function request<T extends Request>(
  value: T,
): Promise<ResponseMap[T["type"]]> {
  return page.evaluate((r) => window.sentry.request(r), value) as Promise<
    ResponseMap[T["type"]]
  >;
}
async function shot(name: string) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(run, `${name}.png`) });
}
async function overflow(p: Page) {
  return p.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    scroll: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    hidden: document.hidden,
    node: typeof (window as unknown as { require?: unknown }).require,
  }));
}
const evidence: Record<string, unknown> = {
  packaged,
  versions: await app.evaluate(() => process.versions),
  screens: [],
};
try {
  evidence.security = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return {
      visible: w.isVisible(),
      preferences: (
        w.webContents as unknown as {
          getLastWebPreferences: () => Record<string, unknown>;
        }
      ).getLastWebPreferences(),
    };
  });
  await shot("01-overview-empty-dark");
  await page
    .getByRole("button", { name: "Create your first plan", exact: true })
    .first()
    .click();
  await page.getByRole("dialog").waitFor();
  await shot("02-plan-editor-dark");
  let trapped = true;
  for (let i = 0; i < 24; i++) {
    await page.keyboard.press("Tab");
    trapped =
      trapped &&
      (await page.evaluate(
        () => !!document.activeElement?.closest("[role=dialog]"),
      ));
  }
  evidence.keyboardTrap = trapped;
  if (!trapped) throw new Error("Plan dialog lost keyboard focus");
  await page.keyboard.press("Escape");
  const sourceA = join(run, "sources", "Schoolwork");
  const sourceB = join(run, "sources", "Development");
  await mkdir(sourceA, { recursive: true });
  await mkdir(sourceB, { recursive: true });
  await writeFile(join(sourceA, "notes.txt"), "Semester notes\r\n");
  await writeFile(join(sourceB, "notes.txt"), "Project notes\r\n");
  await writeFile(
    join(sourceA, "Résumé 日本語.txt"),
    "Unicode recovery fixture",
  );
  const id = randomUUID();
  await request({
    type: "add-destination",
    id,
    name: "Local recovery fixture",
    kind: "local",
    location: join(run, "backup"),
    password: "qa-fixture-recovery-credential",
    existing: false,
  });
  const plan: import("../src/shared/contracts").Plan = {
    id: randomUUID(),
    name: "Schoolwork & projects",
    sources: [sourceA, sourceB],
    destinationIds: [id],
    enabled: true,
    includes: [],
    excludes: ["**/node_modules/**"],
    schedule: {
      kind: "manual" as const,
      minutes: 60,
      time: "18:00",
      weekday: 0,
      day: 1,
    },
    retention: { daily: 30, weekly: 8, monthly: 12 },
    priority: 8,
    pruningSuspended: false,
  };
  await page.reload();
  await page
    .getByRole("button", { name: "Create your first plan", exact: true })
    .click();
  await page.getByLabel("Plan name", { exact: true }).fill(plan.name);
  await page
    .getByLabel("Files and folders", { exact: true })
    .fill(plan.sources.join("\n"));
  await page.getByRole("checkbox", { name: /Local recovery fixture/ }).check();
  await page.getByRole("combobox", { name: "Schedule frequency" }).click();
  await page.getByRole("option", { name: "Manually", exact: true }).click();
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const saved = (await request({ type: "state" })).plans.find(
    (p) => p.name === plan.name,
  );
  if (!saved) throw new Error("Plan editor did not persist the plan");
  plan.id = saved.id;
  const jobs = await request({
    type: "run",
    planId: plan.id,
    name: "Before changes",
    pin: true,
  });
  let state: State;
  const deadline = Date.now() + 90000;
  do {
    await new Promise((r) => setTimeout(r, 250));
    state = await request({ type: "state" });
    if (Date.now() > deadline)
      throw new Error("Native backup did not finish in 90s");
  } while (state.busy || state.jobs.some((j) => j.status === "queued"));
  if (state.jobs.find((j) => j.id === jobs[0])?.status !== "success")
    throw new Error(JSON.stringify(state.jobs));
  await page.reload();
  await page.waitForSelector(".ledger-plan");
  await shot("03-overview-protected-dark");
  await page
    .getByRole("button", { name: "Restore", exact: true })
    .first()
    .click();
  await page.locator(".file-row").first().waitFor({ timeout: 30000 });
  await shot("04-restore-dark");
  const snapshots = await request({ type: "snapshots", destinationId: id });
  const files = await request({
    type: "files",
    destinationId: id,
    snapshotId: snapshots[0].id,
    search: "notes",
    offset: 0,
    limit: 100,
  });
  const target = join(run, "restored");
  const restore = await request({
    type: "restore",
    destinationId: id,
    snapshotId: snapshots[0].id,
    target,
    paths: [],
    overwrite: "never",
  });
  do {
    await new Promise((r) => setTimeout(r, 250));
    state = await request({ type: "state" });
  } while (state.busy);
  evidence.restore = state.jobs.find((j) => j.id === restore);
  evidence.indexedPaths = files.entries.map((f) => f.path);
  for (const source of [sourceA, sourceB]) {
    const output = join(
      target,
      source.replace(/^([A-Z]):/i, "$1"),
      "notes.txt",
    );
    if (
      !Buffer.from(await readFile(output)).equals(
        await readFile(join(source, "notes.txt")),
      )
    )
      throw new Error("Native restore contents mismatch");
  }
  const recoveryTest = await request({
    type: "test-recovery",
    destinationId: id,
    snapshotId: snapshots[0].id,
  });
  do {
    await new Promise((r) => setTimeout(r, 250));
    state = await request({ type: "state" });
  } while (state.busy);
  evidence.recoveryTest = state.jobs.find((j) => j.id === recoveryTest);
  if (state.jobs.find((j) => j.id === recoveryTest)?.status !== "success")
    throw new Error("Native sample recovery did not verify.");
  await request({
    type: "settings",
    settings: { ...state.settings, theme: "light" },
  });
  await page.reload();
  await page.waitForSelector(".ledger-plan");
  await shot("05-overview-light");
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(820, 600),
  );
  await shot("06-compact-light");
  evidence.compact = await overflow(page);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1180, 780);
    w.webContents.setZoomFactor(2);
  });
  await shot("07-scale-200-light");
  evidence.scaled = await overflow(page);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1),
  );
  await page
    .getByRole("button", { name: "Settings", exact: true })
    .first()
    .click();
  await shot("08-settings-light");
  const theme = page.getByRole("combobox", { name: "Color theme" });
  await theme.click();
  await shot("09-dropdown-light");
  await page.keyboard.press("Escape");
  if (!(await theme.evaluate((el) => el === document.activeElement))) throw new Error("Select focus did not return");
  const battery = page.getByRole("switch", { name: "Pause automatic backups on battery", exact: true });
  const previous = await battery.isChecked();
  await battery.focus();
  await page.keyboard.press("Space");
  await page.waitForFunction((before) => {
    const field = [...document.querySelectorAll(".toggle-field")].find((el) => el.textContent?.includes("Pause automatic backups on battery"));
    return field?.querySelector("input")?.checked !== before;
  }, previous);
  if ((await battery.isChecked()) === previous) throw new Error("Switch keyboard change failed");
  await page.keyboard.press("Space");
  await theme.click();
  await page.getByRole("option", { name: "Light", exact: true }).focus();
  await page.keyboard.press("d");
  await page.waitForFunction(() => document.activeElement?.textContent?.includes("Dark"));
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  await shot("10-settings-dark");
  await theme.click();
  await shot("11-dropdown-dark");
  await page.keyboard.press("Escape");
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(820, 600));
  await theme.click();
  await shot("12-controls-compact-dark");
  evidence.controlsCompact = await overflow(page);
  await page.keyboard.press("Escape");

  await page.keyboard.press("Tab");
  evidence.keyboard = await page.evaluate(() => ({
    tag: document.activeElement?.tagName,
    label: document.activeElement?.getAttribute("aria-label"),
    text: document.activeElement?.textContent?.slice(0, 80),
  }));
  evidence.errors = errors;
  await page.emulateMedia({ reducedMotion: "reduce" });
  evidence.controlMotion = await battery.evaluate((el) => ({
    track: getComputedStyle(el).transitionDuration,
    thumb: getComputedStyle(el, "::before").transitionDuration,
  }));
  evidence.reducedMotion = await page.evaluate(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  evidence.state = {
    engine: state.engineVersion,
    jobs: state.jobs.map((j) => ({ kind: j.kind, status: j.status })),
    destination: state.destinations[0].status,
  };
  if (errors.length) throw new Error(errors.join("\n"));
  await writeFile(join(run, "results.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ run, evidence }, null, 2));
} finally {
  await app.close();
}
