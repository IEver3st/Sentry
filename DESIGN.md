# Sentry desktop design

## Recovery expansion contract

Extend the existing desktop workbench: Overview owns actionable protection gaps; Plans owns checkpoints and opt-in capture policies; Restore owns dated file history, verified previews and snapshot changes; Settings > Recovery owns drills, discovery, recovery practice and Windows setup. The primary action remains recovery into a separate folder. Preserve the current shell, Segoe type roles, theme tokens and Radix dialogs. Use aligned version rows and an adjoining file inspector as the signature, with compact labels and text/code previews. Keep automation in collapsed plan details. No card grids or promotional surfaces. Validate empty, loading, missing-version, copy-failure, incomplete and verified-sample states at 1180x780 and 820x600, plus 200% scale. Long paths must wrap or scroll inside their own pane without widening the page.

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

The primary shell uses a 34px draggable Windows titlebar with explicit minimize, maximize and close-to-tray actions. The titlebar and fixed navigation rail share one continuous surface; the workspace meets them with a 12px upper-left corner. At compact widths the rail reduces; at high zoom it becomes an icon rail with accessible button names. Pages own their scroll areas. Repeated page descriptions and the status footer are omitted.

Overview opens on a source-to-destination protection ledger once plans exist. Each copy uses durable per-plan/per-destination last-success and last-attempt records. An incomplete, failed, cancelled, or unavailable destination remains visible even if another destination succeeded. The empty state uses the supplied ribbon asset with direct create-plan and connect-repository actions.

Backup plans expand in place. A focused Radix dialog groups sources, inline destination creation, schedule, inspectable presets, glob preview, retention and weather priority. Password fields are ephemeral and cleared after requests. Named backups can be pinned before changes. Confirmation dialogs explain the concrete effect of removal and pruning.

Restore keeps snapshot dates in a left pane and paginated file paths in the adjoining browser. Selection persists across file pages; an empty selection means a full snapshot. The restore dialog defaults to no overwrite and asks for a separate output folder. Sample recovery and pinning live beside snapshot details. Activity exposes destination outcomes, counts, timestamps and errors, with retries scoped to the failed job.

Settings uses General, Destinations, Weather and Maintenance sections in a centered column capped at 860px. General owns the pause control. Units and consequential warnings remain visible; engine details and background behavior sit under About Sentry. Unsupported OAuth configuration is an actionable unavailable state. Weather simulation is labeled separately from real alert checks.

## Shell decluttering contract · 2026-09-15

Authority: the user's annotated Settings screenshot. Preserve compact Windows typography, existing theme tokens, navigation, and validated IPC. Join the rail and titlebar without a horizontal seam; retain one quiet curved workspace boundary. Align Settings heading, tabs and fields in a centered column, with all General actions visible at 1180×780 and scrolling available at 820×600 and 200% zoom. Remove duplicate branding, generic page subtext and bottom status copy. Keep meaningful failures, recovery warnings, units and accessible controls. No cards, new palette or decorative effects.

