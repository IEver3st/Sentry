import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  ArrowLeft,
  ArrowDownUp,
  Check,
  ChevronDown,
  CloudCog,
  HardDrive,
  Info,
  Keyboard,
  LogOut,
  Palette,
  Power,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X
} from 'lucide-react'
import type { Accent, Settings, Theme } from '@shared/types'
import { THEME_BACKGROUND } from '@shared/types'
import { api, connectDrive, fail, useApp } from '@/lib/store'
import { formatSize } from '@/lib/format'
import { Button, cx, Kbd, Logo, Segmented } from '@/components/ui'
import { StorageStrip } from '@/components/Sidebar'
import { GoogleClientImport } from '@/components/GoogleClientImport'
import { confirm } from '@/components/Confirm'

type SectionId = 'general' | 'appearance' | 'background' | 'drive' | 'transfers' | 'pc' | 'updates' | 'shortcuts' | 'about'

const SECTIONS: Array<{ id: SectionId; label: string; icon: typeof Palette }> = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'background', label: 'Startup & background', icon: Power },
  { id: 'drive', label: 'Drive & account', icon: CloudCog },
  { id: 'transfers', label: 'Transfers', icon: ArrowDownUp },
  { id: 'pc', label: 'This PC', icon: HardDrive },
  { id: 'updates', label: 'Updates', icon: RefreshCw },
  { id: 'shortcuts', label: 'Keyboard', icon: Keyboard },
  { id: 'about', label: 'About', icon: Info }
]

const DEFAULTS: Partial<Settings> = {
  bootAnimation: true,
  launchAtLogin: false,
  startMinimized: true,
  closeToTray: true,
  showTray: true,
  systemNotifications: true,
  sendToTarget: 'inbox',
  autoCheckUpdates: true,
  autoDownloadUpdates: true,
  installOnQuit: true,
  betaUpdates: false,
  theme: 'midnight',
  accent: 'sky',
  uiScale: 1,
  reduceMotion: false,
  sizeBars: true,
  startPage: 'home',
  confirmTrash: true,
  notifyTransfers: true,
  askWhereToSave: false,
  concurrency: 3,
  mapDepth: 2
}

/** Optimistic: the UI changes instantly, the file write follows. */
async function save(patch: Partial<Settings>): Promise<void> {
  const prev = useApp.getState().settings
  if (prev) useApp.setState({ settings: { ...prev, ...patch } })
  try {
    useApp.setState({ settings: await api().updateSettings(patch) })
  } catch (error) {
    if (prev) useApp.setState({ settings: prev })
    fail('Couldn’t save that', error)
  }
}

export function goBackFromSettings(): void {
  const back = useApp.getState().settingsReturn
  useApp.setState({ route: back === 'settings' ? 'home' : back })
}

interface Row {
  section: SectionId
  title: string
  description?: string
  keywords?: string
  control: ReactNode
  /** Full-width rows put the control under the text. */
  wide?: boolean
}

