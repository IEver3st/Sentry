import type { AppUpdater } from "electron-updater";
import type { UpdateState } from "../shared/contracts";

export class SoftwareUpdates {
  state: UpdateState;
  private checking = false;
  constructor(private enabled: boolean, private publish: () => void, private updater: Pick<AppUpdater, "autoDownload" | "autoInstallOnAppQuit" | "allowPrerelease" | "allowDowngrade" | "logger" | "on" | "checkForUpdates" | "quitAndInstall">) {
    this.state = enabled ? { status: "idle" } : { status: "unavailable", message: "Automatic updates are available in the installed app." };
    this.updater.autoDownload = true;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.allowPrerelease = false;
    this.updater.allowDowngrade = false;
    this.updater.logger = null;
    this.updater.on("checking-for-update", () => this.set({ status: "checking" }));
    this.updater.on("update-not-available", () => this.set({ status: "current" }));
    this.updater.on("update-available", info => this.set({ status: "downloading", version: info.version, progress: 0 }));
    this.updater.on("download-progress", info => this.set({ ...this.state, status: "downloading", progress: Math.min(100, Math.max(0, info.percent)) }));
    this.updater.on("update-downloaded", info => this.set({ status: "ready", version: info.version }));
    this.updater.on("error", () => this.set({ status: "error", message: "Could not update Sentry. Check your connection and try again. The release may not be available yet." }));
  }
  set(state: UpdateState) { this.state = state; this.publish(); }
  async check() {
    if (!this.enabled || this.checking || ["downloading", "ready", "installing"].includes(this.state.status)) return this.state;
    this.checking = true;
    try { await this.updater.checkForUpdates(); }
    catch { this.set({ status: "error", message: "Could not check for updates. Check your connection and try again. The release may not be available yet." }); }
    finally { this.checking = false; }
    return this.state;
  }
  install() { this.updater.quitAndInstall(true, true); }
}
