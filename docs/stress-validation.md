# Packaged backup responsiveness

The final packaged app completed a real 4,001-file, 131.38 MiB backup while navigation and keyboard interaction remained responsive. No renderer errors occurred. This is measured hidden/offscreen Windows execution, not a visible-display or long-duration transfer claim.

## Reproduce

```powershell
node --experimental-strip-types scripts/stress.ts
```

The script creates an isolated profile, source fixture, encrypted repository, real backup plan, and real job history under `outputs/stress/<timestamp>`. It streams a 128 MiB incompressible file in 1 MiB chunks and writes 4,000 small files. It does not use existing user files or backup repositories. The packaged executable must already exist at `release/win-unpacked/Sentry.exe`.

## Final run

- Date: September 15, 2026, 06:25 UTC.
- Evidence: `outputs/stress/1789453517170/results.json`.
- Screenshot: `outputs/stress/1789453517170/busy-engine.png`, visually inspected; it shows the real job backing up at 98%.
- Package `app.asar` SHA256: `18a01392c08793f80eba7d5e2cb31596d6e7594e17980d157907c8e42b6044df`.
- Windows build: `10.0.26200`; AMD Ryzen 9 9950X3D, 32 logical processors, 31.11 GiB usable RAM.
- Test runner: Node `v25.2.1`, Playwright connected to the packaged Electron application. Windows remained hidden and offscreen; production software rendering was enabled.

The job accounted for all 4,001 files and all 137,760,328 source bytes, with zero skipped files. It recorded 135,121,175 bytes added to the encrypted repository. Job timestamps span **13.177 seconds**; the enclosing observer ran **16.148 seconds**.

| Actual job phase during input | Navigation and keyboard measurements | Slowest measured interaction |
| ----------------------------- | -----------------------------------: | ---------------------------: |
| Scanning                      |                                   18 |                     46.30 ms |
| Backing up                    |                                   36 |                     44.99 ms |
| Verifying                     |                                    4 |                     19.77 ms |

The 58 measurements included named sidebar navigation with heading readback and Tab/Shift+Tab with focus readback. All took 2.59–46.30 ms. Forty-four measurements had restic present in the latest process sample. The test requires interaction during a real Backing up or Transferring phase, successful completion, and exact fixture file/byte accounting.

## Active memory observation

A separate hidden PowerShell observer sampled the entire Sentry descendant process tree approximately every 750 ms plus query time. Eighteen frames captured main, renderer, worker, GPU, Chromium helper, and restic processes. The observer and Node runner were outside the measured tree.

The highest simultaneous sum of process working sets was **673.74 MiB** during the active job.

| Process role                    | Highest sampled individual working set |
| ------------------------------- | -------------------------------------: |
| Main                            |                             183.57 MiB |
| Renderer                        |                             145.39 MiB |
| Restic                          |                             122.41 MiB |
| GPU process, software rendering |                              96.71 MiB |
| Backup worker                   |                              73.87 MiB |
| Chromium helper                 |                              45.57 MiB |

Individual maxima occur at different times and should not be added. Process working sets can count shared pages more than once. The JSON preserves raw samples and private allocation counters. This active-job measurement does not meet or test the separate idle memory targets. Repeated navigation, renderer reloads, and Playwright instrumentation contribute to the observed application memory.

One source size cannot establish that memory stays independent of total backup bytes. The implementation streams sources and catalogs, bounds concurrency and output records, and delegates deduplication to restic. This run establishes responsive behavior at this fixture size, with a measured restic peak of 122.41 MiB. Larger catalogs, slower disks, other machines, and sustained cloud transfers still need observation. Sampling can miss short-lived helpers and brief peaks.

## Defect found and verified

The initial run found that live jobs remained labeled Scanning even while restic processed data. The service updated the active job in memory, but state and activity responses read only the older persisted record. The final package overlays the active job onto those responses, avoiding frequent SQLite progress writes. The final run observed Scanning, Backing up, and Verifying and captured the actual progress bar. Hidden windows deliberately suspend live subscriptions, so screenshot refreshes read the current real state explicitly.

All test-owned application, worker, engine, and observer processes exited after the run. Scoped script lint and project typechecking passed.
