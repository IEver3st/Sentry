import { useEffect, useMemo, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { ArrowDown, ArrowRight, ArrowUp, Link2, Share2 } from 'lucide-react'
import type { DriveFile, MapNode, Suggestion, Transfer } from '@shared/types'
import { api, go, pullFiles, quickLink, retryDriveMap, revealFile, scanMap, useApp } from '@/lib/store'
import { formatSize, greeting, percent, plural, relativeTime, sizeParts } from '@/lib/format'
import { useLoad, useSize } from '@/lib/hooks'
import { nodeColor, nodeGroup } from '@/lib/kinds'
import { cx, FileBadge, IconButton, LoadError, Spinner } from '@/components/ui'
import { layoutTreemap, Treemap } from '@/components/Treemap'
import { openShare } from '@/components/ShareDialog'

/**
 * Home is one surface, edge to edge: a header band with the numbers that matter,
 * the Drive map filling the body, and hairline-separated columns of lists that
 * show as many rows as the window allows. No cards, no width cap.
 */
export function Home() {
  const name = useApp((s) => s.settings?.name)
  const quota = useApp((s) => s.quota)
  const transfers = useApp((s) => s.transfers)
  const driveVersion = useApp((s) => s.driveVersion)
  const justOnboarded = useApp((s) => s.justOnboarded)
  const driveMap = useApp((s) => s.maps.drive)
  const recent = useLoad(() => api().recent(40), [driveVersion])
  const shared = useLoad(() => api().shared(), [driveVersion])

  useEffect(() => {
    if (!driveMap) void scanMap('drive')
  }, [driveMap])

  const active = transfers.filter((t) => t.state === 'running' || t.state === 'queued')
  const free = quota?.limit ? quota.limit - quota.usage : null

  const status = useMemo(() => {
    if (active.length) {
      const up = active.filter((t) => t.direction === 'up').length
      const down = active.length - up
      return [up && `Sending ${plural(up, 'file')} up`, down && `pulling ${plural(down, 'file')} down`].filter(Boolean).join(' and ') + '.'
    }
    if (!quota) return 'Checking in with your Drive…'
    return 'Everything’s settled.'
  }, [active, quota])

  const largest = useMemo(() => {
    if (!driveMap) return null
    const out: MapNode[] = []
    const walk = (n: MapNode): void => {
      if (n.children?.length) n.children.forEach(walk)
      else if (!n.isDir && !n.aggregate) out.push(n)
    }
    walk(driveMap.root)
    return out.sort((a, b) => b.size - a.size)
  }, [driveMap])

  const mapError = useApp((s) => s.driveMapError)
  const mapBusy = useApp((s) => s.scanning.drive)
  const reclaim = driveMap?.suggestions.filter((s) => s.tone === 'reclaim').reduce((a, s) => a + s.size, 0) ?? 0

  const worth = (
    <Section title="Worth a look" right={driveMap && reclaim > 0 && <span className="text-[12px] font-medium text-amber tnum">{formatSize(reclaim)} to win back</span>}>
      {driveMap ? (
        driveMap.suggestions.length ? (
          <ul className="flex flex-col">
            {driveMap.suggestions.map((s) => (
              <SuggestionRow key={s.id} s={s} />
            ))}
          </ul>
        ) : (
          <p className="px-5 pb-4 text-[13px] text-fog-400">Nothing stands out. Your Drive is tidy.</p>
        )
      ) : mapError ? (
        <LoadError message="Couldn’t read your Drive for suggestions." onRetry={retryDriveMap} busy={mapBusy} />
      ) : (
        <Skeletons n={3} h={44} />
      )}
    </Section>
  )

  const recentSection = (
    <Section
      title="Recently changed"
      fill
      right={
        <button onClick={() => go('files', null)} className="text-[12.5px] text-fog-400 hover:text-fog-100">
          See all
        </button>
      }
    >
      <FitList
        items={recent.data}
        error={recent.error != null && !recent.data ? 'Couldn’t load your recent files.' : null}
        onRetry={recent.reload}
        busy={recent.loading}
        rowHeight={48}
        render={(f) => <RecentRow key={f.id} file={f} />}
        empty="Nothing yet. Files you add show up here."
      />
    </Section>
  )

  const largestSection = (
    <Section title="Largest files" fill>
      <FitList
        items={largest}
        error={!driveMap && mapError ? 'Couldn’t map your Drive.' : null}
        onRetry={retryDriveMap}
        busy={mapBusy}
        rowHeight={36}
        empty="No files yet."
        render={(f) => (
          <button key={f.id} onClick={() => revealFile(f.id)} className="flex h-9 w-full items-center gap-3 px-5 text-left text-[13px] hover:bg-white/[0.03]">
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: nodeColor(f) }} />
            <span className="min-w-0 flex-1 truncate text-fog-300">{f.name}</span>
            <span className="text-fog-400 tnum">{formatSize(f.size)}</span>
          </button>
        )}
      />
    </Section>
  )

  const activitySection = (
    <Section
      title="Activity"
      right={
        <button onClick={() => go('transfers')} className="text-[12.5px] text-fog-400 hover:text-fog-100">
          All transfers
        </button>
      }
    >
      {transfers.length ? (
        <ul className="flex flex-col pb-2">
          {transfers.slice(0, 4).map((t) => (
            <ActivityRow key={t.id} t={t} />
          ))}
        </ul>
      ) : (
        <p className="px-5 pb-4 text-[13px] text-fog-400">Nothing moving. Drop files anywhere on this window to send them up.</p>
      )}
    </Section>
  )

  return (
    <div className="flex h-full flex-col overflow-y-auto lg:overflow-hidden">
      {/* Header band */}
      <header className="flex shrink-0 flex-wrap items-end gap-x-12 gap-y-4 border-b border-white/[0.05] px-7 pt-6 pb-5">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-fog-400">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
          <h1 className="mt-1 text-[30px] leading-tight font-semibold tracking-[-0.025em]">
            {justOnboarded ? 'Welcome in' : greeting()}
            {name ? `, ${name}` : ''}.
          </h1>
          <p className="mt-1 flex items-center gap-2 text-[14.5px] text-fog-300">
            {active.length > 0 && <Spinner size={14} />}
            {status}
          </p>
        </div>
        <dl className="flex flex-wrap items-end gap-x-10 gap-y-3">
          <Figure label="Used" bytes={quota?.usage} sub={quota?.limit ? `of ${formatSize(quota.limit)}` : undefined} />
          <Figure label="Free" bytes={free ?? undefined} tone="text-mint" />
          <Figure label="Trash" bytes={quota?.usageInTrash} />
          <Figure label="Gmail" bytes={quota?.usageElsewhere} />
          <div>
            <dt className="text-[11.5px] font-semibold tracking-[0.08em] text-fog-500 uppercase">Live links</dt>
            <dd className="mt-1">
              <button onClick={() => go('shared')} className="text-[28px] leading-none font-semibold tracking-tight tnum hover:text-amber">
                {shared.data?.length ?? '–'}
              </button>
            </dd>
          </div>
        </dl>
      </header>
      <PlanBar />

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section className="flex min-h-[380px] min-w-0 flex-1 flex-col">
          <DriveMap />
          <CategoryLegend />
        </section>

        {/* Wide windows: recent gets its own column */}
        <div className="hidden w-[380px] shrink-0 flex-col border-l border-white/[0.05] 2xl:flex">{recentSection}</div>

        <aside className="flex shrink-0 flex-col border-t border-white/[0.05] lg:w-[380px] lg:border-t-0 lg:border-l">
          {worth}
          <div className="flex min-h-[220px] flex-1 flex-col border-t border-white/[0.05] 2xl:hidden">{recentSection}</div>
          <div className="hidden min-h-0 flex-1 flex-col border-t border-white/[0.05] 2xl:flex">{largestSection}</div>
          <div className="border-t border-white/[0.05]">{activitySection}</div>
        </aside>
      </div>
    </div>
  )
}

