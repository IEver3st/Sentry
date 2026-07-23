<div align="center">

<img src="./src-tauri/icons/128x128.png" width="96" alt="Sentry Backup icon" />

# Sentry Backup

**Configurable, automated backups for Windows.**

Protect important folders locally, in Google Drive, or in both locations with incremental change detection, scheduling, and a native desktop interface.

[![Latest Release](https://img.shields.io/github/v/release/IEver3st/Sentry?display_name=tag\&sort=semver)](../../releases/latest)
[![Platform](https://img.shields.io/badge/platform-Windows-0078D4?logo=windows)](../../releases/latest)
[![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8DB?logo=tauri)](https://tauri.app/)
[![Rust](https://img.shields.io/badge/backend-Rust-000000?logo=rust)](https://www.rust-lang.org/)
[![License](https://img.shields.io/github/license/IEver3st/Sentry)](./LICENSE)

[Download Sentry](../../releases/latest) · [Report an issue](../../issues) · [View source](../../)

</div>

---

## Overview

Sentry is a native Windows backup utility built to make routine data protection simple and visible.

Create independent backup sets, select the folders that matter, choose a local destination or Google Drive, and let Sentry handle the rest. Incremental backups compare file hashes against previous manifests, allowing unchanged files to be skipped instead of repeatedly archiving the same data.

The project was created after an SSD failure caused the loss of important files on a personal server. Sentry is the practical response: a straightforward backup system designed to prevent the same failure from happening twice.

> [!IMPORTANT]
> Sentry is feature complete and is now in maintenance mode. Version `1.0.2` is the final planned release, and automatic application updates are disabled.

## Features

### Configurable backup sets

* Combine multiple source directories into a single backup set
* Store backups locally, in Google Drive, or in both locations
* Enable or disable individual backup sets
* Configure file and directory exclusion patterns
* Use presets for documents, photographs, source code and desktop files
* Track backup count, last execution time and total data protected

### Incremental backups

Sentry uses SHA-256 file hashes and backup manifests to detect changes between runs.

Only new or modified files are included when incremental mode is enabled. When no changes are detected, Sentry skips the archive rather than creating an unnecessary duplicate.

```text
Source folders
      │
      ▼
Directory scan
      │
      ▼
SHA-256 change detection
      │
      ▼
Compressed ZIP archive
      │
      ├── Local destination
      │
      └── Google Drive + manifest
```

### Scheduling and automation

* Daily backup schedules
* Weekly schedules with selectable days
* Monthly schedules
* Manual backup execution
* “Backup Now” system-tray action
* Optional launch at Windows startup
* Minimise-to-tray behaviour
* Backup progress and completion notifications

### Google Drive integration

Connect your own Google Drive account through OAuth 2.0 to:

* Upload backup archives automatically
* Store a matching JSON manifest with each archive
* View available cloud backups from within Sentry
* Inspect file counts and compressed sizes
* Monitor Google Drive storage usage
* Download complete backup bundles
* Open backups directly in Google Drive
* Delete cloud backups when they are no longer required

Cloud storage is optional. Backup sets can remain entirely local.

### Monitoring and visibility

* Dashboard showing backup-set status and historical totals
* Live scanning, compression, upload and download progress
* Current file and byte-level progress reporting
* Light, dark and system themes
* Weather-alert visibility
* Experimental weather-trigger configuration
* Google Drive connection and quota status

## Screenshots

Add a dashboard screenshot here to show Sentry’s backup status, recent activity and weather-alert interface.

```md
![Sentry dashboard](./docs/sentry-dashboard.png)
```

## Installation

Sentry currently provides a Windows NSIS installer.

1. Open the [latest release](../../releases/latest).
2. Download the Windows `.exe` installer.
3. Run the installer.
4. Open Sentry and complete the initial setup.
5. Create your first backup set and select its source folders.
6. Choose a local destination, Google Drive, or both.
7. Run the first backup manually before relying on a schedule.

> [!NOTE]
> Always verify that the first archive contains the expected files. A backup system deserves evidence, not optimism.

## Google Drive setup

Sentry uses your own Google Cloud OAuth application rather than a shared hosted account.

### 1. Create Google OAuth credentials

1. Open the Google Cloud Console.
2. Create or select a project.
3. Enable the **Google Drive API**.
4. Configure the OAuth consent screen.
5. Create an **OAuth 2.0 Client ID**.
6. Add the following authorised redirect URI:

```text
http://localhost:3000
```

### 2. Connect from Sentry

Open **Cloud Storage**, select **Connect Google Drive**, and enter the client ID and client secret.

Developers can instead provide the credentials through `src-tauri/.env`:

```env
GOOGLE_DRIVE_CLIENT_ID=your_client_id
GOOGLE_DRIVE_CLIENT_SECRET=your_client_secret
```

Use `src-tauri/env.example` as the starting template.

## Backup behaviour

A backup set contains:

| Setting           | Purpose                                            |
| ----------------- | -------------------------------------------------- |
| Sources           | One or more directories to protect                 |
| Exclusions        | Files or directories that should be ignored        |
| Incremental mode  | Includes only files whose SHA-256 hash has changed |
| Local destination | Directory where local ZIP archives are stored      |
| Cloud upload      | Uploads the archive and manifest to Google Drive   |
| Compression       | Creates a standard deflated ZIP archive            |
| Schedule          | Determines when the backup set runs automatically  |

Default exclusions include common generated or temporary content such as:

```text
node_modules
.git
__pycache__
target
.DS_Store
Thumbs.db
*.tmp
*.temp
*.log
```

Review these exclusions before protecting a project with unusual directory names.

## Restoring files

Sentry downloads cloud backup bundles to:

```text
~/Downloads/SentryBackups
```

Each bundle contains:

* A compressed ZIP archive containing the backed-up files
* A JSON manifest describing the backup and its contents

Sentry does not currently perform an in-place restoration. Extract the downloaded archive manually and copy the required files to their intended destination.

This avoids silently overwriting newer files, though it does make restoration a deliberate operation.

## Development

### Prerequisites

* Windows 10 or Windows 11
* [Bun](https://bun.sh/) `1.3.3` or newer
* Stable Rust toolchain
* Tauri system prerequisites
* Google Cloud OAuth credentials for Drive development

### Clone and install

```powershell
git clone https://github.com/IEver3st/Sentry.git
cd Sentry
bun install
```

### Configure Google Drive

```powershell
Copy-Item src-tauri/env.example src-tauri/.env
```

Then populate:

```env
GOOGLE_DRIVE_CLIENT_ID=
GOOGLE_DRIVE_CLIENT_SECRET=
```

Google Drive is optional during local development. Leave the credentials unset when working exclusively with local backups.

### Run the desktop application

```powershell
bun run tauri dev
```

### Run the frontend only

```powershell
bun run dev
```

### Create a production build

```powershell
bun run tauri build
```

The Windows installer will be generated under:

```text
src-tauri/target/release/bundle/nsis/
```

## Technology

| Layer              | Technology                                            |
| ------------------ | ----------------------------------------------------- |
| Desktop runtime    | Tauri 2                                               |
| Backend            | Rust                                                  |
| Frontend           | React 19 and TypeScript                               |
| Build tooling      | Vite and Bun                                          |
| Interface          | Tailwind CSS and Radix UI                             |
| State management   | Zustand                                               |
| Animation          | Framer Motion                                         |
| Compression        | ZIP / Deflate                                         |
| Change detection   | SHA-256                                               |
| Cloud storage      | Google Drive API with OAuth 2.0                       |
| Native integration | File system, notifications, autostart and system tray |

## Project structure

```text
Sentry/
├── src/
│   ├── components/
│   │   ├── backups/       # Backup-set configuration
│   │   ├── cloud/         # Google Drive management
│   │   ├── dashboard/     # Status and activity overview
│   │   ├── downloads/     # Download progress
│   │   ├── onboarding/    # Initial configuration
│   │   ├── schedule/      # Backup scheduling
│   │   └── settings/      # Application preferences
│   └── lib/
│       ├── backupRunner.ts
│       ├── store.ts
│       └── tauri.ts
├── src-tauri/
│   └── src/
│       ├── backup/        # Scanning, manifests and ZIP creation
│       ├── cloud/         # Google Drive OAuth and transfers
│       ├── weather/       # Weather conditions and alerts
│       ├── commands.rs    # Frontend/backend command bridge
│       ├── lib.rs         # Tauri application and tray setup
│       └── state.rs       # Persistent application state
└── website/               # Project website
```

## Project status

Sentry is **feature complete** and no longer has an active feature roadmap.

The application remains available as:

* A usable Windows backup utility
* An open-source reference for Tauri and Rust development
* A foundation for personal forks and specialised backup workflows

Existing installer builds remain available through GitHub Releases. No continued support, compatibility updates or security fixes are guaranteed.

## Limitations

* Official builds are currently Windows-only
* Google Drive is the only supported cloud provider
* Google OAuth credentials must be supplied by the user
* Restores require manually extracting downloaded archives
* Weather-trigger functionality should be considered experimental
* Retention settings should not replace periodic manual verification
* No further application releases are currently planned

## Data and privacy

Backups are assembled and compressed on your computer.

Files leave the machine only when Google Drive upload is enabled for the relevant backup set. Sentry does not require a hosted Sentry account or proprietary cloud service; Google Drive access is performed using the OAuth credentials configured by the user.

As with any backup utility, review the source code and test recovery before trusting it with irreplaceable data.

## Licence

Sentry is released under the [MIT Licence](./LICENSE).

You may use, modify and distribute the software in accordance with the licence terms.

## Name disclaimer

This project is not affiliated with, endorsed by or connected to **Sentry.io** or the `getsentry` organisation.

---

<div align="center">

Built after learning the expensive way that one copy is not a backup.

</div>
