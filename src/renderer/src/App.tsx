import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { api, go, isLocalOnly, refreshQuota, retryDriveMap, scanMap, toast, useApp, type Route } from './lib/store'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { Toasts } from './components/Toasts'
import { DropZone } from './components/DropZone'
import { Onboarding } from './pages/Onboarding'
import { Home } from './pages/Home'
import { Files } from './pages/Files'
import { MapPage } from './pages/Map'
import { Shared } from './pages/Shared'
import { Transfers } from './pages/Transfers'
import { SettingsShell } from './pages/Settings'
import { ConnectDrive } from './pages/ConnectDrive'
import { BootSequence } from './components/BootSequence'
import { installCaptureHooks } from './lib/capture'
import { ShareDialog } from './components/ShareDialog'
import { ConfirmDialog } from './components/Confirm'
import { DrivePicker } from './components/DrivePicker'

const PAGES: Record<Route, () => React.JSX.Element> = {
  home: Home,
  files: Files,
  map: MapPage,
  shared: Shared,
  transfers: Transfers,
  settings: Home
}

/** Pages that need a drive; in local-only mode they show the optional connect screen. */
const DRIVE_ROUTES = new Set<Route>(['home', 'files', 'shared', 'transfers'])

const ROUTE_KEYS: Route[] = ['home', 'files', 'map', 'shared', 'transfers']

/** The boot sequence plays over the app while it loads, then hands off. */
export function App() {
  const booted = useApp((s) => s.booted)
  const loaded = useApp((s) => Boolean(s.boot && s.settings))
  const failed = useApp((s) => s.bootFailed)
  const settings = useApp((s) => s.settings)
  const enabled = settings ? settings.bootAnimation !== false && !settings.reduceMotion : null
  return (
    <>
      <AppContent />
      {!booted && <BootSequence ready={loaded || failed} enabled={enabled} onDone={() => useApp.setState({ booted: true })} />}
    </>
  )
}

