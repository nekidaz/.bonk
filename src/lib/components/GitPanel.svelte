<script lang="ts">
  /**
   * Git source-control panel, shown in the sidebar body when the "Source control"
   * rail tab is active. Presentational: reads the `gitStatus` store and calls the
   * action wrappers in `../git`. Refreshes status on mount and whenever it is
   * re-shown (the parent re-mounts it via the rail toggle).
   *
   * States:
   *  - no workspace        → "open a folder" empty state
   *  - workspace, no repo  → "initialize" empty state + button
   *  - repo                → branch header (switch/create/pull/push), Changes
   *                          (staged + unstaged) with stage/unstage toggles,
   *                          a commit box, and collapsible graph/log sections.
   */
  import { onMount } from 'svelte';
  import { openGitDiffTab, openProjectDiffTab, workspacePath, requestConfirm } from '../stores';
  import {
    gitStatus,
    gitBusy,
    refreshGit,
    stagePaths,
    unstagePaths,
    discardPaths,
    commitChanges,
    initRepo,
    checkoutBranch,
    createBranch,
    pull,
    push,
  } from '../git';
  import { gitBranches, gitGraph, gitLog } from '../api';
  import { statusColor } from '../domain/gitStatus';
  import type { GitFile, GitCommit } from '../domain/types';

  let commitMessage = $state('');
  let statusLine = $state('');

  // Branch switcher / create-branch UI.
  let branchMenuOpen = $state(false);
  let branches = $state<string[]>([]);
  let creatingBranch = $state(false);
  let newBranchName = $state('');

  // Recent commits (collapsible).
  let graphOpen = $state(false);
  let graph = $state<string[]>([]);
  let logOpen = $state(false);
  let log = $state<GitCommit[]>([]);

  const status = $derived($gitStatus);

  // A file is "staged" when its index slot holds a real change (not " " and not
  // the untracked "?"); everything else (worktree change or untracked) is unstaged.
  const staged = $derived(
    (status?.files ?? []).filter((f) => f.index !== ' ' && f.index !== '?'),
  );
  const unstaged = $derived(
    (status?.files ?? []).filter((f) => f.worktree !== ' ' || f.index === '?'),
  );
  const canCommit = $derived(staged.length > 0 && commitMessage.trim().length > 0);

  onMount(() => {
    void refreshGit();
  });

  function basename(p: string): string {
    const parts = p.replace(/\/+$/, '').split('/');
    return parts[parts.length - 1] || p;
  }
  function dirname(p: string): string {
    const idx = p.lastIndexOf('/');
    return idx > 0 ? p.slice(0, idx) : '';
  }

  // Single-char status badge for a file row. Prefer the worktree change for the
  // unstaged list; the index change for the staged list. Untracked "?" → "U".
  function badge(f: GitFile, fromIndex: boolean): string {
    const c = fromIndex ? f.index : f.worktree;
    if (c === '?' || f.index === '?') return 'U';
    return c.trim() || f.index.trim() || 'M';
  }

  async function openBranchMenu(): Promise<void> {
    if (branchMenuOpen) {
      branchMenuOpen = false;
      return;
    }
    const root = $workspacePath;
    if (!root) return;
    try {
      branches = await gitBranches(root);
    } catch (err) {
      console.error('git: branches failed', err);
      branches = [];
    }
    branchMenuOpen = true;
  }

  async function pickBranch(name: string): Promise<void> {
    branchMenuOpen = false;
    if (name === status?.branch) return;
    await checkoutBranch(name);
  }

  function startCreateBranch(): void {
    branchMenuOpen = false;
    creatingBranch = true;
    newBranchName = '';
  }
  async function commitNewBranch(): Promise<void> {
    const name = newBranchName.trim();
    creatingBranch = false;
    if (name) await createBranch(name);
  }
  function branchInputKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      void commitNewBranch();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      creatingBranch = false;
    }
  }

  async function doPull(): Promise<void> {
    statusLine = 'Pulling…';
    statusLine = await pull();
  }
  async function doPush(): Promise<void> {
    statusLine = 'Pushing…';
    statusLine = await push();
  }

  async function onInit(): Promise<void> {
    await initRepo();
  }

  async function toggleLog(): Promise<void> {
    logOpen = !logOpen;
    if (logOpen) {
      const root = $workspacePath;
      if (!root) return;
      try {
        log = await gitLog(root, 20);
      } catch (err) {
        console.error('git: log failed', err);
        log = [];
      }
    }
  }

  async function toggleGraph(): Promise<void> {
    graphOpen = !graphOpen;
    if (graphOpen) {
      const root = $workspacePath;
      if (!root) return;
      try {
        graph = await gitGraph(root, 32);
      } catch (err) {
        console.error('git: graph failed', err);
        graph = [];
      }
    }
  }

  async function stageAll(): Promise<void> {
    await stagePaths(unstaged.map((f) => f.path));
  }
  async function unstageAll(): Promise<void> {
    await unstagePaths(staged.map((f) => f.path));
  }

  async function onDiscard(path: string): Promise<void> {
    if (await requestConfirm(`Discard changes to ${basename(path)}? This can't be undone.`, 'Discard')) {
      await discardPaths([path]);
    }
  }

  async function onCommit(): Promise<void> {
    if (!canCommit) return;
    await commitChanges(commitMessage);
    commitMessage = '';
    statusLine = '';
  }
