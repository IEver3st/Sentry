import { app, BrowserWindow, Menu, nativeImage, Notification, Tray } from 'electron'
import type { Settings, Transfer, UpdateStatus } from '@shared/types'
import { registerNotificationIdentity } from './notification-identity'

type Route = 'home' | 'files' | 'map' | 'shared' | 'transfers' | 'settings'

interface Deps {
  settings: () => Settings
  window: () => BrowserWindow | null
  navigate: (route: Route) => void
  pickAndUpload: () => void
  checkForUpdates: () => void
  installUpdate: () => void
  trayIcon: string
  notificationIcon: string
  appId: string
}

/**
 * Everything that lets Sentry live quietly in the background: the tray,
 * launch at sign-in, close-to-tray, and system notifications while hidden.
 */
export class Background {
  private tray: Tray | null = null
  quitting = false
  private toldAboutTray = false
  private activeTransfers = 0
  private update: UpdateStatus | null = null
  private loginEnabled: boolean | null = null
  private notificationIdentity: Promise<void> | null = null

  constructor(private readonly deps: Deps) {
    app.on('before-quit', () => (this.quitting = true))
  }

  /** Apply login item + tray settings. Safe to call after every settings change. */
  apply(): void {
    const s = this.deps.settings()
    if ((process.platform === 'win32' || process.platform === 'darwin') && this.loginEnabled !== s.launchAtLogin) {
      // Dev builds launch through electron.exe, so the app folder must ride along.
      const args = [...(app.isPackaged ? [] : [app.getAppPath()]), '--hidden']
      app.setLoginItemSettings({ openAtLogin: s.launchAtLogin, path: process.execPath, args })
      this.loginEnabled = s.launchAtLogin
    }
    if (s.showTray && !this.tray) this.createTray()
    if (!s.showTray && this.tray) {
      this.tray.destroy()
      this.tray = null
    }
    this.refreshMenu()
  }

  /** Should a window launched with these args stay hidden? */
  startHidden(argv: string[]): boolean {
    const s = this.deps.settings()
    return argv.includes('--hidden') && s.startMinimized && s.showTray
  }

  /** Close button: hide to tray instead of quitting when the user wants that. */
  attach(win: BrowserWindow): void {
    win.on('close', (e) => {
      const s = this.deps.settings()
      if (this.quitting || !s.closeToTray || !this.tray) return
      e.preventDefault()
      win.hide()
      if (!this.toldAboutTray) {
        this.toldAboutTray = true
        this.notify('Sentry is still running', 'It keeps transfers going from the tray. Quit from the tray menu anytime.', true)
      }
    })
  }

  show(route?: Route): void {
    const win = this.deps.window()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    if (route) this.deps.navigate(route)
  }

  isHidden(): boolean {
    const win = this.deps.window()
    return !win || !win.isVisible() || win.isMinimized() || !win.isFocused()
  }

  /** Native notification, only when the user can't see Sentry (or when forced). */
  notify(title: string, body: string, force = false, route?: Route): void {
    if (!Notification.isSupported()) return
    if (!force && (!this.deps.settings().systemNotifications || !this.isHidden())) return
    void this.showNotification(title, body, force, route)
  }

  private async showNotification(title: string, body: string, force: boolean, route?: Route): Promise<void> {
    if (process.platform === 'win32') {
      this.notificationIdentity ??= registerNotificationIdentity(this.deps.appId, this.deps.notificationIcon).catch((error) => {
        // Keep transfer/update alerts working if Windows denies registration; retry next time.
        this.notificationIdentity = null
        console.warn('Could not register Sentry notification identity:', error)
      })
      await this.notificationIdentity
    }
    // The user may reopen the app or turn notifications off during registration.
    if (this.quitting || (!force && (!this.deps.settings().systemNotifications || !this.isHidden()))) return
    const n = new Notification({ title, body, icon: this.deps.notificationIcon, silent: false })
    n.on('click', () => this.show(route))
    n.show()
  }

  onTransfers(list: Transfer[]): void {
    const active = list.filter((t) => t.state === 'running' || t.state === 'queued').length
    if (this.activeTransfers > 0 && active === 0) {
      const recent = list.filter((t) => t.finishedAt && Date.now() - Date.parse(t.finishedAt) < 120_000)
      const failed = recent.filter((t) => t.state === 'failed').length
      const up = recent.filter((t) => t.state === 'done' && t.direction === 'up').length
      const down = recent.filter((t) => t.state === 'done' && t.direction === 'down').length
      if (failed) this.notify(`${failed} transfer${failed === 1 ? '' : 's'} didn’t finish`, 'Open Sentry to see what happened.', false, 'transfers')
      else if (up || down)
        this.notify(
          up ? 'Safely in Google Drive' : 'Pulled down',
          [up && `${up} file${up === 1 ? '' : 's'} uploaded`, down && `${down} downloaded`].filter(Boolean).join(', ') + '.',
          false,
          'transfers'
        )
    }
    if (active !== this.activeTransfers) {
      this.activeTransfers = active
      this.refreshMenu()
    }
  }

  onUpdate(status: UpdateStatus): void {
    const wasReady = this.update?.state === 'ready'
    this.update = status
    if (status.state === 'ready' && !wasReady) {
      this.notify(`Sentry ${status.version} is ready`, this.deps.settings().installOnQuit ? 'It installs next time Sentry quits, or restart now from the tray.' : 'Restart Sentry from the tray to finish updating.')
    }
    this.refreshMenu()
  }

  private createTray(): void {
    const image = nativeImage.createFromPath(this.deps.trayIcon)
    // .ico carries its own small sizes on Windows; other platforms get a scaled PNG.
    this.tray = new Tray(process.platform === 'win32' || image.isEmpty() ? image : image.resize({ width: 16, height: 16 }))
    this.tray.setToolTip('Sentry')
    this.tray.on('click', () => this.show())
    this.tray.on('double-click', () => this.show())
  }

  private refreshMenu(): void {
    if (!this.tray) return
    const moving = this.activeTransfers
    const u = this.update
    this.tray.setToolTip(moving ? `Sentry · ${moving} file${moving === 1 ? '' : 's'} moving` : 'Sentry')
    const template: Electron.MenuItemConstructorOptions[] = [
      { label: 'Open Sentry', click: () => this.show() },
      { label: 'Send files to Drive…', click: () => this.deps.pickAndUpload() },
      { type: 'separator' },
      moving
        ? { label: `${moving} file${moving === 1 ? '' : 's'} moving…`, click: () => this.show('transfers') }
        : { label: 'Transfers', click: () => this.show('transfers') },
      { label: 'Settings', click: () => this.show('settings') },
      { type: 'separator' },
      u?.state === 'ready'
        ? { label: `Restart to update to ${u.version}`, click: () => this.deps.installUpdate() }
        : u?.state === 'downloading'
          ? { label: `Downloading update… ${u.progress ?? 0}%`, enabled: false }
          : { label: 'Check for updates', enabled: u?.state !== 'unsupported', click: () => this.deps.checkForUpdates() },
      { type: 'separator' },
      {
        label: 'Quit Sentry',
        click: () => {
          this.quitting = true
          app.quit()
        }
      }
    ]
    this.tray.setContextMenu(Menu.buildFromTemplate(template))
  }
}
