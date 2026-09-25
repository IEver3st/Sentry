import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, nativeTheme } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { INBOX_FOLDER, THEME_BACKGROUND, type AppBootstrap, type ProviderId, type ProviderStatus, type SentryEvents, type Settings } from '@shared/types'
import type { DriveProvider } from './providers/types'
import { DemoProvider } from './providers/demo'
import { GoogleAuth, GoogleSessionExpired } from './providers/google-auth'
import { GoogleProvider } from './providers/google'
import { TransferQueue } from './transfers'
import { cancelLocalScan, driveMap, scanLocal, setScanProgressEnabled } from './map'
import { RendererEvents } from './renderer-events'
import { runCapture } from './capture'
import { Background } from './background'
import { LocalScanCache } from './local-cache'
import { containsPath, normalizeRoots, selectedRoots } from './local-roots'
import { localDrives } from './local-drives'
import { Updater } from './updater'
import { installShellIntegration, removeShellIntegration, shellStatus, uploadPathsFrom } from './shell-integration'
import iconIco from '../../resources/icon.ico?asset'
import iconPng from '../../resources/icon.png?asset'

/** Windows wants the multi-size .ico for crisp taskbar/Alt-Tab icons at every DPI. */
const appIcon = process.platform === 'win32' ? iconIco : iconPng
const appId = app.isPackaged ? 'com.ever3st.sentry' : 'com.ever3st.sentry.dev'
if (process.platform === 'win32') app.setAppUserModelId(appId)

const captureBackground = process.argv.includes('--capture-background')
const capture = process.argv.includes('--capture') || captureBackground
if (capture) {
  // Fresh profile every run so onboarding is exercised from the top.
  const profile = join(process.cwd(), 'capture', captureBackground ? 'background-profile' : 'profile')
  rmSync(profile, { recursive: true, force: true })
  app.setPath('userData', profile)
}

// One Sentry at a time. A second launch (e.g. Explorer's "Send to Google Drive") hands its files to the running one.
const launchUploads = uploadPathsFrom(process.argv)
const primary = capture || app.requestSingleInstanceLock({ upload: launchUploads })
if (!primary) app.quit()

const userData = app.getPath('userData')
const settingsPath = join(userData, 'settings.json')

const defaults = (): Settings => ({
  onboarded: false,
  provider: null,
  name: '',
  downloadDir: app.getPath('downloads'),
  scanRoot: homedir(),
  reduceMotion: false,
  theme: 'midnight',
  accent: 'sky',
  uiScale: 1,
  startPage: 'home',
  confirmTrash: true,
  notifyTransfers: true,
  askWhereToSave: false,
  concurrency: 3,
  mapDepth: 2,
  sizeBars: true,
  launchAtLogin: false,
  startMinimized: true,
  closeToTray: true,
  showTray: true,
  systemNotifications: true,
  contextMenu: false,
  sendToTarget: 'inbox',
  autoCheckUpdates: true,
  autoDownloadUpdates: true,
  installOnQuit: true,
  betaUpdates: false
})

let settings: Settings = defaults()
const auth = new GoogleAuth(userData)
const demo = new DemoProvider(join(userData, 'demo-drive'), () => settings.name)
const google = new GoogleProvider(auth)
let window: BrowserWindow | null = null
let connecting = false

function requireIdleAccount(): void {
  if (connecting) throw new Error('Finish or cancel the current sign-in first.')
  if (transfers.isBusy()) throw new Error('Finish or cancel your transfers before changing accounts.')
}

function provider(): DriveProvider {
  if (settings.provider === 'google') return google
  if (settings.provider === 'demo') return demo
  throw new Error('Connect a drive first.')
}

function send<K extends keyof SentryEvents>(event: K, payload: SentryEvents[K]): void {
  rendererEvents.send(event, payload)
}

const rendererEvents = new RendererEvents(
  (event, payload) => {
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(`sentry:event:${event}`, payload)
    }
  },
  (active) => {
    transfers.setProgressEnabled(active)
    setScanProgressEnabled(active)
  }
)

function syncRendererActivity(): void {
  const active = Boolean(window && !window.isDestroyed() && (capture || (window.isVisible() && !window.isMinimized())))
  setRendererActivity(active)
}

function setRendererActivity(active: boolean): void {
  if (active && !rendererEvents.active) send('transfers', transfers.list())
  rendererEvents.setVisible(active)
}

