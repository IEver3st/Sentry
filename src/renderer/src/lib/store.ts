import { create } from 'zustand'
import { formatSize } from './format'
import type { UpdateStatus, AppBootstrap, DriveQuota, MapSnapshot, ProviderStatus, ScanProgress, Settings, Transfer } from '@shared/types'

export type Route = 'home' | 'files' | 'map' | 'shared' | 'transfers' | 'settings'

export interface Toast {
  id: number
  tone: 'info' | 'success' | 'error'
  title: string
  detail?: string
  action?: { label: string; run: () => void }
}

interface State {
  boot: AppBootstrap | null
  settings: Settings | null
  status: ProviderStatus | null
  route: Route
  /** Where Settings' Back button returns to. */
  settingsReturn: Route
  folderId: string | null
  /** File to select once the Files page opens (e.g. from a Map suggestion). */
  focusFileId: string | null
  quota: DriveQuota | null
  transfers: Transfer[]
  toasts: Toast[]
  maps: { drive: MapSnapshot | null; local: MapSnapshot | null }
  mapSource: 'drive' | 'local'
  scanning: { drive: boolean; local: boolean }
  scanProgress: ScanProgress | null
  /** Bumped when Drive content changes so views refetch. */
  driveVersion: number
  justOnboarded: boolean
  /** A This PC scan finished while the user was elsewhere. Cleared on visiting This PC. */
  localScanUnseen: boolean
  /** Bootstrap failed; the boot sequence steps aside so the error shows. */
  bootFailed: boolean
  update: UpdateStatus | null
  windowActive: boolean
  driveMapVersion: number
  driveScanAttemptVersion: number
  /** Why the last Drive map failed; views show it with Retry instead of an endless skeleton. */
  driveMapError: string | null
  /** The boot sequence has handed off; until then the window chrome stays midnight to match it. */
  booted: boolean
}

export const useApp = create<State>(() => ({
  boot: null,
  settings: null,
  status: null,
  route: 'home',
  settingsReturn: 'home',
  folderId: null,
  focusFileId: null,
  quota: null,
  transfers: [],
  toasts: [],
  maps: { drive: null, local: null },
  mapSource: 'local',
  scanning: { drive: false, local: false },
  scanProgress: null,
  driveVersion: 0,
  justOnboarded: false,
  localScanUnseen: false,
  bootFailed: false,
  update: null,
  windowActive: false,
  driveMapVersion: -1,
  driveScanAttemptVersion: -1,
  driveMapError: null,
  booted: false
}))

export const api = (): Window['sentry'] => window.sentry

export function go(route: Route, folderId?: string | null, focusFileId: string | null = null): void {
  useApp.setState((s) => ({
    route,
    settingsReturn: route === 'settings' && s.route !== 'settings' ? s.route : s.settingsReturn,
    localScanUnseen: route === 'map' ? false : s.localScanUnseen,
    folderId: folderId === undefined ? s.folderId : folderId,
    focusFileId
  }))
}

let toastId = 0
export function toast(t: Omit<Toast, 'id'>, ms = 3800): void {
  const id = ++toastId
  useApp.setState((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }))
  setTimeout(() => dismissToast(id), t.tone === 'error' ? ms + 2400 : ms)
}

export function dismissToast(id: number): void {
  useApp.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}

export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  // Strip Electron's "Error invoking remote method 'x': Error: " prefix.
  return raw.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}

export function fail(title: string, error: unknown): void {
  toast({ tone: 'error', title, detail: errorMessage(error) })
}

let quotaRefresh: Promise<void> | null = null
let quotaRequested = false

/** Merge bursts, with one trailing read when Drive changes during an in-flight read. */
export function refreshQuota(): Promise<void> {
  quotaRequested = true
  if (!useApp.getState().windowActive) return Promise.resolve()
  quotaRefresh ??= (async () => {
    while (quotaRequested && useApp.getState().windowActive) {
      await new Promise<void>((resolve) => setTimeout(resolve, 250))
      const s = useApp.getState()
      if (!s.windowActive || !s.status?.connected) break
      quotaRequested = false
      try {
        const quota = await api().quota()
        if (useApp.getState().settings?.provider === s.settings?.provider) useApp.setState({ quota })
      } catch {
        /* keep the last confirmed quota */
      }
    }
  })().finally(() => { quotaRefresh = null })
  return quotaRefresh
}

