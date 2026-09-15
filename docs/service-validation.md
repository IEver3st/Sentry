# Worker service validation

## Result

The service integration fixture passed all 12 scenarios on Windows x64 using Node **v25.2.1**, Bun **1.3.6** for bundling, the bundled restic executable and real SQLite databases. The final run completed at **2026-09-15T06:08:00.073Z**.

Evidence is retained at `outputs/service-fixture/run-wIC1or/results.json`, together with the fixture repositories, restored content and application databases. The fixture creates a fresh run subdirectory on each invocation; it never deletes or resets an existing repository. Fixture credentials stay in test-host memory and are intentionally disposable.

## Covered behavior

- Two local repositories receive independently committed backups and verification timestamps.
- Modified, added and deleted files are reflected in the next complete snapshot. Identical relative filenames in separate source roots remain distinct.
- An unavailable second destination fails without disguising the first destination's success. Reconnection validates the expected repository. Retry executes only the failed destination; the successful repository receives no additional snapshot.
- A full restore compares every fixture file byte-for-byte, including Unicode and zero-byte files, confirms an empty directory and confirms deleted files are absent from the newer snapshot.
- Restore collisions preserve existing destination content and do not report complete success.
- Retention actually removes an unpinned snapshot, preserves the pinned named version, and the retained original restores its original bytes and deleted file.
- A wrong recovery password is rejected; the original connection remains usable.
- Diagnostic exports omit source paths, repository paths, plan names, passwords and file contents.
- Queued cancellation survives service restart. Other queued work remains pending while paused, then completes after resume. History persists.
- A seeded durable `running` job becomes `interrupted` on the next service construction. This verifies restart reconciliation, not an OS-killed worker experiment.
- A persisted overdue interval enqueues one catch-up per destination and advances its due time; a second tick does not duplicate work.
- A fresh application database discovers snapshot metadata from the repository and restores without the original plan database. A subsequent restart with deliberately missing stored credentials accepts the supplied recovery password and reconnects successfully.

Focused ESLint and full TypeScript checks passed after adding this fixture.

## Run

From the repository root in PowerShell:

```powershell
bun -e "const result=await Bun.build({entrypoints:['tests/service.integration.ts'],outdir:'outputs/service-test',target:'node',format:'cjs',naming:'[name].cjs',external:['node:sqlite']}); if(!result.success){console.error(result.logs);process.exit(1)}"
node outputs/service-test/service.integration.cjs
```

The test uses Node's `node:sqlite`, the same API used by the Electron utility worker. Node 25 prints an experimental SQLite notice; a successful exit and the per-scenario JSON are the proof. This fixture is separate from `bun test` because Bun's SQLite implementation is not the service runtime.

## Boundaries

The unavailable destination is a renamed local fixture folder. It proves destination-isolated failure/retry behavior, not Google Drive transport. Real Google account consent, transfers, quota enforcement and reconnect still require configured application credentials and a test account.

No physical USB disconnect, network-share interruption, sleep event, installed startup, DPAPI credential-store call or visible application window is exercised here. The engine tests cover locked-file and interrupted-engine behavior separately. The service fixture does not measure performance or validate installer behavior.

## Review findings sent to the implementation owner

The review identified collision results being treated as success, recovery-password overrides being applied too late, non-atomic job/payload enqueue, unreserved asynchronous repository requests, limited restart reconciliation and stale catalog entries after pruning. The owner corrected these during integration. The final fixture verifies collision, credential recovery and ordinary queue/restart paths; transaction-failure injection and simultaneous-request stress are outside this fixture.

The review also identified graceful shutdown while an asynchronous request is pending and malformed stored Google credentials as separate lifecycle concerns. Consult the final source and overall validation record for their later resolution; this run does not establish those cases.
