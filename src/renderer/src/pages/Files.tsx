import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  ArrowDown,
  ArrowUpDown,
  ChevronRight,
  CloudUpload,
  Download,
  FolderInput,
  FolderPlus,
  Link2,
  MoreHorizontal,
  Pencil,
  Share2,
  Star,
  Trash2,
  RefreshCw,
  Upload
} from 'lucide-react'
import type { DriveFile, FileKind, MapNode } from '@shared/types'
import { api, fail, go, refreshQuota, pullFiles, quickLink, retryDriveMap, revealFile, scanMap, toast, uploadPaths, useApp } from '@/lib/store'
import { formatSize, plural, relativeTime, shortDate } from '@/lib/format'
import { useLoad, useSize } from '@/lib/hooks'
import { KIND, nodeColor } from '@/lib/kinds'
import { BigSize, Button, cx, FileBadge, IconButton, Kbd, LoadError, SectionLabel, Segmented } from '@/components/ui'
import { DRAG_TYPE, layoutTreemap, Treemap, type LaidOut, type MapMode } from '@/components/Treemap'
import { openShare } from '@/components/ShareDialog'
import { confirm } from '@/components/Confirm'

type SortKey = 'name' | 'size' | 'modified'

export function Files() {
  const folderId = useApp((s) => s.folderId)
  const focusFileId = useApp((s) => s.focusFileId)
  const driveVersion = useApp((s) => s.driveVersion)
  const listing = useLoad(() => api().list(folderId), [folderId, driveVersion])
  const mapScanning = useApp((s) => s.scanning.drive)
  const refreshing = listing.loading || mapScanning

  /** Re-read this folder, re-map Drive, and update plan usage: picks up changes made outside Sentry. */
  const refresh = useCallback(() => {
    listing.reload()
    retryDriveMap()
    void refreshQuota()
  }, [listing])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'F5') {
        e.preventDefault()
        refresh()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [refresh])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 })
  const [renaming, setRenaming] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const driveMap = useApp((s) => s.maps.drive)
  const settings = useApp((s) => s.settings)
  const [mode, setMode] = useState<MapMode>('size')
  const [hoverId, setHoverId] = useState<string | null>(null)
  /** A file picked from deeper in the map than the list shows. */
  const [deep, setDeep] = useState<DriveFile | null>(null)

  useEffect(() => {
    if (!driveMap) void scanMap('drive')
  }, [driveMap])

  // Folder colours and the "biggest in here" panel come from the storage map.
  const mapNodes = useMemo(() => {
    const byId = new Map<string, MapNode>()
    const walk = (n: MapNode): void => {
      byId.set(n.id, n)
      n.children?.forEach(walk)
    }
    if (driveMap) walk(driveMap.root)
    return byId
  }, [driveMap])
  const tintOf = (f: DriveFile): string | undefined => {
    if (f.kind !== 'folder') return undefined
    const n = mapNodes.get(f.id)
    return n && n.size > 0 ? nodeColor(n) : undefined
  }

  // A file id handed over from search, Home, or the map: select it once it's loaded.
  useEffect(() => {
    if (!focusFileId || !listing.data) return
    if (listing.data.items.some((f) => f.id === focusFileId)) {
      setSelected(new Set([focusFileId]))
      setAnchor(focusFileId)
      requestAnimationFrame(() => document.getElementById(`row-${focusFileId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
      useApp.setState({ focusFileId: null })
    } else if (!listing.loading) {
      // Not in this folder (e.g. came from the map): jump to where it lives.
      void revealFile(focusFileId)
    }
  }, [focusFileId, listing.data, listing.loading])

  useEffect(() => {
    setSelected(new Set())
    setAnchor(null)
    setCreating(false)
    setDeep(null)
  }, [folderId])

  const items = useMemo(() => {
    const list = [...(listing.data?.items ?? [])]
    list.sort((a, b) => {
      if ((a.kind === 'folder') !== (b.kind === 'folder')) return a.kind === 'folder' ? -1 : 1
      const d =
        sort.key === 'name'
          ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
          : sort.key === 'size'
            ? a.size - b.size
            : a.modifiedAt.localeCompare(b.modifiedAt)
      return d * sort.dir
    })
    return list
  }, [listing.data, sort])

  const selectedFiles = items.filter((f) => selected.has(f.id))
  const detailFiles = deep ? [deep] : selectedFiles
  const mapNode = mapNodes.get(folderId ?? 'root') ?? null

  const selectOnly = (id: string): void => {
    setDeep(null)
    setSelected(new Set([id]))
    setAnchor(id)
  }
  const dragIds = (id: string): string[] => (selected.has(id) ? [...selected] : [id])

  /** Direct children select like list rows; deeper tiles are fetched and shown on their own. */
  const pickTile = (t: LaidOut, e?: React.MouseEvent): void => {
    if (t.node.aggregate) return
    const row = items.find((f) => f.id === t.node.id)
    if (row) {
      setDeep(null)
      if (e) click(e, row)
      else if (!selected.has(row.id)) selectOnly(row.id)
      document.getElementById(`row-${row.id}`)?.scrollIntoView({ block: 'nearest' })
      return
    }
    setSelected(new Set())
    api()
      .get(t.node.id)
      .then(setDeep)
      .catch(() => setDeep(null))
  }
  const maxSize = Math.max(1, ...items.map((f) => f.size))

  const open = useCallback((f: DriveFile) => {
    if (f.kind === 'folder') go('files', f.id)
    else if (!f.sample) void pullFiles([f.id])
  }, [])

  const trash = useCallback(async (files: DriveFile[]) => {
    if (!files.length) return
    const ok = useApp.getState().settings?.confirmTrash === false || await confirm({
      title: files.length === 1 ? `Move “${files[0].name}” to trash?` : `Move ${files.length} items to trash?`,
      body: 'You can restore it from Google Drive’s trash for 30 days.',
      confirm: 'Move to trash',
      danger: true
    })
    if (!ok) return
    try {
      await api().trash(files.map((f) => f.id))
      setSelected(new Set())
      toast({ tone: 'success', title: files.length === 1 ? 'Moved to trash' : `${files.length} items moved to trash` }, 2600)
    } catch (error) {
      fail('Couldn’t move that to trash', error)
    }
  }, [])

  const click = (e: React.MouseEvent, f: DriveFile): void => {
    setDeep(null)
    if (e.shiftKey && anchor) {
      const a = items.findIndex((x) => x.id === anchor)
      const b = items.findIndex((x) => x.id === f.id)
      const [lo, hi] = a < b ? [a, b] : [b, a]
      setSelected(new Set(items.slice(lo, hi + 1).map((x) => x.id)))
      return
    }
    if (e.ctrlKey || e.metaKey) {
      setSelected((s) => {
        const next = new Set(s)
        if (next.has(f.id)) next.delete(f.id)
        else next.add(f.id)
        return next
      })
    } else setSelected(new Set([f.id]))
    setAnchor(f.id)
  }

  const onKey = (e: React.KeyboardEvent): void => {
    if (renaming || creating || (e.target as HTMLElement).tagName === 'INPUT') return
    const idx = items.findIndex((x) => x.id === anchor)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'j' || e.key === 'k') {
      e.preventDefault()
      const next = items[Math.max(0, Math.min(items.length - 1, idx + (e.key === 'ArrowDown' || e.key === 'j' ? 1 : -1)))]
      if (!next) return
      setSelected(new Set([next.id]))
      setAnchor(next.id)
      document.getElementById(`row-${next.id}`)?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter' && selectedFiles.length === 1) open(selectedFiles[0])
    else if (e.key === 'Backspace') {
      const path = listing.data?.path ?? []
      if (path.length) go('files', path.length > 1 ? path[path.length - 2].id : null)
    } else if (e.key === 'Delete') void trash(selectedFiles)
    else if (e.key === 'F2' && selectedFiles.length === 1) setRenaming(selectedFiles[0].id)
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      setSelected(new Set(items.map((x) => x.id)))
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l' && selectedFiles.length === 1) void quickLink(selectedFiles[0])
    else if (e.key === 'Escape') {
      setSelected(new Set())
      setDeep(null)
    }
  }

  const upload = async (mode: 'files' | 'folder'): Promise<void> => uploadPaths(await api().pickLocal(mode), folderId)

  const toggleSort = (key: SortKey): void => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === 'name' ? 1 : -1 }))

  const path = listing.data?.path ?? []

  const empty = listing.data && items.length === 0 && !creating

  const listColumn = (
    <>
      <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_76px_36px] items-center gap-4 border-b border-white/[0.05] px-7 pb-2 text-[11.5px] font-medium tracking-wide text-fog-500 uppercase xl:grid-cols-[minmax(0,1fr)_150px_120px_44px]">
        <SortHeader label="Name" active={sort.key === 'name'} onClick={() => toggleSort('name')} />
        <SortHeader label="Size" active={sort.key === 'size'} onClick={() => toggleSort('size')} align="right" />
        <span className="max-xl:hidden">
          <SortHeader label="Modified" active={sort.key === 'modified'} onClick={() => toggleSort('modified')} />
        </span>
        <span />
      </div>

      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <div
            ref={listRef}
            tabIndex={0}
            onKeyDown={onKey}
            onClick={() => (setSelected(new Set()), setDeep(null))}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-1.5 outline-none focus-visible:ring-1 focus-visible:ring-amber/30 focus-visible:ring-inset"
            role="listbox"
            aria-multiselectable
            aria-label="Files"
          >
            <AnimatePresence initial={false}>
              {creating && (
                <NameRow
                  key="new"
                  initial="New folder"
                  onDone={async (name) => {
                    setCreating(false)
                    if (!name) return
                    try {
                      const f = await api().createFolder(folderId, name)
                      selectOnly(f.id)
                    } catch (error) {
                      fail('Couldn’t create the folder', error)
                    }
                  }}
                />
              )}
            </AnimatePresence>

            {listing.loading && !listing.data && Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton mx-2 my-1 h-10 shrink-0 rounded-lg" />)}

            {listing.error != null && !listing.data && (
              <div className="mx-4 mt-6 rounded-xl bg-rose/10 p-4 text-[13.5px] text-rose">
                Couldn’t open this folder. <button className="underline" onClick={listing.reload}>Try again</button>
              </div>
            )}

            {items.map((f, i) => (
              <div
                key={f.id}
                id={`row-${f.id}`}
                role="option"
                aria-selected={selected.has(f.id)}
                style={{ animation: `row-in 180ms ${Math.min(i, 14) * 12}ms both` }}
                draggable={renaming !== f.id}
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(dragIds(f.id)))
                  e.dataTransfer.effectAllowed = 'move'
                }}
                data-drop-folder={f.kind === 'folder' ? f.id : undefined}
                data-drop-name={f.kind === 'folder' ? f.name : undefined}
                onMouseEnter={() => setHoverId(f.id)}
                onMouseLeave={() => setHoverId(null)}
                onContextMenu={() => !selected.has(f.id) && selectOnly(f.id)}
                onClick={(e) => {
                  e.stopPropagation()
                  click(e, f)
                }}
                onDoubleClick={() => open(f)}
                className={cx(
                  'group grid h-11 shrink-0 cursor-default grid-cols-[minmax(0,1fr)_76px_36px] items-center gap-4 rounded-lg px-4 xl:grid-cols-[minmax(0,1fr)_150px_120px_44px]',
                  selected.has(f.id) ? 'bg-amber/[0.1] ring-1 ring-amber/25' : hoverId === f.id ? 'bg-white/[0.04]' : 'hover:bg-white/[0.03]'
                )}
              >
                {renaming === f.id ? (
                  <InlineRename
                    file={f}
                    onDone={async (name) => {
                      setRenaming(null)
                      listRef.current?.focus()
                      if (!name || name === f.name) return
                      try {
                        await api().rename(f.id, name)
                      } catch (error) {
                        fail('Couldn’t rename it', error)
                      }
                    }}
                  />
                ) : (
                  <span className="flex min-w-0 items-center gap-3">
                    <FileBadge file={f} size={30} tint={tintOf(f)} />
                    <span className="truncate text-[13.5px]">{f.name}</span>
                    {f.starred && <Star size={13} className="shrink-0 fill-amber text-amber" aria-label="Starred" />}
                    {f.link && <Link2 size={13} className="shrink-0 text-mint" aria-label="Shared by link" />}
                  </span>
                )}
                <span className="flex items-center justify-end gap-3 text-[13px] text-fog-400 tnum">
                  {f.size > 0 && settings?.sizeBars !== false && (
                    <span className="h-1 w-12 shrink-0 overflow-hidden rounded-full bg-white/[0.05] max-xl:hidden">
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${Math.max(3, (f.size / maxSize) * 100)}%`, backgroundColor: tintOf(f) ?? KIND[f.kind].color, opacity: 0.8 }}
                      />
                    </span>
                  )}
                  <span className="w-[64px] text-right">{f.size ? formatSize(f.size) : f.kind === 'folder' ? '—' : 'Google file'}</span>
                </span>
                <span className="text-[13px] text-fog-400 max-xl:hidden">{relativeTime(f.modifiedAt)}</span>
                <span className="flex justify-end">
                  <RowMenu file={f} onRename={() => setRenaming(f.id)} onTrash={() => trash([f])} />
                </span>
              </div>
            ))}
          </div>
        </ContextMenu.Trigger>
        <TargetMenu files={selectedFiles} onRename={(f) => setRenaming(f.id)} onTrash={trash} />
      </ContextMenu.Root>
    </>
  )

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex h-14 shrink-0 items-center gap-3 px-5">
          <nav className="flex min-w-0 flex-1 items-center gap-1 text-[15px]" aria-label="Folder path">
            <Crumb label="My Drive" dropId="root" onClick={() => go('files', null)} current={path.length === 0} />
            {path.map((p, i) => (
              <span key={p.id} className="flex min-w-0 items-center gap-1">
                <ChevronRight size={15} className="shrink-0 text-fog-500" />
                <Crumb label={p.name} dropId={p.id} onClick={() => go('files', p.id)} current={i === path.length - 1} />
              </span>
            ))}
          </nav>
          <Segmented
            value={mode}
            onChange={setMode}
            label="Map shows"
            options={[
              { value: 'size', label: 'Size' },
              { value: 'files', label: 'Files' },
              { value: 'age', label: 'Age' }
            ]}
          />
          <IconButton label="Refresh (F5)" onClick={refresh} disabled={refreshing && !listing.data}>
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : undefined} />
          </IconButton>
          <Button variant="ghost" size="sm" icon={<FolderPlus size={15} />} onClick={() => setCreating(true)} aria-label="New folder">
            <span className="max-xl:hidden">New folder</span>
          </Button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button variant="primary" size="sm" icon={<Upload size={15} />}>
                Upload
              </Button>
            </DropdownMenu.Trigger>
            <MenuContent align="end">
              <MenuItem icon={<Upload size={15} />} onSelect={() => upload('files')}>
                Files…
              </MenuItem>
              <MenuItem icon={<FolderInput size={15} />} onSelect={() => upload('folder')}>
                A whole folder…
              </MenuItem>
            </MenuContent>
          </DropdownMenu.Root>
        </div>

        {empty ? (
          <div className="flex min-h-0 flex-1 flex-col px-2 pb-3">
            <EmptyFolder onUpload={upload} />
          </div>
        ) : (
          <Split
            top={
              <ContextMenu.Root>
                <ContextMenu.Trigger asChild>
                  <div className="h-full">
                    <FolderMap
                      node={mapNode}
                      loading={!driveMap}
                      mode={mode}
                      depth={settings?.mapDepth ?? 2}
                      selectedId={deep?.id ?? (selectedFiles.length === 1 ? selectedFiles[0].id : null)}
                      markedIds={selectedFiles.length > 1 ? selected : undefined}
                      highlightId={hoverId}
                      onSelect={pickTile}
                      onOpen={(t) => (t.node.isDir ? go('files', t.node.id) : !t.node.aggregate && revealFile(t.node.id))}
                      onHover={(t) => setHoverId(t && !t.parentId ? t.node.id : null)}
                      onContext={(t) => pickTile(t)}
                      dragIds={(n) => dragIds(n.id)}
                    />
                  </div>
                </ContextMenu.Trigger>
                <TargetMenu files={detailFiles} onRename={(f) => setRenaming(f.id)} onTrash={trash} />
              </ContextMenu.Root>
            }
            bottom={listColumn}
            bottomNeed={LIST_CHROME + (items.length + (creating ? 1 : 0)) * ROW_H}
          />
        )}
      </div>

      <DetailPanel
        folderId={folderId}
        onUpload={upload}
        files={detailFiles}
        folder={listing.data?.folder ?? null}
        items={items}
        node={mapNodes.get(listing.data?.folder?.id ?? 'root') ?? null}
        onRename={(f) => setRenaming(f.id)}
        onTrash={trash}
      />
    </div>
  )
}

