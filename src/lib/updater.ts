/**
 * In-app auto-update via the Tauri updater plugin. The app checks a signed
 * `latest.json` published on GitHub Releases (see `tauri.conf.json` ->
 * `plugins.updater`), and can download + install a newer signed bundle and
 * relaunch — all without leaving the app. Signature verification uses the
 * public key baked into the app; only releases signed with the matching private
 * key are accepted, so this is safe even though builds are unsigned by Apple.
 *
 * The network check runs on the Rust side (not the webview), so it is not
 * subject to the page CSP. All calls are guarded: a failed/again-offline check
 * never throws into the UI.
 */
import { writable, get } from 'svelte/store';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'uptodate'
  | 'error';

/** Current updater state, drives the banner. */
export const updateStatus = writable<UpdateStatus>('idle');
/** Version string of the available update (when status is 'available'+). */
export const updateVersion = writable<string>('');
/** Download progress 0..1 while status is 'downloading'. */
export const updateProgress = writable<number>(0);

let pending: Update | null = null;

/**
 * Check for an update. `manual` surfaces "up to date"/"error" states (for a
 * user-triggered check); the silent startup check leaves the banner hidden when
 * there's nothing to show.
 */
export async function checkForUpdate(manual = false): Promise<void> {
  if (get(updateStatus) === 'downloading') return;
  updateStatus.set('checking');
  try {
    const update = await check();
    if (update) {
      pending = update;
      updateVersion.set(update.version);
      updateStatus.set('available');
    } else {
      updateStatus.set(manual ? 'uptodate' : 'idle');
    }
  } catch (err) {
    console.error('updater: check failed', err);
    updateStatus.set(manual ? 'error' : 'idle');
  }
}

/** Download + install the pending update, then relaunch into the new version. */
export async function installUpdate(): Promise<void> {
  if (!pending) return;
  updateStatus.set('downloading');
  updateProgress.set(0);
  let total = 0;
  let received = 0;
  try {
    await pending.downloadAndInstall((event) => {
      if (event.event === 'Started') {
        total = event.data.contentLength ?? 0;
      } else if (event.event === 'Progress') {
        received += event.data.chunkLength;
        if (total > 0) updateProgress.set(received / total);
      } else if (event.event === 'Finished') {
        updateProgress.set(1);
      }
    });
    updateStatus.set('ready');
    await relaunch();
  } catch (err) {
    console.error('updater: install failed', err);
    updateStatus.set('error');
  }
}

/** Hide the banner (e.g. user dismissed an "up to date"/"error" notice). */
export function dismissUpdate(): void {
  updateStatus.set('idle');
}
