/**
 * Git source-control store + action wrappers.
 *
 * Every action operates on the current workspace path (`workspace.path`),
 * which the Rust git commands take as their `root`. Actions guard on a
 * non-empty workspace, catch failures into `git.error` (so a failed git op never
 * throws into the UI), and refresh the cached status afterwards. `watchGitWorkspace`
 * (started by app/lifecycle) re-reads (or clears) the status whenever the workspace
 * switches or closes.
 */
import { untrack } from 'svelte';
import type { GitCommit, GitStash, GitStatus, OperationInfo, RebaseAction, ResetMode } from '$shared/model';
import {
  gitStatus as gitStatusApi,
  gitStage,
  gitUnstage,
  gitCommit,
  gitInit,
  gitCheckout,
  gitCheckoutRemote,
  gitCreateBranch,
  gitPush,
  gitPull,
  gitDiscard,
  gitLog,
  gitStashList,
  gitStashPush,
  gitStashApply,
  gitStashPop,
  gitStashDrop,
  gitStashBranch,
  gitCherryPick,
  gitRevert,
  gitMerge,
  gitRebase,
  gitCheckoutDetached,
  gitReset,
  gitCreateTag,
  gitCreateBranchAt,
  gitFetch,
  gitOperationAbort,
  gitOperationContinue,
  gitOperationSkip,
  gitOperationInfo,
  gitResolveFile,
  gitResolveSide,
  gitUnresolve,
  gitRebaseInteractive,
} from '$shared/ipc';
import { isConflict, statusByPath } from './gitStatus';
import { openConflictsTab } from './diffTabs';
import { workspace } from '$entities/workspace';

/**
 * Master switch for the Git feature. When false the source-control UI is hidden
 * and `refreshGit` is a no-op, so the `git` CLI never runs. The backend commands
 * and this module stay intact — flip to `false` to hide the whole feature.
 */
export const GIT_ENABLED = true;

/** How many commits the sidebar's RECENT COMMITS section shows. */
const LOG_LIMIT = 10;

/** G11: a branch switch waiting for the user's choice about uncommitted changes. */
export interface PendingSwitch {
  name: string;
  remote: boolean;
}

/** G11: what to do with uncommitted changes when switching branches. */
export type SwitchChoice = 'stash' | 'carry' | 'discard';

class Git {
  /** Latest git status for the open workspace, or null when no workspace/repo. */
  status = $state.raw<GitStatus | null>(null);
  /** Recent commits (newest first) and stashes, re-read with the status. */
  log = $state.raw<GitCommit[]>([]);
  stashes = $state.raw<GitStash[]>([]);
  /** Bumps on every successful refresh; views read it to know to reload. */
  version = $state(0);
  /** Toplevel-relative path -> effective status letter. */
  statusMap = $derived(statusByPath(this.status?.files ?? []));
  /**
   * Workspace path relative to the git toplevel (trailing-slash form, e.g.
   * `"collections/"`), empty when the workspace is the toplevel. Tree-badge
   * lookups prefix workspace-relative node ids with this to reach the
   * toplevel-relative status keys.
   */
  prefix = $derived(this.status?.prefix ?? '');
  /** Git ops in flight; while any runs `busy` is true and the action buttons are disabled. */
  pending = $state(0);
  busy = $derived(this.pending > 0);
  /** Last failed git op's message (git's own stderr), '' when the last op succeeded. */
  error = $state('');
  /** The commit message, shared by the sidebar box and the commit-editor tab (G4b). */
  message = $state('');
  amend = $state(false);
  /** G3: where the branch popover is anchored (viewport px), null when closed. */
  branchMenu = $state.raw<{ x: number; y: number; up: boolean } | null>(null);
  /** G10: where the «Stash changes» popover is anchored, null when closed. */
  stashMenu = $state.raw<{ x: number; y: number } | null>(null);
  /**
   * G7: every file that was in conflict during the running operation — those no longer unmerged
   * were resolved and are listed as such. Cleared when the operation ends.
   */
  opConflicts = $state.raw<string[]>([]);
  /** G7: what the stopped operation is applying, null when none is running. */
  op = $state.raw<OperationInfo | null>(null);
  /** G11: the switch dialog's target, null when closed. */
  pendingSwitch = $state.raw<PendingSwitch | null>(null);
}
export const git = new Git();

/**
 * Re-read git status (plus log and stashes) for the current workspace. Empty workspace → null.
 * On error, log and leave the previous status in place (avoids flicker).
 */
