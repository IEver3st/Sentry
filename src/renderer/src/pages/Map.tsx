import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { ArrowDown, ArrowUpFromLine, ChevronRight, Clipboard, CloudUpload, ExternalLink, FolderOpen, FolderUp, HardDrive, Link2, Minus, Plus, RefreshCw, Search, SquareCheck, Trash2, X, ZoomIn } from 'lucide-react'
import type { MapNode, MapSnapshot } from '@shared/types'
import { api, fail, go, pullFiles, quickLink, revealFile, scanMap, toast, uploadPaths, useApp } from '@/lib/store'
import { pickDriveFolder } from '@/components/DrivePicker'
import { confirm } from '@/components/Confirm'
import { formatCount, formatSize, percent, plural, relativeTime } from '@/lib/format'
import { useSize } from '@/lib/hooks'
import { CATEGORY, nodeGroup } from '@/lib/kinds'
import { layoutTreemap, Treemap, tileColor, type LaidOut, type MapMode } from '@/components/Treemap'
import { BigSize, Button, cx, Kbd, SectionLabel, Segmented, Spinner } from '@/components/ui'

interface Index {
  byId: Map<string, MapNode>
  parent: Map<string, string | null>
}

function indexTree(root: MapNode): Index {
  const byId = new Map<string, MapNode>()
  const parent = new Map<string, string | null>()
  const walk = (n: MapNode, p: string | null): void => {
    byId.set(n.id, n)
    parent.set(n.id, p)
    n.children?.forEach((c) => walk(c, n.id))
  }
  walk(root, null)
  return { byId, parent }
}