function Crumb({ label, onClick, current, dropId }: { label: string; onClick: () => void; current: boolean; dropId: string }) {
  return (
    <button
      onClick={onClick}
      data-drop-folder={dropId}
      data-drop-name={label}
      aria-current={current ? 'location' : undefined}
      className={cx('truncate rounded-md px-1.5 py-0.5 transition-colors', current ? 'font-semibold text-fog-100' : 'text-fog-400 hover:bg-white/5 hover:text-fog-100')}
    >
      {label}
    </button>
  )
}

function SortHeader({ label, active, onClick, align }: { label: string; active: boolean; onClick: () => void; align?: 'right' }) {
  return (
    <button onClick={onClick} className={cx('flex items-center gap-1 uppercase hover:text-fog-300', active && 'text-fog-300', align === 'right' && 'justify-end')}>
      {label}
      <ArrowUpDown size={11} className={active ? 'opacity-100' : 'opacity-0'} />
    </button>
  )
}

const MENU_CLASS =
  'z-50 min-w-[210px] rounded-xl border border-white/[0.08] bg-ink-750 p-1.5 shadow-2xl shadow-black/50 data-[state=open]:animate-none'

function MenuContent({ children, align = 'start' }: { children: React.ReactNode; align?: 'start' | 'end' }) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content align={align} sideOffset={6} className={MENU_CLASS}>
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  )
}

