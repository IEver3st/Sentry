# Sentry

Read `~/AGENTS.md`. Preserve backup repositories and legacy files. Work on the rebuild branch; releases and main publication need explicit authorization.

Electron main owns native integration and validated IPC. The sandboxed renderer uses only `window.sentry`. The engine worker owns SQLite, jobs and backup processes. Do not move scanning, hashing, transfers or catalog reads into main or renderer. Use argument arrays, never shell command interpolation. Secrets may cross the preload only on credential entry; never return stored secrets or include them in logs or process arguments.

Use Bun tooling, strict TypeScript, React, Vite, Radix/shadcn primitives. Run typecheck, lint, meaningful data-safety tests and build. Native QA must be hidden/offscreen or safely placed on the secondary display before first show. Never show agent windows on monitor 0.

Do not describe partial, skipped, cancelled or cloud-failed jobs as successful protection. Recovery must work using repository and password without this app's database. Keep validation evidence in docs/validation.md and outputs (ignored). No fake production data.
