<script lang="ts">
  import { workspacePath } from '../stores';
  import { gitDiff } from '../api';
  import type { GitDiffMode, Tab } from '../domain/types';
  import { diffStats } from '../domain/diff';
  import DiffBlock from './DiffBlock.svelte';

  let { tab }: { tab: Tab } = $props();

  let diffText = $state('');
  let loading = $state(false);
  let error = $state('');
  let loadedKey = $state('');

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
    loading = true;
    error = '';
    diffText = '';
    try {
      const text = await gitDiff(root, filePath, diffMode === 'staged');
      diffText = text.trim() ? text : 'No textual diff (binary file or no changes).';
    } catch (err) {
      error = String(err);
    } finally {
      loading = false;
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
    return value === 'staged' ? 'Staged' : 'Working Tree';
  }
</script>

<div class="bs-git-diff-tab">
  <div class="bs-git-diff-head">
    <div class="bs-git-diff-title">
      <span class="material-symbols-outlined" style="font-size:18px">difference</span>
      <div class="text">
        <div class="main">{path || 'Diff'}</div>
        <div class="sub">{modeLabel(mode)} diff{#if $workspacePath} · {$workspacePath}{/if}</div>
      </div>
    </div>
    <div class="bs-git-diff-stats">
      <span class="add">+{stats.additions}</span>
      <span class="del">-{stats.deletions}</span>
    </div>
    <button class="bs-btn ghost bs-git-refresh" type="button" onclick={reload} disabled={loading}>
      <span class="material-symbols-outlined" style="font-size:15px">refresh</span>
      Refresh
    </button>
  </div>

  {#if error}
    <div class="bs-git-diff-error">{error}</div>
  {:else if loading}
    <div class="bs-git-diff-empty">
      <span class="send-spinner" aria-hidden="true"></span>
      Loading diff...
    </div>
  {:else}
    <DiffBlock text={diffText} />
  {/if}
</div>
