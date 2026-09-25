// Contract shared by the main process, preload bridge, and renderer.

export type ProviderId = 'demo' | 'google'

export type FileKind =
  | 'folder'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'pdf'
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'code'
  | 'other'

export interface DriveFile {
  id: string
  name: string
  kind: FileKind
  mimeType: string
  /** Bytes. Google-native docs report 0. Folders report the sum of their contents when known. */
  size: number
  modifiedAt: string
  createdAt: string
  parentId: string | null
  starred: boolean
  /** Present when anyone with the link can open the file. */
  link: ShareLink | null
  /** Sample entries in demo mode have metadata only and no downloadable bytes. */
  sample?: boolean
  md5?: string
}

export interface ShareLink {
  url: string
  role: 'reader' | 'commenter' | 'writer'
  createdAt: string
}

export interface DriveAccount {
  provider: ProviderId
  email: string
  displayName: string
  photoUrl: string | null
}

export interface DriveQuota {
  /** Total plan bytes. null means unlimited. */
  limit: number | null
  usage: number
  usageInDrive: number
  usageInTrash: number
  /** Gmail + Photos and anything else counted against the plan. */
  usageElsewhere: number
}

export interface FolderListing {
  folder: DriveFile | null
  path: Array<{ id: string; name: string }>
  items: DriveFile[]
}

/* ---------- Storage map (treemap) ---------- */

export type MapCategory =
  | 'documents'
  | 'media'
  | 'code'
  | 'archives'
  | 'apps'
  | 'games'
  | 'synced'
  | 'cache'
  | 'system'
  | 'other'

export interface MapNode {
  /** Stable key: absolute path for local scans, file id for Drive. */
  id: string
  name: string
  size: number
  files: number
  dirs: number
  /** Most recent modification anywhere inside, epoch ms. */
  newest: number
  category: MapCategory
  /** What the file is, or for folders what mostly fills them. Drives map colour when present. */
  kind?: FileKind
  /** Safe to delete / regenerate (caches, build output, trash). */
  reclaimable?: boolean
  isDir: boolean
  /** When smaller items were folded together for display. */
  aggregate?: boolean
  children?: MapNode[]
}

export interface Suggestion {
  id: string
  title: string
  detail: string
  size: number
  nodeId: string
  tone: 'reclaim' | 'backup' | 'review'
}

export interface MapSnapshot {
  source: 'drive' | 'local'
  root: MapNode
  scannedAt: string
  durationMs: number
  suggestions: Suggestion[]
  disk: { label: string; free: number; total: number } | null
}

export interface ScanProgress {
  files: number
  bytes: number
  current: string
}

/* ---------- Transfers ---------- */

export type TransferDirection = 'up' | 'down'
export type TransferState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

export interface Transfer {
  id: string
  direction: TransferDirection
  name: string
  kind: FileKind
  /** Local absolute path (source for uploads, destination for downloads). */
  localPath: string
  /** Drive folder (uploads) or file id (downloads). */
  remoteId: string
  remoteLabel: string
  total: number
  done: number
  state: TransferState
  error?: string
  startedAt: string
  finishedAt?: string
}

/* ---------- Settings / app state ---------- */

export interface Settings {
  onboarded: boolean
  provider: ProviderId | null
  name: string
  downloadDir: string
  scanRoot: string
  reduceMotion: boolean
  theme: Theme
  accent: Accent
  /** Interface zoom, 0.9 – 1.2. */
  uiScale: number
  startPage: 'home' | 'files' | 'map'
  confirmTrash: boolean
  notifyTransfers: boolean
  askWhereToSave: boolean
  concurrency: number
  mapDepth: number
  sizeBars: boolean
  /** Play the boot sequence on launch. Missing (older settings files) means on. */
  bootAnimation?: boolean

  /* Startup & background */
  launchAtLogin: boolean
  /** When launched at sign-in, stay in the tray instead of opening the window. */
  startMinimized: boolean
  closeToTray: boolean
  showTray: boolean
  /** Native notifications for finished transfers while Sentry is hidden. */
  systemNotifications: boolean

  /* Explorer integration (Windows) */
  contextMenu: boolean
  /** Where right-click / Send to uploads land. */
  sendToTarget: 'root' | 'inbox'

  /* Updates */
  autoCheckUpdates: boolean
  autoDownloadUpdates: boolean
  installOnQuit: boolean
  betaUpdates: boolean
}

export type UpdateState = 'unsupported' | 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'error'

