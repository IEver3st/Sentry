# Recovery features

## Find and recover a version

Restore > File history searches one repository for an absolute file path, including versions where the file was deleted. Text previews are limited to 256 KiB and supported raster images to 4 MiB. Previews restore and verify captured bytes in temporary storage, then remove those files. Compare shows two versions side by side. Snapshot Changes uses restic's content comparison and offers the earlier version for deleted paths.

Settings > Recovery can register the installed application in Explorer's file context menu. Windows 11 places this entry under Show more options. Registration is opt-in and removable. Development and QA builds do not register Explorer actions.

## Checkpoints and independent copies

The Checkpoint action names a capture and keeps it for the selected period. Retention preserves an unexpired checkpoint tag. A permanent pin remains protected until explicitly removed. Neither feature guarantees a new capture if the job fails.

In a plan's Capture & automation options, select a capture repository to copy the same committed snapshot to other destinations. Copy jobs preserve the capture timestamp and tags. Changing live sources does not change a retry. Pending and unsuccessful copies prevent pruning or changing the source snapshot ID. Retry resolves that hold when it succeeds; Abandon copy releases it explicitly. Cancelling or failing a copy never marks its destination protected.

## Recovery drills and gaps

Optional scheduled drills restore and verify up to 12 files, spread across the size distribution with a rotating starting position. Files over 128 MiB are excluded from the sample; each drill has a 256 MiB total budget. The UI records the actual sample count and bytes. This is sample evidence, not verification of every file. Failed attempts remain visible and are not immediately repeated.

Protection review checks configured plans and explicitly chosen discovery roots plus their immediate child folders. It reports stale/missing copies, same-physical-disk placement when Windows supplies disk identity, important exclusions and discovered unprotected folders. Discovery is bounded and reports truncation. Review opens a plan for editing and does not silently expand backup coverage.

Backup on connection polls opted-in local repositories once a minute while the engine is available. Recorded volume identity can relocate a changed drive letter; repository identity is checked before work is queued. An overdue plan queues once per observed arrival. When that operation succeeds and no repository work remains, Overview says Sentry has finished using the drive. Windows Safely Remove Hardware still owns physical ejection.

## Recovery without this catalog

Export a recovery kit from Settings > Recovery and store it independently. It includes repository locations, identities and standalone restic/rclone instructions, never recovery passwords or cloud tokens. Store passwords separately. Practice recovery enters the password afresh, bypasses saved credentials and the snapshot/file catalog, and restores a verified sample to an empty folder outside sources, repositories and application data. It does not simulate an entire replacement PC or validate cloud sign-in on that PC.

Live SQLite capture stages an online backup of each selected database, validates it and saves original-path mappings in snapshot tags. Sentry restores the logical original paths. Standalone restic restores the captured staging paths; the recovery kit explains how to read the mapping tags. Multiple databases are each consistent, but do not share one atomic transaction. VSS capture is crash-consistent and requires the Windows privileges supported by restic; arbitrary application writers are not coordinated.

## Optional Windows service

1. Install Sentry at a stable location and connect destinations in the desktop application.
2. Export setup from Settings > Recovery into an empty folder. Export alone changes no services.
3. Quit Sentry. Open administrator Windows PowerShell and run the exported `service-setup.ps1`. Enter the Windows account that owns the Sentry data folder and its account password, not a Windows Hello PIN.
4. Reopen Sentry and check service status. Run a backup and recovery test before relying on signed-out protection.

The service uses that account to retain access to its DPAPI-encrypted credentials. Setup grants Log on as a service, installs a restricted host/configuration under ProgramData, and configures restart after failure. The account password is supplied through PowerShell's credential API, never a process argument or exported file. Desktop and host authenticate each other over a profile-specific named pipe; the token file is restricted to its owner, administrators and SYSTEM. Only one engine owns the catalog. A disconnected client shows last-known state and asks you to reopen it.

To remove the service, run the same exported script with `-Action Remove` as administrator, then reopen Sentry. Backup repositories, credentials and application data are preserved. Stop the service before updating Sentry or starting interactive Google authorization. The service has no interactive browser. Idle-only scheduling cannot establish the signed-in user's idle state in session 0 and stays waiting; turn off that policy if the service must run unattended. Network paths need access under the service account; mapped interactive drive letters may be unavailable.

Validation has exercised the hidden Electron host, client disconnect/reconnect and backup completion while the desktop is closed. Windows SCM installation, sign-out/reboot, physical drive removal, elevated VSS and a real Google account remain separate operational checks. See [validation evidence](validation.md).