type ItemProps = { icon: React.ReactNode; children: React.ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean }
const itemClass = (danger?: boolean): string =>
  cx(
    'flex h-8 cursor-default items-center gap-2.5 rounded-lg px-2.5 text-[13px] outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-white/[0.07]',
    danger ? 'text-rose' : 'text-fog-100'
  )

function MenuItem({ icon, children, onSelect, danger, disabled }: ItemProps) {
  return (
    <DropdownMenu.Item className={itemClass(danger)} onSelect={onSelect} disabled={disabled}>
      <span className={danger ? '' : 'text-fog-400'}>{icon}</span>
      {children}
    </DropdownMenu.Item>
  )
}

function CtxItem({ icon, children, onSelect, danger, disabled }: ItemProps) {
  return (
    <ContextMenu.Item className={itemClass(danger)} onSelect={onSelect} disabled={disabled}>
      <span className={danger ? '' : 'text-fog-400'}>{icon}</span>
      {children}
    </ContextMenu.Item>
  )
}

function FileActions({
  file,
  Item,
  Sep,
  onRename,
  onTrash
}: {
  file: DriveFile
  Item: (p: ItemProps) => React.JSX.Element
  Sep: () => React.JSX.Element
  onRename: () => void
  onTrash: () => void
}) {
  return (
    <>
      {file.kind === 'folder' && (
        <Item icon={<ChevronRight size={15} />} onSelect={() => go('files', file.id)}>
          Open
        </Item>
      )}
      <Item icon={<ArrowDown size={15} />} onSelect={() => pullFiles([file.id])} disabled={file.sample}>
        Pull to Downloads
      </Item>
      <Item icon={<Download size={15} />} onSelect={() => pullFiles([file.id], true)} disabled={file.sample}>
        Pull to…
      </Item>
      <Sep />
      <Item icon={<Link2 size={15} />} onSelect={() => quickLink(file)}>
        {file.link ? 'Copy link' : 'Get a link'}
      </Item>
      <Item icon={<Share2 size={15} />} onSelect={() => openShare(file)}>
        Sharing options…
      </Item>
      <Sep />
      <Item icon={<Star size={15} />} onSelect={() => api().toggleStar(file.id).catch((e: unknown) => fail('Couldn’t star it', e))}>
        {file.starred ? 'Unstar' : 'Star'}
      </Item>
      <Item icon={<Pencil size={15} />} onSelect={onRename}>
        Rename
      </Item>
      <Item icon={<Trash2 size={15} />} onSelect={onTrash} danger>
        Move to trash
      </Item>
    </>
  )
}