const transfers = new TransferQueue(
  provider,
  (list) => {
    send('transfers', list)
    background.onTransfers(list)
  },
  (folderIds) => send('drive-changed', { folderIds }),
  () => settings.concurrency
)

const localScans = new LocalScanCache(userData)

const background = new Background({
  settings: () => settings,
  window: () => window,
  navigate: (route) => send('navigate', { route }),
  pickAndUpload: () => void pickAndSend(),
  checkForUpdates: () => void updater.check(),
  installUpdate: () => updater.install(),
  trayIcon: appIcon,
  notificationIcon: iconPng,
  appId
})

const updater = new Updater(
  () => settings,
  (status) => {
    send('update-status', status)
    background.onUpdate(status)
  },
  () => (background.quitting = true)
)

/* ---------- Uploads from Explorer / the tray ---------- */

let pendingUploads: string[] = []
let uploadTimer: NodeJS.Timeout | null = null

/** Explorer launches once per selected item; batch arrivals that land together into one upload. */
function queueExternalUpload(paths: string[]): void {
  if (!paths.length) return
  pendingUploads.push(...paths)
  if (uploadTimer) clearTimeout(uploadTimer)
  uploadTimer = setTimeout(() => void flushExternalUploads(), 450)
}

async function flushExternalUploads(): Promise<void> {
  const paths = [...new Set(pendingUploads)].filter((p) => existsSync(p))
  pendingUploads = []
  if (!paths.length) return
  if (!settings.onboarded || !settings.provider || connecting) {
    background.show()
    background.notify('Connect a drive first', 'Finish setting up Sentry, then send your files again.', true)
    return
  }
  try {
    let parentId: string | null = null
    let label = 'My Drive'
    if (settings.sendToTarget === 'inbox') {
      const root = await provider().list(null)
      const inbox = root.items.find((f) => f.kind === 'folder' && f.name === INBOX_FOLDER) ?? (await provider().createFolder(null, INBOX_FOLDER))
      parentId = inbox.id
      label = INBOX_FOLDER
      send('drive-changed', { folderIds: [null] })
    }
    await transfers.upload(paths, parentId)
    send('external-upload', { count: paths.length, target: label })
    background.notify(
      paths.length === 1 ? 'Sending 1 item to Drive' : `Sending ${paths.length} items to Drive`,
      `Going to ${label}. You’ll hear when it lands.`,
      false,
      'transfers'
    )
  } catch (error) {
    background.notify('Couldn’t send that to Drive', error instanceof Error ? error.message : 'Open Sentry to try again.', true, 'transfers')
  }
}

async function pickAndSend(): Promise<void> {
  const res = await dialog.showOpenDialog({ title: 'Send to Google Drive', properties: ['openFile', 'multiSelections'] })
  if (!res.canceled) queueExternalUpload(res.filePaths)
}

/** This PC actions may only touch what the user chose to scan. */
function insideScanRoot(path: string, allowRoot = false): boolean {
  return selectedRoots(settings).some((root) => containsPath(root, path) && (allowRoot || !containsPath(path, root)))
}

async function loadSettings(): Promise<void> {
  try {
    settings = { ...defaults(), ...(JSON.parse(await readFile(settingsPath, 'utf8')) as Partial<Settings>) }
  } catch {
    settings = defaults()
  }
}

let settingsWrite: Promise<void> = Promise.resolve()

/** Writes are chained so quick successive changes can't race on the temp file. */
function saveSettings(): Promise<void> {
  settingsWrite = settingsWrite
    .catch(() => undefined)
    .then(async () => {
      await mkdir(userData, { recursive: true })
      const tmp = `${settingsPath}.tmp`
      await writeFile(tmp, JSON.stringify(settings, null, 2))
      await rename(tmp, settingsPath)
    })
  return settingsWrite
}

async function status(): Promise<ProviderStatus> {
  const googleConfigured = (await auth.config()) !== null
  let account = null
  let connected = false
  let connectionError: string | undefined
  if (settings.provider) {
    try {
      account = await provider().account()
      connected = true
    } catch (error) {
      connected = false
      connectionError = error instanceof Error ? error.message : 'Drive is unavailable. Try connecting again.'
    }
  }
  return { provider: settings.provider, connected, account, googleConfigured, connectionError }
}

