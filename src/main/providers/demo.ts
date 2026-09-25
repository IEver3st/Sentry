import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { randomUUID, createHash } from 'node:crypto'
import type { DriveAccount, DriveFile, DriveQuota, FolderListing, ShareLink } from '@shared/types'
import { FOLDER_MIME, kindFromName, mimeFromName } from '@shared/kinds'
import type { DriveProvider, ProgressFn } from './types'

/**
 * A Drive stand-in backed by a folder in userData. Sample entries seeded on
 * first use carry metadata only; anything the user uploads is stored for real
 * and can be downloaded again, so every flow works end to end offline.
 */

interface StoredFile extends DriveFile {
  trashed?: boolean
  /** Filename under blobs/ for real uploaded content. */
  blob?: string
}

interface Index {
  version: 1
  files: Record<string, StoredFile>
}

const GiB = 1024 ** 3
const MiB = 1024 ** 2
const PLAN_LIMIT = 2 * 1024 ** 4
const GMAIL_USAGE = 4.3 * GiB

export class DemoProvider implements DriveProvider {
  readonly id = 'demo' as const
  private index: Index | null = null
  private writing: Promise<void> = Promise.resolve()

  constructor(
    private readonly dir: string,
    private readonly displayName: () => string
  ) {}

  private get indexPath(): string {
    return join(this.dir, 'index.json')
  }

  private get blobDir(): string {
    return join(this.dir, 'blobs')
  }

  private async load(): Promise<Index> {
    if (this.index) return this.index
    await mkdir(this.blobDir, { recursive: true })
    try {
      this.index = JSON.parse(await readFile(this.indexPath, 'utf8')) as Index
    } catch {
      this.index = { version: 1, files: seed() }
      await this.save()
    }
    return this.index
  }

  private save(): Promise<void> {
    // Serialize writes and replace atomically so a crash never leaves half an index.
    this.writing = this.writing.then(async () => {
      const tmp = `${this.indexPath}.tmp`
      await writeFile(tmp, JSON.stringify(this.index))
      await rename(tmp, this.indexPath)
    })
    return this.writing
  }

  private live(index: Index): StoredFile[] {
    return Object.values(index.files).filter((f) => !f.trashed)
  }

  private async require(id: string): Promise<StoredFile> {
    const index = await this.load()
    const file = index.files[id]
    if (!file || file.trashed) throw new Error('That file is no longer in your Drive.')
    return file
  }

  /** Folder sizes are derived so they always match their contents. */
  private withFolderSizes(index: Index, files: StoredFile[]): DriveFile[] {
    const live = this.live(index)
    const sizes = new Map<string, number>()
    for (const f of live) {
      if (f.kind === 'folder') continue
      let parent = f.parentId
      while (parent) {
        sizes.set(parent, (sizes.get(parent) ?? 0) + f.size)
        parent = index.files[parent]?.parentId ?? null
      }
    }
    return files.map((f) => (f.kind === 'folder' ? { ...strip(f), size: sizes.get(f.id) ?? 0 } : strip(f)))
  }

  async account(): Promise<DriveAccount> {
    return { provider: 'demo', email: 'demo drive', displayName: this.displayName() || 'You', photoUrl: null }
  }

  async quota(): Promise<DriveQuota> {
    const index = await this.load()
    let drive = 0
    let trash = 0
    for (const f of Object.values(index.files)) {
      if (f.kind === 'folder') continue
      if (f.trashed) trash += f.size
      else drive += f.size
    }
    return {
      limit: PLAN_LIMIT,
      usage: drive + trash + GMAIL_USAGE,
      usageInDrive: drive,
      usageInTrash: trash,
      usageElsewhere: GMAIL_USAGE
    }
  }

  async get(id: string): Promise<DriveFile> {
    const index = await this.load()
    const file = await this.require(id)
    return this.withFolderSizes(index, [file])[0]
  }

  async list(folderId: string | null): Promise<FolderListing> {
    const index = await this.load()
    const folder = folderId ? await this.require(folderId) : null
    const path: FolderListing['path'] = []
    let cursor: StoredFile | undefined = folder ?? undefined
    while (cursor) {
      path.unshift({ id: cursor.id, name: cursor.name })
      cursor = cursor.parentId ? index.files[cursor.parentId] : undefined
    }
    const items = this.live(index).filter((f) => f.parentId === folderId)
    return {
      folder: folder ? this.withFolderSizes(index, [folder])[0] : null,
      path,
      items: sortListing(this.withFolderSizes(index, items))
    }
  }

