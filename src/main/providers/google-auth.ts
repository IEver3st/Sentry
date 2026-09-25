import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { safeStorage, shell } from 'electron'
import { parseGoogleClient, type GoogleClientConfig } from './google-client'

// Installed-app OAuth: https://developers.google.com/identity/protocols/oauth2/native-app
// Full Drive scope is needed to manage existing files. Keep personal clients in Testing.
export const GOOGLE_SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive']
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const REQUEST_TIMEOUT = 30_000

interface TokenSet {
  access_token: string
  refresh_token?: string
  expires_at: number
  client_id: string
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
}

export class GoogleSessionExpired extends Error {
  constructor() {
    super('Your Google session expired or access was revoked. Connect Google again.')
  }
}

export class GoogleAuth {
  private tokens: TokenSet | null = null
  private refreshing: Promise<string> | null = null
  private signingIn: Promise<void> | null = null
  private signInController: AbortController | null = null
  private tokenWrite: Promise<void> = Promise.resolve()

  constructor(private readonly userData: string) {}

  private get tokenPath(): string { return join(this.userData, 'google-token.bin') }

  async config(): Promise<GoogleClientConfig | null> {
    const envId = process.env.SENTRY_GOOGLE_CLIENT_ID
    const envSecret = process.env.SENTRY_GOOGLE_CLIENT_SECRET
    try {
      if (envId || envSecret) return parseGoogleClient({ clientId: envId, clientSecret: envSecret })
      return parseGoogleClient(JSON.parse(await readFile(join(this.userData, 'google-client.json'), 'utf8')))
    } catch {
      return null
    }
  }

  async importClient(path: string): Promise<void> {
    if (this.signingIn || this.refreshing) throw new Error('Wait for the current Google connection to finish.')
    if (process.env.SENTRY_GOOGLE_CLIENT_ID || process.env.SENTRY_GOOGLE_CLIENT_SECRET) {
      throw new Error('Google credentials are set by environment variables. Remove those before importing another client.')
    }
    const client = parseGoogleClient(JSON.parse(await readFile(path, 'utf8')))
    await mkdir(this.userData, { recursive: true })
    const target = join(this.userData, 'google-client.json')
    await writeFile(`${target}.tmp`, JSON.stringify(client, null, 2), { mode: 0o600 })
    await rename(`${target}.tmp`, target)
    this.tokens = null
  }

  async hasSession(): Promise<boolean> { return (await this.loadTokens()) !== null }

  private async loadTokens(): Promise<TokenSet | null> {
    const client = await this.config()
    if (!client || !safeStorage.isEncryptionAvailable()) return null
    if (this.tokens?.client_id === client.clientId) return this.tokens
    try {
      const raw = JSON.parse(safeStorage.decryptString(await readFile(this.tokenPath))) as TokenSet
      if (typeof raw.access_token !== 'string' || !raw.access_token || !Number.isFinite(raw.expires_at) ||
          raw.client_id !== client.clientId || (raw.refresh_token !== undefined && typeof raw.refresh_token !== 'string')) return null
      this.tokens = raw
    } catch {
      this.tokens = null
    }
    return this.tokens
  }

