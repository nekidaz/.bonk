/**
 * Git source-control store + action wrappers.
 *
 * Every action operates on the current workspace path (`get(workspacePath)`),
 * which the Rust git commands take as their `root`. Actions guard on a
 * non-empty workspace, try/catch-log failures (so a failed git op never throws
 * into the UI), and refresh the cached status afterwards. `refreshGit` is also
 * subscribed to `workspacePath`, so switching/closing the workspace re-reads
 * (or clears) the status automatically.
 */
import { writable, derived, get } from 'svelte/store';
import type { GitStatus } from './domain/types';
import {
  gitStatus as gitStatusApi,
  gitStage,
  gitUnstage,
  gitCommit,
  gitInit,
  gitCheckout,
  gitCreateBranch,
  gitPush,
  gitPull,
  gitDiscard,
} from './api';
import { statusByPath } from './domain/gitStatus';
import { workspacePath } from './stores';

/**
 * Master switch for the Git feature. When false the source-control UI is hidden
 * and `refreshGit` is a no-op, so the `git` CLI never runs. The backend commands
 * and this module stay intact — flip to `true` to re-enable the whole feature.
 */
export const GIT_ENABLED = false;

/** Latest git status for the open workspace, or null when no workspace/repo. */
export const gitStatus = writable<GitStatus | null>(null);

/** Bumps on every successful refresh; views can subscribe to know to reload. */
export const gitStatusVersion = writable(0);

/** Toplevel-relative path -> effective status letter, derived from gitStatus. */
export const gitStatusMap = derived(gitStatus, ($s) => statusByPath($s?.files ?? []));

/**
 * Workspace path relative to the git toplevel (trailing-slash form, e.g.
 * `"collections/"`), empty when the workspace is the toplevel. Tree-badge
 * lookups prefix workspace-relative node ids with this to reach the
 * toplevel-relative status keys.
 */
export const gitPrefix = derived(gitStatus, ($s) => $s?.prefix ?? '');

/** True while a push/pull (or other long op) is in flight — disables buttons. */
export const gitBusy = writable<boolean>(false);

/**
 * Re-read git status for the current workspace. Empty workspace → null.
 * On error, log and leave the previous status in place (avoids flicker).
 */
export async function refreshGit(): Promise<void> {
  if (!GIT_ENABLED) {
    gitStatus.set(null);
    return;
  }
  const path = get(workspacePath);
  if (!path) {
    gitStatus.set(null);
    return;
  }
  try {
    gitStatus.set(await gitStatusApi(path));
    gitStatusVersion.update((n) => n + 1);
  } catch (err) {
    console.error('git: status failed', err);
  }
}

/** Run `fn(root)` against the workspace path, then refresh. Logs+swallows errors. */
async function runGit(name: string, fn: (root: string) => Promise<void>): Promise<void> {
  const root = get(workspacePath);
  if (!root) return;
  try {
    await fn(root);
  } catch (err) {
    console.error(`git: ${name} failed`, err);
  }
  await refreshGit();
}

export async function stagePaths(paths: string[]): Promise<void> {
  await runGit('stage', (root) => gitStage(root, paths));
}

export async function unstagePaths(paths: string[]): Promise<void> {
  await runGit('unstage', (root) => gitUnstage(root, paths));
}

export async function discardPaths(paths: string[]): Promise<void> {
  if (!paths.length) return;
  await runGit('discard', (root) => gitDiscard(root, paths));
}

export async function commitChanges(message: string): Promise<void> {
  const msg = message.trim();
  if (!msg) return;
  await runGit('commit', async (root) => {
    await gitCommit(root, msg);
  });
}

export async function initRepo(): Promise<void> {
  await runGit('init', (root) => gitInit(root));
}

export async function checkoutBranch(name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) return;
  await runGit('checkout', (root) => gitCheckout(root, clean));
}

export async function createBranch(name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) return;
  await runGit('create-branch', (root) => gitCreateBranch(root, clean));
}

/**
 * Push the current branch. Returns the git output (e.g. "Everything up-to-date")
 * or the error message so the UI can surface it in a status line. Sets gitBusy
 * for the duration.
 */
export async function pull(): Promise<string> {
  const root = get(workspacePath);
  if (!root) return '';
  gitBusy.set(true);
  try {
    const out = await gitPull(root);
    await refreshGit();
    return out;
  } catch (err) {
    console.error('git: pull failed', err);
    return String(err);
  } finally {
    gitBusy.set(false);
  }
}

export async function push(): Promise<string> {
  const root = get(workspacePath);
  if (!root) return '';
  gitBusy.set(true);
  try {
    const out = await gitPush(root);
    await refreshGit();
    return out;
  } catch (err) {
    console.error('git: push failed', err);
    return String(err);
  } finally {
    gitBusy.set(false);
  }
}

// Keep git status in sync with the active workspace: switching, opening, or
// closing the workspace re-reads (or clears, when empty) the status.
workspacePath.subscribe(() => {
  void refreshGit();
});
