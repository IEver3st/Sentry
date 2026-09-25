import { memo, useMemo } from 'react'
import { hierarchy, treemap, treemapSquarify, type HierarchyRectangularNode } from 'd3-hierarchy'
import type { MapNode } from '@shared/types'
import { nodeColor } from '@/lib/kinds'
import { formatSize, formatCount } from '@/lib/format'
import { cx } from './ui'

export type MapMode = 'size' | 'files' | 'age'

export interface LaidOut {
  node: MapNode
  x: number
  y: number
  w: number
  h: number
  depth: number
  parentId: string | null
  /** Drawn as a container with a header strip. */
  group: boolean
}

const HEADER = 21
const DAY = 86_400_000
export const DRAG_TYPE = 'application/x-sentry-ids'

function prune(node: MapNode, depth: number): MapNode {
  if (depth === 0 || !node.children) return { ...node, children: undefined }
  return { ...node, children: node.children.map((c) => prune(c, depth - 1)) }
}

function metric(n: MapNode, mode: MapMode): number {
  return mode === 'files' ? Math.max(n.files, n.isDir ? 0 : 1) : n.size
}

export function layoutTreemap(root: MapNode, width: number, height: number, depth: number, mode: MapMode): LaidOut[] {
  if (width <= 0 || height <= 0) return []
  const h = hierarchy(prune(root, depth))
    .sum((d) => (d.children?.length ? 0 : metric(d, mode)))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
  treemap<MapNode>()
    .tile(treemapSquarify.ratio(1.25))
    .size([width, height])
    .paddingInner(3)
    .paddingOuter((d) => (d.depth === 0 ? 0 : 3))
    .paddingTop((d) => (d.depth === 0 ? 0 : HEADER))
    .round(true)(h)

  const out: LaidOut[] = []
  const visit = (d: HierarchyRectangularNode<MapNode>): void => {
    const w = d.x1 - d.x0
    const ht = d.y1 - d.y0
    if (d.depth > 0) {
      if (w < 2 || ht < 2) return
      out.push({
        node: d.data,
        x: d.x0,
        y: d.y0,
        w,
        h: ht,
        depth: d.depth,
        parentId: d.parent && d.parent.depth > 0 ? d.parent.data.id : null,
        group: Boolean(d.children?.length) && w > 36 && ht > HEADER + 10
      })
    }
    // Children of containers too small to hold a header aren't drawn separately.
    if (d.depth === 0 || (w > 36 && ht > HEADER + 10)) d.children?.forEach(visit)
  }
  visit(h as HierarchyRectangularNode<MapNode>)
  return out
}

function ageTint(newest: number): string {
  const days = (Date.now() - newest) / DAY
  if (days < 7) return 'var(--color-amber)'
  if (days < 30) return '#d9a05a'
  if (days < 180) return '#8f8a74'
  if (days < 365) return '#5f6f8c'
  return '#46506a'
}

export function tileColor(n: MapNode, mode: MapMode): string {
  return mode === 'age' ? ageTint(n.newest) : nodeColor(n)
}

/** Small, stable per-tile tone shift (-5..+5) so same-coloured neighbours read as separate objects. */
function toneShift(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return (Math.abs(h) % 11) - 5
}

/** Stable hue drift (-14..+14 deg) so a big family of one kind spreads into related tones. */
function hueShift(id: string): number {
  let h = 7
  for (let i = id.length - 1; i >= 0; i--) h = (h * 33 + id.charCodeAt(i)) | 0
  return (Math.abs(h) % 29) - 14
}

/** 1 for changed this week, falling off on a log scale to a sliver after two years. */
function freshness(newest: number): number {
  const days = Math.max(0, (Date.now() - newest) / DAY)
  return Math.min(1, Math.max(0.04, 1 - Math.log10(1 + days) / Math.log10(1 + 730)))
}

/** Sentry's tile finish: lit from above, darker at the foot, fine ruling on big tiles. */
function leafTexture(area: number): string {
  const light = 'linear-gradient(180deg, rgb(255 255 255 / 0.075), transparent 42%, rgb(0 0 0 / 0.16))'
  return area > 14000 ? `${light}, repeating-linear-gradient(180deg, rgb(255 255 255 / 0.03) 0 1px, transparent 1px 6px)` : light
}

interface Props {
  items: LaidOut[]
  mode: MapMode
  selectedId?: string | null
  /** Softer ring, e.g. the row being hovered in a linked list. */
  highlightId?: string | null
  markedIds?: Set<string>
  compact?: boolean
  onSelect?: (n: LaidOut, e: React.MouseEvent) => void
  onOpen?: (n: LaidOut) => void
  onHover?: (n: LaidOut | null) => void
  onContext?: (n: LaidOut) => void
  /** Enables Drive drag-and-drop: folders accept drops, items can be dragged. */
  dnd?: { dragIds: (n: MapNode) => string[] }
}

