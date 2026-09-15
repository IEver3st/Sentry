# Sentry

Sentry keeps encrypted, versioned copies of important files on Windows. Create a plan, choose its sources and destinations, and recover files from dated snapshots. Local backup does not require an account.

This repository is the Electron rebuild, maintained on `main`. It uses React, strict TypeScript, Bun, Vite, Radix/shadcn primitives and SQLite. The backup worker runs restic 0.19.1; rclone 1.75.1 supplies Google Drive transport. No Tauri or Rust application backend is included.

## Run and build

Windows x64, Bun and Node 24 or later:

```powershell
bun install
bun run engines:fetch
bun run dev
```

`dev` builds the application and starts Electron. After changing source, restart this command. It does not start a second protection service.

```powershell
bun run typecheck
bun run lint
bun test
bun run test:service
bun run build
bun run package
```

The installer is written to `release/Sentry Setup 0.1.0.exe`; the unpacked application is `release/win-unpacked/Sentry.exe`. The candidate is unsigned. No release is published by these commands.

For isolated native validation that opens no visible window:

```powershell
bun run qa
bun run qa --packaged
bun run benchmark
node --experimental-strip-types scripts/stress.ts
```

QA uses a fresh profile and disposable sources under `outputs/`. Screenshots show actual fixture backup results, not seeded operational history. To run interactively on a secondary display, start Electron with `--secondary-display`; placement is determined before the first show. Agent validation must never display a window on monitor 0.

## Protection and recovery

- Plans support multiple files/folders, editable include/exclude rules, previews, presets, schedules, duplication, enable/disable, and manual named or pinned snapshots. Development presets preserve `.git` and configuration files unless you explicitly exclude them.
- Each destination has its own repository identity, outcome, last complete copy and verification result. A failed destination can be retried independently.
- Snapshots are complete recoverable versions with content deduplication. Every repository is encrypted by restic. Save the recovery password somewhere independent of this PC; losing both the saved credential and your password prevents recovery.
- Restore filters snapshots by plan/date and searches paginated paths. Restore to a separate folder by default. Existing-file collisions stay untouched unless overwrite is selected, and skipped collisions are reported as partial. Restic verifies restored bytes.
- After reinstalling, connect an existing repository with its recovery password. Sentry rebuilds its catalog from encrypted repository metadata; the original SQLite database is not required.
- Integrity checks, sample recovery, pinned snapshots, and daily/weekly/monthly retention are available. Automatic pruning runs at most once per day after a successful backup. Incomplete protection or unexpectedly large changes suspend pruning until reviewed.

## Background behavior

Closing the window destroys its renderer and keeps Sentry in the tray. Minimize retains the window. Tray controls open Sentry, run enabled plans, or pause protection. In desktop mode, explicit Quit cancels active work and stops scheduling. Settings > Recovery can export an optional Windows service installer. Once installed under the same Windows account, the service owns the engine and closing or quitting the desktop client leaves protection running. See [recovery features and service setup](docs/recovery.md) for installation and validation boundaries.

Calendar schedules follow the PC's local time zone. Missed occurrences become one catch-up run; monthly days clamp to month end. Sleep/resume and time-zone changes re-evaluate due work. Durable queued jobs survive restart; interrupted jobs remain visible for retry. Repository operations are serialized, and automatic destination failures receive at most two retries with backoff.

Scheduled jobs can wait for AC power, five minutes of idle time or an unmetered connection. Unknown network cost pauses automatic cloud work unless metered connections are allowed. Manual jobs bypass those three waiting policies, while the global pause applies to all queued work. Bandwidth limits apply to engine upload and download. Login startup is opt-in.

## Google Drive and weather

Google Drive uses browser-based Desktop OAuth, PKCE and a loopback callback. Tokens are persisted with Windows DPAPI through Electron safeStorage. Production client configuration and Google consent verification are external prerequisites. See [Google setup and automation behavior](docs/automation.md) for exact configuration and test boundaries. No fake connection is provided.

Cloud destinations receive snapshots through restic's rclone backend. By default, destinations capture sources sequentially and backup retries scan sources again. With a copy source selected in Capture & automation, Sentry captures once and copies that committed snapshot to the other repositories. These copies preserve the original capture time and never rescan live files. Each destination retains its own encryption, outcome and retry history. Pending or failed copies hold their source snapshot against pruning until copied or explicitly abandoned.

Weather automation uses the US National Weather Service API. Configure coordinates, alert types, severities and selected plans. Real alerts are checked for coverage, freshness, expiry and duplication; a cooldown limits repeated runs. Priority plans and off-device destinations run first. Simulation describes eligible plans without creating a real protection-history entry. Coverage outside the NWS service area is unavailable. Weather checks supplement regular schedules.

## Legacy compatibility

The reference source is [Sentry-Old](https://github.com/IEver3st/Sentry-Old), reviewed at `850002d7a3e8e2324120b74da5d1e8f19e4d718e`. Import its `app_state.json` from Settings after connecting a new destination. Imported plans are disabled and manual until reviewed. Existing exclusion rules remain inspectable; no legacy credentials are imported.

Legacy ZIPs and manifests are never modified. Their changed-file-only archives and relative-path identity cannot reliably establish a complete versioned snapshot. Keep all original archives and manifests, extract needed files into a separate directory, and check their contents. Sentry does not invent deleted-file history or merge ambiguous legacy roots.

## Scope and validation

Sentry protects files, not a disk image or bootable system backup. Capture & automation offers ordinary files, Windows VSS and live SQLite capture. VSS requires suitable privileges and provides a crash-consistent filesystem snapshot; Sentry does not coordinate arbitrary application writers. SQLite capture uses the online backup API, including committed WAL contents, and validates each database independently. Close other applications that need consistent multi-file state before an ordinary-file backup.

File history provides verified text/image previews, side-by-side versions and recovery of deleted files. Snapshot Changes lists added, changed and deleted paths. Temporary named checkpoints survive retention until their expiry; permanent pins remain available. Optional recovery drills rotate a bounded sample and report the actual files verified. Protection review checks stale copies, disk overlap, exclusions and opt-in discovery folders. Recovery kits contain locations and standalone recovery instructions without passwords; Practice recovery requires a newly entered password and bypasses the saved catalog. Details and limits are in [recovery features](docs/recovery.md).

See [architecture](docs/architecture.md), [engine decision](docs/engine-decision.md), [design](DESIGN.md), [validation](docs/validation.md), [idle performance](docs/performance.md) and [backup responsiveness](docs/stress-validation.md). Physical drive removal, installed login behavior, real Google account transfers and long-duration soak validation must be distinguished from fixture and packaged-executable checks.

Snapshots and activity are paginated in the interface; files stream into SQLite. Restic snapshot metadata has a 16 MiB response ceiling. Very large exact-file include selections may reach that limit and fail visibly. Restic's memory cap is a soft target; repository indexes can exceed it. Source errors retain actionable details in local history; exported diagnostics omit paths, names, tokens, passwords, file contents and raw engine errors.

Updates are checked only when requested. Sentry opens the trusted GitHub release page after active jobs finish; installation is user controlled. The application does not silently download, install, or publish a release.

## Licenses

Sentry uses the MIT license. Restic and rclone license texts, pinned versions and official download hashes are in `vendor/notices` and included in the Windows package. The two approved original identity images are preserved under `assets/originals`.
