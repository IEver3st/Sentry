import { motion } from 'motion/react'
import { ArrowDownUp, CloudUpload, FolderClosed, HardDrive, House, Link2, Settings2 } from 'lucide-react'
import { api, go, isLocalOnly, useApp, type Route } from '@/lib/store'
import { formatCount, formatSize, percent } from '@/lib/format'
import { cx, Logo, Spinner } from './ui'

/** With no drive connected, Sentry is a disk map first; Drive shows up as one optional entry. */
const LOCAL_NAV: Array<{ route: Route; label: string; icon: typeof House }> = [{ route: 'map', label: 'This PC', icon: HardDrive }]

const NAV: Array<{ route: Route; label: string; icon: typeof House }> = [
  { route: 'home', label: 'Home', icon: House },
  { route: 'files', label: 'My Drive', icon: FolderClosed },
  { route: 'map', label: 'This PC', icon: HardDrive },
  { route: 'shared', label: 'Shared links', icon: Link2 },
  { route: 'transfers', label: 'Transfers', icon: ArrowDownUp }
]

export function Sidebar() {
  const route = useApp((s) => s.route)
  const quota = useApp((s) => s.quota)
  const account = useApp((s) => s.status?.account)
  const name = useApp((s) => s.settings?.name)
  const active = useApp((s) => s.transfers.filter((t) => t.state === 'running' || t.state === 'queued').length)
  const scanning = useApp((s) => s.scanning.local)
  const scanFiles = useApp((s) => s.scanProgress?.files ?? 0)
  const scanUnseen = useApp((s) => s.localScanUnseen)
  const localOnly = useApp(isLocalOnly)
  const disk = useApp((s) => s.maps.local?.disk ?? null)

  const used = quota ? percent(quota.usage, quota.limit ?? quota.usage) : 0
  const initial = (name || account?.displayName || '?').charAt(0).toUpperCase()

  return (
    <aside className="flex w-[216px] shrink-0 flex-col border-r border-white/[0.05] bg-ink-950">
      <div className="drag flex h-11 items-center gap-2.5 px-4">
        <Logo size={18} />
        <span className="text-[14.5px] font-semibold tracking-tight">Sentry</span>
      </div>

      <nav className="mt-3 flex flex-col gap-0.5 px-2.5" aria-label="Main">
        {(localOnly ? LOCAL_NAV : NAV).map(({ route: r, label, icon: Icon }, i) => {
          const on = route === r
          return (
            <button
              key={r}
              onClick={() => go(r)}
              aria-current={on ? 'page' : undefined}
              className={cx(
                'group relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-[13.5px] transition-colors',
                on ? 'text-fog-100' : 'text-fog-400 hover:bg-white/[0.035] hover:text-fog-100'
              )}
            >
              {on && (
                <motion.span
                  layoutId="nav-active"
                  className="absolute inset-0 rounded-lg bg-white/[0.07]"
                  transition={{ type: 'spring', stiffness: 520, damping: 38 }}
                />
              )}
              <Icon size={17} strokeWidth={1.8} className={cx('relative', on && 'text-amber')} />
              <span className="relative flex-1 text-left">{label}</span>
              {r === 'transfers' && active > 0 ? (
                <span className="relative flex items-center gap-1.5 text-[11.5px] text-amber tnum">
                  <Spinner size={12} />
                  {active}
                </span>
              ) : r === 'map' && scanning ? (
                <span className="relative text-[11.5px] text-amber tnum">{scanFiles ? formatCount(scanFiles) : 'Scanning'}</span>
              ) : r === 'map' && scanUnseen ? (
                <span className="relative text-[11.5px] text-mint">Ready</span>
              ) : (
                <span className="relative text-[11px] text-fog-500 opacity-0 transition-opacity group-hover:opacity-100">
                  Ctrl {localOnly ? 3 : i + 1}
                </span>
              )}
              {r === 'map' && (scanning || scanUnseen) && (
                <span className="absolute right-2.5 bottom-0.5 left-2.5 h-[2px] overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
                  {scanning ? <span className="indeterminate block h-full" /> : <motion.span className="block h-full rounded-full bg-mint" initial={{ width: 0 }} animate={{ width: '100%' }} />}
                </span>
              )}
            </button>
          )
        })}
        {localOnly && (
          <>
            <p className="mt-5 mb-1 px-2.5 text-[11px] font-semibold tracking-[0.08em] text-fog-500 uppercase">Google Drive</p>
            <button
              onClick={() => go('files')}
              aria-current={route !== 'map' && route !== 'settings' ? 'page' : undefined}
              className={cx(
                'flex h-9 items-center gap-3 rounded-lg px-2.5 text-[13.5px] transition-colors',
                route !== 'map' && route !== 'settings' ? 'bg-white/[0.07] text-fog-100' : 'text-fog-400 hover:bg-white/[0.035] hover:text-fog-100'
              )}
            >
              <CloudUpload size={17} strokeWidth={1.8} />
              <span className="flex-1 text-left">Connect Drive</span>
              <span className="text-[11px] text-fog-500">Optional</span>
            </button>
          </>
        )}
      </nav>

      <div className="mt-auto px-3 pb-3">
        <UpdateRow />
        {localOnly ? (
          <button onClick={() => go('map')} className="w-full rounded-xl p-3 text-left transition-colors hover:bg-white/[0.035]" aria-label="This PC disk, open This PC">
            <div className="flex items-baseline justify-between text-[12px]">
              <span className="text-fog-400">{disk ? `Disk ${disk.label}` : 'This PC'}</span>
              <span className="text-fog-300 tnum">{disk ? `${Math.round(percent(disk.total - disk.free, disk.total))}%` : ''}</span>
            </div>
            {disk ? (
              <>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/6">
                  <motion.div className="h-full rounded-full bg-amber" initial={{ width: 0 }} animate={{ width: `${percent(disk.total - disk.free, disk.total)}%` }} />
                </div>
                <div className="mt-2 text-[12px] text-fog-400 tnum">
                  <span className="text-fog-100">{formatSize(disk.free)}</span> free of {formatSize(disk.total)}
                </div>
              </>
            ) : (
              <p className="mt-1 text-[12px] text-fog-500">Scan to see your disk</p>
            )}
          </button>
        ) : (
        <button
          onClick={() => go('files', null)}
          className="w-full rounded-xl p-3 text-left transition-colors hover:bg-white/[0.035]"
          aria-label="Drive storage, open My Drive"
        >
          <div className="flex items-baseline justify-between text-[12px]">
            <span className="text-fog-400">Drive storage</span>
            <span className="text-fog-300 tnum">{quota ? `${Math.round(used)}%` : ''}</span>
          </div>
          {quota ? (
            <>
              <StorageStrip />
              <div className="mt-2 text-[12px] text-fog-400 tnum">
                <span className="text-fog-100">{formatSize(quota.usage)}</span> of {quota.limit ? formatSize(quota.limit) : 'unlimited'}
              </div>
            </>
          ) : (
            <div className="skeleton mt-2 h-1.5 rounded-full" />
          )}
        </button>
        )}

        <button
          onClick={() => go('settings')}
          className={cx(
            'mt-1 flex w-full items-center gap-2.5 rounded-xl p-2 text-left transition-colors hover:bg-white/[0.035]',
            route === 'settings' && 'bg-white/[0.07]'
          )}
        >
          <span className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-amber to-[#e0785a] text-[13px] font-semibold text-ink-950">
            {initial}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">{name || account?.displayName || 'You'}</span>
            <span className="block truncate text-[11.5px] text-fog-500">
              {localOnly ? 'This PC only' : account?.provider === 'demo' ? 'Demo drive' : account?.email}
            </span>
          </span>
          <Settings2 size={16} className="text-fog-500" />
        </button>
      </div>
    </aside>
  )
}

/** Plan usage as proportional tiles: Drive, Trash, Gmail & Photos. */
export function StorageStrip({ height = 6, className }: { height?: number; className?: string }) {
  const quota = useApp((s) => s.quota)
  if (!quota) return null
  const total = quota.limit ?? quota.usage
  const parts = [
    { v: quota.usageInDrive, c: 'var(--color-amber)' },
    { v: quota.usageInTrash, c: 'var(--color-cat-cache)' },
    { v: quota.usageElsewhere, c: 'var(--color-cat-documents)' }
  ]
  return (
    <div className={cx('mt-2 flex gap-[2px] overflow-hidden rounded-full bg-white/6', className)} style={{ height }}>
      {parts.map((p, i) =>
        p.v > 0 ? (
          <motion.div
            key={i}
            className="h-full first:rounded-l-full"
            style={{ backgroundColor: p.c }}
            initial={{ width: 0 }}
            animate={{ width: `${Math.max(1.2, percent(p.v, total))}%` }}
            transition={{ type: 'spring', stiffness: 120, damping: 22, delay: i * 0.05 }}
          />
        ) : null
      )}
    </div>
  )
}

/** Only shows up when there's something to do: an update to fetch or one waiting for a restart. */
function UpdateRow() {
  const update = useApp((s) => s.update)
  if (!update || (update.state !== 'ready' && update.state !== 'available' && update.state !== 'downloading')) return null
  const ready = update.state === 'ready'
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-1 flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[12.5px]"
    >
      <span className={cx('size-1.5 shrink-0 rounded-full', ready ? 'bg-mint' : 'bg-amber')} />
      <span className="min-w-0 flex-1 truncate text-fog-300">
        {ready ? `Update ${update.version} ready` : update.state === 'downloading' ? `Downloading ${update.progress ?? 0}%` : `Update ${update.version} available`}
      </span>
      {ready ? (
        <button onClick={() => void api().installUpdate()} className="font-medium text-amber hover:underline hover:underline-offset-4">
          Restart
        </button>
      ) : update.state === 'available' ? (
        <button onClick={() => void api().downloadUpdate()} className="font-medium text-amber hover:underline hover:underline-offset-4">
          Get it
        </button>
      ) : null}
    </motion.div>
  )
}