export function SettingsShell() {
  const settings = useApp((s) => s.settings)!
  const status = useApp((s) => s.status)!
  const version = useApp((s) => s.boot?.version)
  const platform = useApp((s) => s.boot?.platform)
  const [section, setSection] = useState<SectionId>('general')
  const [query, setQuery] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) goBackFromSettings()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const rows = useSettingsRows(settings, status, version)
  const q = query.trim().toLowerCase()
  const visible = q
    ? rows.filter((r) => `${r.title} ${r.description ?? ''} ${r.keywords ?? ''}`.toLowerCase().includes(q))
    : rows.filter((r) => r.section === section)
  const grouped = SECTIONS.map((s) => ({ ...s, rows: visible.filter((r) => r.section === s.id) })).filter((g) => g.rows.length)
  const current = SECTIONS.find((s) => s.id === section)!

  const restore = async (): Promise<void> => {
    const ok = await confirm({
      title: 'Restore default settings?',
      body: 'Appearance and behavior go back to how Sentry shipped. Your account, name, and folders stay as they are.',
      confirm: 'Restore defaults'
    })
    if (ok) await save(DEFAULTS)
  }

  return (
    <div className="flex h-full">
      <aside className="flex w-[232px] shrink-0 flex-col border-r border-white/[0.05] bg-ink-950">
        <div className="drag flex h-11 items-center gap-2.5 px-4">
          <Logo size={18} />
          <span className="text-[14.5px] font-semibold tracking-tight">Settings</span>
        </div>
        <label className="relative mx-2.5 mt-3 block">
          <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fog-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            placeholder="Search settings"
            aria-label="Search settings"
            className="h-9 w-full rounded-lg bg-white/[0.04] pr-8 pl-9 text-[13px] outline-none placeholder:text-fog-500 focus:bg-white/[0.07]"
          />
          {query && (
            <button aria-label="Clear" onClick={() => setQuery('')} className="absolute top-1/2 right-2 -translate-y-1/2 text-fog-500 hover:text-fog-100">
              <X size={14} />
            </button>
          )}
        </label>
        <nav className="mt-3 flex flex-col gap-0.5 px-2.5" aria-label="Settings sections">
          {SECTIONS.map(({ id, label, icon: Icon }) => {
            const on = !q && section === id
            const hits = q ? visible.filter((r) => r.section === id).length : 0
            return (
              <button
                key={id}
                onClick={() => (setSection(id), setQuery(''))}
                aria-current={on ? 'page' : undefined}
                className={cx(
                  'relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-[13.5px] transition-colors',
                  on ? 'text-fog-100' : 'text-fog-400 hover:bg-white/[0.035] hover:text-fog-100',
                  q && !hits && 'opacity-40'
                )}
              >
                {on && <motion.span layoutId="settings-active" className="absolute inset-0 rounded-lg bg-white/[0.07]" transition={{ type: 'spring', stiffness: 520, damping: 38 }} />}
                <Icon size={16} strokeWidth={1.8} className={cx('relative', on && 'text-amber')} />
                <span className="relative flex-1 text-left">{label}</span>
                {q && hits > 0 && <span className="relative text-[11.5px] text-amber tnum">{hits}</span>}
              </button>
            )
          })}
        </nav>
        <button
          onClick={goBackFromSettings}
          className="mx-2.5 mt-auto mb-3 flex h-9 items-center gap-3 rounded-lg px-2.5 text-[13.5px] text-fog-400 hover:bg-white/[0.035] hover:text-fog-100"
        >
          <ArrowLeft size={16} /> Back
          <span className="ml-auto">
            <Kbd>Esc</Kbd>
          </span>
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col bg-ink-900">
        <header className="drag flex h-11 shrink-0 items-center gap-2 border-b border-white/[0.05] pl-6 text-[13.5px]" style={{ paddingRight: platform === 'win32' ? 150 : 16 }}>
          <span className="text-fog-400">Settings</span>
          <span className="text-fog-500">/</span>
          <span className="font-medium">{q ? `Results for “${query.trim()}”` : current.label}</span>
          <Button variant="ghost" size="sm" className="ml-auto" icon={<RotateCcw size={14} />} onClick={restore}>
            Restore defaults
          </Button>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={q ? `q:${q}` : section}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.14 }}
              className="mx-auto max-w-[780px] px-8 pt-8 pb-16"
            >
              {grouped.length === 0 && <p className="pt-10 text-center text-[14px] text-fog-400">No settings match “{query.trim()}”.</p>}
              {grouped.map((g) => (
                <section key={g.id} className="mb-10">
                  {q && <h2 className="mb-2 text-[14px] text-fog-400">{g.label}</h2>}
                  <SectionBlocks rows={g.rows} />
                </section>
              ))}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  )
}

/** Rows grouped under quiet sub-headings, T3-style: text left, control right, no cards. */
function SectionBlocks({ rows }: { rows: Row[] }) {
  return (
    <div className="flex flex-col">
      {rows.map((r) => (
        <div
          key={r.title}
          className={cx('flex gap-6 border-b border-white/[0.045] py-4 last:border-b-0', r.wide ? 'flex-col items-stretch gap-3' : 'items-center')}
        >
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium">{r.title}</p>
            {r.description && <p className="mt-0.5 text-[12.5px] leading-relaxed text-fog-400">{r.description}</p>}
          </div>
          <div className={cx(r.wide ? '' : 'shrink-0')}>{r.control}</div>
        </div>
      ))}
    </div>
  )
}

