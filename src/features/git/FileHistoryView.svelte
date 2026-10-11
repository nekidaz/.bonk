<script lang="ts">
  /**
   * One request's git history as a tab (GitKraken's File History / Blame). «История»: the commits
   * that changed the file, renames followed, newest first; the selected one's diff on the right.
   * «Blame»: the file as it is now, each line with the commit that last changed it.
   */
  import { untrack } from 'svelte';
  import { findNode, workspace } from '$entities/workspace';
  import { describeFile, git, openGraphTab, shortAgo, statusColor } from '$entities/git';
  import { gitBlame, gitCommitFileDiff, gitFileLog } from '$shared/ipc';
  import type { BlameLine, FileCommit, Tab } from '$shared/model';
  import { t, tp, uiLanguage } from '$shared/i18n';
  import FileDiff from './FileDiff.svelte';
  import { diffLayout } from './store.svelte';

  let { tab }: { tab: Tab } = $props();

  const PAGE = 50;
  let view = $state<'history' | 'blame'>('history');
  let commits = $state.raw<FileCommit[]>([]);
  let more = $state(false);
  let selected = $state('');
  let diffText = $state('');
  /** Whose diff `diffText` is: until it is the picked commit's, that one is still loading. */
  let diffOf = $state('');
  let blame = $state.raw<BlameLine[]>([]);
  let error = $state('');
  let loaded = $state(false);
  let seq = 0;

  const path = $derived(tab.git?.path ?? '');
  const info = $derived(describeFile(path, git.prefix, (id) => findNode(workspace.tree, id)));
  const lang = $derived(uiLanguage.current);
  const now = $derived.by(() => (void git.version, Date.now()));
  const pick = $derived(commits.find((c) => c.hash === selected) ?? commits[0]);
  const uncommitted = (h: string) => /^0+$/.test(h);

  // The list (and blame) again whenever a git op may have changed them.
  $effect(() => {
    const root = workspace.path;
    void git.version;
    const v = view;
    if (root && path) untrack(() => void load(root, v));
  });

  async function load(root: string, v: 'history' | 'blame'): Promise<void> {
    const mine = ++seq;
    error = '';
    try {
      if (v === 'blame') {
        const b = await gitBlame(root, path);
        if (mine === seq) blame = b;
      } else {
        const page = await gitFileLog(root, path, 0, Math.max(PAGE, commits.length));
        if (mine !== seq) return;
        commits = page;
        more = page.length >= Math.max(PAGE, commits.length);
      }
    } catch (err) {
      if (mine === seq) error = String(err);
    } finally {
      if (mine === seq) loaded = true;
    }
  }

  async function loadMore(): Promise<void> {
    const root = workspace.path;
    if (!root) return;
    const page = await gitFileLog(root, path, commits.length, PAGE).catch((err) => {
      error = String(err);
      return [];
    });
    commits = [...commits, ...page];
    more = page.length === PAGE;
  }

  // The selected commit's diff of the file (at its path in that commit).
  $effect(() => {
    const root = workspace.path;
    const c = pick;
    if (!root || !c || view !== 'history') return;
    void gitCommitFileDiff(root, c.hash, c.path)
      .then((d) => {
        if (pick?.hash !== c.hash) return;
        diffText = d;
        diffOf = c.hash;
      })
      .catch((err) => (error = String(err)));
  });
</script>