let refreshSeq = 0;
export async function refreshGit(): Promise<void> {
  const seq = ++refreshSeq;
  if (!GIT_ENABLED) {
    git.status = null;
    return;
  }
  const path = workspace.path;
  if (!path) {
    git.status = null;
    git.log = [];
    git.stashes = [];
    return;
  }
  try {
    const status = await gitStatusApi(path);
    const [log, stashes, op] = status.isRepo
      ? await Promise.all([
          gitLog(path, LOG_LIMIT),
          gitStashList(path),
          status.operation ? gitOperationInfo(path) : null,
        ])
      : [[], [], null];
    git.status = status;
    git.log = log;
    git.stashes = stashes;
    const now = status.files.filter(isConflict).map((f) => f.path);
    git.op = op;
    git.opConflicts = status.operation ? [...new Set([...git.opConflicts, ...now])] : [];
    git.version++;
  } catch (err) {
    console.error('git: status failed', err);
  }
}

/**
 * Run `fn(root)` against the workspace path, then refresh. Failures land in `git.error` (after the
 * refresh, so `quiet` can look at the new status); returns success. `quiet(err)` true keeps a
 * failure out of `git.error` — a replay that stopped on conflicts is not an error to toast.
 */
async function runGit(name: string, fn: (root: string) => Promise<unknown>, quiet?: () => boolean): Promise<boolean> {
  const root = workspace.path;
  if (!root) return false;
  let failure: unknown = null;
  git.error = '';
  git.pending++;
  try {
    await fn(root);
  } catch (err) {
    console.error(`git: ${name} failed`, err);
    failure = err ?? 'failed';
  }
  try {
    await refreshGit();
  } finally {
    git.pending--;
  }
  if (failure !== null && !quiet?.()) git.error = String(failure);
  return failure === null;
}

export async function stagePaths(paths: string[]): Promise<void> {
  await runGit('stage', (root) => gitStage(root, paths));
}

export async function unstagePaths(paths: string[]): Promise<void> {
  await runGit('unstage', (root) => gitUnstage(root, paths));
}

export async function discardPaths(paths: string[]): Promise<boolean> {
  if (!paths.length) return true;
  return runGit('discard', (root) => gitDiscard(root, paths));
}

/** Commit the staged index with `message` (or amend the last commit). Clears the shared message on success. */
export async function commitChanges(message: string, amend = false): Promise<boolean> {
  const msg = message.trim();
  if (!msg) return false;
  const ok = await runGit('commit', (root) => gitCommit(root, msg, amend));
  if (ok && message === git.message) {
    git.message = '';
    git.amend = false;
  }
  return ok;
}

export async function initRepo(): Promise<void> {
  await runGit('init', (root) => gitInit(root));
}

export async function createBranch(name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) return;
  await runGit('create-branch', (root) => gitCreateBranch(root, clean));
}

/** Stash message that marks a G11 stash to pop automatically on returning to `branch`. */
const autoMessage = (branch: string) => `auto: ${branch}`;

/**
 * G11: switch to `name` (a remote one gets a local tracking branch). With uncommitted
 * changes this opens the switch dialog instead, which calls `switchBranch` with a choice.
 */
export async function requestCheckout(name: string, remote = false): Promise<void> {
  const clean = name.trim();
  if (!clean || (!remote && clean === git.status?.branch)) return;
  if (git.status?.files.length) {
    git.pendingSwitch = { name: clean, remote };
    return;
  }
  await switchBranch({ name: clean, remote }, 'carry', false);
}

/**
 * Switch branches, first doing `choice` with the uncommitted changes. `autoRestore` names the
 * stash so that coming back to the current branch pops it again.
 */
export async function switchBranch(to: PendingSwitch, choice: SwitchChoice, autoRestore: boolean): Promise<boolean> {
  const from = git.status?.branch ?? '';
  git.pendingSwitch = null;
  if (choice === 'stash') {
    const msg = autoRestore && from ? autoMessage(from) : `${from || 'HEAD'} → ${to.name}`;
    const ok = await runGit('stash', (root) =>
      gitStashPush(root, msg, { includeUntracked: true, stagedOnly: false, keepIndex: false }),
    );
    if (!ok) return false;
  } else if (choice === 'discard') {
    if (!(await discardPaths((git.status?.files ?? []).map((f) => f.path)))) return false;
  }
  const ok = await runGit('checkout', (root) =>
    to.remote ? gitCheckoutRemote(root, to.name) : gitCheckout(root, to.name),
  );
  if (!ok) return false;
  // Back on a branch we left with «return automatically»: pop its stash.
  const branch = git.status?.branch ?? '';
  const auto = git.stashes.find((s) => s.message === autoMessage(branch));
  if (auto) await runGit('stash-pop', (root) => gitStashPop(root, auto.index));
  return true;
}

export interface StashOptions {
  includeUntracked: boolean;
  stagedOnly: boolean;
  keepIndex: boolean;
}

export async function stashPush(message: string, o: StashOptions): Promise<boolean> {
  return runGit('stash', (root) => gitStashPush(root, message.trim(), o));
}