function Section({ title, right, fill, children }: { title: string; right?: ReactNode; fill?: boolean; children: ReactNode }) {
  return (
    <section className={cx('flex flex-col', fill && 'min-h-0 flex-1')}>
      <div className="flex h-11 shrink-0 items-center justify-between px-5">
        <h2 className="text-[11.5px] font-semibold tracking-[0.08em] text-fog-500 uppercase">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  )
}

function Figure({ label, bytes, sub, tone }: { label: string; bytes?: number; sub?: string; tone?: string }) {
  const parts = bytes === undefined ? null : sizeParts(bytes)
  return (
    <div>
      <dt className="text-[11.5px] font-semibold tracking-[0.08em] text-fog-500 uppercase">{label}</dt>
      <dd className="mt-1 flex items-baseline gap-1.5">
        {parts ? (
          <span className={cx('text-[28px] leading-none font-semibold tracking-tight tnum', tone)}>
            {parts.value}
            <span className="ml-1 text-[14px] font-medium text-fog-400">{parts.unit}</span>
          </span>
        ) : (
          <span className="skeleton inline-block h-7 w-20 rounded-md" />
        )}
        {sub && <span className="text-[12.5px] text-fog-500">{sub}</span>}
      </dd>
    </div>
  )
}

/** Full-width plan usage line under the header: Drive, Trash, Gmail. */
function PlanBar() {
  const quota = useApp((s) => s.quota)
  const total = quota ? (quota.limit ?? quota.usage) : 1
  const parts = quota
    ? [
        { v: quota.usageInDrive, c: 'var(--color-amber)', label: 'Drive' },
        { v: quota.usageInTrash, c: 'var(--color-cat-cache)', label: 'Trash' },
        { v: quota.usageElsewhere, c: 'var(--color-cat-documents)', label: 'Gmail' }
      ]
    : []
  return (
    <div className="flex h-[3px] shrink-0 bg-white/[0.04]" role="img" aria-label={quota ? `${formatSize(quota.usage)} of ${formatSize(total)} used` : 'Loading usage'}>
      {parts.map((p) =>
        p.v > 0 ? (
          <motion.div
            key={p.label}
            className="h-full"
            style={{ backgroundColor: p.c }}
            initial={{ width: 0 }}
            animate={{ width: `${Math.max(0.4, percent(p.v, total))}%` }}
            transition={{ type: 'spring', stiffness: 120, damping: 22 }}
          />
        ) : null
      )}
    </div>
  )
}

