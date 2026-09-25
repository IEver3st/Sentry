# Sentry

A desktop home for the Google Drive storage you already pay for. Drop files in, pull them out, share links, and see where your space goes on a Disktree-style storage map covering both Drive and this PC.

Electron + React + TypeScript + Tailwind v4, built with electron-vite and Bun.

## Run

```bash
bun install          # if Electron's binary is missing: node node_modules/electron/install.js
bun run dev          # hot-reloading app
bun run build        # production bundle in out/
bun run typecheck
bun run test:google  # OAuth and Drive regression tests with mocked Google responses
bun run test:performance # hidden event delivery, ongoing transfers, and updater scheduling
bun run test:scan    # run after build; checks worker cleanup, hidden scans, and cancellation
bun run test:window  # run after build; native startup, reopen, navigation, and reload regression checks
bun run capture      # headless end-to-end run: writes screenshots + log to ./capture
bun run capture:background # focused native background checks; output in ./capture/background
```

> If Electron starts as plain Node (`does not provide an export named 'BrowserWindow'`), your shell has
> `ELECTRON_RUN_AS_NODE=1` set. Unset it for the session: `env -u ELECTRON_RUN_AS_NODE bun run dev`.

`bun run capture` uses an offscreen window that is never shown. It walks onboarding, then every page, and
does a real upload → download → share-link round trip against the demo drive. All test data stays inside
`./capture`, with a fresh profile on every run.

### Background resource use

Hidden and minimized windows stop receiving transfer progress and Drive invalidations. Main-process
transfers, completion notifications, and update handling continue. Reopening delivers current transfer
state and merges the pending Drive changes into one refresh. The renderer keeps its existing view state;
closing to the tray does not discard open selections or dialogs. Launching with `--hidden` defers loading
the renderer until the window is opened when Start minimized and Show tray icon are enabled.

Drive reads and automatic maps are deferred while hidden. Automatic map refreshes run only on pages
that display the map, with a trailing refresh if files change during a scan. Local scans explicitly
started by the user continue, but stop emitting progress while hidden. Scan workers exit when finished
or cancelled, and metadata requests are bounded to 48 rather than queued for every entry at once.

`bun run test:scan` uses a temporary 400-file fixture and checks repeated worker exits. An optional
original worker path (`node scripts/check-scan.mjs <original-scan-worker.js>`) compares the same workload.
`bun run capture` also writes `capture/background-check.json`: native Electron IPC checks for a hidden
demo upload, resumed state, SHA-256 download integrity, and scan cancellation. It controls the activity
signal while keeping the native window offscreen; it does not operate the real tray or establish
whole-app CPU/RAM savings or live Google transfer performance.

## How it fits together

```
src/shared/          types.ts (the whole IPC contract), kinds.ts (mime/extension → kind/category)
src/main/            index.ts        window, settings, provider switching, IPC handlers
                     providers/      DriveProvider interface + demo.ts + google.ts + google-auth.ts
                     transfers.ts    upload/download queue (3 concurrent, progress events, no-overwrite naming)
                     map.ts          Drive storage map + suggestions; runs the local scan worker
                     scan-worker.ts  walks a local folder off-thread, flags caches/build output as clearable
                     capture.ts      headless verification harness (--capture)
src/preload/         contextBridge → window.sentry (typed as SentryApi)
src/renderer/src/    App.tsx shell, pages/ (Onboarding, Home, Files = My Drive map+list, Map = This PC, Shared,
                     Transfers, Settings = full-screen takeover),
                     components/ (Treemap, ShareDialog, DropZone, Sidebar, ...), lib/store.ts (zustand)
```

The renderer only ever talks to `window.sentry`. Everything provider-specific sits behind `DriveProvider`
in `src/main/providers/types.ts`. Switching from demo to Google needs no UI changes.

### Demo drive
`providers/demo.ts` stores an index plus real blobs under `<userData>/demo-drive`. On first run it seeds a sample
library. Sample entries have metadata only: they're flagged `sample: true`, and the UI disables "Pull" for
them. Anything you upload is stored for real and can be pulled back down, shared, renamed, or trashed.

## Connect Google Drive

Sentry uses the Drive v3 REST API and Desktop app OAuth. On September 25, 2026, this PC completed
Google sign-in, saved an encrypted session with offline refresh access, and displayed existing Drive
file metadata in the desktop app. Live upload/download integrity, refresh after expiry, and permission
changes have not yet been verified; their automated coverage uses mocked Google responses.