</script>

<div class="bs-tree bs-git">
  {#if !$workspacePath}
    <div class="bs-sech"><span class="material-symbols-outlined cv" style="font-size:12px">expand_more</span>Source Control</div>
    <div class="bs-empty" style="padding-left:22px">
      <b>No workspace</b>
      <p>Open a workspace folder to use Git.</p>
    </div>
  {:else if status && status.isRepo === false}
    <div class="bs-sech"><span class="material-symbols-outlined cv" style="font-size:12px">expand_more</span>Source Control</div>
    <div class="bs-empty" style="padding-left:22px">
      <b>Not a Git repository</b>
      <p>This workspace isn't tracked by Git yet.</p>
    </div>
    <div class="bs-git-initwrap">
      <button class="bs-btn primary" type="button" onclick={onInit}>
        <span class="material-symbols-outlined" style="font-size:15px;vertical-align:-3px">account_tree</span>
        Initialize Git repository
      </button>
    </div>
  {:else if status}
    <!-- Branch / sync header -->
    <div class="bs-git-head">
      <div class="bs-git-branch">
        <button class="bs-git-branchbtn" type="button" title="Switch branch" onclick={openBranchMenu}>
          <span class="material-symbols-outlined" style="font-size:15px">account_tree</span>
          <span class="bs-git-branchname">{status.branch || '(no branch)'}</span>
          <span class="material-symbols-outlined" style="font-size:14px">expand_more</span>
        </button>
        {#if status.ahead > 0 || status.behind > 0}
          <span class="bs-git-track" title="Ahead / behind upstream">
            {#if status.ahead > 0}<span>↑{status.ahead}</span>{/if}
            {#if status.behind > 0}<span>↓{status.behind}</span>{/if}
          </span>
        {/if}
        <button class="bs-fi" type="button" title="Create branch" onclick={startCreateBranch}>
          <span class="material-symbols-outlined" style="font-size:15px">add</span>
        </button>
      </div>
      <div class="bs-git-sync">
        <button class="bs-btn ghost" type="button" title="Pull" disabled={$gitBusy} onclick={doPull}>
          <span class="material-symbols-outlined" style="font-size:14px;vertical-align:-3px">download</span>Pull
        </button>
        <button class="bs-btn ghost" type="button" title="Push" disabled={$gitBusy} onclick={doPush}>
          <span class="material-symbols-outlined" style="font-size:14px;vertical-align:-3px">upload</span>Push
        </button>
        <button class="bs-btn ghost" type="button" title="Open all changes in a tab" onclick={openProjectDiffTab}>
          <span class="material-symbols-outlined" style="font-size:14px;vertical-align:-3px">difference</span>Changes
        </button>
      </div>
    </div>

    {#if branchMenuOpen}
      <div class="bs-git-branchmenu">
        {#each branches as b (b)}
          <button class="bs-git-branchitem" class:on={b === status.branch} type="button" onclick={() => pickBranch(b)}>
            <span class="material-symbols-outlined" style="font-size:13px;opacity:{b === status.branch ? 1 : 0}">check</span>
            <span class="bs-nm">{b}</span>
          </button>
        {/each}
        {#if branches.length === 0}
          <div class="bs-empty" style="padding:6px 10px"><p>No branches.</p></div>
        {/if}
      </div>
    {/if}

    {#if creatingBranch}
      <div class="bs-git-newbranch">
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="bs-input bs-git-input"
          placeholder="New branch name…"
          bind:value={newBranchName}
          autofocus
          onkeydown={branchInputKeydown}
          onblur={commitNewBranch}
        />
      </div>
    {/if}

    {#if statusLine}
      <div class="bs-git-statusline" title={statusLine}>{statusLine}</div>
    {/if}

    <!-- Staged -->
    <div class="bs-sech bs-sech-act">
      <span class="material-symbols-outlined cv" style="font-size:12px">expand_more</span>Staged Changes
      {#if staged.length}<span style="color:var(--t3);font-weight:600">{staged.length}</span>{/if}
      {#if staged.length}
        <span class="bs-act" role="button" tabindex="0" title="Unstage all" onclick={unstageAll} onkeydown={() => {}}>
          <span class="material-symbols-outlined" style="font-size:15px">remove</span>
        </span>
      {/if}
    </div>
    {#if staged.length === 0}
      <div class="bs-empty" style="padding-left:22px"><p>Nothing staged.</p></div>
    {:else}
      {#each staged as f (f.path)}
        <div class="bs-trow bs-git-row">
          <button class="bs-git-rowmain" type="button" title="View staged diff" onclick={() => openGitDiffTab(f.path, 'staged')}>
            <span class="bs-git-badge" style="color:{statusColor(badge(f, true))}">{badge(f, true)}</span>
            <span class="bs-nm"><b>{basename(f.path)}</b>{#if dirname(f.path)}<span class="bs-git-dir">{dirname(f.path)}</span>{/if}</span>
          </button>
          <span class="bs-act" role="button" tabindex="0" title="Unstage" onclick={() => unstagePaths([f.path])} onkeydown={() => {}}>
            <span class="material-symbols-outlined" style="font-size:15px">remove</span>
          </span>
        </div>
      {/each}
    {/if}

    <!-- Changes -->
    <div class="bs-sech bs-sech-act">
      <span class="material-symbols-outlined cv" style="font-size:12px">expand_more</span>Changes
      {#if unstaged.length}<span style="color:var(--t3);font-weight:600">{unstaged.length}</span>{/if}
      {#if unstaged.length}
        <span class="bs-act" role="button" tabindex="0" title="Stage all" onclick={stageAll} onkeydown={() => {}}>
          <span class="material-symbols-outlined" style="font-size:15px">add</span>
        </span>
      {/if}
    </div>
    {#if unstaged.length === 0}
      <div class="bs-empty" style="padding-left:22px"><p>No changes.</p></div>
    {:else}
      {#each unstaged as f (f.path)}
        <div class="bs-trow bs-git-row">
          <button class="bs-git-rowmain" type="button" title="View working tree diff" onclick={() => openGitDiffTab(f.path, 'working')}>
            <span class="bs-git-badge" style="color:{statusColor(badge(f, false))}">{badge(f, false)}</span>
            <span class="bs-nm"><b>{basename(f.path)}</b>{#if dirname(f.path)}<span class="bs-git-dir">{dirname(f.path)}</span>{/if}</span>
          </button>
          <span class="bs-act" role="button" tabindex="0" title="Discard changes" onclick={() => onDiscard(f.path)} onkeydown={() => {}}>
            <span class="material-symbols-outlined" style="font-size:15px">undo</span>
          </span>
          <span class="bs-act" role="button" tabindex="0" title="Stage" onclick={() => stagePaths([f.path])} onkeydown={() => {}}>
            <span class="material-symbols-outlined" style="font-size:15px">add</span>
          </span>
        </div>
      {/each}
    {/if}

    <!-- Commit box -->
    <div class="bs-git-commit">
      <textarea
        class="bs-git-msg"
        placeholder="Commit message"
        rows="2"
        bind:value={commitMessage}
      ></textarea>
      <button class="bs-btn primary bs-git-commitbtn" type="button" disabled={!canCommit} onclick={onCommit}>
        <span class="material-symbols-outlined" style="font-size:15px;vertical-align:-3px">check</span>
        Commit{staged.length ? ` (${staged.length})` : ''}
      </button>
    </div>

    <!-- Commit graph -->
    <button class="bs-sech bs-sech-act bs-git-loghead" type="button" onclick={toggleGraph}>
      <span class="material-symbols-outlined cv" style="font-size:12px">{graphOpen ? 'expand_more' : 'chevron_right'}</span>
      Commit Graph
    </button>
    {#if graphOpen}
      {#if graph.length === 0}
        <div class="bs-empty" style="padding-left:22px"><p>No graph yet.</p></div>
      {:else}
        <div class="bs-git-graph">
          {#each graph as line, i (i)}
            <div class="bs-git-graphrow" title={line}>
              <span class="bs-git-graphline">{line}</span>
            </div>
          {/each}
        </div>
      {/if}
    {/if}

    <!-- Recent commits -->
    <button class="bs-sech bs-sech-act bs-git-loghead" type="button" onclick={toggleLog}>
      <span class="material-symbols-outlined cv" style="font-size:12px">{logOpen ? 'expand_more' : 'chevron_right'}</span>
      Recent Commits
    </button>
    {#if logOpen}
      {#if log.length === 0}
        <div class="bs-empty" style="padding-left:22px"><p>No commits yet.</p></div>
      {:else}
        {#each log as c (c.hash)}
          <div class="bs-trow bs-git-logrow" title={`${c.subject}\n${c.author} · ${c.date}`}>
            <span class="bs-git-hash">{c.short}</span>
            <span class="bs-nm">{c.subject}</span>
            <span class="bs-git-date">{c.date}</span>
          </div>
        {/each}
      {/if}
    {/if}
  {:else}
    <div class="bs-empty" style="padding-left:22px"><p>Loading Git status…</p></div>
  {/if}
</div>
