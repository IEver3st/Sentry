import { app } from 'electron'
import electronUpdater, { type UpdateInfo } from 'electron-updater'
import type { Settings, UpdateStatus } from '@shared/types'

const { autoUpdater } = electronUpdater

const FIRST_CHECK_MS = 15_000
const EVERY_MS = 4 * 60 * 60 * 1000

/**
 * Keeps Sentry current through electron-updater (GitHub Releases feed from electron-builder).
 * Updates only exist for installed builds: in dev, or without a release feed, the status says so
 * instead of pretending to check.
 */
export class Updater {
  private status: UpdateStatus
  private timer: NodeJS.Timeout | null = null
  private firstCheck: NodeJS.Timeout | null = null
  private checking: Promise<unknown> | null = null

  constructor(
    private readonly settings: () => Settings,
    private readonly emit: (status: UpdateStatus) => void,
    private readonly beforeInstall: () => void
  ) {
    this.status = { state: app.isPackaged ? 'idle' : 'unsupported', currentVersion: app.getVersion() }
    if (!app.isPackaged) return

    autoUpdater.logger = null
    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking', error: undefined }))
    autoUpdater.on('update-not-available', () => this.set({ state: 'up-to-date', checkedAt: new Date().toISOString() }))
    autoUpdater.on('update-available', (info: UpdateInfo) =>
      this.set({ state: 'available', version: info.version, releaseNotes: notes(info), checkedAt: new Date().toISOString() })
    )
    autoUpdater.on('download-progress', (p) => this.set({ state: 'downloading', progress: Math.round(p.percent) }))
    autoUpdater.on('update-downloaded', (info: UpdateInfo) => this.set({ state: 'ready', version: info.version, progress: 100, releaseNotes: notes(info) }))
    autoUpdater.on('error', (error: Error) => this.set({ state: 'error', error: friendly(error) }))
  }

  get(): UpdateStatus {
    return { ...this.status }
  }

  private set(patch: Partial<UpdateStatus>): void {
    if (Object.entries(patch).every(([key, value]) => this.status[key as keyof UpdateStatus] === value)) return
    this.status = { ...this.status, ...patch }
    this.emit(this.get())
  }

  /** Re-read settings: channel, auto download, install on quit, and the check schedule. */
  apply(): void {
    if (!app.isPackaged) return
    const s = this.settings()
    autoUpdater.autoDownload = s.autoDownloadUpdates
    autoUpdater.autoInstallOnAppQuit = s.installOnQuit
    autoUpdater.allowPrerelease = s.betaUpdates
    if (!s.autoCheckUpdates) this.dispose()
    else if (!this.timer) {
      this.firstCheck = setTimeout(() => {
        this.firstCheck = null
        void this.check().catch(() => undefined)
      }, FIRST_CHECK_MS)
      this.timer = setInterval(() => void this.check().catch(() => undefined), EVERY_MS)
      this.firstCheck.unref()
      this.timer.unref()
    }
  }

  dispose(): void {
    if (this.firstCheck) clearTimeout(this.firstCheck)
    if (this.timer) clearInterval(this.timer)
    this.firstCheck = this.timer = null
  }

  async check(): Promise<UpdateStatus> {
    if (!app.isPackaged) return this.get()
    if (this.status.state === 'downloading' || this.status.state === 'ready') return this.get()
    this.checking ??= autoUpdater.checkForUpdates().finally(() => (this.checking = null))
    try {
      await this.checking
    } catch (error) {
      this.set({ state: 'error', error: friendly(error) })
    }
    return this.get()
  }

  async download(): Promise<void> {
    if (!app.isPackaged || this.status.state !== 'available') return
    this.set({ state: 'downloading', progress: 0 })
    await autoUpdater.downloadUpdate()
  }

  install(): void {
    if (this.status.state !== 'ready') return
    this.beforeInstall()
    // Silent install, then relaunch into the new version.
    autoUpdater.quitAndInstall(true, true)
  }
}

function notes(info: UpdateInfo): string | undefined {
  const n = info.releaseNotes
  if (!n) return undefined
  const text = typeof n === 'string' ? n : n.map((x) => x.note ?? '').join('\n')
  return text.replace(/<[^>]+>/g, '').trim().slice(0, 600) || undefined
}

function friendly(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error)
  if (/app-update\.yml|ENOENT/i.test(msg)) return 'This build has no update feed configured.'
  if (/net::|ENOTFOUND|ETIMEDOUT|ECONNREFUSED/i.test(msg)) return 'Couldn’t reach the update server. Sentry will try again later.'
  if (/404/.test(msg)) return 'No published releases found yet.'
  return 'Update check failed. Sentry will try again later.'
}
