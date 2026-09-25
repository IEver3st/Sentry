# Windows updates

The installed app already checks for updates, downloads according to its settings, and installs on quit or through the update action. The release workflow builds its GitHub feed into the installer. Development builds do not update.

## Repository binding

On September 25, 2026, the owner authorized replacing `IEver3st/Sentry` with this Drive application (`sentry`, app ID `com.ever3st.sentry`). The older backup application (`sentry-backup`, app ID `com.frommeans.sentry`) is preserved at `backup/sentry-backup-before-drive-20260925`, commit `deefaad998ea35630d17d599da547714fd2aa1fd`. No older release tags or assets existed at activation. The new release series starts at `0.2.0`.

`electron-builder.yml` binds installed builds to the public `IEver3st/Sentry` feed. Release builds use `scripts/release-config.mjs`, which requires the source repository to match the explicitly configured `SENTRY_RELEASE_REPOSITORY` repository variable. The workflow also requires that repository to be public. This permits unauthenticated update downloads and keeps GitHub tokens out of the app.

The repository variable is configured as follows:

```powershell
gh variable set SENTRY_RELEASE_REPOSITORY --repo IEver3st/Sentry --body IEver3st/Sentry
```

Enable GitHub Actions if the repository has disabled it. No PAT secret is required. The build job gets read access; only the publish job receives `contents: write` through GitHub's temporary `GITHUB_TOKEN`. It uploads verified assets to a draft and then publishes it. It refuses to replace an already published release. Failed draft uploads can be retried.

This setup publishes from the same public repository as the source. A private source repository with a separate public release repository needs an explicit cross-repository GitHub App/token arrangement; the default `GITHUB_TOKEN` cannot publish across repositories.

## Publish a version

1. Commit the reviewed application, lockfile, workflow, and release helpers to the approved repository. Run the source checks before tagging.
2. Set `package.json` to the new version, add `docs/release-notes/vVERSION.md`, and commit both. Use `MAJOR.MINOR.PATCH` for stable releases or `MAJOR.MINOR.PATCH-beta.N` for the opt-in beta channel. The version must be newer than the installed release.
3. Push a matching tag, such as `v0.2.0`. The workflow rejects a tag that differs from `package.json`. A manual retry can select that same tag with `gh workflow run release.yml --repo IEver3st/Sentry --ref v0.2.0`.
4. Confirm the workflow and its public-manifest readback pass. The release must contain the installer, its `.blockmap`, `latest.yml` (or `beta.yml`), and `SHA256SUMS.txt`.
5. Install the first Drive release manually. This is a different application identity from Sentry Backup, not a backup-engine upgrade or data migration. Older packaged copies pointing at this repository may discover the replacement release; owners should stop the old backup app/service and install the Drive app intentionally. The new app does not migrate backup jobs, repositories, or credentials. Keep backup data and the old app available separately if needed. Verify a subsequent newer Drive release through Settings before claiming end-to-end upgrade/install proof.

The workflow runs source checks, builds the Windows x64 NSIS installer, verifies the embedded public feed and the installer's SHA-512 against the update manifest, creates SHA-256 checksums, and uploads only the release assets. Its final readback requests the published manifest and checksums without authentication.

No signing certificate is configured by this setup. The pipeline packages using electron-builder's normal Windows behavior; it does not claim a signed or SmartScreen-trusted installer. Configure the project's chosen signing service before requiring signed releases.

References: [electron-builder v26 auto-update](https://www.electron.build/v26/docs/features/auto-update/), [GitHub workflow tokens and permissions](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token).
