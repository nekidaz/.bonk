# Changelog

All notable changes to bonk are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.5] - 2026-07-07

### Added
- `QUERY` HTTP method: a safe, idempotent request with a body (GET semantics
  with a payload). Available in the method dropdown with its own accent colour.

## [0.1.4] - 2026-07-02

### Added
- Postman-style variables: environments + globals with `{{var}}` resolution,
  inline highlighting, and a hover popover to quick-set or edit a value; an
  Environments manager tab and an environment selector in the tab bar.
- Pre-request + test scripts (sandboxed QuickJS, `pm.*` API) for HTTP **and
  gRPC** — CodeMirror editors with `pm.*` autocomplete and snippet columns,
  test results and console output in a Tests sub-tab of the response pane.
  gRPC pre-request scripts can patch the message/metadata before dispatch.
- Collection Runner: run a whole folder (HTTP + gRPC) with iterations, CSV/JSON
  data files (`pm.iterationData`), delay, stop-on-failure, live streaming
  results, and a JSON report export. Scripts run per request, and env/globals
  writes persist across the run.
- OpenAPI/Swagger import & export: import a spec from a file or paste it from
  the clipboard (creates a collection per tag + a `{{baseUrl}}` environment),
  export any folder as OpenAPI 3.0 JSON/YAML.
- Sidebar Filter box now works: collections filter by name / URL / gRPC
  endpoint (matching folders keep their subtree, ancestors auto-expand),
  history filters by URL; Escape or ✕ clears.
- Tab bar: tabs live in a horizontally scrolling strip (mouse wheel scrolls
  it; the active tab keeps itself visible), with a right-click context menu —
  New Request (⌘T), Duplicate Tab, Close Tab (⌘W), Close Other Tabs, Close
  All Tabs.
- Drag-and-drop to move requests/folders in the sidebar tree.

### Changed
- gRPC message and metadata editors are CodeMirror now, with JSON syntax
  highlighting and `{{var}}` highlighting/quick-set; the non-functional
  Authorization and Settings gRPC tab stubs are gone for now.
- Editors across the app (URL bar, body, scripts) are CodeMirror 6 themed to
  the app palette.

### Fixed
- OpenAPI import no longer silently switches the active environment.
- Many open tabs can no longer push the Runner / environment / sidebar
  controls off-screen.
- macOS: ⌘W closes the active tab instead of the window.
- gRPC dial failures show the real error instead of schema guidance, and
  Invoke never no-ops silently (blank endpoint / missing method get their own
  messages).
- Single-line URL/endpoint text is vertically centered again.

## [0.1.3] - 2026-06-29

### Added
- Multi-language code snippets (Postman-style) in a resizable right-docked
  panel; export any request as a curl command.
- Paste a curl command into the URL bar to import it (incl. `-G` and
  `--data-urlencode`).
- Enable/disable toggles on query params; param descriptions and disabled
  rows survive URL edits.
- gRPC: neutral "load a schema" guidance when server reflection is
  unavailable, with a guided .proto import.
- Panel layout toggles (sidebar / response / code) in the bottom status bar;
  shadcn-style neutral zinc theme.

### Fixed
- Updater public key encoding (auto-update works again; signing key rotated).
- URL-encoded bodies keep `+` for spaces and preserve `{{vars}}`; GraphQL
  bodies get the right content-type.
- gRPC metadata keys are lowercased; IPv6 TLS SNI host fixed.
- Save errors surface in the Save dialog instead of being swallowed.

### Changed
- macOS builds are arm64-only (Intel/universal dropped).
- Releases cross-publish to the public repo; Git UI hidden behind a flag.

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