function useSettingsRows(settings: Settings, status: NonNullable<ReturnType<typeof useApp.getState>['status']>, version?: string): Row[] {
  const quota = useApp((s) => s.quota)
  const update = useApp((s) => s.update)
  const [name, setName] = useState(settings.name)
  const [connectingGoogle, setConnectingGoogle] = useState(false)
  const demo = status.provider === 'demo'

  const connectGoogle = async (): Promise<void> => {
    setConnectingGoogle(true)
    try {
      await api().connect('google')
      const boot = await api().bootstrap()
      useApp.setState({ boot, settings: boot.settings, status: boot.status, maps: { drive: null, local: null }, quota: null, folderId: null, focusFileId: null, route: 'home' })
    } catch (error) { fail('Could not connect Google Drive', error) }
    finally { setConnectingGoogle(false) }
  }

  const pick = async (key: 'downloadDir' | 'scanRoot'): Promise<void> => {
    const dir = await api().pickDirectory(settings[key])
    if (!dir) return
    await save({ [key]: dir })
    if (key === 'scanRoot') useApp.setState((s) => ({ maps: { ...s.maps, local: null } }))
  }

  const disconnect = async (): Promise<void> => {
    const ok = await confirm({
      title: demo ? 'Leave the demo drive?' : 'Disconnect Google Drive?',
      body: demo
        ? 'Files you uploaded to the demo drive are deleted from this PC. Your own files elsewhere aren’t touched.'
        : 'Sentry forgets your sign-in on this PC. Nothing in your Drive changes.',
      confirm: demo ? 'Leave demo' : 'Disconnect',
      danger: true
    })
    if (!ok) return
    try {
      const next = await api().disconnect()
      useApp.setState({ status: next, maps: { drive: null, local: null }, quota: null, route: 'home' })
    } catch (error) {
      fail('Couldn’t disconnect', error)
    }
  }

  const reset = async (): Promise<void> => {
    const ok = await confirm({
      title: 'Start over?',
      body: 'Sentry signs out, forgets your preferences, and walks you through setup again.',
      confirm: 'Start over',
      danger: true
    })
    if (!ok) return
    await api().resetApp()
    const boot = await api().bootstrap()
    useApp.setState({ boot, settings: boot.settings, status: boot.status, maps: { drive: null, local: null }, quota: null, route: 'home', folderId: null })
  }

  return useMemo<Row[]>(
    () => [
      /* General */
      {
        section: 'general',
        title: 'Your name',
        description: 'Used in the greeting on Home. Stays on this computer.',
        control: (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() !== settings.name && save({ name: name.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            maxLength={40}
            aria-label="Your name"
            className="h-9 w-56 rounded-lg border border-white/[0.08] bg-ink-800 px-3 text-[13.5px] outline-none focus:border-amber/50"
          />
        )
      },
      {
        section: 'general',
        title: 'Open to',
        description: 'The page Sentry shows when it starts.',
        control: (
          <Select
            value={settings.startPage}
            onChange={(v) => save({ startPage: v })}
            options={[
              { value: 'home', label: 'Home' },
              { value: 'files', label: 'My Drive' },
              { value: 'map', label: 'This PC' }
            ]}
          />
        )
      },
      {
        section: 'general',
        title: 'Confirm before moving to trash',
        description: 'Ask first when you delete from My Drive. Trash is recoverable in Google Drive for 30 days either way.',
        keywords: 'delete',
        control: <Toggle on={settings.confirmTrash} label="Confirm before moving to trash" onChange={(v) => save({ confirmTrash: v })} />
      },
      {
        section: 'general',
        title: 'Transfer notifications',
        description: 'Show a toast when a batch of uploads or downloads finishes.',
        keywords: 'toast alert',
        control: <Toggle on={settings.notifyTransfers} label="Transfer notifications" onChange={(v) => save({ notifyTransfers: v })} />
      },

      /* Appearance */
      {
        section: 'appearance',
        title: 'Background',
        description: 'The base tone for every surface.',
        keywords: 'theme dark black oled graphite',
        wide: true,
        control: <ThemePicker value={settings.theme} onChange={(v) => save({ theme: v })} />
      },
      {
        section: 'appearance',
        title: 'Accent color',
        description: 'Used for selection, focus, progress, and primary buttons.',
        keywords: 'color highlight',
        control: <AccentPicker value={settings.accent} onChange={(v) => save({ accent: v })} />
      },
      {
        section: 'appearance',
        title: 'Interface size',
        description: 'Scales text and controls across the app.',
        keywords: 'zoom scale font text',
        control: (
          <Segmented
            value={String(settings.uiScale)}
            onChange={(v) => save({ uiScale: Number(v) })}
            label="Interface size"
            options={[
              { value: '0.9', label: '90%' },
              { value: '1', label: '100%' },
              { value: '1.1', label: '110%' },
              { value: '1.2', label: '120%' }
            ]}
          />
        )
      },
      {
        section: 'appearance',
        title: 'Reduce motion',
        description: 'Swap slides and springs for instant changes.',
        keywords: 'animation',
        control: <Toggle on={settings.reduceMotion} label="Reduce motion" onChange={(v) => save({ reduceMotion: v })} />
      },
      {
        section: 'appearance',
        title: 'Boot animation',
        description: 'The Sentry mark assembling as the app starts. Any key or click skips it.',
        keywords: 'startup splash intro launch',
        control: <Toggle on={settings.bootAnimation !== false} label="Boot animation" onChange={(v) => save({ bootAnimation: v })} />
      },
      {
        section: 'appearance',
        title: 'Size bars in file lists',
        description: 'A thin bar next to each size so big items stand out.',
        control: <Toggle on={settings.sizeBars} label="Size bars in file lists" onChange={(v) => save({ sizeBars: v })} />
      },

      /* Drive */
      {
        section: 'drive',
        title: !status.provider ? 'No drive connected' : demo ? 'Demo drive' : 'Google Drive',
        description: !status.provider
          ? 'Sentry is mapping this PC only. Connecting Google Drive is optional.'
          : demo
            ? 'Sample library plus your real uploads, stored on this PC.'
            : `Signed in as ${status.account?.email ?? 'unknown'}.`,
        keywords: 'account sign out disconnect local only',
        control: !status.provider ? (
          <Button size="sm" onClick={() => void connectDrive('demo', 'files')}>
            Try a demo drive
          </Button>
        ) : (
          <Button variant="danger" size="sm" icon={<LogOut size={14} />} onClick={disconnect}>
            {demo ? 'Leave demo' : 'Disconnect'}
          </Button>
        )
      },
      {
        section: 'drive',
        title: 'Google sign-in',
        description: status.googleConfigured
          ? demo
            ? 'Connect your real Drive. Your demo files stay on this PC.'
            : !status.provider
              ? 'Ready when you are. Opens your browser to approve access.'
              : 'Connected.'
          : 'Import a Desktop app client downloaded from Google Cloud.',
        keywords: 'oauth login',
        control: !status.googleConfigured ? <GoogleClientImport disabled={connectingGoogle} /> : demo || !status.provider ? (
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={connectGoogle} disabled={connectingGoogle}>{connectingGoogle ? 'Connecting…' : 'Connect Google Drive'}</Button>
            {connectingGoogle && <Button size="sm" variant="ghost" onClick={() => void api().cancelGoogleSignIn()}>Cancel</Button>}
          </div>
        ) : (
          <span className={cx('flex items-center gap-2 text-[13px]', status.googleConfigured ? 'text-mint' : 'text-fog-500')}>
            <span className={cx('size-2 rounded-full', status.googleConfigured ? 'bg-mint' : 'bg-fog-500')} />
            {status.googleConfigured ? 'Available' : 'Unavailable'}
          </span>
        )
      },
      {
        section: 'drive',
        title: 'Plan usage',
        keywords: 'quota storage space',
        wide: true,
        control: quota ? (
          <div>
            <StorageStrip height={8} className="mt-0" />
            <p className="mt-2 text-[12.5px] text-fog-400 tnum">
              {formatSize(quota.usage)} of {quota.limit ? formatSize(quota.limit) : 'unlimited'} · Drive {formatSize(quota.usageInDrive)} · Trash{' '}
              {formatSize(quota.usageInTrash)} · Gmail {formatSize(quota.usageElsewhere)}
            </p>
          </div>
        ) : (
          <div className="skeleton h-8 rounded-lg" />
        )
      },
      {
        section: 'drive',
        title: 'Map detail in My Drive',
        description: 'How many folder levels the map above your files shows.',
        keywords: 'depth treemap',
        control: (
          <Segmented
            value={String(settings.mapDepth)}
            onChange={(v) => save({ mapDepth: Number(v) })}
            label="Map detail"
            options={[
              { value: '1', label: 'Simple' },
              { value: '2', label: 'Balanced' },
              { value: '3', label: 'Detailed' }
            ]}
          />
        )
      },

      /* Startup & background */
      {
        section: 'background',
        title: 'Launch when you sign in',
        description: 'Sentry starts with Windows so right-click uploads and transfers are always ready.',
        keywords: 'startup boot login autostart',
        control: <Toggle on={settings.launchAtLogin} label="Launch when you sign in" onChange={(v) => save({ launchAtLogin: v })} />
      },
      {
        section: 'background',
        title: 'Start in the tray',
        description: settings.showTray
          ? 'When Sentry launches at sign-in, it waits in the tray instead of opening a window.'
          : 'Needs the tray icon, so there’s somewhere to open Sentry from.',
        keywords: 'minimized hidden silent',
        control: <Toggle on={settings.startMinimized && settings.showTray} label="Start in the tray" onChange={(v) => save({ startMinimized: v, ...(v ? { showTray: true } : {}) })} />
      },
      {
        section: 'background',
        title: 'Keep running when the window closes',
        description: 'The close button hides Sentry to the tray so uploads keep going. Quit from the tray menu.',
        keywords: 'close tray background minimize',
        control: <Toggle on={settings.closeToTray && settings.showTray} label="Keep running when the window closes" onChange={(v) => save({ closeToTray: v, ...(v ? { showTray: true } : {}) })} />
      },
      {
        section: 'background',
        title: 'Tray icon',
        description: 'Quick access to Sentry, transfer status, and updates from the notification area.',
        keywords: 'system tray notification area',
        control: <Toggle on={settings.showTray} label="Tray icon" onChange={(v) => save(v ? { showTray: true } : { showTray: false, closeToTray: false, startMinimized: false })} />
      },
      {
        section: 'background',
        title: 'Windows notifications',
        description: 'When Sentry is hidden, tell me when transfers finish or fail.',
        keywords: 'alerts toast notify',
        control: <Toggle on={settings.systemNotifications} label="Windows notifications" onChange={(v) => save({ systemNotifications: v })} />
      },
      {
        section: 'background',
        title: '“Send to Google Drive” in File Explorer',
        description: 'Right-click any file or folder on your PC to upload it with Sentry. Also adds Google Drive (Sentry) to the Send to menu. On Windows 11 the right-click option is under Show more options.',
        keywords: 'context menu right click explorer send to shell',
        control: <ShellToggle />
      },
      {
        section: 'background',
        title: 'Files sent from Explorer go to',
        description: settings.sendToTarget === 'inbox' ? 'A “From my PC” folder in My Drive, created the first time you use it.' : 'The top of My Drive.',
        keywords: 'destination inbox folder',
        control: (
          <Select
            value={settings.sendToTarget}
            onChange={(v) => save({ sendToTarget: v })}
            options={[
              { value: 'inbox', label: 'From my PC folder' },
              { value: 'root', label: 'My Drive' }
            ]}
          />
        )
      },

      /* Updates */
      {
        section: 'updates',
        title: `Sentry ${version ?? ''}`,
        description: updateText(update),
        keywords: 'version check update upgrade',
        control: <UpdateAction />
      },
      {
        section: 'updates',
        title: 'Check for updates automatically',
        description: 'A quick check shortly after launch, then every few hours.',
        control: <Toggle on={settings.autoCheckUpdates} label="Check for updates automatically" onChange={(v) => save({ autoCheckUpdates: v })} />
      },
      {
        section: 'updates',
        title: 'Download updates in the background',
        description: 'Otherwise Sentry asks before downloading.',
        control: <Toggle on={settings.autoDownloadUpdates} label="Download updates in the background" onChange={(v) => save({ autoDownloadUpdates: v })} />
      },
      {
        section: 'updates',
        title: 'Install when Sentry quits',
        description: 'A downloaded update installs quietly the next time you quit, so nothing interrupts you.',
        control: <Toggle on={settings.installOnQuit} label="Install when Sentry quits" onChange={(v) => save({ installOnQuit: v })} />
      },
      {
        section: 'updates',
        title: 'Early releases',
        description: 'Get new features before everyone else. Occasionally rough around the edges.',
        keywords: 'beta prerelease channel',
        control: <Toggle on={settings.betaUpdates} label="Early releases" onChange={(v) => save({ betaUpdates: v })} />
      },

      /* Transfers */
      {
        section: 'transfers',
        title: 'Pulled files land in',
        description: settings.downloadDir,
        keywords: 'download folder',
        control: (
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => api().revealLocal(settings.downloadDir)}>
              Open
            </Button>
            <Button size="sm" onClick={() => pick('downloadDir')}>
              Change
            </Button>
          </div>
        )
      },
      {
        section: 'transfers',
        title: 'Ask where to save each time',
        description: 'Pick a folder for every pull instead of using the one above.',
        keywords: 'download',
        control: <Toggle on={settings.askWhereToSave} label="Ask where to save each time" onChange={(v) => save({ askWhereToSave: v })} />
      },
      {
        section: 'transfers',
        title: 'Files at once',
        description: 'How many uploads and downloads run side by side. Fewer is gentler on slow connections.',
        keywords: 'concurrency parallel speed',
        control: (
          <Segmented
            value={String(settings.concurrency)}
            onChange={(v) => save({ concurrency: Number(v) })}
            label="Files at once"
            options={['1', '2', '3', '4', '6'].map((n) => ({ value: n, label: n }))}
          />
        )
      },

      /* This PC */
      {
        section: 'pc',
        title: 'Folder to map',
        description: settings.scanRoot,
        keywords: 'scan storage map disk',
        control: (
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => api().revealLocal(settings.scanRoot)}>
              Open
            </Button>
            <Button size="sm" onClick={() => pick('scanRoot')}>
              Change
            </Button>
          </div>
        )
      },
      {
        section: 'pc',
        title: 'Forget the last scan',
        description: 'Sentry remembers your last scan between launches. This clears it so the next visit scans fresh. Nothing on disk is touched.',
        control: (
          <Button size="sm" onClick={() => void api().forgetLocalScan().then(() => useApp.setState((s) => ({ maps: { ...s.maps, local: null } })))}>
            Forget scan
          </Button>
        )
      },

      /* Shortcuts */
      ...(
        [
          ['Search your Drive', 'Ctrl K'],
          ['Jump between pages', 'Ctrl 1–5'],
          ['Open settings', 'Ctrl ,'],
          ['Open folder or pull a file', 'Enter'],
          ['Up one folder', 'Backspace'],
          ['Rename', 'F2'],
          ['Copy link for the selected file', 'Ctrl L'],
          ['Move to trash', 'Del'],
          ['Select everything', 'Ctrl A'],
          ['This PC map: depth, mode, filter', '[ ]  t  /']
        ] as const
      ).map(([title, keys]) => ({ section: 'shortcuts' as const, title, keywords: 'keyboard shortcut', control: <Kbd>{keys}</Kbd> })),

      /* About */
      {
        section: 'about',
        title: `Sentry ${version ?? ''}`,
        description: 'Talks straight to Google from this PC. Your sign-in is encrypted with your Windows account, and folder scans never leave your computer.',
        keywords: 'version privacy',
        control: null
      },
      {
        section: 'about',
        title: 'Start over',
        description: 'Sign out, forget preferences, and run setup again.',
        keywords: 'reset onboarding',
        control: (
          <Button variant="danger" size="sm" onClick={reset}>
            Start over
          </Button>
        )
      }
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings, status, quota, version, name, demo, connectingGoogle, update]
  )
}