export async function stashApply(index: number): Promise<boolean> {
  return runGit('stash-apply', (root) => gitStashApply(root, index));
}

export async function stashPop(index: number): Promise<boolean> {
  return runGit('stash-pop', (root) => gitStashPop(root, index));
}

export async function stashDrop(index: number): Promise<boolean> {
  return runGit('stash-drop', (root) => gitStashDrop(root, index));
}

export async function stashBranch(name: string, index: number): Promise<boolean> {
  const clean = name.trim();
  if (!clean) return false;
  return runGit('stash-branch', (root) => gitStashBranch(root, clean, index));
}

// ---- G6: commit actions from the graph. Hashes come in list order (newest first). ----

/** Apply commits on top of the current branch, oldest first like the history they came from. */
export const cherryPick = (hashes: string[]) =>
  replay('cherry-pick', (root) => gitCherryPick(root, [...hashes].reverse()));
/** Undo commits with new commits, newest first so each revert applies cleanly. */
export const revertCommits = (hashes: string[]) => replay('revert', (root) => gitRevert(root, hashes));
export const mergeBranch = (branch: string) => replay('merge', (root) => gitMerge(root, branch));
export const rebaseOnto = (branch: string) => replay('rebase', (root) => gitRebase(root, branch));
/** G9: rewrite the commits above `onto` by the plan (pick / reword / squash / fixup / drop, in order). */
export const rebaseInteractive = (onto: string, steps: RebaseAction[]) =>
  replay('rebase', (root) => gitRebaseInteractive(root, onto, steps));

/**
 * An op that replays commits and may stop on conflicts. When it does, the git error is not the
 * news: the conflicts are, so their tab opens instead of a toast.
 */
async function replay(name: string, fn: (root: string) => Promise<unknown>): Promise<boolean> {
  const stopped = () => !!git.status?.operation;
  const ok = await runGit(name, fn, stopped);
  if (!ok && stopped()) openConflictsTab();
  return ok;
}
export const checkoutCommit = (hash: string) => runGit('checkout', (root) => gitCheckoutDetached(root, hash));
export const resetTo = (hash: string, mode: ResetMode) => runGit('reset', (root) => gitReset(root, hash, mode));
export const createTag = (name: string, hash: string) => runGit('tag', (root) => gitCreateTag(root, name.trim(), hash));
export const createBranchAt = (name: string, hash: string) =>
  runGit('branch', (root) => gitCreateBranchAt(root, name.trim(), hash));
/** G7: give up on, or go on with, a cherry-pick / merge / rebase / revert that stopped on conflicts. */
export const abortOperation = () => runGit('abort', gitOperationAbort);
export const continueOperation = () => replay('continue', gitOperationContinue);
export const skipOperation = () => replay('skip', gitOperationSkip);
/** Take one side for whole files; a side that deleted the file deletes it. */
export const resolveSide = (paths: string[], side: 'mine' | 'theirs') =>
  runGit('resolve', (root) => gitResolveSide(root, paths, side));
/** G8: write the merged text and mark the file resolved. */
export const resolveFile = (path: string, content: string) =>
  runGit('resolve', (root) => gitResolveFile(root, path, content));
/** Bring a resolved file's conflict back. */
export const unresolve = (paths: string[]) => runGit('unresolve', (root) => gitUnresolve(root, paths));

/**
 * Pull or push the current branch. Returns git's output (e.g. "Everything up-to-date")
 * or the error message so the UI can surface it. Sets git.busy for the duration.
 */
async function sync(name: string, fn: (root: string) => Promise<string>): Promise<string> {
  const root = workspace.path;
  if (!root) return '';
  git.pending++;
  git.error = '';
  try {
    const out = await fn(root);
    await refreshGit();
    return out;
  } catch (err) {
    console.error(`git: ${name} failed`, err);
    git.error = String(err);
    return String(err);
  } finally {
    git.pending--;
  }
}

export const pull = (): Promise<string> => sync('pull', gitPull);
export const fetchAll = (): Promise<string> => sync('fetch', gitFetch);
export const push = (force = false): Promise<string> => sync('push', (root) => gitPush(root, force));

/**
 * Keep git status in sync with the workspace: opening, switching or closing it re-reads (or clears) the
 * status at once; a changed tree (save, move, delete) or the window regaining focus (a commit made in a
 * terminal) re-reads it after a short pause. Started once by startApp() (app/lifecycle); returns a stop function.
 */
export function watchGitWorkspace(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void refreshGit(), 300);
  };
  const stop = $effect.root(() => {
    $effect(() => {
      void workspace.path;
      void untrack(refreshGit);
    });
    $effect(() => {
      void workspace.tree;
      untrack(later);
    });
  });
  window.addEventListener('focus', later);
  return () => {
    stop();
    clearTimeout(timer);
    window.removeEventListener('focus', later);
  };
}
