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
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { requestSchema, type State, type Request } from "../shared/contracts";

const qa = process.env.SENTRY_QA === "1";
// This utility renders text and controls, not video or 3D. Avoid retaining a large
// hardware GPU context after the window closes; measured in docs/performance.md.
app.disableHardwareAcceleration();
if (process.env.SENTRY_DATA_DIR)
  app.setPath("userData", process.env.SENTRY_DATA_DIR);
let win: BrowserWindow | undefined;
let tray: Tray;
let worker: ChildProcess;
let quitting = false;
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
function call(request: Request): Promise<unknown> {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.send?.({ kind: "request", id, request });
  });
}
function show() {
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
    if (current) win?.webContents.send("sentry:state", current);
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
  if (current?.busy && !qa) {
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
  setTimeout(() => app.quit(), 2000).unref();
}
async function policy() {
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
    idleSeconds: powerMonitor.getSystemIdleTime(),
    metered,
  });
}
if (!qa && !app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", show);
  app
    .whenReady()
    .then(async () => {
      await mkdir(data, { recursive: true });
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
      worker.on("exit", () => {
        for (const p of pending.values())
          p.reject(
            new Error(
              "Backup worker stopped. Restart Sentry to recover pending work.",
            ),
          );
        pending.clear();
        if (quitting) app.quit();
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
          if (win && !win.isDestroyed()) {
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
              win.webContents.send("sentry:state", current);
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
            if (qa)
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
      tray = new Tray(
        nativeImage
          .createFromPath(join(root, "assets/sentry-icon.png"))
          .resize({ width: 20, height: 20 }),
      );
      tray.on("double-click", show);
      updateTray();
      ipcMain.handle("sentry:request", async (event, raw: unknown) => {
        try {
          if (
            !win ||
            event.sender !== win.webContents ||
            event.senderFrame !== win.webContents.mainFrame
          )
            throw new Error("Untrusted request.");
          const request = requestSchema.parse(raw);
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
            const contents = (await call(request)) as string;
            if (qa) return { ok: true, value: contents };
            const r = await dialog.showSaveDialog(win, {
              defaultPath: "sentry-diagnostics.json",
            });
            if (r.canceled || !r.filePath)
              return { ok: true, value: "Export cancelled" };
            await writeFile(r.filePath, contents, "utf8");
            return { ok: true, value: r.filePath };
          }
          if (request.type === "updates" && request.action === "download") {
            if (current?.busy)
              throw new Error(
                "Wait for active jobs to finish before downloading an update.",
              );
            const result = (await call(request)) as State["update"];
            if (result.url && !qa) await shell.openExternal(result.url);
            return { ok: true, value: result };
          }
          return { ok: true, value: await call(request) };
        } catch (e) {
          return {
            ok: false,
            error: e instanceof Error ? e.message : "The request failed.",
          };
        }
      });
      powerMonitor.on("resume", () => {
        worker.send?.({ kind: "resume" });
        void policy();
      });
      powerMonitor.on("on-ac", () => void policy());
      powerMonitor.on("on-battery", () => void policy());
      setInterval(() => void policy(), 60_000).unref();
      void policy();
      if (!process.argv.includes("--background")) show();
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "Startup failed");
      quitting = true;
      app.exit(1);
    });
}
app.on("window-all-closed", () => {});
app.on("before-quit", (event) => {
  if (!quitting) {
    event.preventDefault();
    void quit();
  }
});