function RowMenu({ file, onRename, onTrash }: { file: DriveFile; onRename: () => void; onTrash: () => void }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          aria-label={`Actions for ${file.name}`}
          onClick={(e) => e.stopPropagation()}
          className="grid size-8 place-items-center rounded-lg text-fog-500 opacity-0 transition-opacity group-hover:opacity-100 group-aria-selected:opacity-100 hover:bg-white/[0.06] hover:text-fog-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreHorizontal size={16} />
        </button>
      </DropdownMenu.Trigger>
      <MenuContent align="end">
        <FileActions file={file} Item={MenuItem} Sep={() => <DropdownMenu.Separator className="my-1 h-px bg-white/[0.06]" />} onRename={onRename} onTrash={onTrash} />
      </MenuContent>
    </DropdownMenu.Root>
  )
}

function InlineRename({ file, onDone }: { file: DriveFile; onDone: (name: string) => void }) {
  const [value, setValue] = useState(file.name)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    const dot = file.kind === 'folder' ? -1 : file.name.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 ? dot : file.name.length)
  }, [file])
  return (
    <span className="flex min-w-0 items-center gap-3" onClick={(e) => e.stopPropagation()}>
      <FileBadge file={file} size={32} />
      <input
        ref={ref}
        value={value}
        aria-label="New name"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => onDone(value.trim())}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') onDone(value.trim())
          if (e.key === 'Escape') onDone(file.name)
        }}
        className="h-8 min-w-0 flex-1 rounded-md border border-amber/40 bg-ink-800 px-2 text-[13.5px] outline-none"
      />
    </span>
  )
}