export function MapPage() {
  const source = useApp((s) => s.mapSource)
  const snap = useApp((s) => s.maps[s.mapSource])
  const scanning = useApp((s) => s.scanning[s.mapSource])
  const windowActive = useApp((s) => s.windowActive)
  const driveVersion = useApp((s) => s.driveVersion)
  const driveScanAttemptVersion = useApp((s) => s.driveScanAttemptVersion)
  const [mode, setMode] = useState<MapMode>('size')
  const [depth, setDepth] = useState(3)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [marked, setMarked] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [ref, size] = useSize<HTMLDivElement>()
  const filterRef = useRef<HTMLInputElement>(null)
  const surface = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (source === 'drive' && windowActive && !snap && !scanning && driveScanAttemptVersion !== driveVersion) void scanMap('drive')
  }, [source, snap, scanning, windowActive, driveVersion, driveScanAttemptVersion])

  useEffect(() => {
    setFocusId(null)
    setSelectedId(null)
    setMarked(new Set())
  }, [source, snap?.scannedAt])

  const index = useMemo(() => (snap ? indexTree(snap.root) : null), [snap])
  const focus = (focusId && index?.byId.get(focusId)) || snap?.root || null
  const selected = (selectedId && index?.byId.get(selectedId)) || null

  const items = useMemo(() => (focus ? layoutTreemap(focus, size.width, size.height, depth, mode) : []), [focus, size, depth, mode])

  const trail = useMemo(() => {
    if (!focus || !index) return []
    const out: MapNode[] = []
    let id: string | null = focus.id
    while (id) {
      const n = index.byId.get(id)
      if (n) out.unshift(n)
      id = index.parent.get(id) ?? null
    }
    return out
  }, [focus, index])

  const zoomInto = useCallback(
    (n: MapNode) => {
      if (n.isDir && n.children?.length) {
        setFocusId(n.id)
        setSelectedId(null)
      }
    },
    []
  )

  const up = useCallback(() => {
    if (!focus || !index) return
    const p = index.parent.get(focus.id)
    if (p !== undefined && p !== null) {
      setSelectedId(focus.id)
      setFocusId(p)
    }
  }, [focus, index])

  // Keyboard map, mirroring the hint bar at the bottom.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || e.ctrlKey || e.metaKey || e.altKey) return
      const k = e.key
      if (k === '/') {
        e.preventDefault()
        setFilterOpen(true)
        requestAnimationFrame(() => filterRef.current?.focus())
      } else if (k === 'Enter' && selected) zoomInto(selected)
      else if (k === 'Backspace') up()
      else if (k === '[') setDepth((d) => Math.max(1, d - 1))
      else if (k === ']') setDepth((d) => Math.min(6, d + 1))
      else if (k === 't') setMode((m) => (m === 'size' ? 'files' : m === 'files' ? 'age' : 'size'))
      else if (k === '0') {
        setFocusId(null)
        setSelectedId(null)
      } else if (k === 'r') void scanMap(source)
      else if (k === ' ' && selected) {
        e.preventDefault()
        setMarked((m) => {
          const next = new Set(m)
          if (next.has(selected.id)) next.delete(selected.id)
          else next.add(selected.id)
          return next
        })
      } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'h', 'j', 'k', 'l'].includes(k)) {
        e.preventDefault()
        setSelectedId(spatialMove(items, selectedId, k))
      } else if (k === 'Escape') setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items, selected, selectedId, source, up, zoomInto])

  const visibleItems = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return items
    return items.map((t) => (t.group || t.node.name.toLowerCase().includes(q) ? t : { ...t, node: { ...t.node, category: 'system' as const } }))
  }, [items, filter])

  const legend = useMemo(() => {
    if (!focus) return []
    const seen = new Map<string, number>()
    const walk = (n: MapNode, d: number): void => {
      if (d > 2 || !n.children) {
        seen.set(n.category, (seen.get(n.category) ?? 0) + n.size)
        return
      }
      n.children.forEach((c) => walk(c, d + 1))
    }
    walk(focus, 0)
    return [...seen].sort((a, b) => b[1] - a[1]).slice(0, 7)
  }, [focus])

  const hasReclaim = useMemo(() => items.some((t) => t.node.reclaimable), [items])

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Controls */}
        <div className="flex h-14 shrink-0 items-center gap-3 px-5">
          <nav className="flex min-w-0 flex-1 items-center gap-0.5 text-[13.5px]" aria-label="Zoom path">
            {trail.map((n, i) => (
              <span key={n.id} className="flex min-w-0 items-center gap-0.5">
                {i > 0 && <ChevronRight size={14} className="shrink-0 text-fog-500" />}
                <button
                  onClick={() => {
                    setFocusId(i === 0 ? null : n.id)
                    setSelectedId(null)
                  }}
                  className={cx(
                    'truncate rounded-md px-1.5 py-0.5',
                    i === trail.length - 1 ? 'font-semibold text-fog-100' : 'text-fog-400 hover:bg-white/5 hover:text-fog-100'
                  )}
                >
                  {n.name}
                </button>
              </span>
            ))}
          </nav>
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'size', label: 'Size' },
              { value: 'files', label: 'Files' },
              { value: 'age', label: 'Age' }
            ]}
          />
          <div className="flex h-8 items-center rounded-lg border border-white/[0.06] bg-ink-800 pl-3 text-[12.5px] text-fog-300">
            Depth <span className="ml-1.5 w-3 text-fog-100 tnum">{depth}</span>
            <button aria-label="Less depth" onClick={() => setDepth((d) => Math.max(1, d - 1))} className="ml-2 grid h-full w-7 place-items-center text-fog-400 hover:text-fog-100">
              <Minus size={13} />
            </button>
            <button aria-label="More depth" onClick={() => setDepth((d) => Math.min(6, d + 1))} className="grid h-full w-7 place-items-center text-fog-400 hover:text-fog-100">
              <Plus size={13} />
            </button>
          </div>
        </div>

        {/* Summary + legend */}
        <div className="flex h-8 shrink-0 items-center gap-4 px-6 text-[12.5px]">
          {focus && (
            <span className="shrink-0 text-fog-300 tnum">
              <span className="font-semibold text-fog-100">{formatSize(focus.size)}</span> · {plural(focus.files, 'file')} · {formatCount(focus.dirs)} folders
            </span>
          )}
          <AnimatePresence>
            {filterOpen && (
              <motion.label
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 200 }}
                exit={{ opacity: 0, width: 0 }}
                className="relative flex shrink-0 items-center"
              >
                <Search size={13} className="absolute left-2 text-fog-500" />
                <input
                  ref={filterRef}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && (setFilter(''), setFilterOpen(false), surface.current?.focus())}
                  placeholder="Filter by name"
                  aria-label="Filter the map by name"
                  className="h-6 w-full rounded-md border border-white/[0.08] bg-ink-800 pr-6 pl-7 text-[12px] outline-none focus:border-amber/40"
                />
                <button aria-label="Clear filter" onClick={() => (setFilter(''), setFilterOpen(false))} className="absolute right-1.5 text-fog-500 hover:text-fog-100">
                  <X size={12} />
                </button>
              </motion.label>
            )}
          </AnimatePresence>
          <div className="ml-auto flex min-w-0 items-center gap-3.5 overflow-hidden text-fog-400">
            {mode === 'age' ? (
              <span className="flex items-center gap-2">
                Newer
                <span className="h-2 w-28 rounded-full bg-gradient-to-r from-amber via-[#8f8a74] to-[#46506a]" />
                Older
              </span>
            ) : (
              <>
                {hasReclaim && (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="hatch size-2.5 rounded-[2px] bg-fog-500/40" /> Clearable
                  </span>
                )}
                {legend.map(([c]) => (
                  <span key={c} className="flex shrink-0 items-center gap-1.5">
                    <span className="size-2.5 rounded-[2px]" style={{ backgroundColor: CATEGORY[c as keyof typeof CATEGORY].color }} />
                    {CATEGORY[c as keyof typeof CATEGORY].label}
                  </span>
                ))}
              </>
            )}
          </div>
        </div>

        {/* The map */}
        <ContextMenu.Root>
        <ContextMenu.Trigger asChild disabled={!snap || scanning || source !== 'local'}>
        <div
          ref={(el) => {
            ;(ref as React.MutableRefObject<HTMLDivElement | null>).current = el
            surface.current = el
          }}
          tabIndex={0}
          role="tree"
          aria-label="Storage map"
          onClick={() => setSelectedId(null)}
          className="relative mx-4 min-h-0 flex-1 overflow-hidden rounded-lg outline-none focus-visible:ring-1 focus-visible:ring-amber/30"
        >
          {snap && !scanning ? (
            <Treemap
              items={visibleItems}
              mode={mode}
              selectedId={selectedId}
              markedIds={marked}
              onSelect={(t) => setSelectedId(t.node.id)}
              onOpen={(t) => (t.node.isDir ? zoomInto(t.node) : source === 'drive' && !t.node.aggregate && revealFile(t.node.id))}
              onContext={(t) => setSelectedId(t.node.id)}
            />
          ) : scanning ? (
            <ScanState source={source} />
          ) : (
            <StartLocal />
          )}
        </div>
        </ContextMenu.Trigger>
        {source === 'local' && selected && index && (
          <LocalMenu
            node={selected}
            marked={[...marked].map((id) => index.byId.get(id)).filter((n): n is MapNode => Boolean(n))}
            isFocus={selected.id === focus?.id}
            onZoom={() => zoomInto(selected)}
            onUp={up}
            onToggleMark={() =>
              setMarked((m) => {
                const next = new Set(m)
                if (next.has(selected.id)) next.delete(selected.id)
                else next.add(selected.id)
                return next
              })
            }
            onRemoved={(ids) => {
              setMarked((m) => new Set([...m].filter((id) => !ids.includes(id))))
              setSelectedId(null)
              useApp.setState((st) => (st.maps.local ? { maps: { ...st.maps, local: pruneSnapshot(st.maps.local, ids) } } : {}))
            }}
          />
        )}
        </ContextMenu.Root>

        {/* Key hints */}
        <footer className="flex h-12 shrink-0 items-center gap-4 overflow-hidden px-5 text-[12px] text-fog-400">
          <Hint k="space" label="mark" />
          <Hint k="enter" label="open" />
          <Hint k="⌫" label="up" />
          <Hint k="hjkl" label="move" />
          <Hint k="/" label="filter" />
          <Hint k="[ ]" label="depth" className="max-xl:hidden" />
          <Hint k="t" label="mode" className="max-xl:hidden" />
          <Hint k="0" label="reset" className="max-2xl:hidden" />
          <Hint k="r" label="rescan" className="max-2xl:hidden" />
          <span className="ml-auto shrink-0 text-fog-500 tnum">
            {snap && `${formatCount(snap.root.files)} files · ${relativeTime(snap.scannedAt)}`}
          </span>
        </footer>
      </div>

      <MapPanel
        snap={snap}
        source={source}
        node={selected ?? focus}
        isSelection={Boolean(selected)}
        marked={marked}
        index={index}
        onClearMarks={() => setMarked(new Set())}
        onSuggestion={(id) => {
          if (!index) return
          const p = index.parent.get(id)
          if (p === undefined) return
          setFocusId(p ?? null)
          setSelectedId(id)
        }}
      />
    </div>
  )
}