<div class="bs-gview">
  <div class="bs-ghead">
    <div class="ttl">
      <span class="crumb">{`${t('git.title')}  /  ${t('git.history.title')}`}</span>
      <div class="row">
        <h2 title={path}>{info.name}</h2>
        {#if loaded && view === 'history'}
          <span class="bs-gtag"
            >{`${commits.length}${more ? '+' : ''} ${tp(commits.length, ['коммит', 'коммита', 'коммитов'], ['commit', 'commits'])}`}</span
          >
        {/if}
      </div>
    </div>
    <div class="bs-gseg" role="group">
      <button class:on={view === 'history'} aria-pressed={view === 'history'} onclick={() => (view = 'history')}
        >{t('git.history.title')}</button
      >
      <button class:on={view === 'blame'} aria-pressed={view === 'blame'} onclick={() => (view = 'blame')}
        >{t('git.history.blame')}</button
      >
    </div>
    {#if view === 'history'}
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
    {/if}
  </div>

  <div class="bs-gview-body">
    {#if error}
      <div class="bs-git-diff-error">{error}</div>
    {:else if !loaded}
      <div class="bs-gview-empty">{t('git.diff.loading')}</div>
    {:else if view === 'history' && !commits.length}
      <div class="bs-gview-empty">{t('git.history.empty')}</div>
    {:else if view === 'history'}
      <div class="split">
        <div class="list">
          {#each commits as c (c.hash)}
            <button class="commit" class:sel={pick?.hash === c.hash} onclick={() => (selected = c.hash)}>
              <span class="st" style:color={statusColor(c.status)}>{c.status}</span>
              <span class="txt">
                <span class="subj">{c.subject}</span>
                <span class="meta">{`${c.short} · ${c.author} · ${shortAgo(c.time, now, lang)}`}</span>
              </span>
            </button>
          {/each}
          {#if more}<button class="bs-gbtn more" onclick={loadMore}>{t('git.history.more')}</button>{/if}
        </div>
        <div class="diff">
          {#if pick}
            <div class="dh">
              <span class="subj">{pick.subject}</span>
              <button class="bs-gbtn" title={t('git.tab.graph')} onclick={() => openGraphTab(pick.hash)}
                ><span class="material-symbols-outlined">account_tree</span>{pick.short}</button
              >
            </div>
            {#if diffOf !== pick.hash}
              <div class="bs-gview-empty">{t('git.diff.loading')}</div>
            {:else if diffText.trim()}
              <FileDiff
                path={pick.path}
                text={diffText}
                layout={diffLayout.current}
                leftLabel={`${pick.short}^`}
                rightLabel={pick.short}
              />
            {:else}
              <div class="bs-gview-empty">{t('git.diff.noText')}</div>
            {/if}
          {/if}
        </div>
      </div>
    {:else}
      <div class="blame">
        {#each blame as l, i (i)}
          {@const first = i === 0 || blame[i - 1].hash !== l.hash}
          <div class="bl" class:first>
            {#if first}
              {#if uncommitted(l.hash)}
                <span class="who muted">{t('git.history.uncommitted')}</span>
              {:else}
                <button class="who" title={l.summary} onclick={() => openGraphTab(l.hash)}
                  ><b>{l.hash.slice(0, 7)}</b> {l.author} · {shortAgo(l.time, now, lang)}</button
                >
              {/if}
            {:else}
              <span class="who"></span>
            {/if}
            <span class="n">{i + 1}</span>
            <code>{l.text}</code>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .split {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(220px, 320px) 1fr;
    gap: 12px;
    padding: 0 20px 16px;
  }
  .list {
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .commit {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 10px;
    border-radius: var(--radius-md);
    text-align: left;
  }
  .commit:hover {
    background: var(--color-hover);
  }
  .commit.sel {
    background: var(--color-selected);
  }
  .st {
    flex: none;
    width: 12px;
    font: 600 var(--font-size-body) var(--font-code);
  }
  .txt {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .subj {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text);
    font-size: var(--font-size-ui);
  }
  .meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-muted);
    font: var(--font-size-micro) var(--font-code);
  }
  .more {
    align-self: center;
    margin-top: 6px;
  }
  .diff {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: auto;
  }
  .dh {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 0 10px;
  }
  .dh .subj {
    flex: 1;
    font-weight: 600;
  }
  .blame {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 0 20px 16px;
    font: 13px / 1.6 var(--font-code);
  }
  .bl {
    display: grid;
    grid-template-columns: minmax(180px, 280px) 36px 1fr;
    gap: 10px;
  }
  .bl.first:not(:first-child) {
    border-top: 1px solid var(--color-border-subtle);
  }
  .who {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-secondary);
    text-align: left;
  }
  .who b {
    color: var(--method-patch);
    font-weight: 500;
  }
  button.who:hover {
    color: var(--color-text);
  }
  .who.muted {
    color: var(--color-text-muted);
    font-style: italic;
  }
  .n {
    color: var(--color-text-muted);
    text-align: right;
    user-select: none;
  }
  code {
    white-space: pre;
    color: var(--color-text);
  }
</style>