function NameRow({ initial, onDone }: { initial: string; onDone: (name: string) => void }) {
  const [value, setValue] = useState(initial)
  const done = useRef(false)
  const finish = (v: string): void => {
    if (done.current) return
    done.current = true
    onDone(v)
  }
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 48 }}
      exit={{ opacity: 0, height: 0 }}
      className="flex items-center gap-3 rounded-lg bg-white/[0.03] px-4"
      onClick={(e) => e.stopPropagation()}
    >
      <FileBadge file={{ kind: 'folder' }} size={32} />
      <input
        autoFocus
        onFocus={(e) => e.target.select()}
        value={value}
        aria-label="Folder name"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => finish(value.trim())}
        onKeyDown={(e) => {
          if (e.key === 'Enter') finish(value.trim())
          if (e.key === 'Escape') finish('')
        }}
        className="h-8 w-80 rounded-md border border-amber/40 bg-ink-800 px-2 text-[13.5px] outline-none"
      />
      <span className="text-[12px] text-fog-500">
        <Kbd>Enter</Kbd> to create
      </span>
    </motion.div>
  )
}

const SPLIT_KEY = 'sentry.drive.split'
const ROW_H = 44
/** Column header + list padding. */
const LIST_CHROME = 48

/**
 * Map above, list below. Until the user drags the divider, the list is only as tall as its rows
 * (between 30% and 62% of the space) and the map takes the rest. Double-click returns to automatic.
 */