const MENU = 'z-50 min-w-[230px] rounded-xl border border-white/[0.08] bg-ink-750 p-1.5 shadow-2xl shadow-black/50'
const ITEM =
  'flex h-8 cursor-default items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-fog-100 outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-white/[0.07]'

function Item({ icon, children, onSelect, danger, disabled, hint }: { icon: React.ReactNode; children: React.ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean; hint?: string }) {
  return (
    <ContextMenu.Item className={cx(ITEM, danger && 'text-rose')} onSelect={onSelect} disabled={disabled}>
      <span className={danger ? '' : 'text-fog-400'}>{icon}</span>
      <span className="flex-1">{children}</span>
      {hint && <span className="text-[11px] text-fog-500">{hint}</span>}
    </ContextMenu.Item>
  )
}

const Sep = () => <ContextMenu.Separator className="my-1 h-px bg-white/[0.06]" />

/** Everything you can do to a file or folder on this PC, straight from the map. */
function LocalMenu({
  node,
  marked,
  isFocus,
  onZoom,
  onUp,
  onToggleMark,
  onRemoved
}: {
  node: MapNode
  marked: MapNode[]
  isFocus: boolean
  onZoom: () => void
  onUp: () => void
  onToggleMark: () => void
  onRemoved: (ids: string[]) => void
}) {
  const connected = useApp((s) => Boolean(s.status?.connected))
  // Act on every marked item when the right-clicked one is part of the marked set.
  const group = marked.length > 1 && marked.some((m) => m.id === node.id) ? marked : [node]
  const many = group.length > 1
  const real = group.filter((n) => !n.aggregate)
  const paths = real.map((n) => n.id)
  const total = real.reduce((a, n) => a + n.size, 0)
  const isMarked = marked.some((m) => m.id === node.id)

  const backup = async (choose: boolean): Promise<void> => {
    if (!paths.length) return
    let parent: string | null = null
    if (choose) {
      const picked = await pickDriveFolder(many ? `Back up ${paths.length} items to…` : `Back up “${node.name}” to…`, 'Back up')
      if (!picked) return
      parent = picked.id
    }
    await uploadPaths(paths, parent)
  }

  const recycle = async (): Promise<void> => {
    const ok = await confirm({
      title: many ? `Move ${real.length} items to the Recycle Bin?` : `Move “${node.name}” to the Recycle Bin?`,
      body: `That frees ${formatSize(total)} on this PC. You can restore ${many ? 'them' : 'it'} from the Recycle Bin.`,
      confirm: 'Move to Recycle Bin',
      danger: true
    })
    if (!ok) return
    try {
      await api().trashLocal(paths)
      onRemoved(paths)
      toast({ tone: 'success', title: 'Moved to the Recycle Bin', detail: `${formatSize(total)} freed.` }, 2800)
    } catch (error) {
      fail('Couldn’t move that to the Recycle Bin', error)
    }
  }

  if (node.aggregate) {
    return (
      <ContextMenu.Portal>
        <ContextMenu.Content className={MENU}>
          <p className="px-2.5 py-1.5 text-[12px] text-fog-500">Many small items, grouped</p>
          <Sep />
          <Item icon={<FolderUp size={15} />} onSelect={onUp}>
            Zoom out
          </Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    )
  }

  return (
    <ContextMenu.Portal>
      <ContextMenu.Content className={MENU}>
        <p className="truncate px-2.5 pt-1 pb-1.5 text-[12px] text-fog-500">
          {many ? `${real.length} marked items · ${formatSize(total)}` : `${node.name} · ${formatSize(node.size)}`}
        </p>
        {!many && (
          <>
            <Item icon={<ExternalLink size={15} />} onSelect={() => api().openLocal(node.id).catch((e: unknown) => fail('Couldn’t open that', e))}>
              {node.isDir ? 'Open folder' : 'Open'}
            </Item>
            <Item icon={<FolderOpen size={15} />} onSelect={() => api().revealLocal(node.id)}>
              Show in File Explorer
            </Item>
            <Item icon={<Clipboard size={15} />} onSelect={() => api().copyText(node.id).then(() => toast({ tone: 'success', title: 'Path copied' }, 1800))}>
              Copy path
            </Item>
            <Sep />
          </>
        )}
        <Item icon={<CloudUpload size={15} />} onSelect={() => backup(false)} disabled={!connected || node.reclaimable}>
          {many ? `Back up ${real.length} items to My Drive` : 'Back up to My Drive'}
        </Item>
        <Item icon={<ArrowUpFromLine size={15} />} onSelect={() => backup(true)} disabled={!connected || node.reclaimable}>
          Back up to a Drive folder…
        </Item>
        <Sep />
        {!many && (
          <>
            <Item icon={<SquareCheck size={15} />} onSelect={onToggleMark} hint="Space">
              {isMarked ? 'Unmark' : 'Mark'}
            </Item>
            {node.isDir && node.children?.length && !isFocus ? (
              <Item icon={<ZoomIn size={15} />} onSelect={onZoom}>
                Zoom into this folder
              </Item>
            ) : (
              <Item icon={<FolderUp size={15} />} onSelect={onUp} hint="⌫">
                Zoom out
              </Item>
            )}
            <Sep />
          </>
        )}
        <Item icon={<Trash2 size={15} />} danger onSelect={recycle} disabled={isFocus && !many}>
          {many ? `Move ${real.length} to Recycle Bin…` : 'Move to Recycle Bin…'}
        </Item>
      </ContextMenu.Content>
    </ContextMenu.Portal>
  )
}

