# Changelog

All notable changes to bonk are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.2] - 2026-06-24

### Fixed
- Release pipeline: Linux AppImage bundling now runs `linuxdeploy` without FUSE
  (`APPIMAGE_EXTRACT_AND_RUN`), and Windows ships the NSIS installer only —
  dropping the flaky WiX/MSI download that failed release builds.
- Query params preserve `{{variables}}` through URL ↔ params round-trips.
- Git operations are correct when the repository root sits above the workspace
  (subdirectory repos); staged-modified hunks are shown in diffs.
- The focused tab is persisted and restored across restarts.
- gRPC: unsupported streaming RPCs are guarded, workspace load skips a corrupt
  request file instead of failing, and binary (`-bin`) metadata no longer panics.

## [0.1.1] - 2026-06-05

First tagged build with Windows installers and full package-manager + auto-update
distribution.

### Added
- Windows builds (NSIS `.exe` + MSI) in the release matrix.
- Chocolatey package (`choco install bonk`) published from the release pipeline.

### Changed
- Landing page: Rust/native performance section, scroll-triggered request→response
  demo, and cursor-follow interactivity.

## [0.1.0] - 2026-06-05

First public release.

### Added
- HTTP requests: method, URL, query params, headers, body (raw/JSON, form-data,
  url-encoded, binary, GraphQL), redirects, timing, response size, cancellation,
  and formatted (pretty/raw/preview) responses.
- gRPC requests: native server reflection, method picker, example message
  templates, metadata, and cancellation.
- Git source control (git-first): a Source-control sidebar panel + a single
  **Project Diff** tab showing every change at once with per-file stage /
  unstage / discard and an inline commit box; status badges (M/A/U/D + folder
  change counts) directly on the Collections tree; branch switch/create,
  pull/push, per-file diff, and a commit log — all driven by the system `git`
  CLI. Discard reverts to HEAD (including staged renames).
- File-based workspaces with nested folders — the on-disk directory tree *is* the
  workspace (folder = directory, request = `*.bonk.json`), no hidden manifest.
- Sidebar tree actions: add request (HTTP/gRPC), add folder, inline rename,
  duplicate, move, delete.
- Smart Save (⌘S): updates the backing collection file in place, or opens a
  destination picker for an unsaved request.
- Request history with a configurable limit, pause, per-entry delete, and
  one-click reopen of any past request in a new tab.
- cURL import.
- Resizable sidebar and request/response split, persisted across restarts.
- Big Sur-inspired UI with light and dark themes.

### Architecture
- Tauri-independent `bonk-core` Rust crate (HTTP/gRPC/workspace/state logic),
  a thin Tauri shell, and a Svelte 5 frontend. See `ARCHITECTURE.md`.
- App state (tabs, history, settings, workspace path) persisted by Rust in a
  single `state.json`.
- Frontend decomposed into focused components: a thin `App.svelte` shell plus
  per-area editors/dialogs (request editor split into URL bar + tabs +
  body/auth/headers/params, gRPC editor, git panel/diff, dialogs). Styles split
  from one monolith into ordered `src/styles/*.css` modules.

### Performance
- Flatten always-visible chrome (toolbar/sidebar/tab bar/status) to solid
  surfaces and add CSS containment on scroll regions, cutting WebKit compositing
  cost on hover while keeping the Big Sur look.

### Security
- Restrictive Content-Security-Policy on the webview (`script-src 'self'`,
  `default-src 'self'`) to mitigate injection from rendered response bodies.
- Fonts (code + icon) are vendored and loaded locally — no CDN, so the app
  renders fully offline and never phones home on launch.
- Least-privilege Tauri capabilities (removed the unused `opener` permission).

### Notes
- macOS builds are currently **unsigned**: on first open use right-click → Open
  to bypass Gatekeeper. Signed/notarized builds are planned.

[Unreleased]: https://github.com/nekidaz/.bonk/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/nekidaz/.bonk/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/nekidaz/.bonk/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/nekidaz/.bonk/releases/tag/v0.1.0