function Split({ top, bottom, bottomNeed }: { top: React.ReactNode; bottom: React.ReactNode; bottomNeed: number }) {
  const [manual, setManual] = useState<number | null>(() => {
    const v = Number(localStorage.getItem(SPLIT_KEY))
    return v > 0 ? v : null
  })
  const [box, size] = useSize<HTMLDivElement>()
  const H = Math.max(1, size.height - 16)
  const auto = 1 - Math.min(0.62, Math.max(0.3, bottomNeed / H))
  const ratio = manual ?? auto

  const drag = (e: React.PointerEvent): void => {
    const el = box.current
    if (!el) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const rect = el.getBoundingClientRect()
    let last = ratio
    const move = (ev: PointerEvent): void => {
      last = Math.min(0.8, Math.max(0.2, (ev.clientY - rect.top) / rect.height))
      setManual(last)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      localStorage.setItem(SPLIT_KEY, String(last))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const nudge = (d: number): void => {
    const next = Math.min(0.8, Math.max(0.2, ratio + d))
    setManual(next)
    localStorage.setItem(SPLIT_KEY, String(next))
  }

  return (
    <div ref={box} className="flex min-h-0 flex-1 flex-col">
      <div
        className={cx('min-h-[120px] shrink-0 px-4', manual === null && 'transition-[height] duration-300 ease-[cubic-bezier(.22,1,.36,1)]')}
        style={{ height: `${ratio * 100}%` }}
      >
        {top}
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize map and list. Double-click for automatic."
        title={manual ? 'Double-click to size automatically' : undefined}
        tabIndex={0}
        onPointerDown={drag}
        onDoubleClick={() => (setManual(null), localStorage.removeItem(SPLIT_KEY))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') nudge(-0.04)
          if (e.key === 'ArrowDown') nudge(0.04)
        }}
        className="group flex h-4 shrink-0 cursor-row-resize items-center justify-center outline-none"
      >
        <span className="h-1 w-10 rounded-full bg-white/10 transition-colors group-hover:bg-amber/60 group-focus-visible:bg-amber" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{bottom}</div>
    </div>
  )
}

function FolderMap({
  node,
  loading,
  mode,
  depth,
  selectedId,
  markedIds,
  highlightId,
  onSelect,
  onOpen,
  onHover,
  onContext,
  dragIds
}: {
  node: MapNode | null
  loading: boolean
  mode: MapMode
  depth: number
  selectedId: string | null
  markedIds?: Set<string>
  highlightId: string | null
  onSelect: (t: LaidOut, e: React.MouseEvent) => void
  onOpen: (t: LaidOut) => void
  onHover: (t: LaidOut | null) => void
  onContext: (t: LaidOut) => void
  dragIds: (n: MapNode) => string[]
}) {
  const [ref, size] = useSize<HTMLDivElement>()
  const items = useMemo(() => (node ? layoutTreemap(node, size.width, size.height, depth, mode) : []), [node, size, depth, mode])
  const mapError = useApp((s) => s.driveMapError)
  const mapBusy = useApp((s) => s.scanning.drive)
  return (
    <div ref={ref} role="tree" aria-label="Folder map" className="relative h-full overflow-hidden rounded-lg">
      {loading && mapError ? (
        <div className="absolute inset-0 grid place-items-center rounded-lg border border-dashed border-white/[0.08]">
          <LoadError message="Couldn’t map your Drive, so the map is missing. Your files below still work." onRetry={retryDriveMap} busy={mapBusy} className="max-w-md items-center text-center" />
        </div>
      ) : loading ? (
        <div className="skeleton absolute inset-0 rounded-lg" />
      ) : items.length ? (
        <Treemap
          items={items}
          mode={mode}
          selectedId={selectedId}
          markedIds={markedIds}
          highlightId={highlightId}
          onSelect={onSelect}
          onOpen={onOpen}
          onHover={onHover}
          onContext={onContext}
          dnd={{ dragIds }}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center rounded-lg border border-dashed border-white/[0.07] text-[13px] text-fog-500">
          Nothing in here takes up space yet.
        </div>
      )}
    </div>
  )
}

/** Context menu body for whatever is selected (one file or many). */
function TargetMenu({ files, onRename, onTrash }: { files: DriveFile[]; onRename: (f: DriveFile) => void; onTrash: (f: DriveFile[]) => void }) {
  if (!files.length) return null
  return (
    <ContextMenu.Portal>
      <ContextMenu.Content className={MENU_CLASS}>
        {files.length > 1 ? (
          <>
            <CtxItem icon={<ArrowDown size={15} />} onSelect={() => pullFiles(files.filter((x) => !x.sample).map((x) => x.id))}>
              Pull {files.length} items to this PC
            </CtxItem>
            <ContextMenu.Separator className="my-1 h-px bg-white/[0.06]" />
            <CtxItem icon={<Trash2 size={15} />} danger onSelect={() => onTrash(files)}>
              Move {files.length} to trash
            </CtxItem>
          </>
        ) : (
          <FileActions
            file={files[0]}
            Item={CtxItem}
            Sep={() => <ContextMenu.Separator className="my-1 h-px bg-white/[0.06]" />}
            onRename={() => onRename(files[0])}
            onTrash={() => onTrash(files)}
          />
        )}
      </ContextMenu.Content>
    </ContextMenu.Portal>
  )
}

function EmptyFolder({ onUpload }: { onUpload: (m: 'files' | 'folder') => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="m-3 flex flex-1 flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-white/[0.08] px-6 py-16 text-center"
    >
      <motion.span animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}>
        <CloudUpload size={40} strokeWidth={1.4} className="text-amber" />
      </motion.span>
      <div>
        <p className="text-[17px] font-semibold">This folder’s empty</p>
        <p className="mt-1 text-[13.5px] text-fog-400">Drop files right here, or pick some from your PC.</p>
      </div>
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => onUpload('files')}>
          Choose files
        </Button>
        <Button onClick={() => onUpload('folder')}>Choose a folder</Button>
      </div>
    </motion.div>
  )
}

