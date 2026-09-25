import { createWriteStream } from 'node:fs'
import { open, rm, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import type { DriveAccount, DriveFile, DriveQuota, FolderListing, ShareLink } from '@shared/types'
import { FOLDER_MIME, kindFromMime, mimeFromName } from '@shared/kinds'
import { GoogleSessionExpired, type GoogleAuth } from './google-auth'
import type { DriveProvider, ProgressFn } from './types'
import { sortListing } from './demo'

/**
 * Google Drive v3 over REST. Tokens stay in the main process.
 */

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const FILE_FIELDS = 'id,name,mimeType,size,modifiedTime,createdTime,parents,starred,webViewLink,md5Checksum,permissions(id,type,role)'
const CHUNK = 8 * 1024 * 1024 // must be a multiple of 256 KiB

const EXPORTS: Record<string, { mime: string; ext: string }> = {
  'application/vnd.google-apps.document': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' },
  'application/vnd.google-apps.spreadsheet': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' },
  'application/vnd.google-apps.presentation': { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: 'pptx' },
  'application/vnd.google-apps.drawing': { mime: 'application/pdf', ext: 'pdf' }
}

interface RawFile {
  id: string
  name: string
  mimeType: string
  size?: string
  modifiedTime: string
  createdTime: string
  parents?: string[]
  starred?: boolean
  webViewLink?: string
  md5Checksum?: string
  permissions?: Array<{ id: string; type: string; role: string }>
}

export class GoogleProvider implements DriveProvider {
  readonly id = 'google' as const
  private rootId: string | null = null
  private rootRequest: Promise<string> | null = null
  /** Folder sizes from the last full listing; Drive does not report them directly. */
  private folderSizes = new Map<string, number>()

  constructor(private readonly auth: GoogleAuth) {}

  private async request<T>(url: string, init: RequestInit = {}, retry = 0): Promise<T> {
    const res = await this.raw(url, init, retry)
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  private async raw(url: string, init: RequestInit = {}, retry = 0, refreshed = false): Promise<Response> {
    const token = await this.auth.accessToken()
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000)
    const res = await fetch(url, { ...init, headers, signal })
    if (res.status === 401) {
      await res.body?.cancel()
      if (refreshed) throw new GoogleSessionExpired()
      await this.auth.accessToken(true)
      return this.raw(url, init, retry, true)
    }
    if (init.method !== 'POST' && (res.status === 429 || res.status >= 500 || res.status === 403) && retry < 4 && (await isRetryable(res))) {
      await res.body?.cancel()
      await delay(2 ** retry * 500 + Math.random() * 250, undefined, { signal: init.signal ?? undefined })
      return this.raw(url, init, retry + 1, refreshed)
    }
    if (!res.ok) throw new Error(await describeError(res))
    return res
  }

  private async root(): Promise<string> {
    if (this.rootId) return this.rootId
    this.rootRequest ??= this.request<{ id: string }>(`${API}/files/root?fields=id`)
      .then(({ id }) => (this.rootId = id)).finally(() => (this.rootRequest = null))
    return this.rootRequest
  }

  clearCache(): void {
    this.rootId = null
    this.rootRequest = null
    this.folderSizes.clear()
  }

  private async toFile(raw: RawFile): Promise<DriveFile> {
    const root = await this.root()
    const kind = kindFromMime(raw.mimeType, raw.name)
    const anyone = raw.permissions?.find((p) => p.type === 'anyone')
    const parent = raw.parents?.[0] ?? null
    return {
      id: raw.id,
      name: raw.name,
      kind,
      mimeType: raw.mimeType,
      size: kind === 'folder' ? (this.folderSizes.get(raw.id) ?? 0) : Number(raw.size ?? 0),
      modifiedAt: raw.modifiedTime,
      createdAt: raw.createdTime,
      parentId: parent === root ? null : parent,
      starred: Boolean(raw.starred),
      link: anyone && raw.webViewLink ? { url: raw.webViewLink, role: anyone.role as ShareLink['role'], createdAt: raw.modifiedTime } : null,
      md5: raw.md5Checksum
    }
  }

  private async query(q: string, extra: Record<string, string> = {}, cap = Infinity): Promise<DriveFile[]> {
    const out: RawFile[] = []
    let pageToken: string | undefined
    do {
      const params = new URLSearchParams({ q, pageSize: '1000', fields: `nextPageToken,files(${FILE_FIELDS})`, ...extra })
      if (pageToken) params.set('pageToken', pageToken)
      const page = await this.request<{ files: RawFile[]; nextPageToken?: string }>(`${API}/files?${params}`)
      out.push(...page.files)
      pageToken = page.nextPageToken
    } while (pageToken && out.length < cap)
    return Promise.all(out.slice(0, cap).map((f) => this.toFile(f)))
  }

  async account(): Promise<DriveAccount> {
    const about = await this.request<{ user: { displayName: string; emailAddress: string; photoLink?: string } }>(`${API}/about?fields=user`)
    return { provider: 'google', email: about.user.emailAddress, displayName: about.user.displayName, photoUrl: about.user.photoLink ?? null }
  }

  async quota(): Promise<DriveQuota> {
    const { storageQuota: q } = await this.request<{ storageQuota: { limit?: string; usage: string; usageInDrive: string; usageInDriveTrash: string } }>(
      `${API}/about?fields=storageQuota`
    )
    const usage = Number(q.usage)
    const drive = Number(q.usageInDrive)
    return {
      limit: q.limit ? Number(q.limit) : null,
      usage,
      usageInDrive: drive,
      usageInTrash: Number(q.usageInDriveTrash),
      usageElsewhere: Math.max(0, usage - drive)
    }
  }

  async get(id: string): Promise<DriveFile> {
    return this.toFile(await this.request<RawFile>(`${API}/files/${id}?fields=${FILE_FIELDS}`))
  }

  async list(folderId: string | null): Promise<FolderListing> {
    const parent = folderId ?? (await this.root())
    const [folder, items] = await Promise.all([
      folderId ? this.get(folderId) : Promise.resolve(null),
      this.query(`'${parent}' in parents and trashed = false`, { orderBy: 'folder,name_natural' })
    ])
    const path: FolderListing['path'] = []
    let cursor = folder
    const seen = new Set<string>()
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id)
      path.unshift({ id: cursor.id, name: cursor.name })
      cursor = cursor.parentId ? await this.get(cursor.parentId) : null
    }
    return { folder, path, items: sortListing(items) }
  }

  async recent(limit: number): Promise<DriveFile[]> {
    limit = Math.max(1, Math.min(1000, Math.trunc(limit) || 20))
    return this.query(`trashed = false and mimeType != '${FOLDER_MIME}' and 'me' in owners`, { orderBy: 'modifiedTime desc', pageSize: String(limit) }, limit)
  }

  async search(query: string): Promise<DriveFile[]> {
    const safe = query.trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    if (!safe) return []
    return this.query(`name contains '${safe}' and trashed = false`, {}, 200)
  }

  async shared(): Promise<DriveFile[]> {
    return this.query(`visibility = 'anyoneWithLink' and trashed = false and 'me' in owners`, { orderBy: 'modifiedTime desc' })
  }

  async allFiles(): Promise<DriveFile[]> {
    const files = await this.query(`trashed = false and 'me' in owners`)
    // Refresh the folder size cache while we have everything in hand.
    const byId = new Map(files.map((f) => [f.id, f]))
    const sizes = new Map<string, number>()
    for (const f of files) {
      if (f.kind === 'folder') continue
      let parent = f.parentId
      const seen = new Set<string>()
      while (parent && !seen.has(parent)) {
        seen.add(parent)
        sizes.set(parent, (sizes.get(parent) ?? 0) + f.size)
        parent = byId.get(parent)?.parentId ?? null
      }
    }
    this.folderSizes = sizes
    return files.map((f) => (f.kind === 'folder' ? { ...f, size: sizes.get(f.id) ?? 0 } : f))
  }

  async createFolder(parentId: string | null, name: string): Promise<DriveFile> {
    const raw = await this.request<RawFile>(`${API}/files?fields=${FILE_FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId ?? (await this.root())] })
    })
    return this.toFile(raw)
  }

  private async patch(id: string, body: Record<string, unknown>): Promise<DriveFile> {
    const raw = await this.request<RawFile>(`${API}/files/${id}?fields=${FILE_FIELDS}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    return this.toFile(raw)
  }

  rename(id: string, name: string): Promise<DriveFile> {
    return this.patch(id, { name })
  }

  async trash(id: string): Promise<void> {
    await this.patch(id, { trashed: true })
  }

  async move(id: string, parentId: string | null): Promise<DriveFile> {
    if (id === parentId) throw new Error('A folder cannot be moved into itself.')
    const current = await this.request<{ parents?: string[] }>(`${API}/files/${id}?fields=parents`)
    const target = parentId ?? (await this.root())
    const params = new URLSearchParams({ addParents: target, fields: FILE_FIELDS })
    if (current.parents?.length) params.set('removeParents', current.parents.join(','))
    const raw = await this.request<RawFile>(`${API}/files/${id}?${params}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    })
    return this.toFile(raw)
  }

  setStarred(id: string, starred: boolean): Promise<DriveFile> {
    return this.patch(id, { starred })
  }

  async setLink(id: string, role: ShareLink['role'] | null): Promise<DriveFile> {
    let existing: { id: string; type: string } | undefined
    let pageToken: string | undefined
    do {
      const params = new URLSearchParams({ fields: 'nextPageToken,permissions(id,type)', pageSize: '100' })
      if (pageToken) params.set('pageToken', pageToken)
      const page = await this.request<{ permissions: Array<{ id: string; type: string }>; nextPageToken?: string }>(
        `${API}/files/${encodeURIComponent(id)}/permissions?${params}`
      )
      existing = page.permissions.find((p) => p.type === 'anyone')
      pageToken = page.nextPageToken
    } while (!existing && pageToken)
    if (existing && !role) {
      await this.request(`${API}/files/${id}/permissions/${encodeURIComponent(existing.id)}`, { method: 'DELETE' })
    } else if (existing && role) {
      await this.request(`${API}/files/${id}/permissions/${encodeURIComponent(existing.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role, allowFileDiscovery: false })
      })
    } else if (role) {
      await this.request(`${API}/files/${id}/permissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'anyone', role, allowFileDiscovery: false })
      })
    }
    return this.get(id)
  }

  /** Resumable upload in 8 MiB chunks so progress is real and large files survive. */
  async upload(localPath: string, parentId: string | null, name: string, onProgress: ProgressFn, signal: AbortSignal): Promise<DriveFile> {
    const { size } = await stat(localPath)
    const mime = mimeFromName(name)
    const init = await this.raw(`${UPLOAD}/files?uploadType=resumable&fields=${FILE_FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size) },
      body: JSON.stringify({ name, parents: [parentId ?? (await this.root())] }),
      signal
    })
    const session = init.headers.get('location')
    if (!session) throw new Error('Google didn’t start the upload session.')
    const sessionUrl = new URL(session)
    if (sessionUrl.protocol !== 'https:' || sessionUrl.hostname !== 'www.googleapis.com') throw new Error('Google returned an unexpected upload location.')

    const handle = await open(localPath, 'r')
    try {
      let offset = 0
      let failures = 0
      const buffer = Buffer.alloc(CHUNK)
      while (true) {
        signal.throwIfAborted()
        if (offset === size && size > 0) throw new Error('Google did not confirm the completed upload. Refresh Drive before retrying.')
        const { bytesRead } = await handle.read(buffer, 0, Math.min(CHUNK, size - offset), offset)
        if (size > offset && bytesRead === 0) throw new Error('The local file changed while uploading. Try again after it is saved.')
        const end = offset + bytesRead
        let res: Response
        try {
          res = await fetch(session, {
            method: 'PUT',
            headers: { 'Content-Length': String(bytesRead), 'Content-Range': size === 0 ? 'bytes */0' : `bytes ${offset}-${end - 1}/${size}` },
            body: buffer.subarray(0, bytesRead), signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)])
          })
          if (res.status === 429 || res.status >= 500) {
            await res.body?.cancel()
            throw new Error('Google temporarily interrupted this upload.')
          }
        } catch (error) {
          signal.throwIfAborted()
          if (++failures > 4) throw error
          await delay(500 * 2 ** (failures - 1), undefined, { signal })
          // The last chunk may have arrived. Ask Google before retransmitting it.
          res = await fetch(session, { method: 'PUT', headers: { 'Content-Length': '0', 'Content-Range': `bytes */${size}` },
            signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) })
        }
        if (res.status === 308) {
          const range = res.headers.get('range')?.match(/^bytes=0-(\d+)$/)
          const next = range ? Number(range[1]) + 1 : 0
          await res.body?.cancel()
          if (!Number.isSafeInteger(next) || next < 0 || next > size || (size > 0 && next > end)) throw new Error('Google returned an invalid upload position.')
          if (next <= offset && ++failures > 4) throw new Error('The upload stopped making progress. Try again.')
          if (next > offset) failures = 0
          offset = next
          onProgress(offset)
          continue
        }
        if (res.status === 404 || res.status === 410) throw new Error('This upload session expired. Start the upload again.')
        if (!res.ok) throw new Error(await describeError(res))
        const uploaded = await res.json() as RawFile
        if (!uploaded.id || (uploaded.size !== undefined && Number(uploaded.size) !== size)) throw new Error('Google did not confirm the complete file. Refresh Drive before retrying.')
        onProgress(size)
        return this.toFile(uploaded)
      }
    } finally {
      await handle.close()
    }
  }

  async download(id: string, destPath: string, onProgress: ProgressFn, signal: AbortSignal): Promise<void> {
    const file = await this.request<RawFile>(`${API}/files/${id}?fields=id,mimeType,size,md5Checksum`, { signal })
    const exp = EXPORTS[file.mimeType]
    if (file.mimeType.startsWith('application/vnd.google-apps.') && !exp) throw new Error('This Google file type cannot be downloaded here. Open it in Google Drive.')
    const url = exp ? `${API}/files/${id}/export?mimeType=${encodeURIComponent(exp.mime)}` : `${API}/files/${id}?alt=media`
    const res = await this.raw(url, { signal })
    if (!res.body) throw new Error('Google returned an empty download.')
    let done = 0
    const checksum = createHash('md5')
    const output = createWriteStream(destPath, { flags: 'wx' })
    let created = false
    output.once('open', () => { created = true })
    try {
      await pipeline(
      Readable.fromWeb(res.body as unknown as WebReadableStream),
      new Transform({
        transform(chunk: Buffer, _enc, cb) {
          done += chunk.length
          checksum.update(chunk)
          onProgress(done)
          cb(null, chunk)
        }
      }),
      output,
      { signal }
      )
      if ((!exp && file.size !== undefined && done !== Number(file.size)) ||
          (!exp && file.md5Checksum && checksum.digest('hex') !== file.md5Checksum)) throw new Error('The downloaded file was incomplete. Try downloading it again.')
    } catch (error) {
      if (created) await rm(destPath, { force: true }).catch(() => undefined)
      throw error
    }
  }

  /** File extension to append when a Google-native doc is exported. */
  static exportExtension(mimeType: string): string | null {
    return EXPORTS[mimeType]?.ext ?? null
  }

  async signOut(): Promise<void> {
    this.clearCache()
    await this.auth.signOut()
  }
}

async function isRetryable(res: Response): Promise<boolean> {
  if (res.status !== 403) return true
  const text = await res.clone().text()
  return /rateLimitExceeded|userRateLimitExceeded/.test(text)
}

async function describeError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string; errors?: Array<{ reason?: string }> } }
    const reasons = body.error?.errors?.map((e) => e.reason) ?? []
    if (reasons.includes('accessNotConfigured')) return 'Enable Google Drive API in your Google Cloud project, then try again.'
    if (reasons.includes('exportSizeLimitExceeded')) return 'This Google document exceeds the export limit. Download it from Google Drive in your browser.'
    if (reasons.includes('insufficientPermissions')) return 'Google Drive access is missing. Reconnect and grant Drive access.'
    if (body.error?.message) return body.error.message
  } catch {
    /* fall through */
  }
  return `Google Drive returned ${res.status}.`
}