  async recent(limit: number): Promise<DriveFile[]> {
    const index = await this.load()
    const files = this.live(index)
      .filter((f) => f.kind !== 'folder')
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
      .slice(0, limit)
    return files.map(strip)
  }

  async search(query: string): Promise<DriveFile[]> {
    const index = await this.load()
    const q = query.trim().toLowerCase()
    if (!q) return []
    const hits = this.live(index)
      .filter((f) => f.name.toLowerCase().includes(q))
      .slice(0, 200)
    return sortListing(this.withFolderSizes(index, hits))
  }

  async shared(): Promise<DriveFile[]> {
    const index = await this.load()
    const hits = this.live(index)
      .filter((f) => f.link)
      .sort((a, b) => (b.link!.createdAt).localeCompare(a.link!.createdAt))
    return this.withFolderSizes(index, hits)
  }

  async allFiles(): Promise<DriveFile[]> {
    const index = await this.load()
    return this.live(index).map(strip)
  }

  async createFolder(parentId: string | null, name: string): Promise<DriveFile> {
    const index = await this.load()
    if (parentId) await this.require(parentId)
    const now = new Date().toISOString()
    const folder: StoredFile = {
      id: randomUUID(), name: name.trim() || 'Untitled folder', kind: 'folder', mimeType: FOLDER_MIME,
      size: 0, modifiedAt: now, createdAt: now, parentId, starred: false, link: null
    }
    index.files[folder.id] = folder
    await this.save()
    return strip(folder)
  }

  async rename(id: string, name: string): Promise<DriveFile> {
    const file = await this.require(id)
    const clean = name.trim()
    if (!clean) throw new Error('Names can’t be empty.')
    file.name = clean
    file.modifiedAt = new Date().toISOString()
    await this.save()
    return this.get(id)
  }

  async trash(id: string): Promise<void> {
    const index = await this.load()
    await this.require(id)
    const stack = [id]
    while (stack.length) {
      const current = stack.pop()!
      index.files[current].trashed = true
      for (const f of Object.values(index.files)) if (f.parentId === current && !f.trashed) stack.push(f.id)
    }
    await this.save()
  }

  async move(id: string, parentId: string | null): Promise<DriveFile> {
    const index = await this.load()
    const file = await this.require(id)
    if (parentId) {
      await this.require(parentId)
      // A folder can't move inside itself.
      let cursor: string | null = parentId
      while (cursor) {
        if (cursor === id) throw new Error('A folder can’t go inside itself.')
        cursor = index.files[cursor]?.parentId ?? null
      }
    }
    file.parentId = parentId
    await this.save()
    return this.get(id)
  }

  async setStarred(id: string, starred: boolean): Promise<DriveFile> {
    const file = await this.require(id)
    file.starred = starred
    await this.save()
    return this.get(id)
  }

  async setLink(id: string, role: ShareLink['role'] | null): Promise<DriveFile> {
    const file = await this.require(id)
    file.link = role
      ? {
          url: file.link?.url ?? demoLink(file),
          role,
          createdAt: file.link?.createdAt ?? new Date().toISOString()
        }
      : null
    await this.save()
    return this.get(id)
  }

  async upload(localPath: string, parentId: string | null, name: string, onProgress: ProgressFn, signal: AbortSignal): Promise<DriveFile> {
    const index = await this.load()
    if (parentId) await this.require(parentId)
    const id = randomUUID()
    const blob = id
    const target = join(this.blobDir, blob)
    const hash = createHash('md5')
    let done = 0
    try {
      await pipeline(
        createReadStream(localPath),
        new Transform({
          transform(chunk: Buffer, _enc, cb) {
            done += chunk.length
            hash.update(chunk)
            onProgress(done)
            cb(null, chunk)
          }
        }),
        createWriteStream(target),
        { signal }
      )
    } catch (error) {
      await rm(target, { force: true })
      throw error
    }
    const info = await stat(localPath)
    const now = new Date().toISOString()
    const file: StoredFile = {
      id, name, kind: kindFromName(name), mimeType: mimeFromName(name), size: info.size,
      modifiedAt: now, createdAt: now, parentId, starred: false, link: null, blob, md5: hash.digest('hex')
    }
    index.files[id] = file
    await this.save()
    return strip(file)
  }