/* ---------- Right panel ---------- */

function DetailPanel({
  folderId,
  onUpload,
  files,
  folder,
  items,
  node,
  onRename,
  onTrash
}: {
  folderId: string | null
  onUpload: (m: 'files' | 'folder') => void
  files: DriveFile[]
  folder: DriveFile | null
  items: DriveFile[]
  node: MapNode | null
  onRename: (f: DriveFile) => void
  onTrash: (f: DriveFile[]) => void
}) {
  return (
    <aside className="flex w-[270px] shrink-0 flex-col overflow-y-auto border-l border-white/[0.05] bg-ink-850 xl:w-[300px]">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={files.length === 1 ? files[0].id : files.length > 1 ? 'multi' : `folder-${folder?.id ?? 'root'}`}
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -8 }}
          transition={{ duration: 0.14 }}
          className="shrink-0 p-5"
        >
          {files.length === 1 ? (
            <FileDetail file={files[0]} onRename={() => onRename(files[0])} onTrash={() => onTrash(files)} />
          ) : files.length > 1 ? (
            <MultiDetail files={files} onTrash={() => onTrash(files)} />
          ) : (
            <FolderSummary folder={folder} items={items} node={node} />
          )}
        </motion.div>
      </AnimatePresence>
      <PanelDrop folderId={folderId} name={folder?.name ?? 'My Drive'} onUpload={onUpload} />
    </aside>
  )
}

/** Fills whatever the panel doesn't use. Drop here (or click) to add to the open folder. */
function PanelDrop({ folderId, name, onUpload }: { folderId: string | null; name: string; onUpload: (m: 'files' | 'folder') => void }) {
  return (
    <button
      onClick={() => onUpload('files')}
      data-drop-folder={folderId ?? 'root'}
      data-drop-name={name}
      className="group mx-5 mb-5 flex min-h-[132px] flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/[0.09] px-4 text-center transition-colors hover:border-amber/40 hover:bg-amber/[0.03]"
    >
      <CloudUpload size={22} strokeWidth={1.6} className="text-amber/80 transition-transform group-hover:-translate-y-0.5" />
      <span className="text-[13px] text-fog-300">
        Drop files to add to <span className="font-medium text-fog-100">{name}</span>
      </span>
      <span className="text-[12px] text-fog-500">or click to choose</span>
    </button>
  )
}

function FileDetail({ file, onRename, onTrash }: { file: DriveFile; onRename: () => void; onTrash: () => void }) {
  const { label } = KIND[file.kind]
  return (
    <>
      <SectionLabel>Selection</SectionLabel>
      <div className="flex items-start gap-3">
        <FileBadge file={file} size={48} />
        <div className="min-w-0">
          <p className="text-[16px] leading-snug font-semibold break-words" data-selectable>
            {file.name}
          </p>
          <p className="mt-0.5 text-[12.5px] text-fog-400">{label}</p>
        </div>
      </div>

      {file.size > 0 && <BigSize bytes={file.size} className="mt-5 block text-[40px] leading-none" />}

      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-[12.5px]">
        <Meta label="Modified" value={relativeTime(file.modifiedAt)} />
        <Meta label="Created" value={shortDate(file.createdAt)} />
        <Meta label="Sharing" value={file.link ? 'Link on' : 'Private'} tone={file.link ? 'text-mint' : undefined} />
        <Meta label="Starred" value={file.starred ? 'Yes' : 'No'} />
      </dl>

      <div className="mt-6 flex flex-col gap-2">
        {file.kind === 'folder' ? (
          <Button variant="primary" onClick={() => go('files', file.id)} icon={<ChevronRight size={15} />}>
            Open folder
          </Button>
        ) : null}
        <Button
          variant={file.kind === 'folder' ? 'secondary' : 'primary'}
          icon={<ArrowDown size={15} />}
          onClick={() => pullFiles([file.id])}
          disabled={file.sample}
          title={file.sample ? 'Sample files have no content to download' : undefined}
        >
          {file.sample ? 'Sample file (no content)' : 'Pull to this PC'}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button icon={<Link2 size={15} />} onClick={() => quickLink(file)}>
            {file.link ? 'Copy link' : 'Get link'}
          </Button>
          <Button icon={<Share2 size={15} />} onClick={() => openShare(file)}>
            Share
          </Button>
        </div>
      </div>

      <div className="mt-4 flex gap-1 border-t border-white/[0.05] pt-3">
        <IconButton label={file.starred ? 'Unstar' : 'Star'} onClick={() => api().toggleStar(file.id).catch((e: unknown) => fail('Couldn’t star it', e))}>
          <Star size={16} className={file.starred ? 'fill-amber text-amber' : ''} />
        </IconButton>
        <IconButton label="Rename (F2)" onClick={onRename}>
          <Pencil size={16} />
        </IconButton>
        <IconButton label="Pull to…" onClick={() => pullFiles([file.id], true)} disabled={file.sample}>
          <Download size={16} />
        </IconButton>
        <IconButton label="Move to trash (Del)" onClick={onTrash} className="ml-auto hover:text-rose">
          <Trash2 size={16} />
        </IconButton>
      </div>
    </>
  )
}