/** Drop removed items from the scan and shrink their ancestors so the map stays truthful without a rescan. */
function pruneSnapshot(snap: MapSnapshot, ids: string[]): MapSnapshot {
  const gone = new Set(ids)
  const prune = (n: MapNode): MapNode => {
    if (!n.children) return n
    let size = n.size
    let files = n.files
    const children: MapNode[] = []
    for (const c of n.children) {
      if (gone.has(c.id)) {
        size -= c.size
        files -= c.files
        continue
      }
      const next = prune(c)
      size -= c.size - next.size
      files -= c.files - next.files
      children.push(next)
    }
    return { ...n, size: Math.max(0, size), files: Math.max(0, files), children }
  }
  const root = prune(snap.root)
  const freed = snap.root.size - root.size
  return {
    ...snap,
    root,
    suggestions: snap.suggestions.filter((sg) => !gone.has(sg.nodeId)),
    disk: snap.disk ? { ...snap.disk, free: snap.disk.free + freed } : null
  }
}

function spatialMove(items: LaidOut[], currentId: string | null, key: string): string | null {
  if (!items.length) return null
  const cur = items.find((t) => t.node.id === currentId)
  if (!cur) return items.filter((t) => t.depth === 1).sort((a, b) => a.y - b.y || a.x - b.x)[0]?.node.id ?? null
  const dir = { ArrowLeft: [-1, 0], h: [-1, 0], ArrowRight: [1, 0], l: [1, 0], ArrowUp: [0, -1], k: [0, -1], ArrowDown: [0, 1], j: [0, 1] }[key]!
  const cx0 = cur.x + cur.w / 2
  const cy0 = cur.y + cur.h / 2
  let best: LaidOut | null = null
  let bestScore = Infinity
  for (const t of items) {
    if (t === cur || t.depth !== cur.depth) continue
    const dx = t.x + t.w / 2 - cx0
    const dy = t.y + t.h / 2 - cy0
    const along = dx * dir[0] + dy * dir[1]
    if (along <= 0) continue
    const across = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0])
    const score = along + across * 2
    if (score < bestScore) {
      bestScore = score
      best = t
    }
  }
  return best?.node.id ?? cur.node.id
}