1. Select your Google Cloud project and enable the **Google Drive API**. This PC uses `autobackups-460205` (AutoBackups).
2. Set up the OAuth consent screen and add yourself as a test user.
3. Create or reuse an OAuth client of type **Desktop app** and save its client JSON when Google makes it available.
4. In onboarding or **Settings → Drive & account**, choose **Import Google client JSON**. Sentry accepts Google's
   downloaded `installed` format and saves the configuration in `%APPDATA%/Sentry/google-client.json`.
5. Choose **Continue with Google** in onboarding, or **Connect Google Drive** from the demo's account settings.
   Finish consent in your browser. Switching directly from demo preserves its local files.

Environment variables `SENTRY_GOOGLE_CLIENT_ID` and `SENTRY_GOOGLE_CLIENT_SECRET` are also supported and take
precedence over the imported file. The local file can alternatively contain `{ "clientId": "...", "clientSecret": "..." }`.
Web application clients are rejected. Keep client JSON and tokens out of the repository.

What to verify once connected, in `providers/google.ts` / `google-auth.ts`:
- **Sign-in:** loopback redirect on `127.0.0.1:<random port>/callback` with PKCE. Tokens are encrypted with
  `safeStorage` in `<userData>/google-token.bin`, and refresh happens automatically. Sentry refuses plaintext
  token storage, validates callback state, supports cancellation, and offers sign-in again for expired or revoked sessions.
- **Listing:** `list`, `recent`, `search`, and `shared` (which uses `visibility = 'anyoneWithLink'`). Folder sizes
  come from the cache built by `allFiles()`, so they show "—" until the storage map has loaded once.
- **Uploads:** resumable, in 8 MiB chunks. Interrupted chunks query Google's confirmed position before retrying.
  Live verification should include a file above 100 MB and cancellation halfway through.
- **Downloads:** Google Docs/Sheets/Slides export to docx/xlsx/pptx. Export-limit failures have an actionable message.
  Binary downloads check their size and available MD5 checksum, refuse overwrites, and remove incomplete output.
- **Share links:** public permissions are listed with pagination; updates and removal use Google's returned permission ID.
- **Move** (drag onto a folder tile, row, or breadcrumb): `PATCH files/{id}?addParents=&removeParents=`.
- **Scope:** full `drive`. This is a restricted scope; fine for personal/test-user use, but it needs Google
  verification before a public release.

`bun run test:google` covers callback state and PKCE, token persistence and refresh, cancellation, incomplete consent,
listing, permission IDs, interrupted and empty uploads, download integrity, and account-switch blocking during transfer preparation.
These tests use temporary profiles and mocked Google responses. `bun run capture` separately exercises the Electron
IPC bridge and demo upload/download/share flow. Neither check establishes access to a live Google account.

## Updates, background, and Explorer

- **Updates** (`src/main/updater.ts`): electron-updater against GitHub Releases at `IEver3st/Sentry`.
  `bun run dist` builds the NSIS installer into `dist/`. Matching version tags run the verified Windows release
  workflow using GitHub's temporary token; see [release instructions](docs/releases.md). Dev runs report
  "unavailable" rather than pretending to check. Settings → Updates: auto check, background download, install on
  quit, early releases.
- **Background** (`src/main/background.ts`): tray menu, launch at sign-in (`--hidden`), start in the tray, close to
  tray, Windows notifications while hidden, one running instance at a time.
- **Explorer** (`src/main/shell-integration.ts`): Settings → Startup & background adds "Send to Google Drive" to the
  right-click menu for files and folders (HKCU, no admin; under "Show more options" on Windows 11) plus a
  "Google Drive (Sentry)" Send to shortcut. Launches carry `--upload <paths>` and are handed to the running app,
  batched, and sent to My Drive or a "From my PC" folder. The uninstaller removes both (`build/installer.nsh`).
- **Local-only mode**: onboarding can skip Google entirely; Sentry then maps this PC and offers Drive as an optional
  add-on from the sidebar or Settings → Drive & account.

## App icon
`resources/icon.ico` (16-256 px, used on Windows) and `resources/icon.png` (1024 px) are rendered from the four-tile
mark by `python scripts/make-icon.py`. The window and taskbar use them via `?asset` imports in `src/main/index.ts`, and
Sentry sets its own AppUserModelID so Windows groups it under this icon. When packaging, point the installer at the same
files (for example electron-builder `win.icon: resources/icon.ico`, `mac.icon: resources/icon.png`).

## Known gaps
- No restore-from-trash inside Sentry. Trash is recoverable for 30 days in Google Drive.
- No background folder sync or watch; uploads are explicit (drop, pick, or "Back up to Drive" on the map).
- The "Clearable" local items are advisory only. Sentry never deletes anything on your PC.
- Windows NSIS packaging and release automation are configured; no signing certificate is configured.
- Upgrading an installed release through download, installation, and relaunch still needs end-to-end verification.