/** Every renderer call goes through one namespaced, promise-returning channel. */
function handle(name: string, fn: (...args: never[]) => unknown): void {
  ipcMain.handle(`sentry:${name}`, async (event, ...args: unknown[]) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('This request did not come from Sentry.')
    }
    return (fn as (...a: unknown[]) => unknown)(...args)
  })
}

function registerIpc(): void {
  handle('rendererReady', () => {
    // Read native state again: renderer startup can finish after a show/restore.
    syncRendererActivity()
    send('transfers', transfers.list())
    rendererEvents.rendererReady()
  })
  handle('bootstrap', async (): Promise<AppBootstrap> => ({
    settings,
    status: await status(),
    platform: process.platform,
    homeDir: homedir(),
    version: app.getVersion()
  }))
  handle('updateSettings', async (patch: Partial<Settings>) => {
    if (!patch || typeof patch !== 'object' || 'provider' in patch) throw new Error('Use Connect to change your Drive account.')
    if ('scanRoots' in patch || 'scanRoot' in patch) {
      const roots = normalizeRoots(patch.scanRoots ?? patch.scanRoot!)
      cancelLocalScan()
      patch = { ...patch, scanRoots: roots, scanRoot: roots[0] }
    }
    settings = { ...settings, ...patch }
    await saveSettings()
    // The capture harness must never touch the tray, login items, or update schedule on this machine.
    if (!capture) {
      background.apply()
      updater.apply()
    }
    return settings
  })
  handle('resetApp', async () => {
    requireIdleAccount()
    connecting = true
    try {
      if (settings.provider) await provider().signOut()
      settings = defaults()
      await saveSettings()
    } finally { connecting = false }
  })

  handle('connect', async (id: ProviderId) => {
    if (id !== 'google' && id !== 'demo') throw new Error('Choose a supported drive provider.')
    requireIdleAccount()
    connecting = true
    try {
      if (id === 'google') {
        if (!(await auth.config())) throw new Error('Import your Google Desktop app client JSON first.')
        google.clearCache()
      }
      // Preserve the current provider until a real account read succeeds.
      let account
      try { account = await (id === 'google' ? google : demo).account() }
      catch (error) {
        if (id !== 'google' || !(error instanceof GoogleSessionExpired)) throw error
        await auth.signIn()
        google.clearCache()
        account = await google.account()
      }
      const previous = settings
      settings = { ...settings, provider: id, name: settings.name || (id === 'google' ? account.displayName.split(' ')[0] : '') }
      try { await saveSettings() } catch (error) { settings = previous; throw error }
      return { provider: id, account, connected: true, googleConfigured: Boolean(await auth.config()) }
    } finally {
      connecting = false
    }
  })
  handle('cancelGoogleSignIn', () => auth.cancelSignIn())
  handle('importGoogleClient', async () => {
    requireIdleAccount()
    if (settings.provider === 'google') throw new Error('Disconnect Google before replacing its client configuration.')
    connecting = true
    try {
      const picked = await dialog.showOpenDialog(window!, {
        title: 'Import Google Desktop app client', properties: ['openFile'], filters: [{ name: 'Google client JSON', extensions: ['json'] }]
      })
      if (!picked.canceled && picked.filePaths[0]) {
        await auth.importClient(picked.filePaths[0])
        google.clearCache()
      }
      return await status()
    } finally { connecting = false }
  })
  handle('disconnect', async () => {
    requireIdleAccount()
    connecting = true
    try {
      if (settings.provider) await provider().signOut()
      settings.provider = null
      await saveSettings()
      return await status()
    } finally { connecting = false }
  })

  handle('quota', () => provider().quota())
  handle('get', (id: string) => provider().get(id))
  handle('list', (folderId: string | null) => provider().list(folderId))
  handle('recent', (limit: number) => provider().recent(limit))
  handle('search', (q: string) => provider().search(q))
  handle('shared', () => provider().shared())
  handle('createFolder', async (parentId: string | null, name: string) => {
    const folder = await provider().createFolder(parentId, name)
    send('drive-changed', { folderIds: [parentId] })
    return folder
  })
  handle('rename', async (id: string, name: string) => {
    const file = await provider().rename(id, name)
    send('drive-changed', { folderIds: [file.parentId] })
    return file
  })
  handle('trash', async (ids: string[]) => {
    const parents = new Set<string | null>()
    for (const id of ids) {
      const f = await provider().get(id)
      parents.add(f.parentId)
      await provider().trash(id)
    }
    send('drive-changed', { folderIds: [...parents] })
  })
  handle('move', async (ids: string[], parentId: string | null) => {
    const parents = new Set<string | null>([parentId])
    for (const id of ids) {
      if (id === parentId) continue
      const f = await provider().get(id)
      if (f.parentId === parentId) continue
      parents.add(f.parentId)
      await provider().move(id, parentId)
    }
    send('drive-changed', { folderIds: [...parents] })
  })
  handle('toggleStar', async (id: string) => {
    const f = await provider().get(id)
    const next = await provider().setStarred(id, !f.starred)
    send('drive-changed', { folderIds: [f.parentId] })
    return next
  })
  handle('setLink', async (id: string, role: 'reader' | 'commenter' | 'writer' | null) => {
    const f = await provider().setLink(id, role)
    send('drive-changed', { folderIds: [f.parentId] })
    return f
  })

  handle('pickLocal', async (mode: 'files' | 'folder') => {
    const res = await dialog.showOpenDialog(window!, {
      title: mode === 'files' ? 'Choose files to put in Drive' : 'Choose a folder to put in Drive',
      properties: mode === 'files' ? ['openFile', 'multiSelections'] : ['openDirectory', 'multiSelections']
    })
    return res.canceled ? [] : res.filePaths
  })
  handle('pickDirectory', async (defaultPath?: string) => {
    const res = await dialog.showOpenDialog(window!, { defaultPath, properties: ['openDirectory', 'createDirectory'] })
    return res.canceled ? null : res.filePaths[0]
  })
  handle('upload', async (paths: string[], parentId: string | null) => {
    if (connecting) throw new Error('Wait for sign-in to finish before starting a transfer.')
    await transfers.upload(paths, parentId)
  })
  handle('download', (ids: string[], destDir?: string) => {
    if (connecting) throw new Error('Wait for sign-in to finish before starting a transfer.')
    return transfers.download(ids, destDir ?? settings.downloadDir)
  })
  handle('cancelTransfer', (id: string) => transfers.cancel(id))
  handle('clearTransfers', () => transfers.clearFinished())
  handle('transfers', () => transfers.list())
  handle('revealLocal', (path: string) => shell.showItemInFolder(path))
  handle('openExternal', (url: string) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url)
  })
  handle('copyText', (text: string) => clipboard.writeText(text))
  handle('setWindowColors', (background: string, symbols: string) => {
    if (!window || !/^#[0-9a-f]{6}$/i.test(background) || !/^#[0-9a-f]{6}$/i.test(symbols)) return
    window.setBackgroundColor(background)
    if (process.platform === 'win32') window.setTitleBarOverlay({ color: background, symbolColor: symbols, height: 44 })
    if (capture) console.log(`[titlebar] ${background} ${symbols}`)
  })

  handle('updateStatus', () => updater.get())
  handle('checkForUpdates', () => updater.check())
  handle('downloadUpdate', () => updater.download())
  handle('installUpdate', () => updater.install())
  handle('shellIntegration', () => shellStatus())
  handle('setShellIntegration', async (on: boolean) => {
    const result = on ? await installShellIntegration(iconIco) : await removeShellIntegration()
    settings = { ...settings, contextMenu: result.contextMenu }
    await saveSettings()
    return result
  })
  handle('openLocal', async (path: string) => {
    if (!insideScanRoot(path, true) || !existsSync(path)) throw new Error('That item isn’t in your scanned folder anymore.')
    const error = await shell.openPath(path)
    if (error) throw new Error(error)
  })
  handle('trashLocal', async (paths: string[]) => {
    for (const p of paths) {
      if (!insideScanRoot(p)) throw new Error('Sentry only removes items inside the folder you scanned.')
    }
    for (const p of paths) if (existsSync(p)) await shell.trashItem(p)
    await localScans.prune(selectedRoots(settings), paths).catch(() => undefined)
  })
  handle('localDrives', () => localDrives())
  handle('lastLocalScan', () => localScans.load(selectedRoots(settings)))
  handle('forgetLocalScan', () => localScans.clear())

  handle('scanDrive', async () => {
    const started = Date.now()
    const [files, quota] = await Promise.all([provider().allFiles(), provider().quota()])
    return driveMap(files, quota, started)
  })
  handle('scanLocal', async (root?: string | string[]) => {
    const target = normalizeRoots(root ?? selectedRoots(settings))
    const snap = await scanLocal(target, (p) => send('scan-progress', p))
    // Remember it, so the next launch opens straight onto this map.
    await localScans.save(target, snap).catch(() => undefined)
    return snap
  })
  handle('cancelScan', () => cancelLocalScan())
}