function MultiDetail({ files, onTrash }: { files: DriveFile[]; onTrash: () => void }) {
  const total = files.reduce((a, f) => a + f.size, 0)
  const pullable = files.filter((f) => !f.sample)
  return (
    <>
      <SectionLabel>Selection</SectionLabel>
      <div className="relative h-16">
        {files.slice(0, 5).map((f, i) => (
          <motion.span key={f.id} className="absolute" initial={{ x: 0 }} animate={{ x: i * 26 }} style={{ zIndex: 10 - i }}>
            <span className="block rounded-[11px] ring-4 ring-ink-850">
              <FileBadge file={f} size={44} />
            </span>
          </motion.span>
        ))}
      </div>
      <p className="text-[16px] font-semibold">{plural(files.length, 'item')} selected</p>
      <BigSize bytes={total} className="mt-3 block text-[40px] leading-none" />
      <div className="mt-6 flex flex-col gap-2">
        <Button variant="primary" icon={<ArrowDown size={15} />} onClick={() => pullFiles(pullable.map((f) => f.id))} disabled={!pullable.length}>
          Pull {pullable.length === files.length ? 'all' : pullable.length} to this PC
        </Button>
        <Button variant="danger" icon={<Trash2 size={15} />} onClick={onTrash}>
          Move to trash
        </Button>
      </div>
      <p className="mt-4 text-[12px] text-fog-500">
        <Kbd>Shift</Kbd> or <Kbd>Ctrl</Kbd> + click to change the selection.
      </p>
    </>
  )
}

function FolderSummary({ folder, items, node }: { folder: DriveFile | null; items: DriveFile[]; node: MapNode | null }) {
  const byKind = new Map<FileKind, { n: number; size: number }>()
  for (const f of items) {
    const e = byKind.get(f.kind) ?? { n: 0, size: 0 }
    e.n++
    e.size += f.size
    byKind.set(f.kind, e)
  }
  const total = node?.size ?? items.reduce((a, f) => a + f.size, 0)
  const kinds = [...byKind].sort((a, b) => b[1].size - a[1].size || b[1].n - a[1].n)
  return (
    <>
      <SectionLabel>This folder</SectionLabel>
      <p className="text-[18px] font-semibold">{folder?.name ?? 'My Drive'}</p>
      <BigSize bytes={total} className="mt-4 block text-[44px] leading-none" />
      <p className="mt-2 text-[12.5px] text-fog-400">in {plural(items.length, 'item')}</p>

      {node?.children?.length ? (
        <>
          <div className="mt-5 flex h-2 gap-[2px] overflow-hidden rounded-full">
            {node.children.slice(0, 8).map((c) => (
              <motion.span key={c.id} initial={{ flexGrow: 0 }} animate={{ flexGrow: c.size }} style={{ backgroundColor: nodeColor(c) }} />
            ))}
          </div>
          <p className="mt-6 mb-2.5 text-[11.5px] font-semibold tracking-[0.08em] text-fog-500 uppercase">Biggest in here</p>
          <ul className="-mx-2 flex flex-col">
            {node.children.slice(0, 7).map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => (c.isDir ? go('files', c.id) : revealFile(c.id))}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-white/[0.04]"
                >
                  <span className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: nodeColor(c) }} />
                  <span className="min-w-0 flex-1 truncate text-fog-300">{c.name}</span>
                  <span className="text-fog-400 tnum">{formatSize(c.size)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          {total > 0 && (
            <div className="mt-5 flex h-2 gap-[2px] overflow-hidden rounded-full">
              {kinds.map(([k, v]) =>
                v.size > 0 ? <motion.span key={k} initial={{ flexGrow: 0 }} animate={{ flexGrow: v.size }} style={{ backgroundColor: KIND[k].color }} /> : null
              )}
            </div>
          )}
          <ul className="mt-4 flex flex-col gap-2.5">
            {kinds.map(([k, v]) => (
              <li key={k} className="flex items-center gap-2.5 text-[13px]">
                <span className="size-2.5 rounded-[3px]" style={{ backgroundColor: KIND[k].color }} />
                <span className="flex-1 text-fog-300">
                  {KIND[k].label} <span className="text-fog-500">· {v.n}</span>
                </span>
                <span className="text-fog-400 tnum">{v.size ? formatSize(v.size) : '—'}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

function Meta({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="text-fog-500">{label}</dt>
      <dd className={cx('mt-0.5 text-[13.5px] text-fog-100', tone)}>{value}</dd>
    </div>
  )
}
