# ADR 001: Electron application and isolated backup worker

Status: implemented and exercised in the Windows package.

Use a sandboxed React renderer with no Node integration, a bundled preload with a narrow typed request API, Electron main for window/tray/power/credential/native-dialog integration, and a forked Node worker for SQLite and backup execution. The worker remains alive when the window closes. Destroying the renderer on close reduces tray resource use; opening reconstructs state from the worker.

Validate discriminated requests at both privileged boundaries. Main keeps encrypted credentials in Electron safeStorage (DPAPI on Windows) and supplies secrets only to the worker over IPC. The worker passes passwords and transport tokens through private child environment, never arguments or diagnostics. Backup executables run with shell disabled and bounded output parsing.

SQLite stores plans, destination identity, jobs, per-destination outcomes, catalog pages, automation state and settings. Interrupted active jobs become interrupted on startup. Repository snapshots remain the recovery authority; the app database is disposable metadata. A global sequential execution queue conservatively excludes incompatible repository operations. Engine repository locks protect against external processes.

Backups use restic format 2, selected after the [executable prototype](engine-decision.md). Rclone supplies Google Drive transport, with its own repository, committed snapshot and failure state. Snapshots carry plan and source metadata so a fresh application database can rebuild its catalog. Windows volume and repository identities are checked before reconnecting a local destination.

Update checks are user initiated. Sentry opens the trusted release page after active jobs finish; the user controls downloading and installing an update. No privileged service is installed, so protection stops when Sentry quits or Windows signs out.
