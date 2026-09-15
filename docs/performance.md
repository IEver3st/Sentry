# Windows process-tree performance

## Method

`scripts/benchmark.ts` launches the packaged `release/win-unpacked/Sentry.exe` with Playwright from Node. It uses a fresh isolated profile, `SENTRY_QA=1`, and verifies that every BrowserWindow is hidden and offscreen. No window is shown, moved to the primary monitor or activated.

The first observation retains the hidden renderer after a ten-second stabilization. This is a **renderer-retained hidden/offscreen idle proxy**, not evidence of visible-window CPU or GPU behavior. The second closes the BrowserWindow, waits ten seconds, verifies that no windows or renderer processes remain, and measures actual tray idle while the backup worker stays alive.

Each observation lasts at least 30 seconds, sampled about every five seconds. The JSON records actual elapsed intervals. A separate hidden PowerShell process queries Windows process ancestry and cumulative CPU counters. This sampler is a sibling of Sentry under the test runner; it is excluded from the measured app tree. Main, renderer, GPU, Chromium utility, backup worker, restic, rclone and policy helpers are classified when present.

CPU is reported both ways:

- One-core equivalent: summed app-tree CPU seconds / observed wall seconds × 100.
- Whole-machine percentage: one-core equivalent / logical processor count.

Memory includes summed process working set, summed private committed bytes and private working set when Windows supplies it. Working-set sums may count shared pages more than once. Private commit is allocated private memory, not all resident RAM. Neither value should be relabeled as unique physical RAM use.

The evidence records process IDs, creation identities, roles, per-process CPU/memory, frame samples, OS/CPU/RAM/runtime details, package modification times and the SHA-256 of `app.asar`. Playwright remains attached; its app-side debugging overhead is included. Short-lived helpers that start and exit between samples can be missed. The fresh profile has no scheduled backups, so the observations measure idle behavior, not scanning or transfers.

## Run

Build or refresh the Windows package first. From the repository root:

```powershell
bun -e "const result=await Bun.build({entrypoints:['scripts/benchmark.ts'],outdir:'outputs/benchmark-runner',target:'node',format:'cjs',naming:'[name].cjs',packages:'external'}); if(!result.success){console.error(result.logs);process.exit(1)}"
node outputs/benchmark-runner/benchmark.cjs
```

The script prints the evidence directory under `outputs/performance/`. It closes only the Electron instance it launched when measurement ends. TypeScript and focused lint passed before execution.

## Results

**The memory targets were missed.** Disabling hardware acceleration reduced measured tray working set by **66.35 MiB (19.2%)**, but the final process-tree sum remained **278.44 MiB** in the tray and **429.68 MiB** with the hidden renderer retained. Private working set is lower, but it does not replace the requested working-set target. No measurable CPU-counter increase occurred in either final idle observation; the short-window CPU target passed using both normalization methods.

September 15, 2026; Windows **10.0.26200**, AMD Ryzen **9 9950X3D**, **32 logical processors**, **31.11 GiB** OS-reported physical memory. Packaged app: Electron **40.10.6**, embedded Node **24.15.0**, Chromium **144.0.7559.236**. Test runner: Node **25.2.1**.

| Build and state | Observation | Average summed WS | Peak summed WS | Average private WS | Average private commit | CPU, one-core / machine |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Hardware acceleration, renderer retained and hidden | 32.438 s | 462.62 MiB | 469.14 MiB | 171.00 MiB | 324.31 MiB | 0 / 0% measurable |
| Hardware acceleration, actual tray | 32.474 s | 344.79 MiB | 346.66 MiB | 132.64 MiB | 272.14 MiB | 0.04812 / 0.00150% |
| Software rendering, renderer retained and hidden | 32.478 s | 429.68 MiB | 446.36 MiB | 140.23 MiB | 225.16 MiB | 0 / 0% measurable |
| **Software rendering, actual tray** | **33.395 s** | **278.44 MiB** | **280.10 MiB** | **83.77 MiB** | **154.58 MiB** | **0 / 0% measurable** |

“0 measurable” means Windows cumulative process CPU counters did not advance between the sampled endpoints. It is not a claim that the app never uses CPU. The approximate engineering targets are 200 MB renderer-retained working set, 120 MB tray working set where achievable, and below 0.5% idle CPU. Neither memory measurement met its target. A genuinely visible-window measurement remains unverified because agent windows must stay hidden or off the primary display.

### Cause and implemented trade-off

The hardware-accelerated GPU process held approximately **143.64 MiB** with the renderer and **127.92 MiB** in the tray. Sentry has no video or canvas workload, so main now calls `app.disableHardwareAcceleration()` before ready. Chromium still uses a GPU-role process for software compositing; that process fell to **82.10 / 67.82 MiB**. Other memory changes between short runs mean the GPU reduction should not be mistaken for a perfectly isolated allocator experiment.

Final tray working-set contributions were:

| Process | Average WS |
| --- | ---: |
| Electron main | 103.09 MiB |
| Chromium software compositor (GPU role) | 67.82 MiB |
| Backup worker | 62.12 MiB |
| Chromium network utility | 45.41 MiB |
| **Total** | **278.44 MiB** |

The renderer is destroyed in the tray, and the independent worker stays alive. No restic/rclone process or policy helper remained during these idle samples. The remaining cost is chiefly the Electron/Chromium process baseline plus the durable worker, not scanning, transfers or an idle render loop.

Software rendering can increase CPU during complex visual updates. The idle observations cannot establish animation/scrolling performance; final packaged visual QA must check that trade-off. No memory trimming, disabled verification, reduced durability or stopped scheduling was used to make the numbers smaller. Reaching a 120 MB summed tray working set would likely require a different background-host arrangement or additional runtime changes; that is not established by this measurement.

Subsequent [stress validation](stress-validation.md) exercises navigation and keyboard input during an actual backup. Its final package includes a service-only correction that publishes live job progress rather than stale persisted progress. The idle results above remain measurements of the explicitly identified earlier archive, not a rerun against that final correction.

### Evidence and accounting correction

- Baseline: `outputs/performance/1789452690905/results-corrected.json`; app archive SHA-256 `5e124ec838d15a37cf1d3455aead8469373bbdf143ebbf348d5147681c2b9db4`.
- Final software rendering: `outputs/performance/1789452922348/results.json`; app archive SHA-256 `5f26ee8bdf47b2f3e35a1586cca9424bccaf2d80fde8304dbff4e46dfe5d86c9`.

The first Windows run revealed that Playwright's `app.process()` identified its `cmd.exe` launcher. The original `results.json` remains intact. The corrected baseline removes that approximately 6.9 MiB instrumentation parent from every captured frame and identifies Electron main using `app.getAppMetrics()`. The benchmark now obtains the real root PID with `app.evaluate(() => process.pid)` before sampling; the final run excludes the launcher directly. The main, compositor, worker, utility and renderer PIDs from the final run were confirmed absent after orderly test shutdown.