  async download(id: string, destPath: string, onProgress: ProgressFn, signal: AbortSignal): Promise<void> {
    const file = await this.require(id)
    if (!file.blob) throw new Error('This is a sample file with no content. Connect Google Drive to pull real files.')
    let done = 0
    await pipeline(
      createReadStream(join(this.blobDir, file.blob)),
      new Transform({
        transform(chunk: Buffer, _enc, cb) {
          done += chunk.length
          onProgress(done)
          cb(null, chunk)
        }
      }),
      createWriteStream(destPath),
      { signal }
    )
  }

  async signOut(): Promise<void> {
    await this.writing
    this.index = null
    await rm(this.dir, { recursive: true, force: true })
  }
}

function strip(f: StoredFile): DriveFile {
  const { trashed: _t, blob, ...rest } = f
  return blob || f.kind === 'folder' ? rest : { ...rest, sample: true }
}

export function sortListing(items: DriveFile[]): DriveFile[] {
  return items.sort((a, b) => {
    if ((a.kind === 'folder') !== (b.kind === 'folder')) return a.kind === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  })
}

function demoLink(file: StoredFile): string {
  const slug = file.id.replace(/-/g, '').slice(0, 20)
  return file.kind === 'folder'
    ? `https://drive.google.com/drive/folders/${slug}?usp=sharing`
    : `https://drive.google.com/file/d/${slug}/view?usp=sharing`
}

/* ---------- Sample library ---------- */

