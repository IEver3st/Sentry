# Scheduling, weather and Google Drive

## Ownership and scheduling

The engine worker owns timers, the SQLite ledger and job queue. `src/automation/schedule.ts` makes pure scheduling decisions. Store a plan's next due timestamp. When overdue, enqueue one catch-up job and advance it with `nextRun(schedule, now)` in the same transaction. Sleep or a long outage must not enqueue a backlog of identical jobs. Resume and startup must recheck persisted due times; policy blocks must leave due work pending.

Calendar schedules use the Windows local time zone. Daily and weekly schedules preserve the selected wall-clock time. A nonexistent spring-forward time rolls forward by the gap; a repeated autumn time runs at its first occurrence only. A monthly day beyond the month end uses that month's last day. Intervals use elapsed time. `reconcileTimeZone` preserves overdue work while recalculating future calendar times after a zone change. Explicit quit ends this process's protection.

## Weather

`checkWeather` uses NWS `/points/{latitude},{longitude}` to confirm coverage, then `/alerts/active?point=...`. It validates the response, requires actual alerts and active validity intervals, filters event and severity, and refuses stale response timestamps. Outside coverage and failed checks preserve the last successful check timestamp and expose an error. Requests time out and response bodies are bounded to 5 MB. The caller should schedule checks no faster than every five minutes and use failure backoff.

Persist `WeatherLedger` in SQLite. `checkWeather` returns eligible alerts without consuming them. Call `acknowledgeWeather` only in the durable transaction that enqueues the selected jobs. This avoids losing an alert when enqueue fails. Dedup IDs expire with alerts; cooldown is persisted. Order enabled selected plans by importance and estimated size, and their destinations off-device first. Ordinary schedules remain independent.

`simulateWeather` is a side-effect-free explanation of the configured automation. Its result is explicitly marked simulation, performs no request and starts no jobs. Display the result separately from real history and last-success timestamps.

Implementation uses the [NWS API documentation](https://www.weather.gov/documentation/services-web-api) and [alert API documentation](https://www.weather.gov/documentation/services-web-alerts), checked September 15, 2026.

## Google Drive setup

Production Google application registration was not supplied. Sentry must show Google as unconfigured until a real client ID is present. No fake connection or bundled rclone shared identity is used.

1. In Google Cloud, create or choose the Means/Sentry project and enable **Google Drive API**.
2. Configure the OAuth consent screen with the application's verified branding, support contact and privacy policy. Add intended test accounts while the project is in Testing.
3. Create an OAuth client with application type **Desktop app**. Do not use a Web, Android or iOS client. The desktop loopback flow binds an ephemeral `127.0.0.1` port.
4. Supply `SENTRY_GOOGLE_CLIENT_ID` to the main process. If the issued desktop client requires its client-secret configuration value, supply `SENTRY_GOOGLE_CLIENT_SECRET` too. A desktop client cannot keep this value confidential; user refresh tokens and repository passwords remain protected credentials. Never commit user tokens or private server credentials.
5. Complete Google's production publishing/verification requirements for the requested Drive scope before public distribution. Testing-mode refresh tokens and audience limits are unsuitable as a production connectivity guarantee.
6. Exercise connect, process restart, token refresh, real quota, backup, download/restore, cancellation and offline/reconnect against a dedicated test repository. These live account operations remain unverified without configured credentials and account consent.

The scope is `https://www.googleapis.com/auth/drive`. It supports reconnecting and discovering an existing repository after reinstall, including one created by a prior installation or another compatible client. This broader scope needs Google's applicable consent/verification; a future narrower scope would need an explicit existing-folder authorization flow before replacing it.

`GoogleDriveAuth` binds only loopback, generates cryptographic state and PKCE S256 for each attempt, validates host/path/state, times out after three minutes, and exchanges the code in an HTTPS POST body. `onAuthorize(url)` asks main to open the normal system browser only during a user-initiated connection. No browser is opened by the module itself. Error text never includes provider response bodies or tokens.

Inject `load` and `save` backed by Electron `safeStorage` in main. Only credential entry crosses preload; stored tokens never return to renderer. `refresh` is single-flight and saves updated tokens before use. `quota` queries the account quota and retries one authorization failure with a refreshed token. `environment` returns the `RCLONE_CONFIG_SENTRY_*` variables for a child-only environment; the remote is `sentry:`. Tokens must not be passed in arguments or diagnostic logs. rclone handles long transfers, retries and per-request refresh. The app refreshes from securely stored refresh credentials before each new operation. Disconnect deletes local credentials; Google Account access controls revoke all installations.

Protocol references: [Google installed application OAuth](https://developers.google.com/identity/protocols/oauth2/native-app), [Drive quota query](https://developers.google.com/workspace/drive/api/reference/rest/v3/about/get), and [rclone Google Drive backend](https://rclone.org/drive/), checked September 15, 2026.

## Evidence

`bun test tests/automation.test.ts` passed on Windows with Bun 1.3.6 on September 15, 2026: calendar/month-end/DST and missed schedules; actual/expired/test/cancelled/malformed/stale weather alerts; durable dedup/cooldown and isolated simulation; real local HTTP OAuth callback with rejected state, PKCE exchange fixture, refresh persistence, quota fixture, timeout, decline and cancellation. The provider responses in OAuth tests are fixtures, not Google account proof.

A live NWS point/active-alert request for 32.78,-96.8 succeeded at `2026-09-15T05:48:45.429Z` and returned one active alert. This proves network/coverage parsing for that location at that time, not end-to-end job scheduling or weather availability elsewhere.
