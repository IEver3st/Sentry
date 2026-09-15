import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Tray,
  Menu,
  nativeImage,
  safeStorage,
  powerMonitor,
  shell,
  screen,
  nativeTheme,
} from "electron";
import { fork, spawn, type ChildProcess } from "node:child_process";
import { readFile, writeFile, rename, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { cpus, freemem, totalmem } from "node:os";
import { DiagnosticLog } from "./diagnostics";
import type { DiagnosticsSnapshot } from "../shared/contracts";
import { requestSchema, type State, type Request } from "../shared/contracts";

import { autoUpdater } from "electron-updater";
import { SoftwareUpdates } from "./updates";
import { BackgroundClient, BackgroundServer, exportServiceSetup } from "./background";
import { backgroundStatus, explorerIntegration } from "./integration";

const qa = process.env.SENTRY_QA === "1";
const serviceHost = process.argv.includes("--service-host");
let backgroundClient: BackgroundClient | undefined;
let backgroundServer: BackgroundServer | undefined;
let historyPath: string | undefined;
function historyArgument(args: string[]) {
  const index = args.indexOf("--history");
  const value = index >= 0 ? args[index + 1] : undefined;
  if (value && /^[A-Za-z]:[\\/]/.test(value) && !/[\0\r\n]/.test(value) && value.length <= 32760) historyPath = value;
}
historyArgument(process.argv);
// This utility renders text and controls, not video or 3D. Avoid retaining a large
// hardware GPU context after the window closes; measured in docs/performance.md.
app.disableHardwareAcceleration();
if (process.env.SENTRY_DATA_DIR)
  app.setPath("userData", process.env.SENTRY_DATA_DIR);
let win: BrowserWindow | undefined;
let tray: Tray;
let worker: ChildProcess;
let quitting = false;
let installing = false;
let updates: SoftwareUpdates;
function publishState() {
  if (current && win && !win.isDestroyed() && !win.isMinimized())
    win.webContents.send("sentry:state", decorate(current));
}
function decorate(state: State): State { return { ...state, update: updates?.state ?? state.update, historyPath, background: { mode: backgroundClient || serviceHost ? "service" : "desktop", installed: !!backgroundClient || serviceHost, detail: backgroundClient || serviceHost ? "Connected to background protection. Closing this window does not stop the service." : "Desktop protection stops when Sentry quits or you sign out." } }; }
const diagnosticLog = new DiagnosticLog();
let previousWorkerCpu: { at: number; total: number } | undefined;
let diagnosticsFlight: Promise<DiagnosticsSnapshot> | undefined;
let metricsStarted = false;
function collectDiagnostics(): Promise<DiagnosticsSnapshot> {
  if (diagnosticsFlight) return diagnosticsFlight;
  diagnosticsFlight = (async () => {
    const start = performance.now();
    const processes: DiagnosticsSnapshot["processes"] = app.getAppMetrics().map((p) => ({ pid: p.pid, name: p.type === "Browser" ? "Electron main" : p.type === "Tab" ? "Renderer" : p.type, cpu: metricsStarted ? p.cpu.percentCPUUsage : null, memory: p.memory.workingSetSize * 1024 }));
    metricsStarted = true;
    let engine: DiagnosticsSnapshot["engine"] = null;
    let engineError: string | undefined;
    try {
      const result = await call({ type: "diagnostics-snapshot" }) as { process: DiagnosticsSnapshot["processes"][number]; cpuUsage: { user: number; system: number }; engine: NonNullable<DiagnosticsSnapshot["engine"]> };
      const at = performance.now();
      const total = result.cpuUsage.user + result.cpuUsage.system;
      result.process.cpu = previousWorkerCpu ? Math.max(0, (total - previousWorkerCpu.total) / ((at - previousWorkerCpu.at) * 1000) * 100 / cpus().length) : null;
      previousWorkerCpu = { at, total };
      processes.push(result.process);
      engine = result.engine;
    } catch { engineError = "Backup worker did not respond. Restart Sentry if this continues."; }
    return { capturedAt: new Date().toISOString(), collectionMs: performance.now() - start,
      runtime: { app: app.getVersion(), electron: process.versions.electron, node: process.versions.node, platform: process.platform, arch: process.arch, uptime: process.uptime(), logicalCores: cpus().length, totalMemory: totalmem(), freeMemory: freemem(), battery: powerMonitor.isOnBatteryPower(), idleSeconds: powerMonitor.getSystemIdleTime(), encryption: safeStorage.isEncryptionAvailable(), workerConnected: !!worker?.connected, pendingRequests: pending.size },
      processes, engine, engineError, ...diagnosticLog.snapshot() };
  })().finally(() => { diagnosticsFlight = undefined; });
  return diagnosticsFlight;
}
let current: State | undefined;
let secrets: Record<string, string> = {};
const pending = new Map<
  string,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();
let cachedMetered: boolean | undefined;
let meteredCheckedAt = 0;
const root = app.isPackaged ? process.resourcesPath : app.getAppPath();
const data = app.getPath("userData");
const compiled = join(app.getAppPath(), "dist");
const secretPath = join(data, "credentials.dpapi");
let saveChain = Promise.resolve();
async function saveSecrets() {
  saveChain = saveChain
    .catch(() => {})
    .then(async () => {
      if (!safeStorage.isEncryptionAvailable())
        throw new Error("Windows credential encryption is unavailable.");
      await mkdir(data, { recursive: true });
      await writeFile(
        secretPath + ".tmp",
        safeStorage.encryptString(JSON.stringify(secrets)),
      );
      await rename(secretPath + ".tmp", secretPath);
    });
  return saveChain;
}
function call(request: Request | { type: "prepare-update" }): Promise<unknown> {
  if (backgroundClient) {
    if (request.type === "prepare-update") return Promise.reject(new Error("Stop the Windows service before installing an update."));
    return backgroundClient.request(request);
  }
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    if (!worker?.connected) { reject(new Error("Backup worker is unavailable.")); return; }
    const timer = ["diagnostics-snapshot", "diagnostics"].includes(request.type) ? setTimeout(() => { pending.delete(id); reject(new Error("Diagnostics request timed out.")); }, 5000) : undefined;
    pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
    worker.send({ kind: "request", id, request }, (error) => { if (error) { pending.delete(id); clearTimeout(timer); reject(error); } });
  });
}
function show() {
  if (serviceHost) return;
  if (win && !win.isDestroyed()) {
    if (!qa) {
      win.show();
      win.focus();
    }
    return;
  }
  const secondary = process.argv.includes("--secondary-display")
    ? screen
        .getAllDisplays()
        .find((d) => d.id !== screen.getPrimaryDisplay().id)
    : undefined;
  if (process.argv.includes("--secondary-display") && !secondary)
    throw new Error("Secondary display is unavailable.");
  const bounds = secondary
    ? {
        x: secondary.workArea.x + 30,
        y: secondary.workArea.y + 30,
        width: Math.min(1180, secondary.workArea.width - 60),
        height: Math.min(780, secondary.workArea.height - 60),
      }
    : { width: 1180, height: 780 };
  win = new BrowserWindow({
    ...bounds,
    minWidth: 820,
    minHeight: 600,
    show: false,
    title: "Sentry",
    backgroundColor: "#101319",
    icon: join(root, "assets/sentry.ico"),
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#101319", symbolColor: "#edf2fa", height: 40 },
    webPreferences: {
      preload: join(compiled, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: true,
      ...(qa ? { offscreen: true } : {}),
    },
  });
  win.webContents.on("did-finish-load", () => {
    win?.webContents.setZoomFactor((current?.settings.uiScale ?? 100) / 100);
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler(
    (_web, _permission, callback) => callback(false),
  );
  win.webContents.session.setPermissionCheckHandler(() => false);
  win.on("close", () => {
    win = undefined;
  });
  win.on("minimize", () =>
    worker.send?.({ kind: "visibility", visible: false }),
  );
  win.on("restore", () => {
    if (current) publishState();
  });
  win.once("ready-to-show", () => {
    if (!qa) {
      if (secondary) win?.showInactive();
      else win?.show();
    }
  });
  void win.loadFile(join(compiled, "renderer/index.html"));
}
function updateTray() {
  if (!tray) return;
  tray.setToolTip(
    current?.settings.paused
      ? "Sentry · protection paused"
      : current?.busy
        ? "Sentry · working"
        : "Sentry · ready",
  );
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Sentry", click: show },
      {
        label: "Back up now",
        enabled: !current?.busy,
        click: () => void call({ type: "run" }).catch(() => {}),
      },
      {
        label: current?.settings.paused
          ? "Resume protection"
          : "Pause protection",
        click: () => {
          if (current)
            void call({
              type: "settings",
              settings: {
                ...current.settings,
                paused: !current.settings.paused,
              },
            });
        },
      },
      { type: "separator" },
      { label: "Quit Sentry", click: () => void quit() },
    ]),
  );
}
async function quit() {
  if (backgroundClient) { quitting = true; backgroundClient.close(); app.quit(); return; }
  if (current?.busy && !qa && !serviceHost) {
    const result = await dialog.showMessageBox({
      type: "question",
      buttons: ["Keep protecting", "Cancel jobs and quit"],
      defaultId: 0,
      cancelId: 0,
      message: "A backup operation is running.",
      detail:
        "Quitting cancels active work and stops scheduled protection until Sentry starts again.",
    });
    if (result.response !== 1) return;
  }
  quitting = true;
  worker?.send?.({ kind: "shutdown" });
  setTimeout(() => app.quit(), serviceHost ? 25000 : 2000).unref();
}
async function policy() {
  if (backgroundClient) return;
  let metered = cachedMetered;
  if (
    process.platform === "win32" &&
    Date.now() - meteredCheckedAt > 15 * 60_000
  ) {
    meteredCheckedAt = Date.now();
    metered = await new Promise((resolve) => {
      const child = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "[Windows.Networking.Connectivity.NetworkInformation,Windows,ContentType=WindowsRuntime] > $null; $p=[Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile(); if ($null -eq $p) { 'unknown' } else { $c=$p.GetConnectionCost(); if ($c.NetworkCostType -eq 'Unrestricted' -and -not $c.Roaming -and -not $c.OverDataLimit) {'no'} else {'yes'} }",
        ],
        {
          windowsHide: true,
          shell: false,
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
      let result = "";
      child.stdout.on("data", (b) => {
        result += String(b);
      });
      child.on("error", () => resolve(undefined));
      child.on("close", () =>
        resolve(
          result.trim() === "yes"
            ? true
            : result.trim() === "no"
              ? false
              : undefined,
        ),
      );
    });
    cachedMetered = metered;
  }
  worker.send?.({
    kind: "policy",
    battery: powerMonitor.isOnBatteryPower(),
    idleSeconds: serviceHost ? 0 : powerMonitor.getSystemIdleTime(),
    metered,
  });
}
if (!qa && !serviceHost && !app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", (_event, argv) => { historyArgument(argv); publishState(); show(); });
  app
    .whenReady()
    .then(async () => {
      await mkdir(data, { recursive: true });
      updates = new SoftwareUpdates(app.isPackaged && !qa && !serviceHost, publishState, autoUpdater);
      if (!serviceHost) {
        const client = new BackgroundClient(data, state => { current = state; publishState(); updateTray(); }, () => { if (backgroundClient && !quitting) { diagnosticLog.add({ source: "engine", level: "error", message: "Background service disconnected" }); } });
        if (await client.connect()) backgroundClient = client;
      }
      if (!backgroundClient) {
      backgroundServer = new BackgroundServer(data, serviceHost ? "service" : "desktop", request => call(request), () => current);
      await backgroundServer.listen();
      try {
        secrets = JSON.parse(
          safeStorage.decryptString(await readFile(secretPath)),
        ) as Record<string, string>;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          throw new Error(
            "Saved credentials could not be decrypted. Original credential file was preserved.",
          );
      }
      worker = fork(join(compiled, "worker.cjs"), [], {
        execPath: process.execPath,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      worker.stdout?.on("data", () => {});
      worker.stderr?.on("data", () => {});
      diagnosticLog.add({ source: "application", level: "info", message: "Application session started" });
      worker.on("exit", (code) => {
        diagnosticLog.add({ source: "engine", level: quitting ? "info" : "error", message: "Backup worker exited" });
        for (const p of pending.values())
          p.reject(
            new Error(
              "Backup worker stopped. Restart Sentry to recover pending work.",
            ),
          );
        pending.clear();
        if (installing && code === 0) { quitting = true; updates.install(); }
        else if (installing) { installing = false; updates.set({ status: "error", message: "Backup worker did not shut down cleanly. Restart Sentry before updating." }); }
        else if (quitting) app.quit();
      });
      worker.on("message", async (raw: unknown) => {
        const m = raw as {
          kind: string;
          id: string;
          value: unknown;
          error?: string;
          key?: string;
          secret?: string;
          url?: string;
        };
        if (m.kind === "response") {
          const p = pending.get(m.id);
          pending.delete(m.id);
          if (m.error) p?.reject(new Error(m.error));
          else p?.resolve(m.value);
        }
        if (m.kind === "state") {
          current = m.value as State;
          backgroundServer?.publish(current);
          diagnosticLog.observe(current);
          if (win && !win.isDestroyed()) {
            const scale = current.settings.uiScale / 100;
            if (win.webContents.getZoomFactor() !== scale) win.webContents.setZoomFactor(scale);
            const dark =
              current.settings.theme === "dark" ||
              (current.settings.theme === "system" &&
                nativeTheme.shouldUseDarkColors);
            win.setTitleBarOverlay({
              color: dark ? "#141922" : "#edf1f7",
              symbolColor: dark ? "#edf2fa" : "#182436",
              height: 34,
            });
            if (!win.isMinimized())
              publishState();
          }
          updateTray();
        }
        if (m.kind === "secret") {
          try {
            if (m.secret === undefined) delete secrets[m.key!];
            else secrets[m.key!] = m.secret;
            await saveSecrets();
            worker.send?.({ kind: "host-response", id: m.id, value: true });
          } catch {
            worker.send?.({
              kind: "host-response",
              id: m.id,
              error: "Could not securely store credentials.",
            });
          }
        }
        if (m.kind === "authorize") {
          try {
            const u = new URL(m.url!);
            if (u.origin !== "https://accounts.google.com")
              throw new Error("Invalid authorization host.");
            if (qa || serviceHost)
              throw new Error(
                "Browser authorization is disabled during hidden validation.",
              );
            await shell.openExternal(u.toString());
            worker.send?.({ kind: "host-response", id: m.id, value: true });
          } catch (e) {
            worker.send?.({
              kind: "host-response",
              id: m.id,
              error: (e as Error).message,
            });
          }
        }
      });
      worker.send({
        kind: "init",
        data,
        engines: join(root, app.isPackaged ? "engines" : "vendor/bin"),
        secrets,
        clientId: process.env.SENTRY_GOOGLE_CLIENT_ID ?? "",
        clientSecret: process.env.SENTRY_GOOGLE_CLIENT_SECRET ?? "",
      });
      }
      if (serviceHost) {
        await unlink(join(data, "service-stop")).catch(() => {});
        let checkingStop = false;
        setInterval(() => { if (checkingStop) return; checkingStop = true; void readFile(join(data, "service-stop")).then(() => quit()).catch(() => {}).finally(() => { checkingStop = false; }); }, 1000).unref();
        powerMonitor.on("resume", () => { worker.send?.({ kind: "resume" }); void policy(); });
        setInterval(() => void policy(), 60_000).unref();
        void policy();
        return;
      }
      tray = new Tray(
        nativeImage
          .createFromPath(join(root, "assets/sentry-icon.png"))
          .resize({ width: 20, height: 20 }),
      );
      tray.on("double-click", show);
      updateTray();
      ipcMain.handle("sentry:request", async (event, raw: unknown) => {
        const started = performance.now();
        let operation: Request["type"] | undefined;
        let failed = false;
        try {
          if (
            !win ||
            event.sender !== win.webContents ||
            event.senderFrame !== win.webContents.mainFrame
          )
            throw new Error("Untrusted request.");
          const request = requestSchema.parse(raw);
          operation = request.type;
          if (request.type === "diagnostics-snapshot") return { ok: true, value: await collectDiagnostics() };
          if (installing || quitting) throw new Error("Sentry is restarting. Try again after it opens.");
          if (request.type === "state") return { ok: true, value: decorate(await call(request) as State) };
          if (request.type === "explorer-integration") {
            if (qa || !app.isPackaged) throw new Error("Enable Explorer integration from the installed application.");
            return { ok: true, value: await explorerIntegration(process.execPath, request.enabled) };
          }
          if (request.type === "background-service") {
            if (request.action === "status") return { ok: true, value: await backgroundStatus(data, !!backgroundClient) };
            if (qa || !app.isPackaged) throw new Error("Export service setup from the installed application at its permanent location.");
            const selected = await dialog.showOpenDialog(win, { title: "Choose an empty folder for service setup", properties: ["openDirectory", "createDirectory"] });
            if (selected.canceled || !selected.filePaths[0]) return { ok: true, value: { mode: "desktop", installed: false, detail: "Setup export cancelled." } };
            await exportServiceSetup(selected.filePaths[0], join(root, "service"), data, process.execPath);
            return { ok: true, value: { mode: "desktop", installed: false, detail: `Setup exported to ${selected.filePaths[0]}. Quit Sentry, then run service-setup.ps1 in administrator PowerShell using your Windows account password.` } };
          }
          if (request.type === "recovery-kit") {
            const contents = await call(request) as string;
            if (qa) return { ok: true, value: contents };
            const selected = await dialog.showSaveDialog(win, { title: "Save recovery kit", defaultPath: "Sentry recovery kit.txt" });
            if (selected.canceled || !selected.filePath) return { ok: true, value: "Export cancelled" };
            await writeFile(selected.filePath, contents, "utf8");
            return { ok: true, value: selected.filePath };
          }
          if (request.type === "updates") {
            if (backgroundClient && request.action === "install") throw new Error("Stop the Windows service before installing an update. Backups must finish first.");
            if (request.action === "check") return { ok: true, value: await updates.check() };
            if (request.action === "download") return { ok: true, value: await updates.download() };
            if (updates.state.status !== "ready") throw new Error("No downloaded update is ready.");
            // The worker checks again atomically before stopping its scheduler.
            installing = true;
            try { await call({ type: "prepare-update" }); }
            catch (error) { installing = false; throw error; }
            updates.set({ ...updates.state, status: "installing" });
            worker.send({ kind: "shutdown" });
            return { ok: true, value: updates.state };
          }
          if (request.type === "choose-path") {
            if (qa)
              throw new Error(
                "Native dialogs are disabled in hidden validation.",
              );
            if (request.kind === "save") {
              const r = await dialog.showSaveDialog(win, {
                title: "Export diagnostics",
                defaultPath: "sentry-diagnostics.json",
              });
              return { ok: true, value: r.canceled ? [] : [r.filePath] };
            }
            const r = await dialog.showOpenDialog(win, {
              properties:
                request.kind === "sources"
                  ? ["openFile", "openDirectory", "multiSelections"]
                  : request.kind === "folder"
                    ? ["openDirectory", "createDirectory"]
                    : ["openFile"],
            });
            return { ok: true, value: r.canceled ? [] : r.filePaths };
          }
          if (request.type === "window") {
            if (request.action === "close") win.close();
            if (request.action === "minimize") win.minimize();
            if (request.action === "maximize") {
              if (win.isMaximized()) win.unmaximize();
              else win.maximize();
            }
            if (request.action === "quit") void quit();
            return { ok: true, value: true };
          }
          if (
            request.type === "settings" &&
            !qa &&
            request.settings.startAtLogin !== current?.settings.startAtLogin
          ) {
            app.setLoginItemSettings({
              openAtLogin: request.settings.startAtLogin,
              args: ["--background"],
            });
          }
          if (request.type === "diagnostics") {
            let metadata: Record<string, unknown>;
            try { metadata = JSON.parse((await call(request)) as string) as Record<string, unknown>; }
            catch { metadata = { partial: true, note: "Engine metadata unavailable. This report contains application counters and safe session events only; paths, account details, credentials and file contents are excluded." }; }
            const contents = JSON.stringify({ ...metadata, diagnostics: await collectDiagnostics() }, null, 2);
            if (qa) return { ok: true, value: contents };
            const r = await dialog.showSaveDialog(win, {
              defaultPath: "sentry-diagnostics.json",
            });
            if (r.canceled || !r.filePath)
              return { ok: true, value: "Export cancelled" };
            await writeFile(r.filePath, contents, "utf8");
            return { ok: true, value: r.filePath };
          }
          return { ok: true, value: await call(request) };
        } catch (e) {
          failed = true;
          return {
            ok: false,
            error: e instanceof Error ? e.message : "The request failed.",
          };
        } finally {
          if (operation && !["state", "diagnostics-snapshot", "window"].includes(operation))
            diagnosticLog.add({ source: "request", level: failed ? "error" : "info", message: failed ? "Request failed; review the operation in Activity" : "Request completed", operation, durationMs: Math.round(performance.now() - started) });
        }
      });
      powerMonitor.on("resume", () => {
        worker?.send?.({ kind: "resume" });
        void policy();
      });
      powerMonitor.on("on-ac", () => void policy());
      powerMonitor.on("on-battery", () => void policy());
      setInterval(() => void policy(), 60_000).unref();
      void policy();
      if (app.isPackaged && !qa) {
        setTimeout(() => void updates.check(), 15_000).unref();
        setInterval(() => void updates.check(), 6 * 60 * 60_000).unref();
      }
      if (!process.argv.includes("--background")) show();
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "Startup failed");
      quitting = true;
      app.exit(1);
    });
}
app.on("window-all-closed", () => {});
app.on("will-quit", () => { void backgroundServer?.close(); backgroundClient?.close(); });
app.on("before-quit", (event) => {
  if (!quitting) {
    event.preventDefault();
    void quit();
  }
});
