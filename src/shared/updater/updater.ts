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
import { writable, get } from 'svelte/store';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { flushPendingSaves } from '$shared/persist';
import { openReleases } from '$shared/ipc';
import { parseReleaseNotes, type NoteItem } from './releaseNotes';

export type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'installing' | 'uptodate' | 'error';

/** Current updater state; 'ready' = downloaded, waiting for a restart. */
export const updateStatus = writable<UpdateStatus>('idle');
/** Version of the found update. */
export const updateVersion = writable<string>('');
/** Version currently running (as reported by the updater). */
export const updateCurrent = writable<string>('');
/** "What's new" items parsed from the release notes. */
export const updateNotes = writable<NoteItem[]>([]);
/** Download progress 0..1 while status is 'downloading'. */
export const updateProgress = writable<number>(0);
/** The one-off "ready to install" toast (U1); the toolbar pill stays. */
export const updateToast = writable<boolean>(false);

let pending: Update | null = null;

/**
 * Check for an update and download it in the background. `manual` surfaces
 * "up to date"/"error" states (Settings); the silent startup check stays quiet.
 */
export async function checkForUpdate(manual = false): Promise<void> {
  const status = get(updateStatus);
  if (status === 'downloading' || status === 'ready' || status === 'installing') return;
  updateStatus.set('checking');
  try {
    const update = await check();
    if (!update) {
      updateStatus.set(manual ? 'uptodate' : 'idle');
      return;
    }
    updateVersion.set(update.version);
    updateCurrent.set(update.currentVersion);
    updateNotes.set(parseReleaseNotes(update.body ?? ''));
    updateProgress.set(0);
    updateStatus.set('downloading');
    let total = 0;
    let received = 0;
    await update.download((event) => {
      if (event.event === 'Started') total = event.data.contentLength ?? 0;
      else if (event.event === 'Progress') {
        received += event.data.chunkLength;
        if (total > 0) updateProgress.set(received / total);
      }
    });
    pending = update;
    updateStatus.set('ready');
    updateToast.set(true);
  } catch (err) {
    console.error('updater: check/download failed', err);
    updateStatus.set(manual ? 'error' : 'idle');
  }
}

/** Install the downloaded update and relaunch into it; state is saved first. */
export async function installUpdate(): Promise<void> {
  if (!pending || get(updateStatus) !== 'ready') return;
  updateStatus.set('installing');
  updateToast.set(false);
  try {
    await flushPendingSaves();
    await pending.install();
    await relaunch();
  } catch (err) {
    console.error('updater: install failed', err);
    updateStatus.set('error');
  }
}

/** Open the public release notes in the browser. */
export function openReleaseNotes(): void {
  void openReleases().catch((err) => console.error('updater: open releases failed', err));
}
