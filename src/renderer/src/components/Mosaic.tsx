import { useMemo } from 'react'
import { motion } from 'motion/react'
import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy'
import type { MapCategory } from '@shared/types'
import { CATEGORY } from '@/lib/kinds'

/** Decorative-but-honest storage mosaic used in onboarding. Labels describe the idea, not user data. */
interface Tile {
  name: string
  size: number
  category: MapCategory
  hatch?: boolean
  children?: Tile[]
}

const SAMPLE: Tile = {
  name: 'root',
  size: 0,
  category: 'other',
  children: [
    { name: 'Photos', size: 0, category: 'media', children: [
      { name: '2025', size: 34, category: 'media' }, { name: '2024', size: 22, category: 'media' },
      { name: '2023', size: 14, category: 'media' }, { name: '2022', size: 9, category: 'media' }, { name: '', size: 6, category: 'media' }
    ] },
    { name: 'Projects', size: 0, category: 'code', children: [
      { name: 'builds', size: 18, category: 'code', hatch: true }, { name: 'src', size: 16, category: 'code' },
      { name: 'assets', size: 10, category: 'code' }, { name: '', size: 4, category: 'code' }
    ] },
    { name: 'Documents', size: 0, category: 'documents', children: [
      { name: 'School', size: 12, category: 'documents' }, { name: 'Taxes', size: 8, category: 'documents' },
      { name: 'Career', size: 5, category: 'documents' }, { name: '', size: 3, category: 'documents' }
    ] },
    { name: 'Backups', size: 0, category: 'archives', children: [
      { name: 'PC backup.zip', size: 30, category: 'archives' }, { name: 'Old laptop.zip', size: 14, category: 'archives', hatch: true }
    ] },
    { name: 'Cache', size: 0, category: 'cache', children: [{ name: 'temp', size: 12, category: 'cache', hatch: true }, { name: '', size: 6, category: 'cache', hatch: true }] },
    { name: 'Games', size: 0, category: 'games', children: [{ name: 'steamapps', size: 26, category: 'games' }] },
    { name: 'Music', size: 0, category: 'apps', children: [{ name: 'flac', size: 9, category: 'apps' }, { name: '', size: 4, category: 'apps' }] }
  ]
}

export function Mosaic({ emphasis, width, height }: { emphasis: MapCategory[] | 'all'; width: number; height: number }) {
  const leaves = useMemo(() => {
    const root = hierarchy(SAMPLE)
      .sum((d) => (d.children ? 0 : d.size))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    treemap<Tile>().tile(treemapSquarify.ratio(1.3)).size([width, height]).paddingInner(4).paddingOuter(0).paddingTop((d) => (d.depth === 1 ? 22 : 0))(root)
    return root.descendants().filter((d) => d.depth > 0) as Array<ReturnType<typeof root.descendants>[number] & { x0: number; x1: number; y0: number; y1: number }>
  }, [width, height])

  return (
    <div className="relative" style={{ width, height }}>
      {leaves.map((n, i) => {
        const cat = CATEGORY[n.data.category]
        const on = emphasis === 'all' || emphasis.includes(n.data.category)
        const w = n.x1 - n.x0
        const h = n.y1 - n.y0
        const group = n.depth === 1
        return (
          <motion.div
            key={`${n.depth}-${n.data.name}-${i}`}
            className="absolute overflow-hidden rounded-[4px]"
            style={{ left: n.x0, top: n.y0, width: w, height: h }}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: on ? 1 : 0.28, scale: 1 }}
            transition={{ opacity: { duration: 0.45 }, scale: { delay: 0.1 + i * 0.022, type: 'spring', stiffness: 260, damping: 24 } }}
          >
            <div
              className={n.data.hatch ? 'hatch h-full w-full' : 'h-full w-full'}
              style={{
                backgroundColor: group ? `color-mix(in oklab, ${cat.color} 22%, #0e1018)` : `color-mix(in oklab, ${cat.color} 58%, #0e1018)`,
                borderTop: group ? `2px solid ${cat.color}` : undefined
              }}
            >
              {group && w > 70 && (
                <span className="block truncate px-2 pt-1 text-[12px] font-medium text-fog-100/90">{n.data.name}</span>
              )}
              {!group && n.data.name && w > 64 && h > 30 && (
                <span className="block truncate px-2 pt-1.5 text-[11.5px] text-white/75">{n.data.name}</span>
              )}
            </div>
          </motion.div>
        )
      })}
    </div>
  )
}