function DriveMap() {
  const snap = useApp((s) => s.maps.drive)
  const error = useApp((s) => s.driveMapError)
  const busy = useApp((s) => s.scanning.drive)
  const [ref, size] = useSize<HTMLDivElement>()
  const items = useMemo(() => (snap ? layoutTreemap(snap.root, size.width, size.height, 2, 'size') : []), [snap, size])
  return (
    <div ref={ref} role="tree" aria-label="Drive map" className="relative m-3 mb-0 min-h-0 flex-1 overflow-hidden rounded-lg">
      {snap ? (
        <Treemap items={items} mode="size" onSelect={(t) => (t.node.isDir ? go('files', t.node.id) : !t.node.aggregate && revealFile(t.node.id))} />
      ) : error ? (
        <div className="absolute inset-0 grid place-items-center rounded-lg border border-dashed border-white/[0.08]">
          <LoadError message={`Couldn’t map your Drive. ${error}`} onRetry={retryDriveMap} busy={busy} className="max-w-md items-center text-center" />
        </div>
      ) : (
        <div className="skeleton absolute inset-0 rounded-lg" />
      )}
    </div>
  )
}

/** What the Drive is made of, as a legend under the map. */
function CategoryLegend() {
  const snap = useApp((s) => s.maps.drive)
  const rows = useMemo(() => {
    if (!snap) return []
    const totals = new Map<string, { label: string; color: string; size: number }>()
    const walk = (n: MapNode): void => {
      if (n.children?.length) return n.children.forEach(walk)
      const g = nodeGroup(n)
      const t = totals.get(g.key) ?? { label: g.label, color: g.color, size: 0 }
      t.size += n.size
      totals.set(g.key, t)
    }
    walk(snap.root)
    return [...totals].filter(([, v]) => v.size > 0).sort((a, b) => b[1].size - a[1].size)
  }, [snap])
  return (
    <div className="flex h-11 shrink-0 items-center gap-6 overflow-hidden px-5 text-[12.5px]">
      {rows.map(([key, g]) => (
        <span key={key} className="flex shrink-0 items-center gap-2">
          <span className="size-2.5 rounded-[3px]" style={{ backgroundColor: g.color }} />
          <span className="text-fog-300">{g.label}</span>
          <span className="text-fog-500 tnum">{formatSize(g.size)}</span>
        </span>
      ))}
      <span className="flex shrink-0 items-center gap-2 text-fog-500" title="The line along the bottom of each tile shows how recently it changed">
        <span className="h-[2px] w-5 rounded-full bg-gradient-to-r from-fog-300 to-fog-300/20" />
        Line length = how recent
      </span>
      <button onClick={() => go('files', null)} className="ml-auto flex shrink-0 items-center gap-1.5 text-fog-400 hover:text-fog-100">
        Open My Drive <ArrowRight size={14} />
      </button>
    </div>
  )
}

