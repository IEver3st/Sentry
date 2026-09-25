import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { mkdtemp, readFile, writeFile, rm, access, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const realFetch = globalThis.fetch
let browserUrl: string | null = null
let encryptionAvailable = true
const encrypt = (text: string): Buffer => Buffer.from(`test-encrypted:${Buffer.from(text).toString('base64')}`)
const decrypt = (data: Buffer): string => {
  if (!data.toString().startsWith('test-encrypted:')) throw new Error('Not encrypted')
  return Buffer.from(data.toString().slice(15), 'base64').toString()
}
mock.module('electron', () => ({
  app: { isPackaged: true, getVersion: () => '0.1.0' },
  safeStorage: { isEncryptionAvailable: () => encryptionAvailable, encryptString: encrypt, decryptString: decrypt },
  shell: { openExternal: async (url: string) => { browserUrl = url } }
}))
const { GoogleAuth, GoogleSessionExpired, GOOGLE_SCOPES } = await import('../src/main/providers/google-auth')
const { GoogleProvider } = await import('../src/main/providers/google')
const { parseGoogleClient } = await import('../src/main/providers/google-client')
const { TransferQueue } = await import('../src/main/transfers')

const clientId = '123-test.apps.googleusercontent.com'
const client = { clientId, clientSecret: 'test-client-secret' }
const token = { access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600, scope: GOOGLE_SCOPES.join(' ') }
const rawFile = { id: 'file-1', name: 'file.txt', mimeType: 'text/plain', size: '4', parents: ['root-id'], modifiedTime: '2026-09-25T00:00:00Z', createdTime: '2026-09-25T00:00:00Z' }
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
let dir: string
const sessions: InstanceType<typeof GoogleAuth>[] = []
const envId = process.env.SENTRY_GOOGLE_CLIENT_ID
const envSecret = process.env.SENTRY_GOOGLE_CLIENT_SECRET

beforeEach(async () => {
  delete process.env.SENTRY_GOOGLE_CLIENT_ID
  delete process.env.SENTRY_GOOGLE_CLIENT_SECRET
  browserUrl = null
  encryptionAvailable = true
  dir = await mkdtemp(join(tmpdir(), 'sentry-google-test-'))
  await writeFile(join(dir, 'google-client.json'), JSON.stringify(client))
})
afterEach(async () => {
  for (const auth of sessions.splice(0)) auth.cancelSignIn()
  globalThis.fetch = realFetch
  await rm(dir, { recursive: true, force: true })
  if (envId === undefined) delete process.env.SENTRY_GOOGLE_CLIENT_ID
  else process.env.SENTRY_GOOGLE_CLIENT_ID = envId
  if (envSecret === undefined) delete process.env.SENTRY_GOOGLE_CLIENT_SECRET
  else process.env.SENTRY_GOOGLE_CLIENT_SECRET = envSecret
})

function authSession() {
  const auth = new GoogleAuth(dir)
  sessions.push(auth)
  return auth
}
async function opened(): Promise<URL> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (browserUrl) return new URL(browserUrl)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('System-browser callback was not opened')
}
function callback(url: URL, state = url.searchParams.get('state')!): string {
  const out = new URL(url.searchParams.get('redirect_uri')!)
  out.search = new URLSearchParams({ state, code: 'test-code' }).toString()
  return out.toString()
}
function provider() {
  return new GoogleProvider({ accessToken: async () => 'test-access' } as InstanceType<typeof GoogleAuth>)
}
async function seedExpired(): Promise<void> {
  await writeFile(join(dir, 'google-token.bin'), encrypt(JSON.stringify({ access_token: 'old', refresh_token: 'test-refresh', expires_at: 0, client_id: clientId })))
}

test('imports downloaded Desktop JSON; rejects Web clients and preserves valid credentials on failure', async () => {
  const downloaded = { installed: { client_id: clientId, client_secret: client.clientSecret, project_id: 'test-project' } }
  expect(parseGoogleClient(downloaded)).toEqual(client)
  expect(() => parseGoogleClient({ web: downloaded.installed })).toThrow('Web client')
  const path = join(dir, 'downloaded.json')
  await writeFile(path, JSON.stringify(downloaded))
  const auth = authSession()
  await auth.importClient(path)
  expect(await auth.config()).toEqual(client)
  await writeFile(path, '{"installed":{}}')
  await expect(auth.importClient(path)).rejects.toThrow()
  expect(await auth.config()).toEqual(client)
})

