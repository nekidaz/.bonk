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
  gitRebaseUndo,
  gitRestoreSnapshot,
  gitHead,
  gitMoveHead,
  gitDeleteBranch,
  gitDeleteRemoteBranch,
  gitRenameBranch,
  gitDeleteTag,
  gitPushTag,
} from '$shared/ipc';
import { isConflict, statusByPath } from './gitStatus';
import { openConflictsTab } from './diffTabs';
import { workspace } from '$entities/workspace';
import { t } from '$shared/i18n';
import { persisted } from '$shared/persist';

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
  /**
   * The last git action that can be taken back (GitKraken's Undo), null when none. Any other git op
   * clears it, so «Отменить» is always about the action just done.
   */
  undo = $state.raw<{ label: string; run: () => Promise<boolean> } | null>(null);
  /** News for a toast (the app shows it, then clears this): a rebase that finished or paused. */
  notice = $state.raw<{ text: string; undo?: () => void } | null>(null);
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
  git.undo = null;
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

// ---- Undo: each undoable action records how to take itself back once it succeeded. ----

/** Offer `run` as the undo of what was just done; `toast` also says so with an «Отменить» button. */
function offerUndo(label: string, run: () => Promise<boolean>, toast?: string): void {
  const entry = { label, run };
  git.undo = entry;
  // The toast's button undoes this action only while it still is the last one.
  if (toast) git.notice = { text: toast, undo: () => void (git.undo === entry && undoLast()) };
}

/** Take back the last undoable git action. */
export function undoLast(): Promise<boolean> {
  const u = git.undo;
  git.undo = null;
  return u ? u.run() : Promise.resolve(false);
}

/** The full HEAD hash before / after an action ('' when unknown or unborn). */
const headNow = (): Promise<string> => (workspace.path ? gitHead(workspace.path).catch(() => '') : Promise.resolve(''));

/** Move HEAD back from `after` to `before` (refused if it moved since). */
const moveHeadBack = (name: string, after: string, before: string, mode: 'soft' | 'mixed' | 'keep') =>
  runGit(name, (root) => gitMoveHead(root, after, before, mode));

export async function discardPaths(paths: string[]): Promise<boolean> {
  if (!paths.length) return true;
  let snapshot = '';
  const ok = await runGit('discard', async (root) => {
    snapshot = await gitDiscard(root, paths);
  });
  if (ok && snapshot)
    offerUndo(
      t('git.undo.discard'),
      () => runGit('restore', (root) => gitRestoreSnapshot(root, snapshot, paths)),
      t('git.undo.discarded', { n: paths.length }),
    );
  return ok;
}

/** Commit the staged index with `message` (or amend the last commit). Clears the shared message on success. */
export async function commitChanges(message: string, amend = false): Promise<boolean> {
  const msg = message.trim();
  if (!msg) return false;
  const before = await headNow();
  const ok = await runGit('commit', (root) => gitCommit(root, msg, amend));
  if (ok && message === git.message) {
    git.message = '';
    git.amend = false;
  }
  const after = ok ? await headNow() : '';
  // Undone softly: the changes are staged again and the message is back in the box.
  if (before && after && before !== after)
    offerUndo(t('git.undo.commit'), async () => {
      const back = await moveHeadBack('undo commit', after, before, 'soft');
      if (back && !git.message.trim()) git.message = msg;
      return back;
    });
  return ok;
}

export async function initRepo(): Promise<void> {
  await runGit('init', (root) => gitInit(root));
}

export async function createBranch(name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) return;
  const from = git.status?.branch ?? '';
  if (!(await runGit('create-branch', (root) => gitCreateBranch(root, clean)))) return;
  // Back to where it was made from (same commit, changes ride along), then the branch goes.
  if (from)
    offerUndo(t('git.undo.branch', { name: clean }), () =>
      runGit('undo branch', async (root) => {
        await gitCheckout(root, from);
        await gitDeleteBranch(root, clean, false);
      }),
    );
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
  const fromHead = from ? '' : await headNow();
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
  offerBack(from, fromHead);
  return true;
}

/** After a switch: undo goes back to the branch (or detached commit) it left. */
function offerBack(from: string, fromHead: string): void {
  if (from)
    offerUndo(t('git.undo.checkout', { name: from }), async () => {
      await requestCheckout(from);
      return true;
    });
  else if (fromHead) offerUndo(t('git.undo.checkout', { name: fromHead.slice(0, 7) }), () => checkoutCommit(fromHead));
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
  // Stopped on conflicts. A rebase paused at an `edit` is not: a refused continue there is news.
  const stopped = () => !!git.status?.operation && !git.op?.paused;
  const ok = await runGit(name, fn, stopped);
  if (!ok && stopped()) openConflictsTab();
  if (ok && git.op?.paused) git.notice = { text: t('git.op.pausedToast', { short: git.op.hash.slice(0, 7) }) };
  else if (ok && !stopped() && git.status?.undoRebase && ['rebase', 'continue', 'skip'].includes(name))
    offerUndo(t('git.undo.rebase'), undoRebase, t('git.rb.done'));
  return ok;
}

