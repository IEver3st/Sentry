import { parentPort, workerData } from 'node:worker_threads'
import { lstat, opendir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { MapCategory, MapNode } from '@shared/types'
import { categoryFromKind, kindFromName } from '@shared/kinds'

/**
 * Walks a directory tree off the main thread. Directories keep full detail;
 * individual files are only kept when large enough to be visible on the map.
 */

interface Dir {
  path: string
  name: string
  size: number
  files: number
  dirs: number
  newest: number
  category: MapCategory
  reclaimable: boolean
  children: Dir[]
  leaves: MapNode[]
}

const KEEP_FILE = 16 * 1024 * 1024
// At most 8 directories x 6 metadata requests, including very wide folders.
const CONCURRENCY = 8
const STAT_BATCH = 6

const CACHE_NAMES = new Set([
  'node_modules', '.cache', 'cache', 'caches', 'cachestorage', 'code cache', 'gpucache', 'shadercache', 'dawncache',
  'temp', 'tmp', '__pycache__', '.gradle', '_cacache', '.pnpm-store', 'crashdumps', 'crashpad', '$recycle.bin',
  'inetcache', 'webcache', '.turbo', '.parcel-cache', '.vite'
])
const GAMES = /^(steamapps|steam|epic games|riot games|fivem|fivem\.app|battle\.net|ea games|ubisoft|gog galaxy|xboxgames)$/i
const SYNCED = /^(google drive|my drive|onedrive.*|dropbox|icloud ?drive|sync|syncthing)$/i
const APPS = /^(program files.*|programs|\.rustup|\.cargo|\.bun|\.npm|\.nuget|\.vscode|\.cursor|\.dotnet|go|sdk|android|jetbrains|microsoft|windowsapps|packages)$/i
const CODE = /^(development|dev|src|source|repos|projects|code|github|\.git|workspace)$/i
const MEDIA = /^(pictures|photos|videos|music|movies|camera roll|screenshots|captures|obs)$/i
const DOCS = /^(documents|desktop|onedrive - personal)$/i
const SYSTEM = /^(appdata|library|\.local|\.config|windows)$/i

function classify(name: string, parent: Dir | null, siblings: Set<string>): { category: MapCategory; reclaimable: boolean } {
  const lower = name.toLowerCase()
  const inherited = parent?.category ?? 'other'
  if (parent?.reclaimable) return { category: inherited, reclaimable: true }
  if (CACHE_NAMES.has(lower)) return { category: 'cache', reclaimable: true }
  if (lower === 'target' && siblings.has('cargo.toml')) return { category: 'code', reclaimable: true }
  if ((lower === 'dist' || lower === 'out' || lower === '.next' || lower === 'build') && siblings.has('package.json'))
    return { category: 'code', reclaimable: true }
  if (GAMES.test(name)) return { category: 'games', reclaimable: false }
  if (SYNCED.test(name)) return { category: 'synced', reclaimable: false }
  if (CODE.test(name)) return { category: 'code', reclaimable: false }
  if (MEDIA.test(name)) return { category: 'media', reclaimable: false }
  if (DOCS.test(name)) return { category: 'documents', reclaimable: false }
  if (APPS.test(name)) return { category: 'apps', reclaimable: false }
  if (SYSTEM.test(name)) return { category: 'system', reclaimable: false }
  return { category: inherited, reclaimable: false }
}

let cancelled = false
const roots: string[] = workerData.roots ?? [workerData.root]
let completedFiles = 0
let completedBytes = 0
let rootIndex = 0
let progressEnabled = workerData.progressEnabled !== false
let updateProgressTimer = (): void => {}
let stopProgress = (): void => {}
parentPort?.on('message', (msg: { type: string; enabled?: boolean }) => {
  if (msg.type === 'cancel') cancelled = true
  if (msg.type === 'progress-enabled') {
    progressEnabled = msg.enabled === true
    updateProgressTimer()
  }
})

async function scan(rootPath: string): Promise<Dir> {
  const root: Dir = {
    path: rootPath, name: basename(rootPath) || rootPath, size: 0, files: 0, dirs: 0, newest: 0,
    category: 'other', reclaimable: false, children: [], leaves: []
  }
  let files = 0
  let bytes = 0
  let current = rootPath
  let ticker: ReturnType<typeof setInterval> | null = null
  let rootError: unknown = null
  const report = (): void => { parentPort?.postMessage({ type: 'progress', files: completedFiles + files, bytes: completedBytes + bytes, current, root: rootPath, rootIndex: rootIndex + 1, rootCount: roots.length }) }
  stopProgress = () => {
    if (ticker) clearInterval(ticker)
    ticker = null
  }
  updateProgressTimer = () => {
    if (progressEnabled && !ticker) {
      report()
      ticker = setInterval(report, 120)
    } else if (!progressEnabled) stopProgress()
  }
  updateProgressTimer()

  const queue: Dir[] = [root]
  let active = 0

  await new Promise<void>((resolve) => {
    const pump = (): void => {
      if (cancelled) {
        queue.length = 0
      }
      while (active < CONCURRENCY && queue.length) {
        const dir = queue.pop()!
        active++
        void visit(dir).finally(() => {
          active--
          if (!queue.length && active === 0) resolve()
          else pump()
        })
      }
      if (!queue.length && active === 0) resolve()
    }

    const visit = async (dir: Dir): Promise<void> => {
      current = dir.path
      let entries: Array<{ name: string; isDir: boolean; isFile: boolean }> = []
      try {
        const handle = await opendir(dir.path)
        for await (const e of handle) {
          if (cancelled) break
          entries.push({ name: e.name, isDir: e.isDirectory(), isFile: e.isFile() })
        }
      } catch (error) {
        if (dir === root) rootError = error
        return // permission denied, vanished, etc.
      }
      const names = new Set(entries.map((e) => e.name.toLowerCase()))
      for (let offset = 0; offset < entries.length && !cancelled; offset += STAT_BATCH) {
        const batch = entries.slice(offset, offset + STAT_BATCH)
        const stats = await Promise.all(batch.map(async (e) => {
          if (!e.isDir && !e.isFile) return null // symlinks, junctions, sockets
          try {
            return await lstat(join(dir.path, e.name))
          } catch {
            return null
          }
        }))
        batch.forEach((e, i) => {
          const st = stats[i]
          if (!st || st.isSymbolicLink()) return
          const full = join(dir.path, e.name)
          if (st.isDirectory()) {
            const { category, reclaimable } = classify(e.name, dir, names)
            const child: Dir = {
              path: full, name: e.name, size: 0, files: 0, dirs: 0, newest: st.mtimeMs,
              category, reclaimable, children: [], leaves: []
            }
            dir.children.push(child)
            queue.push(child)
          } else if (st.isFile()) {
            files++
            bytes += st.size
            dir.size += st.size
            dir.files++
            if (st.mtimeMs > dir.newest) dir.newest = st.mtimeMs
            if (st.size >= KEEP_FILE) {
              const kind = kindFromName(e.name)
              const kindCat = categoryFromKind(kind)
              dir.leaves.push({
                id: full, name: e.name, size: st.size, files: 1, dirs: 0, newest: st.mtimeMs,
                kind: dir.reclaimable || kind === 'other' ? undefined : kind,
                category: dir.reclaimable ? dir.category : kindCat === 'other' ? dir.category : kindCat,
                reclaimable: dir.reclaimable || undefined, isDir: false
              })
            }
          }
        })
      }
    }

    pump()
  })

  stopProgress()
  if (rootError) throw rootError
  if (progressEnabled) report()
  if (!cancelled) rollup(root)
  return root
}

function rollup(dir: Dir): void {
  for (const c of dir.children) {
    rollup(c)
    dir.size += c.size
    dir.files += c.files
    dir.dirs += c.dirs + 1
    if (c.newest > dir.newest) dir.newest = c.newest
  }
}

/** Converts to the wire format, folding anything too small to draw. */
function toNode(dir: Dir, minSize: number): MapNode {
  const node: MapNode = {
    id: dir.path, name: dir.name, size: dir.size, files: dir.files, dirs: dir.dirs, newest: dir.newest,
    category: dir.category, reclaimable: dir.reclaimable || undefined, isDir: true
  }
  if (dir.size < minSize * 4) return node
  const kids: MapNode[] = []
  let restSize = 0
  let restFiles = 0
  let restNewest = 0
  for (const c of dir.children) {
    if (c.size >= minSize) kids.push(toNode(c, minSize))
    else {
      restSize += c.size
      restFiles += c.files
      restNewest = Math.max(restNewest, c.newest)
    }
  }
  let keptLeafBytes = 0
  for (const leaf of dir.leaves) {
    if (leaf.size >= minSize) {
      kids.push(leaf)
      keptLeafBytes += leaf.size
    }
  }
  const looseBytes = dir.size - dir.children.reduce((a, c) => a + c.size, 0) - keptLeafBytes
  restSize += looseBytes
  restFiles += Math.max(0, dir.files - dir.children.reduce((a, c) => a + c.files, 0) - kids.filter((k) => !k.isDir).length)
  if (restSize > 0 && kids.length) {
    kids.push({
      id: `${dir.path}::rest`, name: 'Everything else', size: restSize, files: restFiles, dirs: 0,
      newest: restNewest || dir.newest, category: dir.category, reclaimable: dir.reclaimable || undefined, isDir: false, aggregate: true
    })
  }
  if (kids.length) node.children = kids.sort((a, b) => b.size - a.size)
  return node
}

async function scanRoots(): Promise<void> {
  const children: MapNode[] = []
  const scanErrors: Array<{ root: string; message: string }> = []
  for (rootIndex = 0; rootIndex < roots.length && !cancelled; rootIndex++) {
    const root = roots[rootIndex]
    try {
      const tree = await scan(root)
      if (cancelled) break
      completedFiles += tree.files
      completedBytes += tree.size
      children.push(toNode(tree, Math.max(tree.size / 6000, 1024 * 1024)))
    } catch (error) {
      stopProgress()
      scanErrors.push({ root, message: error instanceof Error ? error.message : String(error) })
    }
  }
  if (cancelled) {
    parentPort?.postMessage({ type: 'cancelled' })
    return
  }
  if (!children.length) throw new Error(scanErrors.map((e) => `${e.root}: ${e.message}`).join('\n') || 'No locations to scan.')
  const root: MapNode = roots.length === 1 ? children[0] : {
    id: 'local:computer', name: 'This PC', virtual: true, isDir: true, category: 'other',
    size: completedBytes, files: completedFiles,
    dirs: children.reduce((sum, child) => sum + child.dirs + 1, 0),
    newest: Math.max(...children.map((child) => child.newest)),
    children: children.sort((a, b) => b.size - a.size)
  }
  parentPort?.postMessage({ type: 'done', root, scanErrors })
}

scanRoots()
  .catch((error: unknown) => parentPort?.postMessage({ type: 'error', message: String(error) }))
  .finally(() => {
    stopProgress()
    parentPort?.close()
  })
