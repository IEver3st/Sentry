# Electron rebuild plan

1. Inspect source, instructions and approved assets; preserve originals. The supplied remote and checkout were empty at intake. The compatibility reference is Sentry-Old at `850002d7a3e8e2324120b74da5d1e8f19e4d718e`; its settings can be imported without modifying legacy backups.
2. Compare established engines against official documentation. Prove encrypted local snapshots, incremental changes and byte-for-byte recovery before integration.
3. Establish typed IPC, an isolated worker, SQLite metadata, encrypted credentials and durable destination jobs.
4. Complete local plan creation, preview, backup, catalog recovery and safe verified restore.
5. Implement the desktop interface using real service state, themes, keyboard access and bounded rendering.
6. Integrate scheduling, Google Drive OAuth/transport, retention, integrity and background policies.
7. Add weather automation, redacted diagnostics, import and update controls.
8. Validate data safety, hidden native UI, production packaging and process-tree performance. Record external prerequisites explicitly.

Ownership: root owns shared contracts, main/preload, worker orchestration and integration; engine agent owns executable acquisition/proof/adapter; automation agent owns scheduling/weather/OAuth modules; frontend agent owns renderer and design implementation. Root reviews integrated changes and makes coherent commits. No release or main overwrite.

Implementation and integration are complete on `rebuild/electron`. The Windows candidate is packaged and exercised with isolated native fixtures. [Validation](validation.md) records passing checks and external configuration/platform gaps; [performance](performance.md) records the missed memory targets. These gaps remain acceptance limits, not simulated successes.
