import { Worker } from 'node:worker_threads'
import { statfs } from 'node:fs/promises'
import { parse } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DriveFile, DriveQuota, MapNode, MapSnapshot, ScanProgress, Suggestion } from '@shared/types'
import { categoryFromKind } from '@shared/kinds'
import { normalizeRoots } from './local-roots'

const DAY = 86_400_000
const GiB = 1024 ** 3

let activeWorker: Worker | null = null
let cancelActiveScan: (() => void) | null = null
let progressEnabled = true
let scanGeneration = 0

export function cancelLocalScan(): void {
  scanGeneration++
  cancelActiveScan?.()
}

export function setScanProgressEnabled(enabled: boolean): void {
  progressEnabled = enabled
  activeWorker?.postMessage({ type: 'progress-enabled', enabled })
}

export async function scanLocal(input: string | string[], onProgress: (p: ScanProgress) => void): Promise<MapSnapshot> {
  const roots = normalizeRoots(input)
  cancelLocalScan()
  const generation = scanGeneration
  const started = Date.now()
  let scanErrors: MapSnapshot['scanErrors'] = []
  const tree = await new Promise<MapNode>((resolve, reject) => {
    const worker = new Worker(fileURLToPath(new URL('./scan-worker.js', import.meta.url)), { workerData: { roots, progressEnabled } })
    activeWorker = worker
    let settled = false
    const finish = (error: Error | null, tree?: MapNode): void => {
      if (settled) return
      settled = true
      if (activeWorker === worker) {
        activeWorker = null
        cancelActiveScan = null
      }
      // A completed/cancelled scan must release its thread and retained directory tree.
      void worker.terminate().then(() => {
        if (error) reject(error)
        else resolve(tree!)
      }, reject)
    }
    cancelActiveScan = () => finish(new Error('Scan cancelled.'))
    worker.on('message', (msg: { type: string } & Record<string, unknown>) => {
      if (settled) return
      if (msg.type === 'progress' && progressEnabled) onProgress(msg as unknown as ScanProgress)
      else if (msg.type === 'done') {
        scanErrors = msg.scanErrors as MapSnapshot['scanErrors'] ?? []
        finish(null, msg.root as MapNode)
      }
      else if (msg.type === 'cancelled') finish(new Error('Scan cancelled.'))
      else if (msg.type === 'error') finish(new Error(String(msg.message)))
    })
    worker.on('error', (error) => finish(error))
    worker.on('exit', (code) => {
      if (!settled) finish(new Error(`The scan stopped before returning a result (exit ${code}). Try scanning again.`))
    })
  })

  const disks: NonNullable<MapSnapshot['disks']> = []
  const volumes = new Map(roots.filter((root) => !scanErrors?.some((e) => e.root === root)).map((root) => {
    const volume = parse(root).root
    return [process.platform === 'win32' ? volume.toLowerCase() : volume, volume]
  })).values()
  for (const root of volumes) {
    try {
      const fs = await statfs(root)
      disks.push({ root, label: root.replace(/\\$/, '') || root, free: fs.bavail * fs.bsize, total: fs.blocks * fs.bsize })
    } catch { /* unavailable disk figures must not invalidate a completed scan */ }
  }
  const disk = disks.length ? { label: disks.length === 1 ? disks[0].label : `${disks.length} drives`, free: disks.reduce((sum, d) => sum + d.free, 0), total: disks.reduce((sum, d) => sum + d.total, 0) } : null
  if (generation !== scanGeneration) throw new Error('Scan cancelled.')

  return {
    source: 'local',
    root: tree,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    suggestions: localSuggestions(tree),
    disk,
    disks,
    scanErrors
  }
}

function localSuggestions(root: MapNode): Suggestion[] {
  const reclaim: MapNode[] = []
  const backup: MapNode[] = []
  const walk = (node: MapNode, depth: number): void => {
    if (node.aggregate) return
    if (node.reclaimable && node.isDir) {
      reclaim.push(node)
      return // don't double count nested caches
    }
    if (node.isDir && depth >= 1 && depth <= 2 && (node.category === 'media' || node.category === 'documents') && node.size > 2 * GiB) {
      backup.push(node)
    }
    node.children?.forEach((c) => walk(c, depth + 1))
  }
  walk(root, root.virtual ? -1 : 0)

  const out: Suggestion[] = []
  // Group node_modules and friends so 400 tiny folders become one line.
  const grouped = new Map<string, { size: number; count: number; biggest: MapNode }>()
  for (const n of reclaim) {
    const key = n.name.toLowerCase()
    const g = grouped.get(key)
    if (g) {
      g.size += n.size
      g.count++
      if (n.size > g.biggest.size) g.biggest = n
    } else grouped.set(key, { size: n.size, count: 1, biggest: n })
  }
  for (const [name, g] of [...grouped].sort((a, b) => b[1].size - a[1].size).slice(0, 4)) {
    if (g.size < 256 * 1024 * 1024) continue
    out.push({
      id: `reclaim:${name}`,
      title: g.count > 1 ? `${g.count} × ${g.biggest.name}` : shortPath(g.biggest.id),
      detail: g.count > 1 ? 'regenerable, safe to clear' : 'cache or build output',
      size: g.size,
      nodeId: g.biggest.id,
      tone: 'reclaim'
    })
  }
  for (const n of backup.sort((a, b) => b.size - a.size).slice(0, 3)) {
    out.push({ id: `backup:${n.id}`, title: shortPath(n.id), detail: 'only on this PC, back it up', size: n.size, nodeId: n.id, tone: 'backup' })
  }
  return out.sort((a, b) => b.size - a.size).slice(0, 6)
}