/**
 * Delete a local branch. One whose commits aren't merged anywhere is refused unless `force`;
 * `quiet` keeps that refusal out of the toast (the caller asks and retries).
 */
export async function deleteBranch(name: string, force: boolean, quiet = false): Promise<boolean> {
  let tip = '';
  const ok = await runGit(
    'delete branch',
    async (root) => {
      tip = await gitDeleteBranch(root, name, force);
    },
    () => quiet,
  );
  if (ok && tip)
    offerUndo(
      t('git.undo.deleteBranch', { name }),
      () => runGit('restore branch', (root) => gitCreateBranchAt(root, name, tip)),
      t('git.undo.branchDeleted', { name }),
    );
  return ok;
}
/** Delete `origin/x` on its remote. */
export const deleteRemoteBranch = (name: string) =>
  runGit('delete remote branch', (root) => gitDeleteRemoteBranch(root, name));
export const renameBranch = (old: string, name: string) =>
  runGit('rename branch', (root) => gitRenameBranch(root, old, name.trim()));
/** Delete a tag here, and with `remote` on the push remote too. */
export const deleteTag = (name: string, remote: boolean) =>
  runGit('delete tag', (root) => gitDeleteTag(root, name, remote));
export const pushTag = (name: string): Promise<string> => sync('push tag', (root) => gitPushTag(root, name));

/** Put the branch back where it was before the last rebase (while that is still undoable). */
export function undoRebase(): Promise<boolean> {
  const before = git.status?.undoRebase;
  return before ? runGit('undo rebase', (root) => gitRebaseUndo(root, before)) : Promise.resolve(false);
}
export async function checkoutCommit(hash: string): Promise<boolean> {
  const from = git.status?.branch ?? '';
  const fromHead = from ? '' : await headNow();
  const ok = await runGit('checkout', (root) => gitCheckoutDetached(root, hash));
  if (ok) offerBack(from, fromHead);
  return ok;
}

export async function resetTo(hash: string, mode: ResetMode): Promise<boolean> {
  const before = await headNow();
  const ok = await runGit('reset', (root) => gitReset(root, hash, mode));
  const after = ok ? await headNow() : '';
  // A hard reset's lost local changes don't come back; `keep` won't clobber newer ones either.
  if (before && after && before !== after)
    offerUndo(t('git.undo.reset'), () => moveHeadBack('undo reset', after, before, mode === 'hard' ? 'keep' : mode));
  return ok;
}
export const createTag = (name: string, hash: string) => runGit('tag', (root) => gitCreateTag(root, name.trim(), hash));
export async function createBranchAt(name: string, hash: string): Promise<boolean> {
  const clean = name.trim();
  const ok = await runGit('branch', (root) => gitCreateBranchAt(root, clean, hash));
  // It points at a commit the graph already showed, so forcing the delete loses nothing.
  if (ok)
    offerUndo(t('git.undo.branch', { name: clean }), () =>
      runGit('undo branch', (root) => gitDeleteBranch(root, clean, true)),
    );
  return ok;
}
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
  git.undo = null;
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

/** Minutes between background fetches (GitKraken's auto-fetch); 0 = off. */
export const AUTO_FETCH_MINUTES = [0, 1, 5, 15] as const;
export const gitAutoFetch = persisted<number>('gitAutoFetch', 5, (v): v is number =>
  (AUTO_FETCH_MINUTES as readonly unknown[]).includes(v),
);

/**
 * Fetch every `gitAutoFetch` minutes so ↓N stays true without pressing Fetch. Quiet: no busy state,
 * no toast when offline or the remote wants credentials; skipped while the window is hidden or an
 * op runs. Started once by startApp() (app/lifecycle); returns a stop function.
 */
export function watchGitAutoFetch(): () => void {
  return $effect.root(() => {
    // A boolean, so the many status refreshes don't restart the timer.
    const repo = $derived(!!git.status?.isRepo);
    $effect(() => {
      const minutes = gitAutoFetch.current;
      const root = workspace.path;
      if (!minutes || !root || !repo) return;
      const timer = setInterval(() => {
        if (document.hidden || git.pending || git.status?.operation || workspace.path !== root) return;
        void gitFetch(root).then(
          () => refreshGit(),
          () => {},
        );
      }, minutes * 60_000);
      return () => clearInterval(timer);
    });
  });
}

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
