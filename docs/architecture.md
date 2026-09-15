# ADR 001: Electron application and isolated backup worker

Status: accepted for implementation.

Use a sandboxed React renderer with no Node integration, a bundled preload with a narrow typed request API, Electron main for window/tray/power/credential/native-dialog integration, and a forked Node worker for SQLite and backup execution. The worker remains alive when the window closes. Destroying the renderer on close reduces tray resource use; opening reconstructs state from the worker.

Validate discriminated requests at both privileged boundaries. Main keeps encrypted credentials in Electron safeStorage (DPAPI on Windows) and supplies secrets only to the worker over IPC. The worker passes passwords and transport tokens through private child environment, never arguments or diagnostics. Backup executables run with shell disabled and bounded output parsing.

SQLite stores plans, destination identity, jobs, per-destination outcomes, catalog pages, automation state and settings. Interrupted active jobs become interrupted on startup. Repository snapshots remain the recovery authority; the app database is disposable metadata. A global sequential execution queue conservatively excludes incompatible repository operations. Engine repository locks protect against external processes.

Backup format is decided by the separately recorded executable prototype. Google Drive is a transport destination, with its own committed snapshot and failure state. Updates are user initiated and installation waits for jobs. No privileged service is installed, so protection stops when Sentry quits or Windows signs out.
