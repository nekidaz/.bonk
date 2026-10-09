<script lang="ts">
  import { workspacePath } from '$entities/workspace';
  import { gitDiff } from '$shared/ipc';
  import type { GitDiffMode, Tab } from '$shared/model';
  import { diffStats } from './diff';
  import DiffBlock from './DiffBlock.svelte';
  import { t } from '$shared/i18n';

  let { tab }: { tab: Tab } = $props();

  let diffText = $state('');
  let loading = $state(false);
  let error = $state('');
  let loadedKey = $state('');
  let loadSeq = 0;

  const path = $derived(tab.git?.path ?? '');
  const mode = $derived((tab.git?.mode ?? 'working') as GitDiffMode);
  const stats = $derived(diffStats(diffText));

  $effect(() => {
    const root = $workspacePath;
    const key = `${root}\0${path}\0${mode}`;
    if (!root || !path || key === loadedKey) return;
    loadedKey = key;
    void load(root, path, mode);
  });

  async function load(root: string, filePath: string, diffMode: GitDiffMode): Promise<void> {
    // Concurrent loads (e.g. a fast tab switch or Refresh) race on the shared
    // diffText/error/loading state; only the latest load may write its result.
    const seq = ++loadSeq;
    loading = true;
    error = '';
    diffText = '';
    try {
      const text = await gitDiff(root, filePath, diffMode === 'staged');
      if (seq !== loadSeq) return;
      diffText = text.trim() ? text : $t('git.diff.noText');
    } catch (err) {
      if (seq !== loadSeq) return;
      error = String(err);
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  function reload(): void {
    loadedKey = '';
    const root = $workspacePath;
    if (!root || !path) return;
    loadedKey = `${root}\0${path}\0${mode}`;
    void load(root, path, mode);
  }

  function modeLabel(value: GitDiffMode): string {
    return value === 'staged' ? $t('git.diff.staged') : $t('git.diff.working');
  }
</script>

<div class="bs-git-diff-tab">
  <div class="bs-git-diff-head">
    <div class="bs-git-diff-title">
      <span class="material-symbols-outlined" style="font-size:18px">difference</span>
      <div class="text">
        <div class="main">{path || $t('git.diff.title')}</div>
        <div class="sub">
          {$t('git.diff.sub', { mode: modeLabel(mode) })}{#if $workspacePath}
            · {$workspacePath}{/if}
        </div>
      </div>
    </div>
    <div class="bs-git-diff-stats">
      <span class="add">+{stats.additions}</span>
      <span class="del">-{stats.deletions}</span>
    </div>
    <button class="bs-btn ghost bs-git-refresh" type="button" onclick={reload} disabled={loading}>
      <span class="material-symbols-outlined" style="font-size:15px">refresh</span>
      {$t('git.refresh')}
    </button>
  </div>

  {#if error}
    <div class="bs-git-diff-error">{error}</div>
  {:else if loading}
    <div class="bs-git-diff-empty">
      <span class="send-spinner" aria-hidden="true"></span>
      {$t('git.diff.loading')}
    </div>
  {:else}
    <DiffBlock text={diffText} />
  {/if}
</div>