test('loopback validates state, exchanges PKCE, saves encrypted tokens, and restores a session', async () => {
  globalThis.fetch = (async (input, init) => {
    if (String(input) !== 'https://oauth2.googleapis.com/token') throw new Error('Unexpected external request')
    const body = new URLSearchParams(init?.body as string)
    const authorization = new URL(browserUrl!)
    expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(authorization.searchParams.get('code_challenge'))
    expect(body.get('redirect_uri')).toBe(authorization.searchParams.get('redirect_uri'))
    return json(token)
  }) as typeof fetch
  const auth = authSession()
  const pending = auth.signIn()
  expect(auth.signIn()).toBe(pending)
  const url = await opened()
  expect(new URL(url.searchParams.get('redirect_uri')!).hostname).toBe('127.0.0.1')
  expect((await realFetch(callback(url, 'incorrect-state'))).status).toBe(400)
  const reply = await realFetch(callback(url))
  expect(reply.status).toBe(200)
  await pending
  const saved = await readFile(join(dir, 'google-token.bin'))
  expect(saved.toString()).not.toContain('test-refresh')
  expect(JSON.parse(decrypt(saved)).client_id).toBe(clientId)
  expect(await authSession().accessToken()).toBe('test-access')
})

test('cancelling sign-in closes the pending flow and permits another attempt', async () => {
  const auth = authSession()
  const first = auth.signIn()
  const result = first.then(() => null, (error: Error) => error)
  await opened()
  auth.cancelSignIn()
  expect((await result)?.message).toContain('cancelled')
  browserUrl = null
  const second = auth.signIn()
  const nextResult = second.then(() => null, (error: Error) => error)
  await opened()
  auth.cancelSignIn()
  expect((await nextResult)?.message).toContain('cancelled')
})

test('refuses plaintext fallback and does not open a browser when encryption is unavailable', async () => {
  encryptionAvailable = false
  await expect(authSession().signIn()).rejects.toThrow('encrypt')
  expect(browserUrl).toBeNull()
  await expect(access(join(dir, 'google-token.bin'))).rejects.toThrow()
})

test('partial Drive consent never persists tokens or reports success', async () => {
  globalThis.fetch = (async () => json({ ...token, scope: 'openid email' })) as typeof fetch
  const pending = authSession().signIn()
  const rejected = pending.then(() => null, (error: Error) => error)
  const reply = await realFetch(callback(await opened()))
  expect(reply.status).toBe(400)
  expect((await rejected)?.message).toContain('Drive access was not granted')
  await expect(access(join(dir, 'google-token.bin'))).rejects.toThrow()
})

test('concurrent expired-token requests share one refresh; invalid grants remain actionable', async () => {
  await seedExpired()
  let calls = 0
  globalThis.fetch = (async () => { calls++; await new Promise((resolve) => setTimeout(resolve, 10)); return json(token) }) as typeof fetch
  const auth = authSession()
  expect(await Promise.all([auth.accessToken(), auth.accessToken(), auth.accessToken()])).toEqual(['test-access', 'test-access', 'test-access'])
  expect(calls).toBe(1)
  await seedExpired()
  globalThis.fetch = (async () => json({ error: 'invalid_grant' }, 400)) as typeof fetch
  await expect(authSession().accessToken()).rejects.toBeInstanceOf(GoogleSessionExpired)
})

test('transient token failures preserve the previous session and mismatched clients cannot reuse it', async () => {
  await seedExpired()
  const before = await readFile(join(dir, 'google-token.bin'))
  globalThis.fetch = (async () => json({ error: 'temporarily_unavailable' }, 503)) as typeof fetch
  await expect(authSession().accessToken()).rejects.toThrow('temporarily unavailable')
  expect(await readFile(join(dir, 'google-token.bin'))).toEqual(before)
  await writeFile(join(dir, 'google-client.json'), JSON.stringify({ ...client, clientId: '456-other.apps.googleusercontent.com' }))
  expect(await authSession().hasSession()).toBe(false)
})

test('Drive listing paginates and resolves the root only once for parallel file conversion', async () => {
  let rootReads = 0
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/files/root')) { rootReads++; return json({ id: 'root-id' }) }
    return url.searchParams.has('pageToken') ? json({ files: [{ ...rawFile, id: 'second' }] }) : json({ files: [rawFile], nextPageToken: 'page-2' })
  }) as typeof fetch
  const files = await provider().search('file')
  expect(files.map(f => f.id)).toEqual(['file-1', 'second'])
  expect(files.every(f => f.parentId === null)).toBe(true)
  expect(rootReads).toBe(1)
})

