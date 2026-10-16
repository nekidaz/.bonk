<script lang="ts">
  /**
   * G1 / G1b: the diff of one changed file as a tab. Header: the request's name and status,
   * Inline | Side-by-side, Working tree | Staged, Discard (asks first) and Stage / Unstage.
   * Reloads whenever a git op bumps `git.version`. With `rev` (opened from the G5 graph) it is the
   * file as that commit changed it: read-only, against the commit's first parent.
   */
  import { findNode, workspace } from '$entities/workspace';
  import {
    applyPatch,
    describeFile,
    discardPaths,
    git,
    openFileHistoryTab,
    stagePaths,
    statusColor,
    statusLetter,
    unstagePaths,
  } from '$entities/git';
  import { tabs } from '$entities/tab';
  import { gitCommitFileDiff, gitDiff } from '$shared/ipc';
  import { requestConfirm } from '$shared/ui';
  import type { GitDiffMode, Tab } from '$shared/model';
  import { t } from '$shared/i18n';
  import FileDiff, { type BlockAction } from './FileDiff.svelte';
  import { blockPatch } from './diff';
  import { diffLayout } from './store.svelte';
  import {
    GitButton,
    GitSeg,
    GitHead,
    GitView,
    GitViewBody,
    GitViewEmpty,
    GitTag,
    GitError,
  } from '$entities/git/components';

  let { tab }: { tab: Tab } = $props();

  let diffText = $state('');
  let loading = $state(false);
  let error = $state('');
  let loadSeq = 0;

  const path = $derived(tab.git?.path ?? '');
  const mode = $derived((tab.git?.mode ?? 'working') as GitDiffMode);
  const rev = $derived(tab.git?.rev ?? '');
  const info = $derived(describeFile(path, git.prefix, (id) => findNode(workspace.tree, id)));
  const file = $derived(rev ? undefined : git.status?.files.find((f) => f.path === path));
  const letter = $derived(file ? statusLetter(file) : '');
  const hasStaged = $derived(!!file && file.index !== ' ' && file.index !== '?');
  const hasUnstaged = $derived(!!file && (file.worktree !== ' ' || file.index === '?'));

  $effect(() => {
    const root = workspace.path;
    void git.version;
    if (root && path) void load(root, path, mode, rev);
  });

  async function load(root: string, filePath: string, diffMode: GitDiffMode, at: string): Promise<void> {
    // Concurrent loads (a fast tab switch, a refresh) race on the shared state; only the latest may write.
    const seq = ++loadSeq;
    loading = !diffText;
    error = '';
    try {
      const text = at
        ? await gitCommitFileDiff(root, at, filePath)
        : await gitDiff(root, filePath, diffMode === 'staged');
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

  // Block / line actions, on a tracked file changed in place (a new, deleted or conflicted file goes
  // whole: its patch would need a file header of its own).
  const blockActions = $derived.by((): BlockAction[] => {
    if (rev || !file) return [];
    if (mode === 'staged')
      return file.index === 'M'
        ? [
            {
              label: t('git.hunk.unstage'),
              icon: 'remove',
              run: (lines, b, picked) => void applyPatch(blockPatch(path, lines, b, picked, true), true, true),
            },
          ]
        : [];
    if (file.worktree !== 'M' || file.index === 'U') return [];
    return [
      {
        label: t('git.hunk.discard'),
        icon: 'undo',
        run: async (lines, b, picked) => {
          if (await requestConfirm(t('git.hunk.discardConfirm'), t('git.discard')))
            await applyPatch(blockPatch(path, lines, b, picked, true), false, true);
        },
      },
      {
        label: t('git.hunk.stage'),
        icon: 'add',
        run: (lines, b, picked) => void applyPatch(blockPatch(path, lines, b, picked), true, false),
      },
    ];
  });

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

<GitView>
  <GitHead>
    <div class="ttl">
      <span class="crumb"
        >{`${t('git.title')}  /  ${rev ? `${t('git.graph.commit')} ${rev.slice(0, 7)}` : mode === 'staged' ? t('git.staged') : t('git.changes')}`}</span
      >
      <div class="row">
        <h2 title={path}>{info.name}</h2>
        {#if letter}
          <GitTag style="color: {statusColor(letter)}"><b>{letter}</b>{t(STATUS_WORD[letter] ?? 'git.st.M')}</GitTag>
        {/if}
      </div>
    </div>
    <GitButton title={t('git.history.open')} onclick={() => openFileHistoryTab(path, info.name)}
      ><span class="material-symbols-outlined">history</span>{t('git.history.title')}</GitButton
    >
    <GitSeg role="group" aria-label={t('git.diff.layout')}>
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
    </GitSeg>
    {#if !rev}
      <GitSeg role="group" aria-label={t('git.diff.mode')}>
        <button class:on={mode === 'working'} aria-pressed={mode === 'working'} onclick={() => setMode('working')}
          >{t('git.diff.working')}</button
        >
        <button class:on={mode === 'staged'} aria-pressed={mode === 'staged'} onclick={() => setMode('staged')}
          >{t('git.diff.staged')}</button
        >
      </GitSeg>
      <GitButton class="danger" disabled={!file} onclick={discard}
        ><span class="material-symbols-outlined">undo</span>{t('git.discard')}</GitButton
      >
      {#if mode === 'staged'}
        <GitButton class="inv" disabled={!hasStaged} onclick={() => unstagePaths([path])}
          ><span class="material-symbols-outlined">remove</span>{t('git.unstageFile')}</GitButton
        >
      {:else}
        <GitButton class="inv" disabled={!hasUnstaged} onclick={() => stagePaths([path])}
          ><span class="material-symbols-outlined">add</span>{t('git.stageFile')}</GitButton
        >
      {/if}
    {/if}
  </GitHead>

  <GitViewBody>
    {#if error}
      <GitError>{error}</GitError>
    {:else if loading}
      <GitViewEmpty>{t('git.diff.loading')}</GitViewEmpty>
    {:else if !diffText.trim()}
      <!-- A file no longer in the status (committed, discarded) simply has nothing to show. -->
      <GitViewEmpty>{!file && !rev ? t('git.diff.clean') : t('git.diff.noText')}</GitViewEmpty>
    {:else}
      <FileDiff
        {path}
        text={diffText}
        layout={diffLayout.current}
        leftLabel={rev
          ? `${rev.slice(0, 7)}^`
          : mode === 'working' && hasStaged && hasUnstaged
            ? t('git.diff.staged')
            : `HEAD  ${git.log[0]?.short ?? ''}`}
        rightLabel={rev ? rev.slice(0, 7) : mode === 'staged' ? t('git.diff.staged') : t('git.diff.working')}
        actions={blockActions}
      />
    {/if}
  </GitViewBody>
</GitView>
