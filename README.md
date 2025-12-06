# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Prerequisites

- [Bun](https://bun.sh) 1.3.3 or newer (set via `packageManager`).
- Rust toolchain for Tauri.

## Install & run with Bun

```bash
bun install
bun run dev          # web dev server
bun run tauri dev    # Tauri dev window
bun run build        # type-check + Vite build
```

## Google Drive credentials

- Copy `src-tauri/env.example` to `src-tauri/.env` and fill `GOOGLE_DRIVE_CLIENT_ID` and `GOOGLE_DRIVE_CLIENT_SECRET`.
- The app will use these automatically for OAuth; leave the fields empty in the UI to use the .env values.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