export const Treemap = memo(function Treemap({ items, mode, selectedId, highlightId, markedIds, compact, onSelect, onOpen, onHover, onContext, dnd }: Props) {
  const sorted = useMemo(() => [...items].sort((a, b) => a.depth - b.depth), [items])
  return (
    <>
      {sorted.map((t) => {
        const color = tileColor(t.node, mode)
        const selected = t.node.id === selectedId
        const marked = markedIds?.has(t.node.id)
        const showLabel = !t.group && t.w > 46 && t.h > (compact ? 22 : 30)
        const metricLabel = mode === 'files' ? `${formatCount(t.node.files)} files` : formatSize(t.node.size)
        const real = !t.node.aggregate && t.node.id !== 'root'
        return (
          <div
            key={t.node.id}
            role="treeitem"
            aria-label={`${t.node.name}, ${formatSize(t.node.size)}`}
            aria-selected={selected}
            data-drop-folder={dnd && real && t.node.isDir ? t.node.id : undefined}
            data-drop-name={dnd && real && t.node.isDir ? t.node.name : undefined}
            draggable={Boolean(dnd && real)}
            onDragStart={(e) => {
              if (!dnd) return
              e.stopPropagation()
              const ids = dnd.dragIds(t.node)
              e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids))
              e.dataTransfer.effectAllowed = 'move'
            }}
            onClick={(e) => {
              e.stopPropagation()
              onSelect?.(t, e)
            }}
            onDoubleClick={(e) => {
              e.stopPropagation()
              onOpen?.(t)
            }}
            onContextMenu={() => onContext?.(t)}
            onMouseEnter={() => onHover?.(t)}
            onMouseLeave={() => onHover?.(null)}
            className={cx(
              'group/tile absolute overflow-hidden rounded-[3px] transition-[left,top,width,height,filter] duration-300 ease-[cubic-bezier(.22,1,.36,1)]',
              onSelect && 'cursor-pointer',
              !t.group && 'hover:brightness-125'
            )}
            style={{
              left: t.x,
              top: t.y,
              width: t.w,
              height: t.h,
              backgroundColor: t.group
                ? `color-mix(in oklab, ${color} 15%, var(--color-ink-900))`
                : `color-mix(in oklab, oklch(from ${color} l c calc(h + ${mode === 'age' ? 0 : hueShift(t.node.id)})) ${t.node.aggregate ? 24 : 42 + toneShift(t.node.id)}%, var(--color-ink-900))`,
              backgroundImage: t.group ? 'linear-gradient(180deg, rgb(0 0 0 / 0.1), transparent 90px)' : t.node.aggregate ? undefined : leafTexture(t.w * t.h),
              boxShadow: marked
                ? 'inset 0 0 0 2px var(--color-sky)'
                : t.group
                  ? `inset 0 2px 0 0 color-mix(in oklab, ${color} 85%, transparent)`
                  : 'inset 0 1px 0 0 rgb(255 255 255 / 0.07)'
            }}
          >
            {t.node.reclaimable && <div className="hatch pointer-events-none absolute inset-0" />}
            {t.group && (
              <div
                className="pointer-events-none relative flex h-[21px] items-center justify-between gap-2 px-2 text-[12px] leading-none"
                style={{ backgroundColor: `color-mix(in oklab, ${color} 24%, var(--color-ink-900))` }}
              >
                <span className="truncate font-medium text-fog-100/95">{t.node.name}</span>
                {t.w > 110 && <span className="shrink-0 text-fog-400/80 tnum">{metricLabel}</span>}
              </div>
            )}
            {!t.group && !t.node.aggregate && mode !== 'age' && t.w > 28 && t.h > 22 && (
              <span
                aria-hidden
                className="pointer-events-none absolute bottom-0 left-0 h-[2px] rounded-r-full"
                style={{ width: `${freshness(t.node.newest) * 100}%`, backgroundColor: `color-mix(in oklab, ${color} 70%, white)`, opacity: 0.75 }}
              />
            )}
            {showLabel && (
              <div className="pointer-events-none relative px-2 pt-1.5 leading-tight">
                <div className={cx('truncate text-white/85', compact ? 'text-[11px]' : 'text-[12px]')}>{t.node.name}</div>
                {t.h > 44 && <div className="truncate text-[11px] text-white/45 tnum">{metricLabel}</div>}
              </div>
            )}
          </div>
        )
      })}
      <Ring target={highlightId && highlightId !== selectedId ? (sorted.find((t) => t.node.id === highlightId) ?? null) : null} soft />
      <Ring target={sorted.find((t) => t.node.id === selectedId) ?? null} />
    </>
  )
})

/** Drawn above everything so a selected folder never hides its contents; glides between tiles. */
function Ring({ target, soft }: { target: LaidOut | null; soft?: boolean }) {
  if (!target) return null
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-10 rounded-[4px] transition-[left,top,width,height] duration-200 ease-[cubic-bezier(.22,1,.36,1)]"
      style={{
        left: target.x - 1,
        top: target.y - 1,
        width: target.w + 2,
        height: target.h + 2,
        boxShadow: soft
          ? 'inset 0 0 0 1.5px color-mix(in oklab, var(--color-fog-100) 55%, transparent)'
          : 'inset 0 0 0 2px var(--color-amber), 0 0 0 1px var(--color-ink-900), 0 0 24px color-mix(in oklab, var(--color-amber) 20%, transparent)'
      }}
    />
  )
}