function AppContent() {
  const boot = useApp((s) => s.boot)
  const settings = useApp((s) => s.settings)
  const route = useApp((s) => s.route)
  const connected = useApp((s) => s.status?.connected ?? false)
  const [bootError, setBootError] = useState<string | null>(null)

  useEffect(() => {
    installCaptureHooks()
    Promise.all([api().bootstrap(), api().transfers(), api().updateStatus()])
      .then(([b, transfers, update]) =>
        useApp.setState({
          boot: b,
          settings: b.settings,
          status: b.status,
          transfers,
          update,
          // Without a drive, This PC is the home screen.
          route: b.settings.onboarded && !b.status.provider ? 'map' : (b.settings.startPage ?? 'home')
        })
      )
      .catch((e: unknown) => {
        setBootError(String(e))
        useApp.setState({ bootFailed: true })
      })
      .finally(() => { void api().rendererReady() })
    // Reopen on the last This PC scan. Optional: any failure here just means a fresh scan later, never a failed start.
    api()
      .lastLocalScan()
      .then((snap) => {
        if (snap) useApp.setState((st) => (st.maps.local ? {} : { maps: { ...st.maps, local: snap } }))
      })
      .catch(() => undefined)

    let wasBusy = false
    const offActive = api().on('window-active', (windowActive) => {
      document.documentElement.dataset.windowActive = String(windowActive)
      useApp.setState({ windowActive })
    })
    const offTransfers = api().on('transfers', (transfers) => {
      useApp.setState({ transfers })
      // Celebrate once when a batch settles, not per file.
      const busy = transfers.some((t) => t.state === 'running' || t.state === 'queued')
      if (wasBusy && !busy && useApp.getState().settings?.notifyTransfers !== false) {
        const failed = transfers.filter((t) => t.state === 'failed' && t.finishedAt && Date.now() - Date.parse(t.finishedAt) < 60_000).length
        const last = transfers.find((t) => t.state === 'done')
        if (failed) toast({ tone: 'error', title: `${failed} didn’t make it`, detail: 'Open Transfers for details.', action: { label: 'Open Transfers', run: () => go('transfers') } })
        else if (last)
          toast({
            tone: 'success',
            title: last.direction === 'up' ? 'Safely in Drive' : 'Pulled down',
            detail: last.direction === 'up' ? `Everything landed in ${last.remoteLabel}.` : 'Your files are on this PC.',
            action: last.direction === 'down' ? { label: 'Show in folder', run: () => void api().revealLocal(last.localPath) } : undefined
          })
      }
      wasBusy = busy
    })
    const offProgress = api().on('scan-progress', (scanProgress) => useApp.setState({ scanProgress }))
    const offUpdate = api().on('update-status', (update) => {
      const was = useApp.getState().update?.state
      useApp.setState({ update })
      if (update.state === 'ready' && was !== 'ready')
        toast({ tone: 'success', title: `Sentry ${update.version} is ready`, detail: 'Restart whenever it suits you.', action: { label: 'Restart now', run: () => void api().installUpdate() } })
    })
    const offNavigate = api().on('navigate', ({ route }) => go(route))
    const offExternal = api().on('external-upload', ({ count, target }) =>
      toast({ tone: 'info', title: count === 1 ? 'Sending 1 item from Explorer' : `Sending ${count} items from Explorer`, detail: `Going to ${target}.`, action: { label: 'Watch progress', run: () => go('transfers') } })
    )
    const offChanged = api().on('drive-changed', () => {
      useApp.setState((s) => ({ driveVersion: s.driveVersion + 1 }))
      void refreshQuota()
    })
    return () => {
      offActive()
      offTransfers()
      offProgress()
      offChanged()
      offUpdate()
      offNavigate()
      offExternal()
    }
  }, [])

  const localOnly = useApp(isLocalOnly)
  // Local-only mode (no drive at all) is a complete way to use Sentry; a drive that lost its session goes back to connect.
  const ready = Boolean(settings?.onboarded && (connected || localOnly))
  const driveVersion = useApp((s) => s.driveVersion)
  const windowActive = useApp((s) => s.windowActive)
  const scanningDrive = useApp((s) => s.scanning.drive)
  const driveScanAttemptVersion = useApp((s) => s.driveScanAttemptVersion)
  const mapSource = useApp((s) => s.mapSource)
  const needsDriveMap = route === 'home' || route === 'files' || (route === 'map' && mapSource === 'drive')


  // Appearance lives on <html> so every token follows it.
  useEffect(() => {
    if (!settings) return
    document.documentElement.dataset.theme = settings.theme
    document.documentElement.dataset.accent = settings.accent
    api().setZoom(settings.uiScale || 1)
    // Read the colour the title bar actually renders with, so the native caption buttons match it exactly.
    requestAnimationFrame(() => {
      const css = getComputedStyle(document.documentElement)
      const bg = css.getPropertyValue('--color-ink-900').trim()
      const fg = css.getPropertyValue('--color-fog-400').trim()
      void api().setWindowColors(bg, fg)
    })
  }, [settings?.theme, settings?.accent, settings?.uiScale])

  // A failed Drive map retries on its own (gently), instead of leaving the page waiting forever.
  const driveMapError = useApp((s) => s.driveMapError)
  useEffect(() => {
    // Re-arms each time a scan settles, so repeated failures keep retrying every 20s while the page needs the map.
    if (!driveMapError || scanningDrive || !windowActive || !needsDriveMap || !connected) return
    const t = setTimeout(retryDriveMap, 20_000)
    return () => clearTimeout(t)
  }, [driveMapError, scanningDrive, windowActive, needsDriveMap, connected])

  // Keep the Drive map in step with uploads, moves and deletes.
  useEffect(() => {
    if (!ready || !connected || !windowActive || !needsDriveMap || scanningDrive || driveScanAttemptVersion === driveVersion) return
    const t = setTimeout(() => void scanMap('drive'), 350)
    return () => clearTimeout(t)
  }, [driveVersion, ready, connected, windowActive, needsDriveMap, scanningDrive, driveScanAttemptVersion])

  useEffect(() => {
    if (ready && connected && windowActive) void refreshQuota()
  }, [ready, connected, windowActive])

  useEffect(() => {
    if (!ready) return
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      if (e.key === ',') {
        e.preventDefault()
        go('settings')
        return
      }
      const n = Number(e.key)
      if (n >= 1 && n <= ROUTE_KEYS.length) {
        e.preventDefault()
        go(ROUTE_KEYS[n - 1])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ready])

  if (bootError) {
    return (
      <div className="grid h-full place-items-center p-10 text-center">
        <div>
          <p className="text-lg font-semibold">Sentry couldn’t start</p>
          <p className="mt-2 text-fog-400" data-selectable>{bootError}</p>
        </div>
      </div>
    )
  }

  if (!boot || !settings) {
    return (
      <div className="drag h-full" />
    )
  }

  if (!ready)
    return (
      <>
        <Onboarding />
        <Toasts />
      </>
    )

  if (route === 'settings')
    return (
      <div className={settings.reduceMotion ? 'reduce-motion h-full' : 'h-full'}>
        <SettingsShell />
        <ConfirmDialog />
        <Toasts />
      </div>
    )

  const Page = localOnly && DRIVE_ROUTES.has(route) ? ConnectDrive : PAGES[route]
  return (
    <div className={settings.reduceMotion ? 'reduce-motion flex h-full' : 'flex h-full'}>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col bg-ink-900">
        <TitleBar />
        <main className="relative min-h-0 flex-1">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={route}
              className="absolute inset-0"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            >
              <Page />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      {!localOnly && <DropZone />}
      <ShareDialog />
      <DrivePicker />
      <ConfirmDialog />
      <Toasts />
    </div>
  )
}
