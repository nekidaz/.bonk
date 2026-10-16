<script lang="ts">
  /**
   * Project Diff: every changed file in the workspace stacked in one tab, each
   * with stage/unstage/discard, plus a commit box. Reads batched diffs from the
   * Rust core and refreshes after every mutation.
   */
  import { workspace } from '$entities/workspace';
  import { requestConfirm } from '$shared/ui';
  import { gitStatusDiffs } from '$shared/ipc';
  import { stagePaths, unstagePaths, discardPaths, commitChanges, git } from '$entities/git';
  import type { FileDiff } from '$shared/model';
  import { diffStats } from './diff';
  import DiffBlock from './DiffBlock.svelte';
  import { t } from '$shared/i18n';
  import { Button } from '$shared/ui/components';
  import { GitError } from '$entities/git/components';

  let files = $state<FileDiff[]>([]);
  let loading = $state(false);
  let error = $state('');
  let commitMessage = $state('');
  let loadSeq = 0;

  const stagedCount = $derived(files.filter((f) => f.staged).length);

  async function load(): Promise<void> {
    const root = workspace.path;
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
    void workspace.path;
    void git.version;
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
    if (await requestConfirm(t('git.discard.confirm', { name: basename(f.path) }), t('git.discard'))) {
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
    <textarea class="bs-git-msg" placeholder={t('git.commit.placeholder')} rows="2" bind:value={commitMessage}
    ></textarea>
    <Button variant="primary" disabled={!commitMessage.trim() || stagedCount === 0 || git.busy} onclick={commit}>
      <span class="material-symbols-outlined" style="font-size:15px;vertical-align:-3px">check</span>
      {t('git.commit')}{stagedCount ? ` (${stagedCount})` : ''}
    </Button>
  </div>

  {#if error}
    <GitError>{error}</GitError>
  {:else if loading && files.length === 0}
    <div class="bs-git-diff-empty">
      <span class="send-spinner" aria-hidden="true"></span>
      {t('git.changes.loading')}
    </div>
  {:else if files.length === 0}
    <div class="bs-git-diff-empty">{t('git.changes.none')}</div>
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
            <Button variant="ghost" onclick={() => unstage(f)}>{t('git.unstage')}</Button>
          {:else}
            <Button variant="ghost" onclick={() => stage(f)}>{t('git.stage')}</Button>
          {/if}
          <Button variant="ghost" onclick={() => discard(f)}>{t('git.discard')}</Button>
        </div>
        <DiffBlock text={f.diff} />
      </div>
    {/each}
  {/if}
</div>

<style>
  /* Git panel and diff views (hidden behind GIT_ENABLED). */
  .bs-git-msg {
    width: 100%;
    resize: vertical;
    min-height: 44px;
    border-radius: 8px;
    background: var(--inset);
    border: 0.5px solid var(--sep);
    padding: 7px 9px;
    font: inherit;
    font-size: 12.5px;
    color: var(--text);
    outline: none;
  }

  .bs-git-msg:focus {
    border-color: var(--accent);
  }

  .bs-git-diff-stats {
    display: flex;
    gap: 6px;
    font-family: var(--mono);
    font-size: 12px;
    font-weight: 700;
  }

  .bs-git-diff-stats :global(span) {
    min-width: 42px;
    height: 24px;
    padding: 0 8px;
    border-radius: 7px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0.5px solid var(--sepsoft);
    background: var(--inset);
  }

  .bs-git-diff-stats :global(.add) {
    color: var(--green);
  }

  .bs-git-diff-stats :global(:where(.del)) {
    color: var(--red);
  }

  .bs-git-diff-empty {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--t2);
    background: var(--inset);
    font-size: 13px;
  }

  .bs-projdiff-commit {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border-bottom: 0.5px solid var(--sep);
    position: sticky;
    top: 0;
    background: var(--bg);
    z-index: 1;
  }

  .bs-projdiff-file {
    border-bottom: 0.5px solid var(--sep);
  }

  .bs-projdiff-fhead {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--surface);
    position: sticky;
    top: 0;
    z-index: 0;
  }

  .bs-projdiff-fhead :global(.grow) {
    flex: 1;
  }

  .bs-projdiff-fpath {
    font-family: var(--mono);
    font-size: 12px;
  }

  .bs-projdiff {
    overflow: auto;
    height: 100%;
    contain: layout paint;
  }

  .send-spinner {
    width: 12px;
    height: 12px;
    border-radius: 999px;
    border: 1.5px solid rgba(255, 255, 255, 0.42);
    animation: send-spin 850ms linear infinite;
    border-width: 1.75px;
    border-color: color-mix(in srgb, var(--primary-text) 42%, transparent);
    border-top-color: var(--primary-text);
  }
</style>
