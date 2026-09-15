# Sentry desktop design

Mode: Operate. One job: understand protection and recover work. Authority: supplied original ribbon and navy app icon, user's visual brief, Means' restrained product presentation.

First viewport: a compact protection summary, plans with source and per-destination last success, and a clear Back up now action. Navigation is a fixed 184px rail. Main content owns scrolling; titlebar and navigation remain stable. No statistics-card grid.

Signature: a thin protection ledger with aligned destination outcomes; dated recovery rows with a persistent file inspector; the dimensional ribbon used only in the app identity. Use quiet blue selection, not decorative gradients.

Typography: Segoe UI Variable / Segoe UI native Windows text, 13px body, 12px metadata, 20px page headings, tabular timestamps and byte counts. Sections use weight and spacing. Base spacing 4px; ordinary controls 32px high, touchable buttons at least 32px, radii 5-8px.

Dark: near-black #101319 canvas, #151a23 navigation, #1b2230 fields, #2a3342 borders, #edf2fa text, #a3afc2 secondary. Light: #f7f9fc canvas, #eef2f8 rail, white fields, #d2dae6 borders, #192332 text, #526176 secondary. Accent #3b82f6, with theme-aware accessible primary text. Semantic status always includes text.

Controls: Radix dialogs and menus with focus return, real labels, visible blue focus. Inline plan editor owns sources, shared destinations, schedules and rules. Destructive actions require explicit contextual choice. Restore uses a separate folder by default.

Motion: 120-180ms opacity/transform for state and navigation, no idle animation, no automatic animated entrances on every row. Reduced motion removes transitions. Hidden/minimized renderer stops updates.

Critical states: no plans, unavailable repository, partial backup, cloud reconnect, password error, source errors, running/cancelled/queued jobs, no snapshots, search empty, large paginated lists. Supported window: 820x600 minimum, 1180x780 normal, 150%/200% scaling with content reflow.

Anti-reference: SaaS dashboards, giant headings, nested cards, decorative graphs, fake operational history, logo-derived gradients across the UI.

## Implemented interaction system

The primary shell uses a 34px draggable Windows titlebar with explicit minimize, maximize and close-to-tray actions. The navigation rail remains fixed while each page owns its scroll area. At compact widths the rail reduces; at high zoom it becomes an icon rail with accessible button names. The status footer describes ordinary file backup without claiming application or system consistency.

Overview opens on a source-to-destination protection ledger once plans exist. Each copy uses durable per-plan/per-destination last-success and last-attempt records. An incomplete, failed, cancelled, or unavailable destination remains visible even if another destination succeeded. The empty state uses the supplied ribbon asset with direct create-plan and connect-repository actions.

Backup plans expand in place. A focused Radix dialog groups sources, inline destination creation, schedule, inspectable presets, glob preview, retention and weather priority. Password fields are ephemeral and cleared after requests. Named backups can be pinned before changes. Confirmation dialogs explain the concrete effect of removal and pruning.

Restore keeps snapshot dates in a left pane and paginated file paths in the adjoining browser. Selection persists across file pages; an empty selection means a full snapshot. The restore dialog defaults to no overwrite and asks for a separate output folder. Sample recovery and pinning live beside snapshot details. Activity exposes destination outcomes, counts, timestamps and errors, with retries scoped to the failed job.

Settings uses General, Destinations, Weather and Maintenance sections. Unsupported OAuth configuration is an actionable unavailable state. Weather simulation is labeled separately from real alert checks. Background behavior and limits are explained next to their controls.

Implementation references: [Means](https://frommeans.com/), [Apple HIG layout](https://developer.apple.com/design/human-interface-guidelines/layout), [Apple HIG motion](https://developer.apple.com/design/human-interface-guidelines/motion), frontend-design desktop/interaction/accessibility guidance. Apple pages were consulted but their live body requires JavaScript; no platform-specific implementation claim is based on inaccessible text.

Validation: renderer passes strict TypeScript and ESLint. Native screenshot, keyboard, scaling and integration evidence is tracked in `docs/validation.md`; compilation alone is not visual acceptance.

## Packaged visual acceptance · 2026-09-15

Reviewed the actual hidden Windows packaged application at 1180×780 logical pixels (150% display scaling): `outputs/native-qa/1789453037142/02-plan-editor-dark.png` (stable, opaque dialog with visible input focus), `04-restore-dark.png` (loaded snapshot, path selection, search, pin/test recovery and restore action), and `05-overview-light.png` (real successful backup, restore and recovery-test history). No blocker or major visual defect remains in those states. The earlier 820×600 and 200% zoom views were also visually inspected; the final packaged `results.json` confirms no horizontal document overflow at 820×600 or 590×390 CSS pixels.

The packaged evidence records a successful plan save through the interface, 24 Tab presses retained inside the plan dialog, reduced-motion support, no page errors, and actual restic backup, restore and sample-recovery success. Window visibility was false, context isolation and renderer sandbox were enabled, and renderer Node access was absent. Screenshot QA does not establish screen-reader behavior, live Google authorization, physical drive reconnection, or interaction with native titlebar controls outside the captured web content. Those boundaries remain in `docs/validation.md`.
