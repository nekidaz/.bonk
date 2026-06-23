# Releasing bonk

bonk ships signed macOS + Linux + Windows bundles via GitHub Releases, supports
in-app auto-updates, and publishes package-manager channels. This is the
maintainer guide.

## One-time setup

### 1. Updater signing key (required for auto-update + signed bundles)

A keypair was generated with `npm run tauri signer generate`. The **public** key
is committed in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). The
**private** key must be added as repo secrets — never commit it.

In **GitHub → Settings → Secrets and variables → Actions**, add:

| Secret | Value |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | the full contents of the generated private key file |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the key password (empty string if generated without one) |

> If you lose the private key you can't sign updates that existing installs will
> accept — keep a backup. To rotate, generate a new key, replace the `pubkey` in
> `tauri.conf.json`, and ship it before the old installs can no longer update.

### 2. Homebrew tap (required for `brew install`)

Create a public repo **`nekidaz/homebrew-tap`** (the `homebrew-` prefix is what
lets `brew tap nekidaz/tap` work) with a placeholder `Casks/bonk.rb`. The
Homebrew workflow regenerates that file (version + sha256) on every published
release, so the placeholder content doesn't matter.

Then add a repo secret on **this** repo:

| Secret | Value |
| --- | --- |
| `HOMEBREW_TAP_TOKEN` | a fine-grained PAT with **Contents: read/write** on `nekidaz/homebrew-tap` |

The `Homebrew` workflow uses it to push the bumped cask after each release.

### 3. Chocolatey package (required for `choco install`)

Reserve and verify the Chocolatey package id **`bonk`**. The package template
lives in `packaging/chocolatey/`; the workflow injects the release version,
Windows installer URL, and SHA-256 checksum after a release is published.

Then add a repo secret on **this** repo:

| Secret | Value |
| --- | --- |
| `CHOCOLATEY_API_KEY` | Chocolatey API key with push access for package id `bonk` |

The `Chocolatey` workflow pushes the generated `.nupkg` after each release.

## Cutting a release

1. Bump the version in **all four** places (keep them in sync):
   `package.json`, `src-tauri/Cargo.toml`, `crates/bonk-core/Cargo.toml`,
   `src-tauri/tauri.conf.json`.
2. Update `CHANGELOG.md` (move `Unreleased` items under the new version + date).
3. Commit, then tag and push:

   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```

4. The **Release** workflow builds macOS (Apple Silicon `.dmg` + updater artifacts),
   Linux (`.AppImage` + `.deb` + updater artifacts), and Windows installer
   artifacts, signs them for the updater, generates `latest.json`, and uploads
   everything to a **draft** GitHub Release.
5. Review the draft, then **Publish** it.
6. Publishing fires the **Homebrew** workflow, which downloads the DMG, computes
   its sha256, and pushes an updated `Casks/bonk.rb` to the tap.
7. Publishing also fires the **Chocolatey** workflow, which downloads the
   Windows installer, computes its sha256, packs `bonk.nupkg`, and pushes it to
   Chocolatey.

## How auto-update works

- Each install has the updater public key baked in. On launch the app fetches
  `https://github.com/nekidaz/.bonk/releases/latest/download/latest.json`,
  compares versions, and (if newer) offers to download + install the **signed**
  bundle, then relaunch.
- Only releases signed with the matching private key are accepted, so unsigned
  (by Apple) builds are still safe to auto-update.
- `latest.json` resolves to the latest **published** (non-draft) release — the
  draft step (5) is your gate.

## Signing / notarization (optional, later)

Builds are currently unsigned by Apple/Microsoft. To remove the Gatekeeper /
SmartScreen warnings, add Apple `APPLE_*` (certificate, team id, notarization)
and Windows code-signing secrets and wire them into `tauri-action` in
`.github/workflows/release.yml`. The updater works either way.