/** Renders as many rows as fit the available height, so lists fill the column without scrolling. */
function FitList<T>({
  items,
  rowHeight,
  render,
  empty,
  error,
  onRetry,
  busy
}: {
  items: T[] | null
  rowHeight: number
  render: (item: T) => ReactNode
  empty: string
  error?: string | null
  onRetry?: () => void
  busy?: boolean
}) {
  const [ref, size] = useSize<HTMLDivElement>()
  const fit = Math.max(1, Math.floor(size.height / rowHeight))
  return (
    <div ref={ref} className="relative min-h-0 flex-1">
      <div className="absolute inset-0 overflow-hidden">
        {items === null && error && onRetry ? (
          <LoadError message={error} onRetry={onRetry} busy={busy} />
        ) : items === null ? (
          <Skeletons n={fit} h={rowHeight} />
        ) : items.length === 0 ? (
          <p className="px-5 text-[13px] text-fog-400">{empty}</p>
        ) : (
          items.slice(0, fit).map(render)
        )}
      </div>
    </div>
  )
}

function Skeletons({ n, h }: { n: number; h: number }) {
  return (
    <div className="flex flex-col gap-1 px-5">
      {Array.from({ length: Math.min(n, 12) }, (_, i) => (
        <div key={i} className="skeleton rounded-md" style={{ height: h - 6 }} />
      ))}
    </div>
  )
}

function SuggestionRow({ s }: { s: Suggestion }) {
  return (
    <li>
      <button
        onClick={() => (s.nodeId === 'root' ? go('files', null) : revealFile(s.nodeId))}
        className="flex w-full items-center gap-3 px-5 py-2 text-left hover:bg-white/[0.03]"
      >
        <span className={cx('h-8 w-[3px] shrink-0 rounded-full', s.tone === 'reclaim' ? 'bg-amber' : 'bg-sky')} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px]">{s.title}</span>
          <span className="block truncate text-[12px] text-fog-500">{s.detail}</span>
        </span>
        <span className="text-[13px] text-fog-300 tnum">{formatSize(s.size)}</span>
      </button>
    </li>
  )
}

function RecentRow({ file }: { file: DriveFile }) {
  return (
    <div className="group flex h-12 items-center gap-3 px-5 hover:bg-white/[0.03]">
      <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => go('files', file.parentId, file.id)}>
        <FileBadge file={file} size={32} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px]">{file.name}</span>
          <span className="block text-[12px] text-fog-500 tnum">
            {file.size ? formatSize(file.size) : 'Google file'} · {relativeTime(file.modifiedAt)}
          </span>
        </span>
      </button>
      <span className="flex opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <IconButton label={file.sample ? 'Sample file, nothing to download' : 'Pull to this PC'} disabled={file.sample} onClick={() => pullFiles([file.id])}>
          <ArrowDown size={15} />
        </IconButton>
        <IconButton label={file.link ? 'Copy link' : 'Get a link'} onClick={() => quickLink(file)}>
          <Link2 size={15} />
        </IconButton>
        <IconButton label="Sharing options" onClick={() => openShare(file)}>
          <Share2 size={15} />
        </IconButton>
      </span>
      {file.link && <Link2 size={13} className="text-mint group-hover:hidden" aria-label="Has a link" />}
    </div>
  )
}

function ActivityRow({ t }: { t: Transfer }) {
  const running = t.state === 'running' || t.state === 'queued'
  const pct = percent(t.done, t.total || 1)
  return (
    <li className="flex h-11 items-center gap-3 px-5">
      <span className={cx('shrink-0', t.state === 'failed' ? 'text-rose' : t.direction === 'up' ? 'text-amber' : 'text-sky')}>
        {t.direction === 'up' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px]">{t.name}</span>
        {running ? (
          <span className="mt-1 block h-1 overflow-hidden rounded-full bg-white/6">
            <span className="block h-full rounded-full bg-amber transition-[width] duration-200" style={{ width: `${pct}%` }} />
          </span>
        ) : (
          <span className={cx('block truncate text-[11.5px]', t.state === 'failed' ? 'text-rose' : 'text-fog-500')}>
            {t.state === 'done'
              ? `${t.direction === 'up' ? 'In Drive' : 'On this PC'} · ${relativeTime(t.finishedAt ?? t.startedAt)}`
              : t.state === 'failed'
                ? t.error
                : 'Cancelled'}
          </span>
        )}
      </span>
      <span className="text-[12px] text-fog-400 tnum">{running ? `${Math.round(pct)}%` : formatSize(t.total)}</span>
    </li>
  )
}
