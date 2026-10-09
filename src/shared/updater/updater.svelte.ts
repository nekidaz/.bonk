/**
 * In-app auto-update via the Tauri updater plugin. The app checks a signed
 * `latest.json` published on GitHub Releases (see `tauri.conf.json` ->
 * `plugins.updater`), downloads a newer signed bundle in the background, and
 * installs + relaunches when the user asks — all without leaving the app.
 * Signature verification uses the public key baked into the app; only releases
 * signed with the matching private key are accepted, so this is safe even
 * though builds are unsigned by Apple.
 *
 * The network check runs on the Rust side (not the webview), so it is not
 * subject to the page CSP. All calls are guarded: a failed/again-offline check
 * never throws into the UI.
 */
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { flushPendingSaves } from '$shared/persist';
import { openReleases } from '$shared/ipc';
import { parseReleaseNotes, type NoteItem } from './releaseNotes';

export type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'installing' | 'uptodate' | 'error';

/** Updater state shown by the toolbar pill, the toast and Settings. */
class Updater {
  /** 'ready' = downloaded, waiting for a restart. */
  status = $state<UpdateStatus>('idle');
  /** Version of the found update. */
  version = $state('');
  /** Version currently running (as reported by the updater). */
  currentVersion = $state('');
  /** "What's new" items parsed from the release notes. */
  notes = $state.raw<NoteItem[]>([]);
  /** Download progress 0..1 while status is 'downloading'. */
  progress = $state(0);
  /** The one-off "ready to install" toast (U1); the toolbar pill stays. */
  toast = $state(false);
}
export const updater = new Updater();

let pending: Update | null = null;

/**
 * Check for an update and download it in the background. `manual` surfaces
 * "up to date"/"error" states (Settings); the silent startup check stays quiet.
 */
export async function checkForUpdate(manual = false): Promise<void> {
  const status = updater.status;
  if (status === 'downloading' || status === 'ready' || status === 'installing') return;
  updater.status = 'checking';
  try {
    const update = await check();
    if (!update) {
      updater.status = manual ? 'uptodate' : 'idle';
      return;
    }
    updater.version = update.version;
    updater.currentVersion = update.currentVersion;
    updater.notes = parseReleaseNotes(update.body ?? '');
    updater.progress = 0;
    updater.status = 'downloading';
    let total = 0;
    let received = 0;
    await update.download((event) => {
      if (event.event === 'Started') total = event.data.contentLength ?? 0;
      else if (event.event === 'Progress') {
        received += event.data.chunkLength;
        if (total > 0) updater.progress = received / total;
      }
    });
    pending = update;
    updater.status = 'ready';
    updater.toast = true;
  } catch (err) {
    console.error('updater: check/download failed', err);
    updater.status = manual ? 'error' : 'idle';
  }
}

/** Install the downloaded update and relaunch into it; state is saved first. */
export async function installUpdate(): Promise<void> {
  if (!pending || updater.status !== 'ready') return;
  updater.status = 'installing';
  updater.toast = false;
  try {
    await flushPendingSaves();
    await pending.install();
    await relaunch();
  } catch (err) {
    console.error('updater: install failed', err);
    updater.status = 'error';
  }
}

/** Open the public release notes in the browser. */
export function openReleaseNotes(): void {
  void openReleases().catch((err) => console.error('updater: open releases failed', err));
}