Implementation references: [Means](https://frommeans.com/), [Apple HIG layout](https://developer.apple.com/design/human-interface-guidelines/layout), [Apple HIG motion](https://developer.apple.com/design/human-interface-guidelines/motion), frontend-design desktop/interaction/accessibility guidance. Apple pages were consulted but their live body requires JavaScript; no platform-specific implementation claim is based on inaccessible text.

Validation: renderer passes strict TypeScript and ESLint. Native screenshot, keyboard, scaling and integration evidence is tracked in `docs/validation.md`; compilation alone is not visual acceptance.

## Packaged visual acceptance · 2026-09-15

Reviewed the actual hidden Windows packaged application at 1180×780 logical pixels (150% display scaling): `outputs/native-qa/1789453037142/02-plan-editor-dark.png` (stable, opaque dialog with visible input focus), `04-restore-dark.png` (loaded snapshot, path selection, search, pin/test recovery and restore action), and `05-overview-light.png` (real successful backup, restore and recovery-test history). No blocker or major visual defect remains in those states. The earlier 820×600 and 200% zoom views were also visually inspected; the final packaged `results.json` confirms no horizontal document overflow at 820×600 or 590×390 CSS pixels.

The packaged evidence records a successful plan save through the interface, 24 Tab presses retained inside the plan dialog, reduced-motion support, no page errors, and actual restic backup, restore and sample-recovery success. Window visibility was false, context isolation and renderer sandbox were enabled, and renderer Node access was absent. Screenshot QA does not establish screen-reader behavior, live Google authorization, physical drive reconnection, or interaction with native titlebar controls outside the captured web content. Those boundaries remain in `docs/validation.md`.

## Shared controls · 2026-09-15

Control polish follows the existing compact desktop hierarchy and theme tokens. Settings booleans use 34×20 sliding switches; membership and file selections retain square checkboxes. Dropdown triggers retain 33px field geometry, with anchored themed menus, selected checkmarks, keyboard focus, typeahead and Escape return. Native scrolling uses a shared thin thumb; fields and buttons use matching hover and press feedback. Motion is 140–160ms, interruptible, and removed for reduced motion. Existing 1180×780 and 820×600 constraints remain authoritative.

Radix Select supplies the missing accessible popup behavior alongside the existing Radix dialogs (MIT; adds the select primitive and its shared positioning/focus dependencies). CSS owns motion; no motion library is added. Empty and numeric domain values are encoded only inside the control and decoded before existing handlers run.

## Settings overhaul and scaling · 2026-09-15
Surface/job: configure appearance, background protection, destinations and maintenance. The current overhaul brief supersedes the centered-column topology above; existing screenshot, Windows typography and theme tokens remain authority. First viewport: section navigation, appearance and protection controls; secondary application actions follow. Compact 13px body, 16px section headings, 12px supporting text. A quiet vertical section rail and trailing switch column echo the protection ledger; no nested cards or decorative effects. Existing Radix selects, switches and confirmations remain. Persist 80–200% app zoom through validated settings and the engine store; main applies native page zoom. At 1180×780 use a rail/content split, at narrow effective widths wrap section navigation and stack field controls. Critical states: saving/failure, paused protection, unsupported cloud connection, empty destinations, narrow/high zoom, light/dark and keyboard focus.

## Overview insights contract · 2026-09-15

Surface/job: inspect backup activity, spot incomplete copies, and start a backup or recovery. Authority: current user request for charts and customization; retain the existing Windows shell, type and theme system.
First viewport: fixed page actions, a compact always-visible protection summary, then a wide daily activity plot beside an outcome ring. The destination ledger follows. Density: restrained 13px utility UI, 24px chart totals, quiet axes and 11px metadata.
Material: existing neutral canvas and surfaces; blue complete-backup bars, text-labeled amber/red/neutral incomplete outcomes; thin section boundaries. Signature: daily destination-run stacks, an explicit completion ring, and the source-to-copy ledger. No decorative chart series, generic metric-card grid, or storage-savings claims.
Controls: 7/30-day selector, Radix customization dialog with section checkboxes, explicit save and restore defaults. Preferences persist through validated settings IPC. Protection warnings and active jobs remain visible regardless of customization.
Data: charts use backup jobs from the latest 100 jobs in the state feed, grouped by local completion date; the scope is visible. Running jobs, restores and checks do not count as complete backups. Processed bytes include repeated files across runs/destinations and are not repository size.
Critical states: no plans, no history in range, all failed/partial/cancelled/interrupted, active/paused, unavailable destination despite an older success, no optional sections, pending/failed settings save, long names, dark/light.
Responsive: 1180×780 primary, 820×600 compact, 200% zoom. Charts reflow to one column; workspace retains scroll ownership. SVG/CSS use existing React and Radix primitives; no new package.


## Diagnostics workspace · 2026-09-15

Surface/job: investigate Sentry resource use and operation failures from Settings > Diagnostics. The supplied reference owns the vertical structure: footprint, host/collection, timeline, process ledger. Existing Sentry themes, Segoe typography and settings navigation own styling. First viewport presents live/paused collection, export, CPU/memory footprint and health; detailed logs follow. Use a single quiet footprint band, aligned key/value columns and thin table rules, 22px tabular readings, 14px section titles and 12px metadata. Blue CPU and amber memory lines have explicit labels and independent units. Primary action exports redacted evidence; pause, refresh, time range, search, severity/source filtering and row disclosure use existing controls. Signature: backup-worker breakdown, protection-aware health and timestamped request/job events. Avoid disconnected metric cards, invented I/O counters and success claims from worker liveness. Critical states: warming CPU sample, no logs/matches, partial worker failure, paused/stale capture, export failure/cancellation, long job errors, light/dark and keyboard focus. Reflow at 820×600 and 200% zoom, with local table scrolling only. No new UI dependency.
