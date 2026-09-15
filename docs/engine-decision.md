# Backup engine decision

Status: adopted after the Windows fixture proof on September 15, 2026.

## Comparison

| Candidate | Windows and packaging | Google Drive | Recovery, encryption, retention | Integration fit |
| --- | --- | --- | --- | --- |
| restic 0.19.1 | One Go executable, official Windows x64 ZIP, BSD-2-Clause | Documented rclone transport | Encrypted, deduplicated complete snapshots; independent restore/check; retention and pinned tags | Selected. Sentry owns lifecycle and SQLite; restic owns the backup format. |
| Kopia | Windows executable, Apache-2.0 | Official documentation labels native Drive and rclone experimental | Encrypted snapshots, repository-contained recovery metadata, policies | Strong alternative; experimental transport increases integration uncertainty. |
| Duplicati | Windows application/CLI and .NET runtime, MIT | Native Drive backend and OAuth helper | Encrypted blocks, restore without original local database, retention | More application/service/catalog machinery overlaps Sentry responsibilities. |

These are architectural judgments, not comparative performance benchmarks. Official documentation reviewed: [restic introduction](https://restic.net/), [repository backends](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html), [backup behavior](https://restic.readthedocs.io/en/stable/040_backup.html), [restore](https://restic.readthedocs.io/en/stable/050_restore.html), [retention](https://restic.readthedocs.io/en/stable/060_forget.html), [Kopia repositories](https://kopia.io/docs/repositories/), [Duplicati Drive](https://docs.duplicati.com/backup-destinations/file-synchronization-providers/googledrive-destination), [Duplicati Windows](https://docs.duplicati.com/platform-specific-guides/using-duplicati-with-windows), and [rclone Drive](https://rclone.org/drive/).

## Format and transport

Use restic format 2. Each destination is an independent encrypted repository, with its own confirmed snapshot and failure state. rclone 1.75.1 is a transport helper for Drive, not a second backup engine. Restic manages encrypted object uploads directly; Sentry does not mirror a mutable local repository into the cloud. A failed cloud write cannot change a completed local snapshot. Interrupted operations retry against the repository; committed snapshots are the recovery boundary.

Passwords and OAuth tokens are supplied only through child environment, never command arguments. Electron safeStorage owns persisted encryption. Environment access remains possible for sufficiently privileged local processes; this is not a claim of protection from an administrator. Processes use explicit executable paths, argument arrays, no shell, hidden console windows, bounded concurrency, 16 MiB target packs, and a 128 MiB Go soft memory limit. Repository index size still affects restic memory; the limit is a soft target, not a guarantee.

Original source paths and plan names are saved as encoded snapshot tags. Importing a repository requires its password and no Sentry database. Tags are metadata encoded for syntax, not custom encryption. All repository metadata remains engine encrypted. Changing tags changes snapshot identifiers, so Sentry refreshes its catalog after pin changes.

Snapshots begin with an incomplete tag. Only successful, warning-free completion removes that tag. Exit 3 and skipped links remain partial, preventing unreadable files from being presented as fully protected. Backup is ordinary file backup. Optional VSS uses restic's Windows mechanism, but application-consistent database or system recovery is not asserted.

## Source and restore safety

Absolute source identities distinguish identical relative filenames. Overlapping roots, links as source roots, and source/destination nesting are rejected after resolving existing path ancestors. Symlinks and junctions encountered while scanning are explicitly excluded and reported. Include rules use a streamed exact selection manifest, preventing newly appearing nonmatching files from slipping into a backup. Empty selected directories exclude their contents during the operation. Changing files are handled by restic; a unreadable source is a failure or incomplete snapshot, never silent success.

Restore reconstructs original drive/path hierarchy below the chosen destination, and restores source subtrees rather than unrelated system ancestors. The initial prototype found that restoring the entire absolute tree can reproduce `C:\Users` ACLs and then fail to restore that ancestor's timestamp. Source subtree restoration avoids importing those unrelated ACLs. Existing target junctions, unsafe snapshot paths, traversal, reserved Windows names, and selected repository links are rejected. Restic verifies restored contents. Choosing never-overwrite leaves existing collisions untouched; a collision is not evidence the existing file matches the backup.

## Evidence

`bun tests/engine-prototype.ts` passed using the actual pinned Windows restic executable before adapter implementation: two roots with `same.txt`, byte-for-byte restore, empty file and folder, Unicode names, one changed file, three unchanged files, deleted-file recovery from the older snapshot, incorrect password exit 12, no Sentry database, and full `check --read-data`.

`bun test tests/engine.test.ts` exercises the integrated adapter, repository identity, source tags, incremental summaries, root-isolated restore, missing application catalog, wrong credentials, pinned retention followed by restore, full integrity checking, include selection, and source recursion rejection. Retained fixture folders are printed by the tests for independent inspection.

`bun scripts/fetch-engines.ts` checks both a hardcoded reviewed SHA256 and the official release checksum document before extracting either executable. Original upstream license texts and version/source manifest are in `vendor/notices`. Release signing keys were not independently authenticated; checksum verification is not publisher code signing.

Google account transfer, quota behavior, external-device disconnection, VSS elevation, and physical power-loss durability require their respective environments. Local fixture success does not establish those results.

## Windows destination identity

`volume.ts` reads Windows Storage cmdlets through fixed, noninteractive PowerShell scripts. Values are environment inputs, subprocesses have a 10-second timeout and 16 KiB output limit, and no disk configuration is changed. `Get-Volume.UniqueId` records a mounted volume's identity independently of its drive letter. Reconnection requires exactly one volume matching that ID, followed by the service's separate encrypted repository-ID check. A matching volume alone is never authorization to initialize a replacement repository.

The September 15 fixture identified local drive C as disk 1, resolved its volume identity to the same path, rejected an unknown identity, and reported UNC paths as unsupported. No drive letter was changed during testing. Physical USB removal and reinsertion remain unverified. Same-disk warnings use Windows disk numbers only for ordinary SATA, ATA, NVMe, USB, or SAS disks; virtual, Storage Spaces, RAID, ambiguous and network storage report unknown rather than guessing.

Failure validation now includes a modified file held with a Windows exclusive handle (partial snapshot retained), forced cancellation during a real write, stale-lock cleanup followed by full integrity checking, repository directory disappearance/reconnection, and local snapshot survival after a separate transport failure. A real rclone local-backend repository completed backup and byte-for-byte restore, proving bundled helper discovery and environment configuration. That transport fixture does not establish Google Drive account behavior.

The include-selection fixture changes a selected file after scanning and creates two unmatched files, including one inside a directory that was empty during scanning. Restore contains the selected file's updated bytes and neither unmatched file. This demonstrates ordinary file consistency and exact inclusion boundaries; it is not a filesystem-wide point-in-time consistency claim.

Engine stdout lines are bounded at 16 MiB before line buffering, and stderr lines at 64 KiB. File listings stream record by record into the service catalog. Snapshot metadata is currently a bounded JSON response; very large exact-file selections can reach that explicit limit because restic records every selected input path. Source-root backups avoid that path-list growth. Oversized metadata fails visibly instead of growing memory without a bound. Drive credentials use environment-only remotes and rclone's config file is forced to the null device, so Sentry cannot read or modify an unrelated user rclone configuration.