export async function scanMap(source: 'drive' | 'local'): Promise<void> {
  const s = useApp.getState()
  if (s.scanning[source] || (source === 'drive' && (!s.windowActive || !s.status?.connected))) return
  useApp.setState((st) => ({
    scanning: { ...st.scanning, [source]: true },
    scanProgress: source === 'local' ? null : st.scanProgress,
    driveScanAttemptVersion: source === 'drive' ? st.driveVersion : st.driveScanAttemptVersion
  }))
  try {
    const snap = source === 'drive' ? await api().scanDrive() : await api().scanLocal()
    if (source === 'drive' && useApp.getState().settings?.provider !== s.settings?.provider) {
      // The account changed mid-scan: drop this result, but let the next scan run.
      useApp.setState({ driveScanAttemptVersion: -1 })
      return
    }
    if (source === 'drive') useApp.setState({ driveMapError: null })
    useApp.setState((st) => ({
      maps: { ...st.maps, [source]: snap },
      driveMapVersion: source === 'drive' ? s.driveVersion : st.driveMapVersion
    }))
    if (source === 'local' && useApp.getState().route !== 'map') {
      useApp.setState({ localScanUnseen: true })
      toast({
        tone: 'success',
        title: 'This PC is mapped',
        detail: `${formatSize(snap.root.size)} across ${snap.root.files.toLocaleString()} files.`,
        action: { label: 'Open', run: () => go('map') }
      })
    }
  } catch (error) {
    if (source === 'drive') {
      // One toast per failure streak; the page shows the error with Retry and App retries on its own.
      if (!useApp.getState().driveMapError) fail('Couldn’t map your Drive', error)
      useApp.setState({ driveMapError: errorMessage(error) })
    } else if (!errorMessage(error).includes('cancelled')) fail('Couldn’t scan this PC', error)
  } finally {
    useApp.setState((st) => ({ scanning: { ...st.scanning, [source]: false } }))
  }
}

export async function uploadPaths(paths: string[], parentId: string | null): Promise<void> {
  if (!paths.length) return
  try {
    await api().upload(paths, parentId)
    toast({
      tone: 'info',
      title: paths.length === 1 ? `Sending ${paths[0].split(/[\\/]/).pop()} to Drive` : `Sending ${paths.length} items to Drive`,
      action: { label: 'Watch progress', run: () => go('transfers') }
    }, 2600)
  } catch (error) {
    fail('Upload didn’t start', error)
  }
}

export async function pullFiles(ids: string[], ask = false): Promise<void> {
  if (!ids.length) return
  let dest: string | undefined
  if (ask || useApp.getState().settings?.askWhereToSave) {
    const picked = await api().pickDirectory(useApp.getState().settings?.downloadDir)
    if (!picked) return
    dest = picked
  }
  try {
    await api().download(ids, dest)
    toast({
      tone: 'info',
      title: ids.length === 1 ? 'Pulling it down' : `Pulling ${ids.length} items down`,
      detail: `Into ${dest ?? useApp.getState().settings?.downloadDir}`,
      action: { label: 'Watch progress', run: () => go('transfers') }
    }, 2600)
  } catch (error) {
    fail('Couldn’t pull that down', error)
  }
}

export async function copyLink(url: string): Promise<void> {
  await api().copyText(url)
  toast({ tone: 'success', title: 'Link copied', detail: 'Paste it anywhere.' }, 2400)
}

/** One click: make a view link if there isn't one, then copy it. */
export async function quickLink(file: { id: string; link: { url: string } | null }): Promise<void> {
  try {
    const url = file.link?.url ?? (await api().setLink(file.id, 'reader')).link?.url
    if (url) await copyLink(url)
  } catch (error) {
    fail('Couldn’t make a link', error)
  }
}

/** Opens My Drive at wherever a file lives and selects it. */
export async function revealFile(id: string): Promise<void> {
  try {
    const f = await api().get(id)
    if (f.kind === 'folder') go('files', f.id)
    else go('files', f.parentId, f.id)
  } catch (error) {
    useApp.setState({ focusFileId: null })
    fail('Couldn’t find that file', error)
  }
}

/** Set up but not connected to any drive: Sentry maps this PC only until the user adds Google Drive. */
export function isLocalOnly(s: { settings: State['settings']; status: State['status'] }): boolean {
  return Boolean(s.settings?.onboarded && !s.status?.provider)
}

/**
 * Connect a drive from anywhere (onboarding, the connect screen, Settings). Reloads app state from
 * the main process so every view sees the new account. Resolves false if it didn't connect.
 */
export async function connectDrive(provider: 'google' | 'demo', route: Route = 'home'): Promise<boolean> {
  try {
    const s = await api().connect(provider)
    if (!s.connected) throw new Error('Connected, but Drive didn’t answer. Try again in a moment.')
    const boot = await api().bootstrap()
    useApp.setState({ boot, settings: boot.settings, status: boot.status, maps: { drive: null, local: useApp.getState().maps.local }, driveMapVersion: -1, driveScanAttemptVersion: -1, quota: null, folderId: null, focusFileId: null, route })
    return true
  } catch (error) {
    if (!/cancel/i.test(errorMessage(error))) fail(provider === 'google' ? 'Couldn’t connect Google Drive' : 'Couldn’t open the demo drive', error)
    return false
  }
}

/** Clear a failed Drive map and scan again now. */
export function retryDriveMap(): void {
  useApp.setState({ driveScanAttemptVersion: -1 })
  void scanMap('drive')
}
