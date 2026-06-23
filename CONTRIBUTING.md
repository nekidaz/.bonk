# Contributing

Thanks for helping improve Bonk.

## Local Setup

```sh
npm ci
npm run tauri dev
```

Use `npm run dev` only for frontend-only UI work. Native Tauri commands are not
available in a plain browser tab.

## Before a Pull Request

Run the project checks:

```sh
npm run check
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

If a check cannot be run locally, mention it in the pull request.

## Code Style

- Keep changes scoped to the behavior being changed.
- Prefer existing Svelte/Rust patterns before adding new abstractions.
- Keep UI dense, native-feeling, and useful as a daily API client.
- Do not commit local workspace data, generated screenshots, logs, or agent
  scratch files.

## Request Storage

Workspace files are written under `.bonk/` in the selected workspace folder.
Changes to that format should stay backward-compatible or include a migration.