function shortPath(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts.slice(-2).join('/')
}

/** Builds the Drive storage map from a flat listing. */
export function driveMap(files: DriveFile[], quota: DriveQuota, started: number): MapSnapshot {
  const nodes = new Map<string, MapNode>()
  const root: MapNode = { id: 'root', name: 'My Drive', size: 0, files: 0, dirs: 0, newest: 0, category: 'other', isDir: true, children: [] }
  for (const f of files) {
    const t = Date.parse(f.modifiedAt)
    nodes.set(f.id, {
      id: f.id,
      name: f.name,
      size: f.kind === 'folder' ? 0 : f.size,
      files: f.kind === 'folder' ? 0 : 1,
      dirs: 0,
      newest: t,
      category: f.kind === 'folder' ? 'other' : categoryFromKind(f.kind),
      kind: f.kind === 'folder' ? undefined : f.kind,
      isDir: f.kind === 'folder',
      children: f.kind === 'folder' ? [] : undefined
    })
  }
  for (const f of files) {
    const parent = (f.parentId && nodes.get(f.parentId)) || root
    parent.children!.push(nodes.get(f.id)!)
  }
  const roll = (n: MapNode): void => {
    if (!n.children) return
    const byCat = new Map<string, number>()
    const byKind = new Map<string, number>()
    for (const c of n.children) {
      roll(c)
      if (c.kind) byKind.set(c.kind, (byKind.get(c.kind) ?? 0) + c.size)
      n.size += c.size
      n.files += c.files
      n.dirs += c.dirs + (c.isDir ? 1 : 0)
      n.newest = Math.max(n.newest, c.newest)
      byCat.set(c.category, (byCat.get(c.category) ?? 0) + c.size)
    }
    // A folder takes the colour of whatever dominates it.
    if (n.isDir && n.children.length) n.category = [...byCat].sort((a, b) => b[1] - a[1])[0][0] as MapNode['category']
    if (n.isDir && byKind.size) n.kind = [...byKind].sort((a, b) => b[1] - a[1])[0][0] as MapNode['kind']
    n.children = n.children.filter((c) => c.size > 0 || !c.isDir).sort((a, b) => b.size - a.size)
    if (!n.children.length) delete n.children
  }
  roll(root)
  root.category = 'other'
  root.kind = undefined

  const suggestions: Suggestion[] = []
  const bySum = new Map<string, DriveFile[]>()
  for (const f of files) {
    if (!f.md5 || f.size <= 0) continue
    const key = `${f.md5}:${f.size}`
    const group = bySum.get(key)
    if (group) group.push(f)
    else bySum.set(key, [f])
  }
  for (const group of [...bySum.values()].filter((g) => g.length > 1).sort((a, b) => b[0].size - a[0].size).slice(0, 2)) {
    suggestions.push({
      id: `dupe:${group[0].id}`,
      title: group[0].name,
      detail: `${group.length} identical copies`,
      size: group[0].size * (group.length - 1),
      nodeId: group[1].id,
      tone: 'reclaim'
    })
  }
  const stale = files.filter((f) => f.kind !== 'folder' && f.size > GiB && Date.now() - Date.parse(f.modifiedAt) > 365 * DAY)
  if (stale.length) {
    const biggest = stale.sort((a, b) => b.size - a.size)[0]
    suggestions.push({
      id: 'stale',
      title: stale.length > 1 ? `${stale.length} big files untouched 1y+` : biggest.name,
      detail: stale.length > 1 ? `largest: ${biggest.name}` : 'untouched for over a year',
      size: stale.reduce((a, f) => a + f.size, 0),
      nodeId: biggest.id,
      tone: 'review'
    })
  }
  const videos = files.filter((f) => f.kind === 'video')
  if (videos.length > 3) {
    const biggest = videos.sort((a, b) => b.size - a.size)[0]
    suggestions.push({
      id: 'videos', title: `${videos.length} videos`, detail: `largest: ${biggest.name}`,
      size: videos.reduce((a, f) => a + f.size, 0), nodeId: biggest.id, tone: 'review'
    })
  }
  if (quota.usageInTrash > 0) {
    suggestions.push({ id: 'trash', title: 'Trash', detail: 'still counts against your plan', size: quota.usageInTrash, nodeId: 'root', tone: 'reclaim' })
  }

  return {
    source: 'drive',
    root,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    suggestions: suggestions.sort((a, b) => b.size - a.size).slice(0, 6),
    disk: quota.limit ? { label: 'Google One plan', free: Math.max(0, quota.limit - quota.usage), total: quota.limit } : null
  }
}
