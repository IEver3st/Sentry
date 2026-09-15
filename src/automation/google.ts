import { createServer } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export interface GoogleCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType: "Bearer";
  scope?: string;
}
export interface GoogleOptions {
  clientId: string;
  /** Desktop client configuration is public, never a confidential application secret. */
  clientSecret?: string;
  load: () => Promise<GoogleCredentials | null>;
  save: (credentials: GoogleCredentials | null) => Promise<void>;
  onAuthorize: (url: string) => Promise<void>;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}
const tokenSchema = z.object({
  access_token: z.string().min(1).max(16384),
  expires_in: z.number().positive().max(86400),
  token_type: z.literal("Bearer"),
  refresh_token: z.string().min(1).max(16384).optional(),
  scope: z.string().max(4000).optional(),
});
export const googleCredentialSchema = z.object({
  accessToken: z.string().min(1).max(16384),
  refreshToken: z.string().min(1).max(16384),
  expiresAt: z.number().finite(),
  tokenType: z.literal("Bearer"),
  scope: z.string().max(4000).optional(),
});
const scope = "https://www.googleapis.com/auth/drive";

async function providerJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Google returned an empty response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 256_000) {
      await reader.cancel();
      throw new Error("Google returned an oversized response.");
    }
    chunks.push(chunk.value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new Error("Google returned an invalid response.");
  }
}

export class GoogleDriveAuth {
  private refreshing?: Promise<GoogleCredentials>;
  private connecting = false;
  private generation = 0;
  private connectionController?: AbortController;
  constructor(private readonly options: GoogleOptions) {}

  get configured(): boolean {
    return /^[a-zA-Z0-9._-]+\.apps\.googleusercontent\.com$/.test(
      this.options.clientId,
    );
  }

  async connected(): Promise<boolean> {
    return googleCredentialSchema.safeParse(await this.options.load()).success;
  }

