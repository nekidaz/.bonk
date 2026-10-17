# Contributing

Thanks for helping improve Bonk.

## Local Setup

Needs Node 24 and stable Rust (`rustup`).

```sh
make setup   # npm ci + cargo fetch
make dev     # desktop app with hot reload
```

`make ui` runs only the frontend in a browser. Native Tauri commands aren't
available there, so anything that talks to Rust will fail. `make` with no
arguments lists every target.

New to the codebase? Start with [ARCHITECTURE.md](ARCHITECTURE.md).

## Before a Pull Request

```sh
make check   # svelte-check, clippy -D warnings, vitest, cargo test, vite build
```

It runs the same steps as CI. If a check can't run locally, say so in the pull
request.

## Code Style

- Keep changes scoped to the behavior being changed.
- Prefer existing Svelte/Rust patterns before adding new abstractions.
- Keep UI dense, native-feeling, and useful as a daily API client.
- Do not commit local workspace data, generated screenshots, logs, or agent
  scratch files.

## Request Storage

A workspace is a plain folder: each subfolder is a collection folder and each
request is a `<name>.bonk.json` file. Folder-level auth lives in
`.folder.bonk.json`. Changes to that format should stay backward-compatible or
include a migration.