function Hint({ k, label, className }: { k: string; label: string; className?: string }) {
  return (
    <span className={cx('flex shrink-0 items-center gap-1.5', className)}>
      <Kbd>{k}</Kbd>
      {label}
    </span>
  )
}

const GHOST: MapNode = {
  id: 'ghost', name: '', size: 0, files: 0, dirs: 0, newest: 0, category: 'other', isDir: true,
  children: [34, 21, 13, 9, 8, 5, 4, 3, 2].map((size, i) => ({
    id: `g${i}`, name: '', size, files: 0, dirs: 0, newest: 0, category: 'other' as const, isDir: false
  }))
}

function ScanState({ source }: { source: 'drive' | 'local' }) {
  const progress = useApp((s) => s.scanProgress)
  const [ref, size] = useSize<HTMLDivElement>()
  const tiles = useMemo(() => layoutTreemap(GHOST, size.width, size.height, 1, 'size'), [size])
  return (
    <div ref={ref} className="absolute inset-0">
      {tiles.map((t, i) => (
        <motion.div
          key={t.node.id}
          className="absolute rounded-[3px] bg-white/[0.04]"
          style={{ left: t.x, top: t.y, width: t.w, height: t.h }}
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ repeat: Infinity, duration: 1.8, delay: i * 0.12 }}
        />
      ))}
      <div className="absolute inset-0 grid place-items-center">
        <div className="rounded-2xl border border-white/[0.07] bg-ink-850/95 px-7 py-5 text-center shadow-2xl shadow-black/40 backdrop-blur">
          <div className="flex items-center justify-center gap-2.5 text-[15px] font-semibold">
            <Spinner /> {source === 'drive' ? 'Mapping your Drive' : 'Scanning this PC'}
          </div>
          {source === 'local' && progress && progress.files > 0 && (
            <>
              <p className="mt-2 text-[22px] font-semibold tnum">
                {formatCount(progress.files)} files · {formatSize(progress.bytes)}
              </p>
              <p className="mt-1 max-w-[420px] truncate font-mono text-[11.5px] text-fog-500">{progress.current}</p>
            </>
          )}
          {source === 'local' && (
            <>
              <p className="mx-auto mt-3 max-w-[340px] text-[12.5px] text-fog-400">
                Keep using Sentry while this runs. Progress shows under This PC in the sidebar, and you’ll get a note when it’s done.
              </p>
              <div className="mt-3 flex justify-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => go('files', null)}>
                  Go to My Drive
                </Button>
                <Button variant="ghost" size="sm" onClick={() => api().cancelScan()}>
                  Stop
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function StartLocal() {
  const root = useApp((s) => s.settings?.scanRoot)
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="max-w-md text-center">
        <HardDrive size={40} strokeWidth={1.4} className="mx-auto text-mint" />
        <p className="mt-4 text-[20px] font-semibold">See what’s eating this PC</p>
        <p className="mt-2 text-[14px] text-fog-400">
          Sentry will read file sizes under <span className="text-fog-100" data-selectable>{root}</span>. Nothing leaves your computer.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="primary" onClick={() => scanMap('local')}>
            Scan now
          </Button>
          <Button variant="ghost" onClick={() => go('settings')}>
            Pick another folder
          </Button>
        </div>
      </div>
    </div>
  )
}

function MapPanel({
  snap,
  source,
  node,
  isSelection,
  marked,
  index,
  onClearMarks,
  onSuggestion
}: {
  snap: MapSnapshot | null
  source: 'drive' | 'local'
  node: MapNode | null
  isSelection: boolean
  marked: Set<string>
  index: Index | null
  onClearMarks: () => void
  onSuggestion: (id: string) => void
}) {
  const total = snap?.root.size ?? 0
  const connected = useApp((s) => Boolean(s.status?.connected))
  const markedNodes = [...marked].map((id) => index?.byId.get(id)).filter(Boolean) as MapNode[]
  const markedSize = markedNodes.reduce((a, n) => a + n.size, 0)
  const maxSuggestion = Math.max(1, ...(snap?.suggestions.map((s) => s.size) ?? [1]))

  return (
    <aside className="flex w-[310px] shrink-0 flex-col overflow-y-auto border-l border-white/[0.05] bg-ink-850 p-5 [&>*]:shrink-0">
      <SectionLabel>{isSelection ? 'Selection' : 'Viewing'}</SectionLabel>
      {node ? (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={node.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }}>
            <p className="flex items-center gap-2.5 text-[20px] font-semibold">
              <span className="h-6 w-1 shrink-0 rounded-full" style={{ backgroundColor: tileColor(node, 'size') }} />
              <span className="truncate" data-selectable>
                {node.name}
              </span>
            </p>
            {source === 'local' && <p className="mt-1 truncate font-mono text-[11px] text-fog-500" data-selectable title={node.id}>{node.id}</p>}
            <BigSize bytes={node.size} className="mt-4 block text-[54px] leading-none" unitClass="text-[0.38em]" />
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/6">
              <motion.div className="h-full rounded-full bg-amber" initial={{ width: 0 }} animate={{ width: `${percent(node.size, total)}%` }} transition={{ type: 'spring', stiffness: 160, damping: 26 }} />
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4">
              <PanelStat label={`Of ${source === 'drive' ? 'Drive' : 'scan'}`} value={`${percent(node.size, total) < 1 ? percent(node.size, total).toFixed(1) : Math.round(percent(node.size, total))}%`} />
              <PanelStat label="Files" value={formatCount(node.files)} />
              <PanelStat label="Last change" value={node.newest ? relativeTime(node.newest) : '—'} />
              <PanelStat label="Kind" value={node.reclaimable ? 'Clearable' : nodeGroup(node).label} />
            </dl>
            {!node.aggregate && node.id !== 'root' && (
              <div className="mt-5 flex flex-wrap gap-2">
                {source === 'drive' ? (
                  <>
                    <Button size="sm" icon={<FolderOpen size={14} />} onClick={() => (node.isDir ? go('files', node.id) : revealFile(node.id))}>
                      Open
                    </Button>
                    <Button size="sm" icon={<ArrowDown size={14} />} onClick={() => pullFiles([node.id])}>
                      Pull
                    </Button>
                    {!node.isDir && (
                      <Button size="sm" icon={<Link2 size={14} />} onClick={async () => quickLink(await api().get(node.id))}>
                        Link
                      </Button>
                    )}
                  </>
                ) : (
                  <>
                    <Button size="sm" icon={<FolderOpen size={14} />} onClick={() => api().revealLocal(node.id)}>
                      Show in folder
                    </Button>
                    {!node.reclaimable && (
                      <Button
                        size="sm"
                        variant={connected ? 'primary' : 'secondary'}
                        icon={<CloudUpload size={14} />}
                        onClick={() => (connected ? uploadPaths([node.id], null) : go('files'))}
                      >
                        {connected ? 'Back up to Drive' : 'Connect Drive to back up'}
                      </Button>
                    )}
                  </>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      ) : (
        <div className="space-y-3">
          <div className="skeleton h-7 w-2/3 rounded-md" />
          <div className="skeleton h-14 w-1/2 rounded-md" />
        </div>
      )}

      <AnimatePresence>
        {markedNodes.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-5 overflow-hidden rounded-xl border border-sky/25 bg-sky/[0.07] p-3"
          >
            <p className="text-[13px]">
              <span className="font-semibold">{markedNodes.length} marked</span> <span className="text-fog-400">· {formatSize(markedSize)}</span>
            </p>
            <div className="mt-2 flex gap-2">
              {source === 'drive' ? (
                <Button size="sm" variant="primary" onClick={() => (pullFiles(markedNodes.filter((n) => !n.aggregate).map((n) => n.id)), onClearMarks())}>
                  Pull all
                </Button>
              ) : (
                <Button size="sm" variant="primary" onClick={() => (uploadPaths(markedNodes.filter((n) => !n.aggregate).map((n) => n.id), null), onClearMarks())}>
                  Back up all
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={onClearMarks}>
                Clear
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-6 border-t border-white/[0.05] pt-5">
        <SectionLabel
          right={
            snap && (
              <span className="text-[12px] font-medium text-amber tnum">{formatSize(snap.suggestions.reduce((a, s) => a + s.size, 0))}</span>
            )
          }
        >
          Worth a look
        </SectionLabel>
        <ul className="-mx-2 flex flex-col">
          {snap?.suggestions.map((s) => (
            <li key={s.id}>
              <button onClick={() => onSuggestion(s.nodeId)} className="group flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left hover:bg-white/[0.04]">
                <span className={cx('mt-0.5 h-8 w-[3px] shrink-0 rounded-full', s.tone === 'reclaim' ? 'bg-amber' : s.tone === 'backup' ? 'bg-mint' : 'bg-sky')} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px]">{s.title}</span>
                    <span className="shrink-0 text-[12.5px] text-fog-300 tnum">{formatSize(s.size)}</span>
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-3">
                    <span className="truncate text-[11.5px] text-fog-500">{s.detail}</span>
                    <span className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-white/6">
                      <span className={cx('block h-full rounded-full', s.tone === 'reclaim' ? 'bg-amber' : s.tone === 'backup' ? 'bg-mint' : 'bg-sky')} style={{ width: `${(s.size / maxSuggestion) * 100}%` }} />
                    </span>
                  </span>
                </span>
              </button>
            </li>
          ))}
          {snap && snap.suggestions.length === 0 && <li className="px-2 text-[12.5px] text-fog-500">Nothing stands out here.</li>}
        </ul>
      </div>

      {snap?.disk && (
        <div className="mt-auto border-t border-white/[0.05] pt-5">
          <SectionLabel right={<span className="truncate text-[11.5px] text-fog-500">{snap.disk.label}</span>}>{source === 'drive' ? 'Plan' : 'Disk'}</SectionLabel>
          <p>
            <BigSize bytes={snap.disk.free} className="text-[34px] leading-none" unitClass="text-[0.45em]" />
            <span className="ml-2 text-[13px] text-fog-400">free</span>
          </p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/6">
            <div className="h-full rounded-full bg-fog-500" style={{ width: `${percent(snap.disk.total - snap.disk.free, snap.disk.total)}%` }} />
          </div>
          <p className="mt-2 flex justify-between text-[12px] text-fog-500 tnum">
            <span>{formatSize(snap.disk.total - snap.disk.free)} used</span>
            <span>{formatSize(snap.disk.total)} total</span>
          </p>
        </div>
      )}

      <Button variant="ghost" size="sm" className="mt-4 self-start -ml-2" icon={<RefreshCw size={13} />} onClick={() => scanMap(source)}>
        Rescan
      </Button>
    </aside>
  )
}

function PanelStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold tracking-[0.08em] text-fog-500 uppercase">{label}</dt>
      <dd className="mt-1 text-[17px] font-medium tnum">{value}</dd>
    </div>
  )
}