export interface UpdateStatus {
  state: UpdateState
  currentVersion: string
  version?: string
  /** 0-100 while downloading. */
  progress?: number
  checkedAt?: string
  error?: string
  releaseNotes?: string
}

export interface ShellIntegration {
  supported: boolean
  contextMenu: boolean
  sendTo: boolean
}

/** Folder name used when right-click uploads go to their own folder. */
export const INBOX_FOLDER = 'From my PC'

export type Theme = 'midnight' | 'graphite' | 'oled'
export type Accent = 'amber' | 'sky' | 'mint' | 'rose' | 'violet'

export const THEME_BACKGROUND: Record<Theme, string> = {
  midnight: '#0e1018',
  graphite: '#23272e',
  oled: '#050506'
}

export interface ProviderStatus {
  provider: ProviderId | null
  connected: boolean
  account: DriveAccount | null
  /** Google OAuth client credentials are present in this build. */
  googleConfigured: boolean
  connectionError?: string
}

export interface AppBootstrap {
  settings: Settings
  status: ProviderStatus
  platform: NodeJS.Platform
  homeDir: string
  version: string
}

/* ---------- IPC surface exposed on window.sentry ---------- */

export interface SentryApi {
  bootstrap(): Promise<AppBootstrap>
  /** Called after initial state and event listeners are installed. */
  rendererReady(): Promise<void>
  updateSettings(patch: Partial<Settings>): Promise<Settings>
  resetApp(): Promise<void>

  connect(provider: ProviderId): Promise<ProviderStatus>
  disconnect(): Promise<ProviderStatus>
  importGoogleClient(): Promise<ProviderStatus>
  cancelGoogleSignIn(): Promise<void>

  quota(): Promise<DriveQuota>
  get(id: string): Promise<DriveFile>
  list(folderId: string | null): Promise<FolderListing>
  recent(limit: number): Promise<DriveFile[]>
  search(query: string): Promise<DriveFile[]>
  shared(): Promise<DriveFile[]>
  createFolder(parentId: string | null, name: string): Promise<DriveFile>
  rename(id: string, name: string): Promise<DriveFile>
  trash(ids: string[]): Promise<void>
  move(ids: string[], parentId: string | null): Promise<void>
  toggleStar(id: string): Promise<DriveFile>
  setLink(id: string, role: ShareLink['role'] | null): Promise<DriveFile>

  pickLocal(mode: 'files' | 'folder'): Promise<string[]>
  pickDirectory(defaultPath?: string): Promise<string | null>
  upload(paths: string[], parentId: string | null): Promise<void>
  download(ids: string[], destDir?: string): Promise<void>
  cancelTransfer(id: string): Promise<void>
  clearTransfers(): Promise<void>
  transfers(): Promise<Transfer[]>
  revealLocal(path: string): Promise<void>
  openExternal(url: string): Promise<void>
  copyText(text: string): Promise<void>
  pathForFile(file: File): string
  setZoom(factor: number): void
  /** Match the native caption buttons (Windows) and window background to the rendered theme. */
  setWindowColors(background: string, symbols: string): Promise<void>

  updateStatus(): Promise<UpdateStatus>
  checkForUpdates(): Promise<UpdateStatus>
  downloadUpdate(): Promise<void>
  installUpdate(): Promise<void>
  shellIntegration(): Promise<ShellIntegration>
  setShellIntegration(on: boolean): Promise<ShellIntegration>

  /** This PC actions. Paths must sit inside the scanned folder. */
  openLocal(path: string): Promise<void>
  trashLocal(paths: string[]): Promise<void>
  /** The last This PC scan of the current folder, remembered across launches. */
  lastLocalScan(): Promise<MapSnapshot | null>
  forgetLocalScan(): Promise<void>

  scanDrive(): Promise<MapSnapshot>
  scanLocal(root?: string): Promise<MapSnapshot>
  cancelScan(): Promise<void>

  on<K extends keyof SentryEvents>(event: K, listener: (payload: SentryEvents[K]) => void): () => void
}

export interface SentryEvents {
  'window-active': boolean
  transfers: Transfer[]
  'scan-progress': ScanProgress
  'drive-changed': { folderIds: Array<string | null> }
  'update-status': UpdateStatus
  /** The tray or a notification asked the window to show a page. */
  navigate: { route: 'home' | 'files' | 'map' | 'shared' | 'transfers' | 'settings' }
  /** Files arrived from Explorer's right-click menu. */
  'external-upload': { count: number; target: string }
}
