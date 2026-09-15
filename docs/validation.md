# Validation evidence

Windows 11 x64 build 26200; Bun 1.3.6; host Node 25.2.1. Electron 40.10.6 embeds Node 24.15.0, Chromium 144.0.7559.236 and SQLite 3.51.3. Engines: restic 0.19.1 and rclone 1.75.1. Fixtures use isolated directories and never existing backup repositories.

## Data safety

Final `bun test`: **15 passed, 0 failed, 84 assertions**, across five files in 58.34 seconds. TypeScript, ESLint and the production build passed. The separately executed Node service fixture passed all **12 scenarios**.

The engine prototype ran before application integration. Automated engine tests cover byte-for-byte multi-root restore, incremental changes/deletion, empty files/directories, Unicode, 335-character Windows paths, renamed files, wrong passwords, pinned retention followed by recovery, locked modified files, changing content after scanning, unexpected include-rule arrivals, cancellation during an actual write, stale-lock cleanup and integrity checks. A real rclone local backend validates transport discovery without claiming Google account success.

The service suite runs the actual worker service and SQLite through Node. Twelve scenarios pass: independent destination commits; incremental local success with another destination unavailable; failed-only retry; complete restore; honest collision results; real retention removal with retained recovery; wrong credentials; redacted diagnostics; queued cancellation/persistence; interrupted-job recovery; missed schedule catch-up; and recovery without the original application database. Latest service evidence: `outputs/service-fixture/run-wIC1or/results.json`.

Automation tests cover DST/month end, missed schedules, durable weather deduplication, stale/invalid/no-coverage responses, simulation separation, OAuth loopback state rejection and PKCE exchange, refresh, timeout, cancellation and quota parsing. A live NWS request for Dallas succeeded on September 15, 2026. OAuth provider responses in protocol tests are fixtures; live Google account operations remain unverified.

## Native application

Hidden/offscreen native Electron validation used a fresh profile, actual encrypted repository, source files and real jobs. It verified context isolation, renderer sandboxing and no renderer Node access. The local backup and verified restore crossed renderer/preload/main/worker/SQLite/engine boundaries. Two identically named files from different roots restored byte-for-byte.

The first native run found Bun's bundled `__dirname` pointing at source paths. Main now resolves packaged entrypoints from `app.getAppPath()/dist`. Development and packaged discovery must both pass before acceptance.

Rendered evidence covers empty and protected Overview, plan editor, Restore, Settings, dark/light, 820×600 and 200% zoom. The first pass found a misleading no-plan tray label and excessive empty-state instructions; both were repaired. Light metadata contrast was raised to at least 4.72:1 on the rail. UI lists use bounded pages, dialogs trap and return focus, and reduced motion removes nonessential transitions.

Final packaged evidence is `outputs/native-qa/1789453037142/results.json`, with eight adjacent PNG screenshots. The plan was saved through the actual editor; a named pinned backup, full byte-for-byte restore and nonempty sample recovery completed. Twenty-four Tab presses stayed inside the Radix dialog. No page errors occurred, both compact/200% layouts had no horizontal overflow, and reduced motion was enabled. All test windows remain hidden; this establishes actual native rendering, not physical monitor interaction or assistive-technology acceptance.

## Windows candidate

`release/Sentry Setup 0.1.0.exe` is an unsigned NSIS per-user installer. The unpacked packaged executable, bundled engine discovery, fresh writable profile and DPAPI credential path were exercised. Installer execution and uninstall were not exercised.

- Installer SHA-256: `9f1fa1e26cc4b34d03172b676f015bcdca925edf2ed5245e0e45bf9896ef868c`.
- Packaged `app.asar` SHA-256: `18a01392c08793f80eba7d5e2cb31596d6e7594e17980d157907c8e42b6044df`.
- Resource metadata identifies Sentry 0.1.0; packaged restic matches the downloaded executable byte-for-byte. Approved PNG originals, multi-resolution ICO and engine license notices are included.

The full process tree measured **429.68 MiB** with a hidden retained renderer and **278.44 MiB** in the tray over approximately 33 seconds per state. These exceed the initial memory targets. Software rendering reduced tray working set by 19.2%; the final idle CPU counter did not advance within the sampling resolution. Hidden rendering is a proxy, not a visible-window benchmark. See [performance](performance.md) for per-process values, methodology and limitations.

The native workflow screenshots and idle benchmark precede one final service change: active jobs now overlay their live progress on persisted history when publishing state and reading Activity. This repairs a stale “Scanning” label without writing every progress event to SQLite. The final package was rebuilt and exercised by the [stress validation](stress-validation.md); benchmark evidence retains the exact earlier package hash.

The final package backed up **4,001 files / 137,760,328 bytes** in **13.177 seconds**, with zero skipped files and renderer errors. Fifty-eight navigation/keyboard interactions spanned Scanning, Backing up and Verifying; the slowest measured interaction took **46.30 ms**. Sampled active process-tree working set peaked at **673.74 MiB**. Evidence: `outputs/stress/1789453517170/results.json` and `busy-engine.png`. This is one hidden/offscreen local fixture, not a large-repository or cloud soak test. All test-owned processes exited.

## Limits that require external evidence

- Production Google Desktop OAuth client/consent configuration and real account transfer/reconnect/quota/long-transfer interruption.
- Physical external-drive removal/reinsertion, changed drive letters and network-share interruption. Directory disappearance/reconnection and read-only volume identity were exercised.
- Real sleep/resume and Windows login across reboot. Schedule decisions and missed-run persistence were exercised.
- Elevated VSS, application-consistent or full-system recovery are not exposed in this build.
- Actual sudden power loss, hardware/storage-controller behavior, very large real repositories, and multi-day soak operation.
- Installer is unsigned. A packaged executable smoke test does not establish trusted-publisher signing or a clean-machine installation lifecycle.

Performance measurements and their process-tree boundaries are maintained separately in [performance.md](performance.md).