  private async token(
    body: URLSearchParams,
    signal?: AbortSignal,
  ): Promise<z.infer<typeof tokenSchema>> {
    body.set("client_id", this.options.clientId);
    if (this.options.clientSecret)
      body.set("client_secret", this.options.clientSecret);
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(
        "https://oauth2.googleapis.com/token",
        {
          method: "POST",
          body,
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
            : AbortSignal.timeout(20_000),
        },
      );
    } catch {
      throw new Error(
        signal?.aborted
          ? "Google connection cancelled."
          : "Google could not be reached. Check your connection and retry.",
      );
    }
    if (!response.ok)
      throw new Error(
        response.status === 400 || response.status === 401
          ? "Google authorization expired or was rejected. Reconnect Google Drive."
          : `Google authorization is unavailable (HTTP ${response.status}).`,
      );
    const parsed = tokenSchema.safeParse(await providerJson(response));
    if (!parsed.success)
      throw new Error("Google returned an invalid authorization response.");
    return parsed.data;
  }

  async connect(signal?: AbortSignal): Promise<void> {
    if (!this.configured)
      throw new Error(
        "Google Drive needs a configured Desktop OAuth client ID. See docs/automation.md.",
      );
    if (this.connecting)
      throw new Error("Google connection is already in progress.");
    signal?.throwIfAborted();
    this.connecting = true;
    const generation = this.generation;
    this.connectionController = new AbortController();
    signal = signal
      ? AbortSignal.any([signal, this.connectionController.signal])
      : this.connectionController.signal;
    try {
      const verifier = randomBytes(48).toString("base64url");
      const state = randomBytes(32).toString("base64url");
      const authorization = await new Promise<{
        code: string;
        redirect: string;
      }>((resolve, reject) => {
        let finished = false;
        let redirect = "";
        const finish = (error?: Error, code?: string) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          server.close();
          server.closeIdleConnections();
          if (error) server.closeAllConnections();
          if (error) reject(error);
          else if (code) resolve({ code, redirect });
        };
        const abort = () => finish(new Error("Google connection cancelled."));
        const server = createServer((request, response) => {
          response.setHeader("Content-Type", "text/plain; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.setHeader("Referrer-Policy", "no-referrer");
          response.setHeader(
            "Content-Security-Policy",
            "default-src 'none'; frame-ancestors 'none'",
          );
          const url = new URL(request.url ?? "/", "http://127.0.0.1");
          if (
            request.method !== "GET" ||
            url.pathname !== "/" ||
            request.headers.host !== new URL(redirect).host
          ) {
            response.writeHead(404).end("Not found");
            return;
          }
          const received = Buffer.from(url.searchParams.get("state") ?? "");
          const expected = Buffer.from(state);
          if (
            received.length !== expected.length ||
            !timingSafeEqual(received, expected)
          ) {
            response
              .writeHead(400)
              .end(
                "Invalid authorization state. Return to Sentry and reconnect.",
              );
            return;
          }
          if (url.searchParams.has("error")) {
            response.end("Connection was declined. Return to Sentry.");
            finish(new Error("Google connection was declined."));
            return;
          }
          const code = url.searchParams.get("code");
          if (!code || code.length > 8192) {
            response.writeHead(400).end("Missing authorization code.");
            return;
          }
          response.end(
            "Authorization received. You can close this tab and return to Sentry.",
          );
          finish(undefined, code);
        });
        server.requestTimeout = 10_000;
        server.headersTimeout = 10_000;
        server.on("error", () =>
          finish(
            new Error(
              "Sentry could not open the local Google authorization callback.",
            ),
          ),
        );
        const timer = setTimeout(
          () =>
            finish(
              new Error("Google connection timed out. Reconnect to try again."),
            ),
          this.options.timeoutMs ?? 180_000,
        );
        signal?.addEventListener("abort", abort, { once: true });
        server.listen(0, "127.0.0.1", () => {
          if (finished) {
            server.close();
            return;
          }
          const address = server.address();
          if (!address || typeof address === "string") {
            finish(
              new Error("Could not allocate an authorization callback port."),
            );
            return;
          }
          redirect = `http://127.0.0.1:${address.port}/`;
          const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
          url.search = new URLSearchParams({
            client_id: this.options.clientId,
            redirect_uri: redirect,
            response_type: "code",
            scope,
            state,
            code_challenge: createHash("sha256")
              .update(verifier)
              .digest("base64url"),
            code_challenge_method: "S256",
            access_type: "offline",
            prompt: "consent",
          }).toString();
          void this.options
            .onAuthorize(url.toString())
            .catch(() =>
              finish(
                new Error(
                  "Could not open Google authorization in your browser.",
                ),
              ),
            );
        });
      });
      const token = await this.token(
        new URLSearchParams({
          code: authorization.code,
          code_verifier: verifier,
          redirect_uri: authorization.redirect,
          grant_type: "authorization_code",
        }),
        signal,
      );
      if (!token.refresh_token)
        throw new Error(
          "Google did not grant offline access. Reconnect and approve access.",
        );
      if (token.scope && !token.scope.split(" ").includes(scope))
        throw new Error(
          "Google Drive permission was not granted. Reconnect and approve Drive access.",
        );
      if (generation !== this.generation)
        throw new Error("Google connection cancelled.");
      await this.options.save({
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: Date.now() + token.expires_in * 1000,
        tokenType: "Bearer",
        scope: token.scope,
      });
    } finally {
      this.connecting = false;
      this.connectionController = undefined;
    }
  }

  async refresh(
    signal?: AbortSignal,
    force = false,
  ): Promise<GoogleCredentials> {
    if (this.refreshing) return this.refreshing;
    const generation = this.generation;
    this.refreshing = (async () => {
      const parsed = googleCredentialSchema.safeParse(
        await this.options.load(),
      );
      if (!parsed.success) throw new Error("Connect Google Drive to continue.");
      const current = parsed.data;
      if (!force && current.expiresAt > Date.now() + 120_000) return current;
      const token = await this.token(
        new URLSearchParams({
          refresh_token: current.refreshToken,
          grant_type: "refresh_token",
        }),
        signal,
      );
      const updated: GoogleCredentials = {
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? current.refreshToken,
        expiresAt: Date.now() + token.expires_in * 1000,
        tokenType: "Bearer",
        scope: token.scope ?? current.scope,
      };
      if (generation !== this.generation)
        throw new Error("Google Drive was disconnected.");
      await this.options.save(updated);
      return updated;
    })();
    try {
      return await this.refreshing;
    } finally {
      this.refreshing = undefined;
    }
  }

  async quota(signal?: AbortSignal): Promise<{ used: number; limit?: number }> {
    let credentials = await this.refresh(signal);
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await (this.options.fetch ?? fetch)(
        "https://www.googleapis.com/drive/v3/about?fields=storageQuota",
        {
          headers: { Authorization: `Bearer ${credentials.accessToken}` },
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
            : AbortSignal.timeout(20_000),
        },
      );
      if (response.status === 401 && attempt === 0) {
        credentials = await this.refresh(signal, true);
        continue;
      }
      if (!response.ok)
        throw new Error(
          `Google Drive quota is unavailable (HTTP ${response.status}).${response.status === 401 ? " Reconnect Google Drive." : ""}`,
        );
      const parsed = z
        .object({
          storageQuota: z.object({
            usage: z.string().regex(/^\d+$/),
            limit: z.string().regex(/^\d+$/).optional(),
          }),
        })
        .safeParse(await providerJson(response));
      if (!parsed.success)
        throw new Error("Google Drive returned invalid quota information.");
      return {
        used: Number(parsed.data.storageQuota.usage),
        ...(parsed.data.storageQuota.limit
          ? { limit: Number(parsed.data.storageQuota.limit) }
          : {}),
      };
    }
    throw new Error("Reconnect Google Drive.");
  }

  async environment(
    rootFolderId?: string,
    signal?: AbortSignal,
  ): Promise<NodeJS.ProcessEnv> {
    const credentials = await this.refresh(signal);
    if (rootFolderId && !/^[a-zA-Z0-9_-]{1,256}$/.test(rootFolderId))
      throw new Error("Invalid Google Drive folder ID.");
    return {
      RCLONE_CONFIG_SENTRY_TYPE: "drive",
      RCLONE_CONFIG_SENTRY_CLIENT_ID: this.options.clientId,
      ...(this.options.clientSecret
        ? { RCLONE_CONFIG_SENTRY_CLIENT_SECRET: this.options.clientSecret }
        : {}),
      RCLONE_CONFIG_SENTRY_SCOPE: "drive",
      RCLONE_CONFIG_SENTRY_TOKEN: JSON.stringify({
        access_token: credentials.accessToken,
        refresh_token: credentials.refreshToken,
        token_type: credentials.tokenType,
        expiry: new Date(credentials.expiresAt).toISOString(),
      }),
      ...(rootFolderId
        ? { RCLONE_CONFIG_SENTRY_ROOT_FOLDER_ID: rootFolderId }
        : {}),
    };
  }

  /** Removes local credentials. Revoke app access in Google Account to disconnect all installs. */
  async disconnect(): Promise<void> {
    this.generation++;
    this.connectionController?.abort();
    await this.options.save(null);
  }
}
