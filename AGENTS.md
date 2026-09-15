# Sentry

Read `~/AGENTS.md`. Preserve backup repositories and legacy files. Work directly on `main` for all future changes unless the user explicitly requests another branch. Before editing or committing, recheck the current branch because agents share this checkout. When consolidating existing branches, wait for active agents to finish, merge any new commits into `main`, and verify every active branch tip is contained in `main`. Releases and publication still require task-specific user authorization.

Electron main owns native integration and validated IPC. The sandboxed renderer uses only `window.sentry`. The engine worker owns SQLite, jobs and backup processes. Do not move scanning, hashing, transfers or catalog reads into main or renderer. Use argument arrays, never shell command interpolation. Secrets may cross the preload only on credential entry; never return stored secrets or include them in logs or process arguments.

Use Bun tooling, strict TypeScript, React, Vite, Radix/shadcn primitives. Run typecheck, lint, meaningful data-safety tests and build. Native QA must be hidden/offscreen or safely placed on the secondary display before first show. Never show agent windows on monitor 0.

Do not describe partial, skipped, cancelled or cloud-failed jobs as successful protection. Recovery must work using repository and password without this app's database. Keep validation evidence in docs/validation.md and outputs (ignored). No fake production data.