function createWindow(): BrowserWindow {
  nativeTheme.themeSource = 'dark'
  const hidden = !capture && background.startHidden(process.argv)
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    show: false,
    // The saved theme from the first frame: window, caption buttons, and boot sequence all match.
    backgroundColor: THEME_BACKGROUND[settings.theme],
    icon: appIcon,
    title: 'Sentry',
    titleBarStyle: 'hidden',
    // Transparent so the caption buttons sit on the app's own title bar in any theme.
    // Starts on the saved theme's color; the renderer sends the exact rendered color once it paints.
    titleBarOverlay: process.platform === 'win32' ? { color: THEME_BACKGROUND[settings.theme], symbolColor: '#8d93ab', height: 44 } : undefined,
    trafficLightPosition: { x: 16, y: 14 },
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: true,
      offscreen: capture
    }
  })
  if (process.platform === 'win32') {
    // Explorer reads this independently of BrowserWindow's icon. Use the packaged
    // executable's embedded icon, or the real .ico on disk for electron.exe in dev.
    win.setAppDetails({
      appId,
      appIconPath: app.isPackaged ? process.execPath : iconIco,
      appIconIndex: 0,
      relaunchDisplayName: 'Sentry',
      relaunchCommand: [process.execPath, ...(app.isPackaged ? [] : [app.getAppPath()])]
        .map((path) => `"${path}"`).join(' ')
    })
  }
  if (!capture) win.once('ready-to-show', () => !hidden && win.show())
  background.attach(win)
  win.on('show', syncRendererActivity)
  win.on('hide', syncRendererActivity)
  win.on('minimize', syncRendererActivity)
  win.on('restore', syncRendererActivity)
  win.webContents.on('did-start-navigation', (details) => {
    // Loading also fires for in-page and child-frame navigation. Neither replaces
    // React or its listeners, so neither will send a new rendererReady handshake.
    if (details.isMainFrame && !details.isSameDocument) rendererEvents.rendererLoading()
  })
  win.webContents.on('render-process-gone', () => rendererEvents.rendererLoading())
  win.on('closed', () => {
    if (window === win) window = null
    rendererEvents.rendererLoading()
    rendererEvents.setVisible(false)
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  const loadRenderer = (): void => {
    // Theme and accent ride along so the very first paint (the boot sequence) is already in the user's colors.
    const query: Record<string, string> = { theme: settings.theme, accent: settings.accent }
    if (capture) query.capture = '1'
    if (process.env.ELECTRON_RENDERER_URL) {
      const url = new URL(process.env.ELECTRON_RENDERER_URL)
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
      void win.loadURL(url.toString())
    } else {
      void win.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)), { query })
    }
  }
  // Login-to-tray does not need React, Drive listings, or a storage map yet.
  if (hidden) win.once('show', loadRenderer)
  else loadRenderer()
  return win
}

app.on('second-instance', (_event, argv, _cwd, data) => {
  const paths = (data as { upload?: string[] } | undefined)?.upload ?? uploadPathsFrom(argv)
  if (paths.length) queueExternalUpload(paths)
  else background.show()
})

app.whenReady().then(async () => {
  if (!primary) return
  await loadSettings()
  registerIpc()
  window = createWindow()
  transfers.setProgressEnabled(false)
  setScanProgressEnabled(false)
  syncRendererActivity()
  if (!capture) {
    background.apply()
    updater.apply()
    queueExternalUpload(launchUploads)
  }
  if (capture) {
    await runCapture(window, join(process.cwd(), 'capture', ...(captureBackground ? ['background'] : [])), setRendererActivity)
    if (process.exitCode) app.exit(Number(process.exitCode))
    else app.quit()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  rendererEvents.dispose()
  cancelLocalScan()
  updater.dispose()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    window = createWindow()
    syncRendererActivity()
  } else background.show()
})
