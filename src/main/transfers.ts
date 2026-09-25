import { mkdir, readdir, lstat, access } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { DriveFile, Transfer } from '@shared/types'
import { kindFromName } from '@shared/kinds'
import type { DriveProvider } from './providers/types'
import { GoogleProvider } from './providers/google'

interface Job {
  transfer: Transfer
  controller: AbortController
  run: (job: Job) => Promise<void>
}

const HISTORY = 200

/** Upload/download queue. Emits the whole list (throttled) whenever anything moves. */
export class TransferQueue {
  private jobs: Job[] = []
  private running = 0
  private preparing = 0
  private emitTimer: NodeJS.Timeout | null = null
  private progressEnabled = true

  constructor(
    private readonly provider: () => DriveProvider,
    private readonly emit: (list: Transfer[]) => void,
    private readonly driveChanged: (folderIds: Array<string | null>) => void,
    private readonly concurrency: () => number
  ) {}

  list(): Transfer[] {
    return this.jobs.map((j) => ({ ...j.transfer }))
  }

  isBusy(): boolean {
    return this.preparing > 0 || this.jobs.some((j) => j.transfer.state === 'running' || j.transfer.state === 'queued')
  }

  /** Transfers and terminal notifications continue; only progress snapshots stop. */
  setProgressEnabled(enabled: boolean): void {
    this.progressEnabled = enabled
    if (!enabled && this.emitTimer) {
      clearTimeout(this.emitTimer)
      this.emitTimer = null
    }
  }

  private changed(immediate = false): void {
    if (!immediate && !this.progressEnabled) return
    if (immediate) {
      if (this.emitTimer) clearTimeout(this.emitTimer)
      this.emitTimer = null
      this.emit(this.list())
      return
    }
    this.emitTimer ??= setTimeout(() => {
      this.emitTimer = null
      this.emit(this.list())
    }, 90)
  }

  private enqueue(transfer: Omit<Transfer, 'id' | 'done' | 'state' | 'startedAt'>, run: Job['run']): void {
    this.jobs.unshift({
      transfer: { ...transfer, id: randomUUID(), done: 0, state: 'queued', startedAt: new Date().toISOString() },
      controller: new AbortController(),
      run
    })
    const finished = this.jobs.filter((j) => j.transfer.state !== 'queued' && j.transfer.state !== 'running')
    if (finished.length > HISTORY) {
      const drop = new Set(finished.slice(HISTORY))
      this.jobs = this.jobs.filter((j) => !drop.has(j))
    }
    this.changed(true)
    this.pump()
  }

  private pump(): void {
    while (this.running < Math.max(1, Math.min(8, Math.trunc(this.concurrency()) || 3))) {
      const next = this.jobs.findLast((j) => j.transfer.state === 'queued')
      if (!next) return
      this.running++
      next.transfer.state = 'running'
      this.changed(true)
      next
        .run(next)
        .then(() => {
          next.transfer.state = 'done'
          next.transfer.done = next.transfer.total
        })
        .catch((error: unknown) => {
          if (next.controller.signal.aborted) next.transfer.state = 'cancelled'
          else {
            next.transfer.state = 'failed'
            next.transfer.error = error instanceof Error ? error.message : String(error)
          }
        })
        .finally(() => {
          next.transfer.finishedAt = new Date().toISOString()
          if (next.transfer.direction === 'down') reserved.delete(next.transfer.localPath.toLowerCase())
          this.running--
          this.changed(true)
          this.pump()
        })
    }
  }

  cancel(id: string): void {
    const job = this.jobs.find((j) => j.transfer.id === id)
    if (!job) return
    if (job.transfer.state === 'queued') {
      job.transfer.state = 'cancelled'
      job.transfer.finishedAt = new Date().toISOString()
      if (job.transfer.direction === 'down') reserved.delete(job.transfer.localPath.toLowerCase())
      this.changed(true)
    } else if (job.transfer.state === 'running') job.controller.abort()
  }

  clearFinished(): void {
    this.jobs = this.jobs.filter((j) => j.transfer.state === 'queued' || j.transfer.state === 'running')
    this.changed(true)
  }

  /** Files upload directly; folders are recreated in Drive and filled. */
  async upload(paths: string[], parentId: string | null, parentLabel?: string): Promise<void> {
    const provider = this.provider()
    const touched = new Set<string | null>([parentId])
    const walk = async (path: string, parent: string | null, label: string): Promise<void> => {
      const info = await lstat(path)
      if (info.isSymbolicLink()) return
      const name = basename(path)
      if (info.isDirectory()) {
        const folder = await provider.createFolder(parent, name)
        touched.add(folder.id)
        const entries = await readdir(path, { withFileTypes: true })
        for (const e of entries) {
          if (e.isFile() || e.isDirectory()) await walk(join(path, e.name), folder.id, `${label}/${name}`)
        }
        return
      }
      this.enqueue(
        { direction: 'up', name, kind: kindFromName(name), localPath: path, remoteId: parent ?? 'root', remoteLabel: label, total: info.size },
        async (job) => {
          await provider.upload(path, parent, name, (done) => {
            job.transfer.done = done
            this.changed()
          }, job.controller.signal)
          this.driveChanged([parent])
        }
      )
    }
    this.preparing++
    try {
      const label = parentLabel ?? (parentId ? (await provider.get(parentId)).name : 'My Drive')
      for (const p of paths) await walk(p, parentId, label)
    } finally {
      this.preparing--
      if (touched.size > 1) this.driveChanged([...touched])
    }
  }

  async download(ids: string[], destDir: string): Promise<void> {
    const provider = this.provider()
    const visited = new Set<string>()
    const walk = async (file: DriveFile, dir: string): Promise<void> => {
      if (file.kind === 'folder') {
        if (visited.has(file.id)) return
        visited.add(file.id)
        const target = await uniquePath(join(dir, safeName(file.name)))
        try { await mkdir(target) } finally { reserved.delete(target.toLowerCase()) }
        const listing = await provider.list(file.id)
        for (const item of listing.items) await walk(item, target)
        return
      }
      const ext = GoogleProvider.exportExtension(file.mimeType)
      const name = safeName(ext && !file.name.toLowerCase().endsWith(`.${ext}`) ? `${file.name}.${ext}` : file.name)
      const target = await uniquePath(join(dir, name))
      this.enqueue(
        { direction: 'down', name: basename(target), kind: file.kind, localPath: target, remoteId: file.id, remoteLabel: 'Drive', total: file.size },
        (job) =>
          provider.download(file.id, target, (done) => {
            job.transfer.done = done
            if (done > job.transfer.total) job.transfer.total = done
            this.changed()
          }, job.controller.signal)
      )
    }
    this.preparing++
    try {
      await mkdir(destDir, { recursive: true })
      for (const id of ids) await walk(await provider.get(id), destDir)
    } finally { this.preparing-- }
  }
}

function safeName(name: string): string {
  const safe = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '') || 'file'
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe) ? `_${safe}` : safe
}

const reserved = new Set<string>()

/** Never overwrite: "report.pdf" becomes "report (1).pdf". Reserved names cover queued downloads. */
async function uniquePath(path: string): Promise<string> {
  const ext = extname(path)
  const stem = path.slice(0, path.length - ext.length)
  for (let i = 0; ; i++) {
    const candidate = i === 0 ? path : `${stem} (${i})${ext}`
    if (reserved.has(candidate.toLowerCase())) continue
    try {
      await access(candidate)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      reserved.add(candidate.toLowerCase())
      return candidate
    }
  }
}