function seed(): Record<string, StoredFile> {
  let s = 0x5e47
  const rand = (): number => {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const between = (lo: number, hi: number): number => lo + (hi - lo) * rand()
  const now = Date.now()
  const daysAgo = (lo: number, hi: number): string => new Date(now - between(lo, hi) * 86_400_000).toISOString()

  const files: Record<string, StoredFile> = {}
  let n = 0
  const add = (parentId: string | null, name: string, size: number, age: [number, number], extra: Partial<StoredFile> = {}): StoredFile => {
    const id = `sample-${(n++).toString(36).padStart(4, '0')}`
    const when = daysAgo(age[0], age[1])
    const isFolder = size < 0
    const file: StoredFile = {
      id, name, parentId,
      kind: isFolder ? 'folder' : kindFromName(name),
      mimeType: isFolder ? FOLDER_MIME : mimeFromName(name),
      size: Math.max(0, Math.round(size)), modifiedAt: when, createdAt: when, starred: false, link: null,
      ...extra
    }
    files[id] = file
    return file
  }
  const folder = (parentId: string | null, name: string, age: [number, number] = [2, 900]): string => add(parentId, name, -1, age).id
  const share = (f: StoredFile, daysBack: number, role: ShareLink['role'] = 'reader'): void => {
    f.link = { url: demoLink(f), role, createdAt: new Date(now - daysBack * 86_400_000).toISOString() }
  }

  // Photos by year, the classic Drive heavyweight.
  const photos = folder(null, 'Photos', [1, 30])
  for (let year = 2019; year <= 2026; year++) {
    const y = folder(photos, String(year), [(2026 - year) * 365, (2026 - year) * 365 + 20])
    const count = 14 + Math.round(rand() * 26)
    const base = (2026 - year) * 365
    for (let i = 0; i < count; i++) {
      const video = rand() < 0.14
      add(y, `${video ? 'VID' : 'IMG'}_${year}${String(1000 + Math.round(rand() * 8999))}.${video ? 'MOV' : 'HEIC'}`,
        video ? between(60, 900) * MiB : between(1.8, 6.4) * MiB, [base, base + 330])
    }
  }

  const projects = folder(null, 'Projects', [0, 4])
  const sentry = folder(projects, 'Sentry', [0, 2])
  add(sentry, 'Sentry brand.fig', 84 * MiB, [0, 1], { starred: true })
  add(sentry, 'Onboarding flow.mp4', 312 * MiB, [1, 2])
  add(sentry, 'Roadmap', 0, [0, 1], { mimeType: 'application/vnd.google-apps.document', kind: 'document' })
  add(sentry, 'icon-set.zip', 46 * MiB, [2, 3])
  const fivem = folder(projects, 'FiveM resources', [3, 12])
  for (const r of ['ev-garage', 'ev-hud', 'ev-inventory', 'ev-phone', 'ev-dispatch', 'map-streams']) {
    const f = add(fivem, `${r}-release.zip`, between(18, r === 'map-streams' ? 2400 : 220) * MiB, [3, 200])
    if (r === 'ev-hud' || r === 'ev-phone') share(f, between(2, 40))
  }
  add(fivem, 'Vehicle pack source.7z', 7.8 * GiB, [40, 60])
  const site = folder(projects, 'Website', [10, 30])
  add(site, 'hero-footage.mp4', 740 * MiB, [10, 30])
  for (let i = 1; i <= 12; i++) add(site, `shot-${i}.png`, between(1.2, 9) * MiB, [10, 60])

  const docs = folder(null, 'Documents', [1, 10])
  const taxes = folder(docs, 'Taxes', [120, 200])
  for (const y of [2022, 2023, 2024, 2025]) {
    const t = folder(taxes, String(y), [(2026 - y) * 365 - 200, (2026 - y) * 365 - 150])
    add(t, `W-2 ${y}.pdf`, between(0.2, 0.6) * MiB, [(2026 - y) * 365 - 250, (2026 - y) * 365 - 240])
    add(t, `Return ${y}.pdf`, between(1, 3) * MiB, [(2026 - y) * 365 - 200, (2026 - y) * 365 - 190])
    add(t, `Receipts ${y}.zip`, between(40, 260) * MiB, [(2026 - y) * 365 - 200, (2026 - y) * 365 - 190])
  }
  const career = folder(docs, 'Career', [2, 20])
  const resume = add(career, 'Resume.pdf', 0.4 * MiB, [2, 5], { starred: true })
  share(resume, 3)
  add(career, 'Resume.docx', 0.1 * MiB, [2, 5])
  add(career, 'Cover letter template', 0, [20, 30], { mimeType: 'application/vnd.google-apps.document', kind: 'document' })
  add(career, 'Job tracker', 0, [0, 2], { mimeType: 'application/vnd.google-apps.spreadsheet', kind: 'spreadsheet' })
  const school = folder(docs, 'School', [5, 40])
  for (const c of ['C182', 'C836', 'D315', 'D322', 'C779']) {
    const cf = folder(school, c, [10, 300])
    for (let i = 1; i <= 4; i++) add(cf, `${c} notes ${i}.pdf`, between(0.5, 18) * MiB, [10, 300])
  }
  add(docs, 'Lease 2026.pdf', 3.4 * MiB, [90, 100])
  add(docs, 'Car title scan.pdf', 5.1 * MiB, [400, 420])
  add(docs, 'Budget', 0, [0, 3], { mimeType: 'application/vnd.google-apps.spreadsheet', kind: 'spreadsheet', starred: true })

  const videos = folder(null, 'Videos', [2, 60])
  const recordings = folder(videos, 'Recordings', [2, 60])
  for (let i = 0; i < 14; i++) add(recordings, `Recording ${2025 + (i > 8 ? 1 : 0)}-${String(1 + (i % 12)).padStart(2, '0')}-${String(3 + i).padStart(2, '0')}.mkv`, between(0.8, 7.5) * GiB, [4, 520])
  const edits = folder(videos, 'Edits', [10, 90])
  for (let i = 1; i <= 6; i++) {
    const f = add(edits, `Montage v${i}.mp4`, between(0.6, 2.8) * GiB, [10, 90])
    if (i === 6) share(f, 11)
  }

  const backups = folder(null, 'Backups', [180, 500])
  add(backups, 'PC backup 2025-03.zip', 48.6 * GiB, [180, 190])
  const oldLaptop = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
  add(backups, 'Old laptop.zip', 21.9 * GiB, [700, 720], { md5: oldLaptop })
  add(backups, 'Old laptop (1).zip', 21.9 * GiB, [690, 700], { md5: oldLaptop })
  add(backups, 'Phone backup 2024.tar', 9.2 * GiB, [400, 410])

  const music = folder(null, 'Music', [300, 900])
  for (const album of ['Midnight Drive', 'Neon Skyline', 'Lo-fi Sessions', 'Live in Dallas']) {
    const a = folder(music, album, [300, 900])
    for (let i = 1; i <= 10; i++) add(a, `${String(i).padStart(2, '0')} Track ${i}.flac`, between(22, 48) * MiB, [300, 900])
  }

  const sharedPack = add(null, 'Shared with crew.zip', 1.3 * GiB, [6, 8])
  share(sharedPack, 6)
  add(null, 'Scratch notes', 0, [0, 1], { mimeType: 'application/vnd.google-apps.document', kind: 'document' })
  return files
}
