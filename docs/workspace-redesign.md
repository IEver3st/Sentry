# Backup workspaces · 2026-09-15

Surface/job: Backup Plans organizes sources, schedules and per-destination outcomes; Restore finds and safely recovers a saved version; Activity investigates individual operation outcomes. The user's circled screenshot defines the three routes and the empty-canvas problem. Existing DESIGN.md typography, theme tokens and shell remain authority.

First viewport: a useful state summary and direct action, followed by the actual plan library, repository/version/file workflow, or operation ledger. Empty states retain task structure with a concrete starting action and concise preparation guidance. No sample production history.

Hierarchy/density: 22px page headings, 16px task headings, 13px controls/body, 12px supporting data, tabular counts and dates. Compact aligned rows and thin separators. Blue indicates actions/selection; text accompanies outcome colors. Use existing Radix controls and CSS motion only.

Signature: source-to-copy plan rows with last complete copy; a numbered repository/version/recovery path; outcome filters above expandable operation details. Controls have a short spring-like settle, 1px hover lift and restrained press feedback. No idle animation or repeated row entrances; reduced motion is static.

Critical states: no plans/repositories/history, missing destination, no complete copy, disabled plans, loading/read errors, no filter matches, partial/failed/cancelled work, file selection, pagination, long paths and names. Filtering history explicitly applies to the loaded page, preserving engine-owned paginated catalog reads.

Responsive: 1180×780 and 820×600 native windows, 590×390 effective pixels at 200% zoom. Page owns scrolling; the populated recovery browser owns version/file scrolling on desktop and stacks at narrow widths. No horizontal page overflow. Existing work and IPC contracts are preserved.