function updateText(u: ReturnType<typeof useApp.getState>['update']): string {
  if (!u) return 'Checking…'
  switch (u.state) {
    case 'unsupported':
      return 'Updates arrive in installed builds. This is a development copy.'
    case 'checking':
      return 'Checking for updates…'
    case 'up-to-date':
      return `You’re up to date.${u.checkedAt ? ` Checked ${new Date(u.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : ''}`
    case 'available':
      return `Version ${u.version} is available.`
    case 'downloading':
      return `Downloading ${u.version}… ${u.progress ?? 0}%`
    case 'ready':
      return `Version ${u.version} is downloaded and ready to install.`
    case 'error':
      return u.error ?? 'Couldn’t check for updates.'
    default:
      return 'Sentry checks for updates on its own.'
  }
}

function UpdateAction() {
  const u = useApp((s) => s.update)
  const [busy, setBusy] = useState(false)
  if (!u || u.state === 'unsupported') return <span className="text-[13px] text-fog-500">Unavailable</span>
  if (u.state === 'ready')
    return (
      <Button size="sm" variant="primary" onClick={() => void api().installUpdate()}>
        Restart to update
      </Button>
    )
  if (u.state === 'available')
    return (
      <Button size="sm" variant="primary" onClick={() => void api().downloadUpdate()}>
        Download
      </Button>
    )
  if (u.state === 'downloading')
    return (
      <div className="h-1.5 w-32 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full bg-amber transition-[width]" style={{ width: `${u.progress ?? 0}%` }} />
      </div>
    )
  return (
    <Button
      size="sm"
      disabled={busy || u.state === 'checking'}
      onClick={async () => {
        setBusy(true)
        try {
          useApp.setState({ update: await api().checkForUpdates() })
        } finally {
          setBusy(false)
        }
      }}
    >
      {busy || u.state === 'checking' ? 'Checking…' : 'Check now'}
    </Button>
  )
}

/** Reads the real Explorer state from Windows rather than trusting the saved setting. */
function ShellToggle() {
  const [state, setState] = useState<{ supported: boolean; on: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void api()
      .shellIntegration()
      .then((s) => setState({ supported: s.supported, on: s.contextMenu || s.sendTo }))
  }, [])
  if (!state) return <span className="text-[13px] text-fog-500">Checking…</span>
  if (!state.supported) return <span className="text-[13px] text-fog-500">Windows only</span>
  return (
    <Toggle
      on={state.on}
      label="Send to Google Drive in File Explorer"
      onChange={async (v) => {
        if (busy) return
        setBusy(true)
        setState({ ...state, on: v })
        try {
          const s = await api().setShellIntegration(v)
          setState({ supported: s.supported, on: s.contextMenu || s.sendTo })
          useApp.setState((st) => (st.settings ? { settings: { ...st.settings, contextMenu: s.contextMenu } } : {}))
        } catch (error) {
          setState({ ...state, on: !v })
          fail('Couldn’t change the Explorer option', error)
        } finally {
          setBusy(false)
        }
      }}
    />
  )
}

/* ---------- Controls ---------- */

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={cx('relative h-6 w-10 shrink-0 rounded-full transition-colors', on ? 'bg-amber' : 'bg-ink-600')}>
      <motion.span className="absolute top-0.5 size-5 rounded-full bg-white shadow" animate={{ left: on ? 18 : 2 }} transition={{ type: 'spring', stiffness: 600, damping: 32 }} />
    </button>
  )
}

function Select<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }> }) {
  const current = options.find((o) => o.value === value)
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="flex h-9 w-48 items-center justify-between rounded-lg border border-white/[0.08] bg-ink-800 px-3 text-[13.5px] hover:bg-ink-750 data-[state=open]:border-amber/40">
        {current?.label}
        <ChevronDown size={15} className="text-fog-400" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-50 w-48 rounded-xl border border-white/[0.08] bg-ink-750 p-1.5 shadow-2xl shadow-black/50">
          {options.map((o) => (
            <DropdownMenu.Item
              key={o.value}
              onSelect={() => onChange(o.value)}
              className="flex h-8 cursor-default items-center justify-between rounded-lg px-2.5 text-[13px] outline-none data-[highlighted]:bg-white/[0.07]"
            >
              {o.label}
              {o.value === value && <Check size={14} className="text-amber" />}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

const THEMES: Array<{ id: Theme; label: string; note: string }> = [
  { id: 'midnight', label: 'Midnight', note: 'Deep blue-black' },
  { id: 'graphite', label: 'Graphite', note: 'Soft, warmer gray' },
  { id: 'oled', label: 'True black', note: 'Best on OLED screens' }
]

function ThemePicker({ value, onChange }: { value: Theme; onChange: (v: Theme) => void }) {
  return (
    <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Background">
      {THEMES.map((t) => {
        const on = value === t.id
        const bg = THEME_BACKGROUND[t.id]
        return (
          <button
            key={t.id}
            role="radio"
            aria-checked={on}
            onClick={() => onChange(t.id)}
            className={cx('rounded-xl border p-2 text-left transition-colors', on ? 'border-amber/60 bg-amber/[0.06]' : 'border-white/[0.07] hover:border-white/15')}
          >
            {/* A tiny preview of the app in that tone */}
            <span className="flex h-20 overflow-hidden rounded-lg border border-white/[0.06]" style={{ backgroundColor: bg }}>
              <span className="w-1/4 border-r border-white/[0.05]" style={{ backgroundColor: `color-mix(in oklab, ${bg} 80%, black)` }} />
              <span className="flex flex-1 flex-col gap-1.5 p-2">
                <span className="h-1.5 w-1/2 rounded-full bg-white/25" />
                <span className="flex flex-1 gap-1">
                  <span className="flex-[3] rounded-[3px]" style={{ backgroundColor: 'color-mix(in oklab, var(--color-cat-archives) 45%, ' + bg + ')' }} />
                  <span className="flex flex-[2] flex-col gap-1">
                    <span className="flex-1 rounded-[3px]" style={{ backgroundColor: 'color-mix(in oklab, var(--color-cat-media) 45%, ' + bg + ')' }} />
                    <span className="flex-1 rounded-[3px]" style={{ backgroundColor: 'color-mix(in oklab, var(--color-amber) 55%, ' + bg + ')' }} />
                  </span>
                </span>
              </span>
            </span>
            <span className="mt-2 flex items-center justify-between px-1">
              <span>
                <span className="block text-[13px] font-medium">{t.label}</span>
                <span className="block text-[11.5px] text-fog-500">{t.note}</span>
              </span>
              {on && <Check size={15} className="text-amber" />}
            </span>
          </button>
        )
      })}
    </div>
  )
}

const ACCENTS: Array<{ id: Accent; color: string; label: string }> = [
  { id: 'sky', color: '#6aa8ff', label: 'Sky' },
  { id: 'amber', color: '#f2b35b', label: 'Amber' },
  { id: 'mint', color: '#5fd39a', label: 'Mint' },
  { id: 'rose', color: '#f28a8a', label: 'Rose' },
  { id: 'violet', color: '#a88bf5', label: 'Violet' }
]

function AccentPicker({ value, onChange }: { value: Accent; onChange: (v: Accent) => void }) {
  return (
    <div className="flex gap-2" role="radiogroup" aria-label="Accent color">
      {ACCENTS.map((a) => (
        <button
          key={a.id}
          role="radio"
          aria-checked={value === a.id}
          aria-label={a.label}
          title={a.label}
          onClick={() => onChange(a.id)}
          className={cx('grid size-8 place-items-center rounded-full transition-transform hover:scale-110', value === a.id && 'ring-2 ring-offset-2 ring-offset-ink-900')}
          style={{ backgroundColor: a.color, ['--tw-ring-color' as string]: a.color }}
        >
          {value === a.id && <Check size={15} strokeWidth={3} className="text-ink-950" />}
        </button>
      ))}
    </div>
  )
}
