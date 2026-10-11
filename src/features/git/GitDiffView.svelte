<script lang="ts">
  /**
   * G1 / G1b: the diff of one changed file as a tab. Header: the request's name and status,
   * Inline | Side-by-side, Working tree | Staged, Discard (asks first) and Stage / Unstage.
   * Reloads whenever a git op bumps `git.version`.
   */
  import { findNode, workspace } from '$entities/workspace';
  import { describeFile, discardPaths, git, stagePaths, statusColor, statusLetter, unstagePaths } from '$entities/git';
  import { tabs } from '$entities/tab';
  import { gitDiff } from '$shared/ipc';
  import { requestConfirm } from '$shared/ui';
  import type { GitDiffMode, Tab } from '$shared/model';
  import { t } from '$shared/i18n';
  import FileDiff from './FileDiff.svelte';
  import { diffLayout } from './store.svelte';

  let { tab }: { tab: Tab } = $props();

  let diffText = $state('');
  let loading = $state(false);
  let error = $state('');
  let loadSeq = 0;

  const path = $derived(tab.git?.path ?? '');
  const mode = $derived((tab.git?.mode ?? 'working') as GitDiffMode);
  const info = $derived(describeFile(path, git.prefix, (id) => findNode(workspace.tree, id)));
  const file = $derived(git.status?.files.find((f) => f.path === path));
  const letter = $derived(file ? statusLetter(file) : '');
  const hasStaged = $derived(!!file && file.index !== ' ' && file.index !== '?');
  const hasUnstaged = $derived(!!file && (file.worktree !== ' ' || file.index === '?'));

  $effect(() => {
    const root = workspace.path;
    void git.version;
    if (root && path) void load(root, path, mode);
  });

  async function load(root: string, filePath: string, diffMode: GitDiffMode): Promise<void> {
    // Concurrent loads (a fast tab switch, a refresh) race on the shared state; only the latest may write.
    const seq = ++loadSeq;
    loading = !diffText;
    error = '';
    try {
      const text = await gitDiff(root, filePath, diffMode === 'staged');
      if (seq !== loadSeq) return;
      diffText = text;
    } catch (err) {
      if (seq !== loadSeq) return;
      error = String(err);
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  function setMode(m: GitDiffMode): void {
    tabs.updateById(tab.id, (x) => (x.git ? { ...x, git: { ...x.git, mode: m } } : x));
  }

  async function discard(): Promise<void> {
    if (await requestConfirm(t('git.discard.confirm', { name: info.name }), t('git.discard')))
      await discardPaths([path]);
  }

  const STATUS_WORD: Record<string, string> = {
    M: 'git.st.M',
    A: 'git.st.A',
    D: 'git.st.D',
    R: 'git.st.R',
    U: 'git.st.U',
  };
</script>

<div class="bs-gview">
  <div class="bs-ghead">
    <div class="ttl">
      <span class="crumb">{`${t('git.title')}  /  ${mode === 'staged' ? t('git.staged') : t('git.changes')}`}</span>
      <div class="row">
        <h2 title={path}>{info.name}</h2>
        {#if letter}
          <span class="bs-gtag" style:color={statusColor(letter)}
            ><b>{letter}</b>{t(STATUS_WORD[letter] ?? 'git.st.M')}</span
          >
        {/if}
      </div>
    </div>
    <div class="bs-gseg" role="group" aria-label={t('git.diff.layout')}>
      <button
        class="icon"
        class:on={diffLayout.current === 'inline'}
        title={t('git.diff.inline')}
        aria-pressed={diffLayout.current === 'inline'}
        onclick={() => (diffLayout.current = 'inline')}
        ><span class="material-symbols-outlined">splitscreen_top</span></button
      >
      <button
        class="icon"
        class:on={diffLayout.current === 'split'}
        title={t('git.diff.split')}
        aria-pressed={diffLayout.current === 'split'}
        onclick={() => (diffLayout.current = 'split')}
        ><span class="material-symbols-outlined">vertical_split</span></button
      >
    </div>
    <div class="bs-gseg" role="group" aria-label={t('git.diff.mode')}>
      <button class:on={mode === 'working'} aria-pressed={mode === 'working'} onclick={() => setMode('working')}
        >{t('git.diff.working')}</button
      >
      <button class:on={mode === 'staged'} aria-pressed={mode === 'staged'} onclick={() => setMode('staged')}
        >{t('git.diff.staged')}</button
      >
    </div>
    <button class="bs-gbtn danger" disabled={!file} onclick={discard}
      ><span class="material-symbols-outlined">undo</span>{t('git.discard')}</button
    >
    {#if mode === 'staged'}
      <button class="bs-gbtn inv" disabled={!hasStaged} onclick={() => unstagePaths([path])}
        ><span class="material-symbols-outlined">remove</span>{t('git.unstageFile')}</button
      >
    {:else}
      <button class="bs-gbtn inv" disabled={!hasUnstaged} onclick={() => stagePaths([path])}
        ><span class="material-symbols-outlined">add</span>{t('git.stageFile')}</button
      >
    {/if}
  </div>

  <div class="bs-gview-body">
    {#if error}
      <div class="bs-git-diff-error">{error}</div>
    {:else if loading}
      <div class="bs-gview-empty">{t('git.diff.loading')}</div>
    {:else if !diffText.trim()}
      <div class="bs-gview-empty">{t('git.diff.noText')}</div>
    {:else}
      <FileDiff
        {path}
        text={diffText}
        layout={diffLayout.current}
        leftLabel={`HEAD  ${git.log[0]?.short ?? ''}`}
        rightLabel={mode === 'staged' ? t('git.diff.staged') : t('git.diff.working')}
      />
    {/if}
  </div>
</div>
