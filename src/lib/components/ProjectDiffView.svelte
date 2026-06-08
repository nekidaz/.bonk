<script lang="ts">
  /**
   * Project Diff: every changed file in the workspace stacked in one tab, each
   * with stage/unstage/discard, plus a commit box. Reads batched diffs from the
   * Rust core and refreshes after every mutation.
   */
  import { workspacePath, requestConfirm } from '../stores';
  import { gitStatusDiffs } from '../api';
  import { gitStatusVersion, gitBusy, stagePaths, unstagePaths, discardPaths, commitChanges } from '../git';
  import type { FileDiff } from '../domain/types';
  import { diffStats } from '../domain/diff';
  import DiffBlock from './DiffBlock.svelte';

  let files = $state<FileDiff[]>([]);
  let loading = $state(false);
  let error = $state('');
  let commitMessage = $state('');
  let loadSeq = 0;

  const stagedCount = $derived(files.filter((f) => f.staged).length);

  async function load(): Promise<void> {
    const root = $workspacePath;
    if (!root) {
      files = [];
      return;
    }
    const seq = ++loadSeq;
    loading = true;
    error = '';
    try {
      const result = await gitStatusDiffs(root);
      if (seq !== loadSeq) return;
      files = result;
    } catch (err) {
      if (seq !== loadSeq) return;
      error = String(err);
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  // Reload whenever the workspace changes or any git mutation bumps the version.
  $effect(() => {
    void $workspacePath;
    void $gitStatusVersion;
    void load();
  });

  function basename(p: string): string {
    const parts = p.replace(/\/+$/, '').split('/');
    return parts[parts.length - 1] || p;
  }

  async function stage(f: FileDiff): Promise<void> {
    await stagePaths([f.path]);
  }
  async function unstage(f: FileDiff): Promise<void> {
    await unstagePaths([f.path]);
  }
  async function discard(f: FileDiff): Promise<void> {
    if (await requestConfirm(`Discard changes to ${basename(f.path)}? This can't be undone.`, 'Discard')) {
      await discardPaths([f.path]);
    }
  }
  async function commit(): Promise<void> {
    if (!commitMessage.trim() || stagedCount === 0) return;
    await commitChanges(commitMessage);
    commitMessage = '';
  }
</script>

<div class="bs-projdiff">
  <div class="bs-projdiff-commit">
    <textarea class="bs-git-msg" placeholder="Commit message" rows="2" bind:value={commitMessage}></textarea>
    <button class="bs-btn primary" type="button" disabled={!commitMessage.trim() || stagedCount === 0 || $gitBusy} onclick={commit}>
      <span class="material-symbols-outlined" style="font-size:15px;vertical-align:-3px">check</span>
      Commit{stagedCount ? ` (${stagedCount})` : ''}
    </button>
  </div>

  {#if error}
    <div class="bs-git-diff-error">{error}</div>
  {:else if loading && files.length === 0}
    <div class="bs-git-diff-empty"><span class="send-spinner" aria-hidden="true"></span> Loading changes…</div>
  {:else if files.length === 0}
    <div class="bs-git-diff-empty">No changes.</div>
  {:else}
    {#each files as f (f.path)}
      {@const s = diffStats(f.diff)}
      <div class="bs-projdiff-file">
        <div class="bs-projdiff-fhead">
          <span class="bs-projdiff-fpath">{f.path}</span>
          {#if s.additions || s.deletions}
            <span class="bs-git-diff-stats">
              <span class="add">+{s.additions}</span>
              <span class="del">-{s.deletions}</span>
            </span>
          {/if}
          <div class="grow"></div>
          {#if f.staged}
            <button class="bs-btn ghost" type="button" onclick={() => unstage(f)}>Unstage</button>
          {:else}
            <button class="bs-btn ghost" type="button" onclick={() => stage(f)}>Stage</button>
          {/if}
          <button class="bs-btn ghost" type="button" onclick={() => discard(f)}>Discard</button>
        </div>
        <DiffBlock text={f.diff} />
      </div>
    {/each}
  {/if}
</div>