test('removing a public link paginates and uses the returned permission ID', async () => {
  const deletes: string[] = []
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input))
    if (init?.method === 'DELETE') { deletes.push(url.pathname); return new Response(null, { status: 204 }) }
    if (url.pathname.endsWith('/permissions')) return url.searchParams.has('pageToken')
      ? json({ permissions: [{ id: 'actual-public-id', type: 'anyone' }] })
      : json({ permissions: [{ id: 'owner-id', type: 'user' }], nextPageToken: 'page-2' })
    if (url.pathname.endsWith('/root')) return json({ id: 'root-id' })
    return json(rawFile)
  }) as typeof fetch
  await provider().setLink('file-1', null)
  expect(deletes).toEqual(['/drive/v3/files/file-1/permissions/actual-public-id'])
})

test('interrupted final upload probes its session without creating a duplicate file', async () => {
  const source = join(dir, 'source.txt')
  await writeFile(source, 'data')
  const ranges: string[] = []
  let creations = 0
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/files/root')) return json({ id: 'root-id' })
    if (init?.method === 'POST') { creations++; return new Response(null, { status: 200, headers: { location: 'https://www.googleapis.com/upload/session-test' } }) }
    const range = new Headers(init?.headers).get('Content-Range')!
    ranges.push(range)
    if (ranges.length === 1) throw new TypeError('Connection dropped after Google received the file')
    return json(rawFile)
  }) as typeof fetch
  const file = await provider().upload(source, null, 'source.txt', () => undefined, new AbortController().signal)
  expect(file.id).toBe('file-1')
  expect(creations).toBe(1)
  expect(ranges).toEqual(['bytes 0-3/4', 'bytes */4'])
})

test('308 without Range retries from zero; zero-byte files complete without looping', async () => {
  const source = join(dir, 'source.txt')
  await writeFile(source, 'data')
  let puts = 0
  const ranges: string[] = []
  globalThis.fetch = (async (input, init) => {
    if (String(input).includes('/files/root')) return json({ id: 'root-id' })
    if (init?.method === 'POST') return new Response(null, { headers: { location: 'https://www.googleapis.com/upload/session-test' } })
    const range = new Headers(init?.headers).get('Content-Range')!
    ranges.push(range)
    if (++puts === 1) return new Response(null, { status: 308 })
    return json({ ...rawFile, size: range === 'bytes */0' ? '0' : '4' })
  }) as typeof fetch
  await provider().upload(source, null, 'source.txt', () => undefined, new AbortController().signal)
  expect(ranges).toEqual(['bytes 0-3/4', 'bytes 0-3/4'])
  await writeFile(source, '')
  await provider().upload(source, null, 'empty.txt', () => undefined, new AbortController().signal)
  expect(ranges.at(-1)).toBe('bytes */0')
})

test('downloads preserve existing files and remove their own incomplete output', async () => {
  const destination = join(dir, 'existing.txt')
  await writeFile(destination, 'keep this')
  globalThis.fetch = (async (input) => String(input).includes('alt=media') ? new Response('bad') : json(rawFile)) as typeof fetch
  await expect(provider().download('file-1', destination, () => undefined, new AbortController().signal)).rejects.toThrow()
  expect(await readFile(destination, 'utf8')).toBe('keep this')
  const partial = join(dir, 'partial.txt')
  await expect(provider().download('file-1', partial, () => undefined, new AbortController().signal)).rejects.toThrow('incomplete')
  await expect(access(partial)).rejects.toThrow()
})

test('downloads verify content against the Google checksum', async () => {
  const destination = join(dir, 'verified.txt')
  globalThis.fetch = (async (input) => String(input).includes('alt=media') ? new Response('data') : json({ ...rawFile, md5Checksum: createHash('md5').update('data').digest('hex') })) as typeof fetch
  await provider().download('file-1', destination, () => undefined, new AbortController().signal)
  expect(await readFile(destination, 'utf8')).toBe('data')
})

test('folder preparation keeps the queue busy before the first upload is enqueued', async () => {
  const folder = join(dir, 'empty-folder')
  await mkdir(folder)
  let release!: () => void
  const blocked = new Promise<void>((resolve) => { release = resolve })
  const fake = { createFolder: async () => { await blocked; return { id: 'new-folder' } } }
  const queue = new TransferQueue(() => fake as never, () => undefined, () => undefined, () => 3)
  const pending = queue.upload([folder], null)
  expect(queue.isBusy()).toBe(true)
  release()
  await pending
  expect(queue.isBusy()).toBe(false)
})
