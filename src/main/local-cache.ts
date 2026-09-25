import { readFile, rename, rm, statfs, writeFile } from 'node:fs/promises'
import { join, parse, resolve } from 'node:path'
import type { MapNode, MapSnapshot } from '@shared/types'

/**
 * Remembers the last This PC scan across launches, so the map is there immediately and
 * a rescan is the user's choice. Tied to the folder it scanned; a different folder means no cache.
 */
interface Stored {
  version: 1
  root: string
  snapshot: MapSnapshot
}

export class LocalScanCache {
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly dir: string) {}

  private get file(): string {
    return join(this.dir, 'local-scan.json')
  }

  save(root: string, snapshot: MapSnapshot): Promise<void> {
    const data: Stored = { version: 1, root: resolve(root), snapshot }
    this.writing = this.writing
      .catch(() => undefined)
      .then(async () => {
        const tmp = `${this.file}.tmp`
        await writeFile(tmp, JSON.stringify(data))
        await rename(tmp, this.file)
      })
    return this.writing
  }

  /** The saved scan for this folder, with free disk space refreshed (that changes between launches). */
  async load(root: string): Promise<MapSnapshot | null> {
    await this.writing.catch(() => undefined)
    let data: Stored
    try {
      data = JSON.parse(await readFile(this.file, 'utf8')) as Stored
    } catch {
      return null
    }
    if (data.version !== 1 || data.root !== resolve(root)) return null
    const snap = data.snapshot
    try {
      const fs = await statfs(root)
      snap.disk = { label: parse(root).root.replace(/\\$/, '') || root, free: fs.bavail * fs.bsize, total: fs.blocks * fs.bsize }
    } catch {
      /* keep the saved figures */
    }
    return snap
  }

  /** Keep the saved map truthful after items go to the Recycle Bin. */
  async prune(root: string, paths: string[]): Promise<void> {
    const snap = await this.load(root)
    if (!snap) return
    const gone = new Set(paths.map((p) => resolve(p)))
    const walk = (n: MapNode): MapNode => {
      if (!n.children) return n
      const kept: MapNode[] = []
      let size = n.size
      let files = n.files
      for (const c of n.children) {
        if (gone.has(resolve(c.id))) {
          size -= c.size
          files -= c.files
          continue
        }
        const next = walk(c)
        size -= c.size - next.size
        files -= c.files - next.files
        kept.push(next)
      }
      return { ...n, size: Math.max(0, size), files: Math.max(0, files), children: kept }
    }
    snap.root = walk(snap.root)
    snap.suggestions = snap.suggestions.filter((s) => !gone.has(resolve(s.nodeId)))
    await this.save(root, snap)
  }

  async clear(): Promise<void> {
    await this.writing.catch(() => undefined)
    await rm(this.file, { force: true })
  }
}