  private saveTokens(tokens: TokenSet): Promise<void> {
    this.tokenWrite = this.tokenWrite.catch(() => undefined).then(async () => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows could not encrypt your Google sign-in. Restart Sentry and try again.')
      await mkdir(this.userData, { recursive: true })
      const tmp = `${this.tokenPath}.tmp`
      await writeFile(tmp, safeStorage.encryptString(JSON.stringify(tokens)), { mode: 0o600 })
      await rename(tmp, this.tokenPath)
      this.tokens = tokens
    })
    return this.tokenWrite
  }

  signIn(): Promise<void> {
    if (!this.signingIn) {
      const controller = new AbortController()
      this.signInController = controller
      this.signingIn = this.authorize(controller.signal).finally(() => {
        this.signingIn = null
        this.signInController = null
      })
    }
    return this.signingIn
  }

  cancelSignIn(): void { this.signInController?.abort(new Error('Sign-in was cancelled.')) }

  private async authorize(signal: AbortSignal): Promise<void> {
    const client = await this.config()
    if (!client) throw new Error('Import your Google Desktop app client JSON to connect Drive.')
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows could not encrypt your Google sign-in. Restart Sentry and try again.')
    signal.throwIfAborted()
    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const state = randomBytes(32).toString('base64url')

    await new Promise<void>((resolve, reject) => {
      let redirectUri = ''
      let settled = false
      let exchanging = false
      const finish = (error?: unknown): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        server.close()
        if (error) reject(error)
        else resolve()
      }
      const abort = (): void => finish(signal.reason ?? new Error('Sign-in was cancelled.'))
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
        if (req.method !== 'GET' || url.pathname !== '/callback') { res.writeHead(404).end(); return }
        if (url.searchParams.get('state') !== state || req.headers.host !== new URL(redirectUri).host) {
          res.writeHead(400, headers).end(callbackPage(false))
          return // A stray local request must not cancel the real sign-in.
        }
        if (exchanging || settled) { res.writeHead(409).end(); return }
        const code = url.searchParams.get('code')
        if (url.searchParams.has('error') || !code) {
          res.writeHead(400, headers).end(callbackPage(false))
          finish(new Error(url.searchParams.get('error') === 'access_denied' ? 'Sign-in was cancelled.' : 'Google sign-in failed. Try again.'))
          return
        }
        exchanging = true
        void this.exchange(client, code, redirectUri, verifier, signal).then(() => {
          res.writeHead(200, headers).end(callbackPage(true))
          finish()
        }, (error: unknown) => {
          res.writeHead(400, headers).end(callbackPage(false))
          finish(error)
        })
      })
      const timer = setTimeout(() => {
        this.signInController?.abort(new Error('Sign-in timed out. Connect Google again when you are ready.'))
      }, 5 * 60_000)
      signal.addEventListener('abort', abort, { once: true })
      server.on('error', () => finish(new Error('Sentry could not open its local Google sign-in callback. Try again.')))
      server.listen(0, '127.0.0.1', () => {
        if (signal.aborted || settled) { server.close(); return }
        redirectUri = `http://127.0.0.1:${(server.address() as { port: number }).port}/callback`
        const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
        url.search = new URLSearchParams({
          client_id: client.clientId, redirect_uri: redirectUri, response_type: 'code',
          scope: GOOGLE_SCOPES.join(' '), code_challenge: challenge, code_challenge_method: 'S256',
          state, access_type: 'offline', prompt: 'consent'
        }).toString()
        void shell.openExternal(url.toString()).catch(() => finish(new Error('Sentry could not open your browser. Try connecting again.')))
      })
    })
  }

  private async tokenRequest(params: Record<string, string>, signal?: AbortSignal): Promise<TokenResponse> {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT)]) : AbortSignal.timeout(REQUEST_TIMEOUT)
    })
    const body = await res.json() as TokenResponse
    if (!res.ok) {
      if (body.error === 'invalid_grant') throw new GoogleSessionExpired()
      if (body.error === 'invalid_client' || body.error === 'unauthorized_client') throw new Error('Google rejected this client. Import a current Desktop app client JSON.')
      if (res.status === 429 || res.status >= 500) throw new Error('Google is temporarily unavailable. Try again shortly.')
      throw new Error(`Google could not complete sign-in (${res.status}). Try connecting again.`)
    }
    if (typeof body.access_token !== 'string' || !body.access_token || typeof body.expires_in !== 'number' || !Number.isFinite(body.expires_in) || body.expires_in <= 0) throw new Error('Google returned an incomplete sign-in response.')
    return body
  }

  private async exchange(client: GoogleClientConfig, code: string, redirectUri: string, verifier: string, signal: AbortSignal): Promise<void> {
    const body = await this.tokenRequest({ code, client_id: client.clientId, client_secret: client.clientSecret,
      redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier }, signal)
    signal.throwIfAborted()
    if (body.scope && !body.scope.split(' ').includes(GOOGLE_SCOPES[3])) throw new Error('Drive access was not granted. Connect again and allow Sentry to access Google Drive.')
    if (typeof body.refresh_token !== 'string' || !body.refresh_token) throw new Error('Google did not grant offline access. Connect again to keep Sentry signed in.')
    await this.saveTokens({ access_token: body.access_token!, refresh_token: body.refresh_token,
      expires_at: Date.now() + body.expires_in! * 1000, client_id: client.clientId })
  }

  async accessToken(force = false): Promise<string> {
    const tokens = await this.loadTokens()
    if (!tokens) throw new GoogleSessionExpired()
    if (!force && tokens.expires_at - Date.now() > 60_000) return tokens.access_token
    if (!tokens.refresh_token) throw new GoogleSessionExpired()
    this.refreshing ??= this.refresh(tokens.refresh_token).finally(() => (this.refreshing = null))
    return this.refreshing
  }

  private async refresh(refreshToken: string): Promise<string> {
    const client = await this.config()
    if (!client) throw new Error('Import your Google Desktop app client JSON to connect Drive.')
    const body = await this.tokenRequest({ client_id: client.clientId, client_secret: client.clientSecret,
      refresh_token: refreshToken, grant_type: 'refresh_token' })
    await this.saveTokens({ access_token: body.access_token!, refresh_token: body.refresh_token ?? refreshToken,
      expires_at: Date.now() + body.expires_in! * 1000, client_id: client.clientId })
    return body.access_token!
  }

  async signOut(): Promise<void> {
    this.cancelSignIn()
    await this.signingIn?.catch(() => undefined)
    await this.refreshing?.catch(() => undefined)
    await this.tokenWrite.catch(() => undefined)
    const tokens = await this.loadTokens()
    if (tokens) {
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: tokens.refresh_token ?? tokens.access_token }),
        signal: AbortSignal.timeout(10_000)
      }).catch(() => undefined)
    }
    this.tokens = null
    await rm(this.tokenPath, { force: true })
  }
}

function callbackPage(ok: boolean): string {
  const msg = ok ? 'Your Google sign-in is saved. Return to Sentry to load your Drive.' : 'Sign-in did not finish. Return to Sentry for details.'
  return `<!doctype html><meta charset="utf-8"><title>Sentry</title><body style="margin:0;height:100vh;display:grid;place-items:center;background:#11131c;color:#e7e9f3;font:500 18px system-ui">${msg}</body>`
}
