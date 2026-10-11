<script lang="ts">
  /**
   * G5: the commit graph as a tab — branches in lanes, branch / remote / tag labels, search, All
   * branches | Current, Fetch, «Ещё N» paging, and the selected commit's details on the right.
   * G6: click selects, ⇧-click a range, ⌘-click toggles; right-click opens the commit menu.
   */
  import { untrack } from 'svelte';
  import { filterTree, idToRel, workspace } from '$entities/workspace';
  import { tabs } from '$entities/tab';
  import {
    checkoutCommit,
    cherryPick,
    createBranchAt,
    createTag,
    deleteTag,
    pushTag,
    fetchAll,
    undoRebase,
    undoLast,
    openCompareTab,
    openReflogTab,
    git,
    mergeBranch,
    openProjectDiffTab,
    rebaseOnto,
    requestCheckout,
    resetTo,
    revertCommits,
  } from '$entities/git';
  import { gitCommitDetail, gitCommitsTouching, gitFormatPatch, gitGraphLog, openapiExportSave } from '$shared/ipc';
  import { requestChoice, requestConfirm } from '$shared/ui';
  import { GitBranchIcon } from '$shared/ui/components';
  import type { CommitDetail, GitRef, GraphCommit, Tab, TreeNode } from '$shared/model';
  import { t, tp, uiLanguage } from '$shared/i18n';
  import CommitMenu from './CommitMenu.svelte';
  import CommitPanel from './CommitPanel.svelte';
  import RebaseDialog from './RebaseDialog.svelte';
  import { commitDate, firstParentChain, initials, layoutGraph, type CommitAction, type Segment } from './graph';

  let { tab }: { tab: Tab } = $props();

  const PAGE = 200;
  const ROW = 38;
  const LANE = 16;
  const PAD = 14;
  const MAX_LANES = 8;
  const COLORS = [
    'var(--method-get)',
    'var(--method-patch)',
    'var(--color-warning)',
    'var(--color-success)',
    'var(--color-danger)',
    'var(--method-grpc, var(--color-text-secondary))',
  ];
  const WORKTREE = 'WORKTREE';

  let commits = $state.raw<GraphCommit[]>([]);
  let total = $state(0);
  let branchCount = $state(0);
  let all = $state(true);
  let query = $state('');
  let loading = $state(false);
  let selected = $state.raw<string[]>([]);
  let anchor = '';
  let details = $state.raw<Record<string, CommitDetail>>({});
  let menu = $state<{ x: number; y: number } | null>(null);
  let prompt = $state<{ kind: 'tag' | 'branch'; hash: string } | null>(null);
  let promptValue = $state('');
  /** G9: the branch an interactive rebase goes onto while its dialog is open. */
  let rebaseTarget = $state<string | null>(null);
  let loadSeq = 0;

  const now = $derived.by(() => (void git.version, Date.now()));
  const lang = $derived(uiLanguage.current);
  const current = $derived(git.status?.branch ?? '');
  const dirty = $derived(git.status?.files.length ?? 0);
  const q = $derived(query.trim().toLowerCase());
  const head = $derived(commits.find((c) => c.refs.some((r) => r.kind === 'head')));
  // The working tree sits on top of HEAD as a commit of its own while there are uncommitted changes.
  const nodes = $derived(dirty && head && !q ? [{ hash: WORKTREE, parents: [head.hash] }, ...commits] : commits);
  const lanes = $derived(layoutGraph(nodes));
  const width = $derived(Math.min(MAX_LANES, Math.max(1, ...lanes.map((r) => r.width))));
  const visible = $derived(
    q
      ? commits.filter(
          (c) =>
            c.subject.toLowerCase().includes(q) ||
            c.hash.startsWith(q) ||
            c.author.toLowerCase().includes(q) ||
            c.email.toLowerCase().includes(q) ||
            fileHits.has(c.hash),
        )
      : commits,
  );

  // Search by file too: commits that touched a path containing the query, or a request whose name
  // matches it (its file may be named otherwise). Asked of git a moment after typing stops.
  let fileHits = $state.raw<Set<string>>(new Set());
  const requestPaths = (list: TreeNode[]): string[] =>
    list.flatMap((n) => (n.kind === 'folder' ? requestPaths(n.children) : [git.prefix + idToRel(n.id)]));
  $effect(() => {
    const root = workspace.path;
    const query = q;
    const range = all;
    if (!root || !query) {
      fileHits = new Set();
      return;
    }
    const paths = untrack(() => requestPaths(filterTree(workspace.tree, query)));
    const timer = setTimeout(() => {
      void gitCommitsTouching(root, query, paths, range)
        .then((h) => {
          if (q === query) fileHits = new Set(h);
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  });
  const selection = $derived(commits.filter((c) => selected.includes(c.hash)));
  const laneOf = $derived(new Map(nodes.map((n, i) => [n.hash, lanes[i]])));

  // Reload when the workspace, the range or any git op changes; keep as many commits as were shown.
  $effect(() => {
    const root = workspace.path;
    void git.version;
    const range = all;
    if (root) untrack(() => void load(root, range, 0, Math.max(PAGE, commits.length), true));
  });

  async function load(root: string, range: boolean, skip: number, limit: number, replace: boolean): Promise<void> {
    const seq = ++loadSeq;
    loading = true;
    try {
      const page = await gitGraphLog(root, range, skip, limit);
      if (seq !== loadSeq) return;
      commits = replace ? page.commits : [...commits, ...page.commits];
      total = page.total;
      branchCount = page.branches;
      if (replace) details = {};
      pickInitial();
    } catch (err) {
      if (seq === loadSeq) git.error = String(err);
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  /** The commit the tab was opened for (from the sidebar), else keep the selection, else HEAD. */
  function pickInitial(): void {
    const want = tab.git?.rev;
    if (want && commits.some((c) => c.hash === want)) {
      selected = [want];
      anchor = want;
      tabs.updateById(tab.id, (x) => (x.git ? { ...x, git: { ...x.git, rev: undefined } } : x));
      return;
    }
    selected = selected.filter((h) => commits.some((c) => c.hash === h));
    if (!selected.length && commits.length) {
      const first = commits.find((c) => c.refs.some((r) => r.kind === 'head')) ?? commits[0];
      selected = [first.hash];
      anchor = first.hash;
    }
  }

  // Details of what's selected, fetched once per commit.
  $effect(() => {
    const root = workspace.path;
    const want = selected.slice(0, 30).filter((h) => !untrack(() => details[h]));
    if (!root || !want.length) return;
    void Promise.all(
      want.map((h) =>
        gitCommitDetail(root, h).catch((err) => {
          // Say why the panel stays empty instead of showing «0 files».
          git.error = String(err);
          return undefined;
        }),
      ),
    ).then((got) => {
      const next = { ...details };
      for (const d of got) if (d) next[d.hash] = d;
      details = next;
    });
  });

  function more(): void {
    if (workspace.path) void load(workspace.path, all, commits.length, PAGE, false);
  }

  function pick(e: MouseEvent, hash: string): void {
    if (e.shiftKey && anchor) {
      const chain = q ? undefined : firstParentChain(commits, anchor, hash);
      if (chain) {
        selected = chain;
        return;
      }
      const a = visible.findIndex((c) => c.hash === anchor);
      const b = visible.findIndex((c) => c.hash === hash);
      if (a !== -1 && b !== -1) {
        selected = visible.slice(Math.min(a, b), Math.max(a, b) + 1).map((c) => c.hash);
        return;
      }
    }
    if (e.metaKey || e.ctrlKey) {
      selected = selected.includes(hash) ? selected.filter((h) => h !== hash) : [...selected, hash];
    } else {
      selected = [hash];
    }
    anchor = hash;
  }

  function openMenu(e: MouseEvent, hash?: string): void {
    e.preventDefault();
    if (hash && !selected.includes(hash)) {
      selected = [hash];
      anchor = hash;
    }
    menu = { x: e.clientX, y: e.clientY };
  }

  function onKey(e: KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && e.key === 'c' && !window.getSelection()?.toString()) {
      e.preventDefault();
      void act({ kind: 'copy' });
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const i = visible.findIndex((c) => c.hash === anchor);
      const next = visible[Math.max(0, Math.min(visible.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) {
        selected = [next.hash];
        anchor = next.hash;
        document.querySelector(`[data-hash="${next.hash}"]`)?.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  async function act(a: CommitAction): Promise<void> {
    const sel = selection;
    const hashes = sel.map((c) => c.hash);
    if (!sel.length) return;
    const root = workspace.path;
    switch (a.kind) {
      case 'cherry-pick':
        await cherryPick(hashes);
        break;
      case 'revert':
        await revertCommits(hashes);
        break;
      case 'checkout':
        await checkoutCommit(hashes[0]);
        break;
      case 'merge':
        await mergeBranch(a.branch);
        break;
      case 'rebase':
        await rebaseOnto(a.branch);
        break;
      case 'interactive':
        rebaseTarget = a.branch;
        break;
      case 'reset':
        if (
          a.mode !== 'hard' ||
          (await requestConfirm(
            t('git.graph.resetHardConfirm', { branch: current || 'HEAD', short: sel[0].short }),
            'Reset',
          ))
        )
          await resetTo(hashes[0], a.mode);
        break;
      case 'push-tag':
        await pushTag(a.tag);
        break;
      case 'delete-tag': {
        const how = await requestChoice(
          t('git.graph.deleteTagConfirm', { name: a.tag }),
          t('git.branch.delete'),
          t('git.graph.deleteTagRemote'),
        );
        if (how) await deleteTag(a.tag, how === 'alt');
        break;
      }
      case 'tag':
      case 'branch':
        promptValue = '';
        prompt = { kind: a.kind, hash: hashes[0] };
        break;
      case 'patch':
        if (!root) return;
        try {
          // Oldest first, the order `git am` applies them in.
          const text = await gitFormatPatch(root, [...hashes].reverse());
          await openapiExportSave(`${sel.at(-1)!.short}.patch`, text, t('git.graph.patch'));
        } catch (err) {
          git.error = String(err);
        }
        break;
      case 'copy':
        await navigator.clipboard.writeText(hashes.join('\n'));
        break;
      case 'compare':
        // Two commits: older → newer (the list is newest first). One: it → HEAD.
        if (hashes.length === 2) openCompareTab(hashes[1], hashes[0]);
        else openCompareTab(hashes[0], 'HEAD');
        break;
    }
  }

  async function submitPrompt(): Promise<void> {
    const p = prompt;
    const name = promptValue.trim();
    if (!p || !name) return;
    prompt = null;
    if (p.kind === 'tag') await createTag(name, p.hash);
    else await createBranchAt(name, p.hash);
  }

  const x = (lane: number) => PAD + lane * LANE;
  function path(s: Segment): string {
    const [y1, y2] = s.half === 'top' ? [0, ROW / 2] : s.half === 'bottom' ? [ROW / 2, ROW] : [0, ROW];
    const [x1, x2] = [x(s.from), x(s.to)];
    if (x1 === x2) return `M${x1} ${y1}V${y2}`;
    const m = (y1 + y2) / 2;
    return `M${x1} ${y1}C${x1} ${m} ${x2} ${m} ${x2} ${y2}`;
  }
  const color = (i: number) => COLORS[i % COLORS.length];
  // ---- Drag a branch label onto another branch's row: merge it there, or rebase that one onto it.
  // Pointer events: HTML5 drag & drop never fires in the macOS webview. ----
  type Drag = { src: string; x0: number; y0: number; x: number; y: number; on: boolean; over: string };
  let drag = $state<Drag | null>(null);
  let dropMenu = $state<{ x: number; y: number; src: string; dst: string } | null>(null);
  /** A drag just ended on a row: its click must not select it. */
  let swallowClick = false;
  const branchOf = (c: GraphCommit | undefined) =>
    (c?.refs.find((r) => r.kind === 'head') ?? c?.refs.find((r) => r.kind === 'branch'))?.name;
  const rowAt = (x: number, y: number) =>
    document.elementFromPoint(x, y)?.closest<HTMLElement>('.bs-graphview [data-hash]')?.dataset.hash ?? '';

  function dragStart(e: PointerEvent, ref: GitRef): void {
    if (e.button !== 0 || ref.kind === 'tag') return;
    e.preventDefault(); // no text selection while dragging
    drag = { src: ref.name, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, on: false, over: '' };
    window.addEventListener('pointermove', dragMove);
    window.addEventListener('pointerup', dragEnd, { once: true });
  }
  function dragMove(e: PointerEvent): void {
    if (!drag) return;
    const on = drag.on || Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 5;
    drag = { ...drag, x: e.clientX, y: e.clientY, on, over: on ? rowAt(e.clientX, e.clientY) : '' };
  }
  function dragEnd(e: PointerEvent): void {
    window.removeEventListener('pointermove', dragMove);
    const d = drag;
    drag = null;
    if (!d?.on) return;
    swallowClick = true;
    setTimeout(() => (swallowClick = false));
    const dst = branchOf(commits.find((c) => c.hash === rowAt(e.clientX, e.clientY)));
    if (dst && dst !== d.src) dropMenu = { x: e.clientX, y: e.clientY, src: d.src, dst };
  }

  /** Merge `src` into `dst`, or rebase `dst` onto `src` — switching to `dst` first when it isn't current. */
  async function dropAction(kind: 'merge' | 'rebase', src: string, dst: string): Promise<void> {
    dropMenu = null;
    if (dst !== current) {
      await requestCheckout(dst);
      // Uncommitted changes open the switch dialog instead; the drop waits for a clean switch.
      if (git.status?.branch !== dst) return;
    }
    if (kind === 'merge') await mergeBranch(src);
    else await rebaseOnto(src);
  }

  const refIcon = (r: GitRef) => (r.kind === 'remote' ? 'cloud' : r.kind === 'tag' ? 'sell' : '');
  // Labels: the checked-out branch first, then local branches, remotes, tags; a remote that just
  // mirrors a local label at the same commit is still shown, like the design.
  const order = { head: 0, branch: 1, remote: 2, tag: 3 } as const;
  const sortedRefs = (refs: GitRef[]) =>
    refs.filter((r) => !(r.kind === 'head' && r.name === 'HEAD')).sort((a, b) => order[a.kind] - order[b.kind]);
</script>

{#snippet graph(hash: string, kind: 'worktree' | 'head' | 'merge' | 'commit')}
  {@const r = laneOf.get(hash)}
  {#if r}
    <svg class="lanes" width={PAD * 2 + (width - 1) * LANE} height={ROW} aria-hidden="true">
      {#if !q}
        {#each r.segments as s, i (i)}
          {#if s.from < MAX_LANES && s.to < MAX_LANES}
            <path d={path(s)} stroke={color(s.color)} />
          {/if}
        {/each}
      {/if}
      {#if r.lane < MAX_LANES}
        {#if kind === 'worktree'}
          <circle class="hollow" cx={x(r.lane)} cy={ROW / 2} r="5" stroke="var(--color-text-muted)" />
        {:else if kind === 'head'}
          <circle class="ring" cx={x(r.lane)} cy={ROW / 2} r="6.5" stroke={color(r.color)} />
        {:else if kind === 'merge'}
          <circle class="hollow" cx={x(r.lane)} cy={ROW / 2} r="5" stroke={color(r.color)} />
        {:else}
          <circle cx={x(r.lane)} cy={ROW / 2} r="5" fill={color(r.color)} />
        {/if}
      {/if}
    </svg>
  {/if}
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div class="bs-gview bs-graphview" tabindex="0" role="region" aria-label={t('git.tab.graph')} onkeydown={onKey}>
  <div class="bs-ghead">
    <div class="ttl">
      <span class="crumb">{`${t('git.title')}  /  ${t('git.graph.crumb')}`}</span>
      <div class="row">
        <h2>{t('git.graph.title')}</h2>
        <span class="bs-gtag"
          >{`${branchCount} ${tp(branchCount, ['ветка', 'ветки', 'веток'], ['branch', 'branches'])} · ${total} ${tp(total, ['коммит', 'коммита', 'коммитов'], ['commit', 'commits'])}`}</span
        >
      </div>
    </div>
    <label class="search">
      <span class="material-symbols-outlined" aria-hidden="true">search</span>
      <input
        bind:value={query}
        placeholder={t('git.graph.search')}
        aria-label={t('git.graph.search')}
        autocomplete="off"
        spellcheck="false"
      />
    </label>
    <div class="bs-gseg" role="group" aria-label={t('git.graph.range')}>
      <button class:on={all} aria-pressed={all} onclick={() => (all = true)}>{t('git.graph.all')}</button>
      <button class:on={!all} aria-pressed={!all} onclick={() => (all = false)}>{t('git.graph.current')}</button>
    </div>
    {#if git.undo}
      <button class="bs-gbtn" disabled={git.busy} onclick={undoLast}
        ><span class="material-symbols-outlined">undo</span>{git.undo.label}</button
      >
    {:else if git.status?.undoRebase}
      <!-- Survives restarts: read from the branch's reflog, not from this session's last action. -->
      <button
        class="bs-gbtn"
        disabled={git.busy}
        title={`git reset --keep ${git.status.undoRebase.slice(0, 7)}`}
        onclick={() => undoRebase()}
        ><span class="material-symbols-outlined">undo</span>{t('git.graph.undoRebase')}</button
      >
    {/if}
    <button class="bs-gbtn" title={t('git.reflog.open')} onclick={openReflogTab}
      ><span class="material-symbols-outlined">manage_history</span>Reflog</button
    >
    <button class="bs-gbtn" disabled={git.busy} onclick={() => fetchAll()}
      ><span class="material-symbols-outlined" class:spin={git.busy}>sync</span>Fetch</button
    >
  </div>

  <div class="split">
    <div class="table">
      <div class="thead" style:--gw="{PAD * 2 + (width - 1) * LANE}px">
        <span>{t('git.graph.colGraph')}</span><span>{t('git.graph.colMessage')}</span><span></span><span
          >{t('git.graph.date')}</span
        ><span>{t('git.graph.colHash')}</span>
      </div>
      <div class="rows" style:--gw="{PAD * 2 + (width - 1) * LANE}px">
        {#if dirty && head && !q}
          <button class="r wt" onclick={openProjectDiffTab}>
            {@render graph(WORKTREE, 'worktree')}
            <span class="msg"
              ><i>{t('git.graph.uncommitted')}</i><span class="chg"
                >{`${dirty} ${tp(dirty, ['изменение', 'изменения', 'изменений'], ['change', 'changes'])}`}</span
              ></span
            >
            <span></span>
            <span class="date">{t('git.graph.now')}</span>
            <span></span>
          </button>
        {/if}
        {#each visible as c (c.hash)}
          {@const isHead = c.refs.some((r) => r.kind === 'head')}
          {@const lc = color(laneOf.get(c.hash)?.color ?? 0)}
          <button
            class="r"
            class:sel={selected.includes(c.hash)}
            class:merge={c.parents.length > 1}
            data-hash={c.hash}
            class:drop={drag?.on && drag.over === c.hash && !!branchOf(c) && branchOf(c) !== drag.src}
            onclick={(e) => !swallowClick && pick(e, c.hash)}
            oncontextmenu={(e) => openMenu(e, c.hash)}
          >
            {@render graph(c.hash, isHead ? 'head' : c.parents.length > 1 ? 'merge' : 'commit')}
            <span class="msg">
              <span class="subj">{c.subject}</span>
              {#each sortedRefs(c.refs) as ref (ref.kind + ref.name)}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <span
                  class="ref {ref.kind}"
                  style:--lc={ref.kind === 'head' || ref.kind === 'branch' ? lc : undefined}
                  title={ref.kind === 'tag' ? undefined : t('git.graph.dragHint')}
                  onpointerdown={(e) => dragStart(e, ref)}
                  >{#if refIcon(ref)}<span class="material-symbols-outlined">{refIcon(ref)}</span>{:else}<GitBranchIcon
                      size={11}
                    />{/if}{ref.name}</span
                >
                {#if ref.kind === 'head' && git.status?.ahead}<span class="ahead">↑{git.status.ahead}</span>{/if}
              {/each}
            </span>
            <span class="av" title={c.author}>{initials(c.author)}</span>
            <span class="date">{commitDate(c.time, now, lang)}</span>
            <span class="hash">{c.short}</span>
          </button>
        {/each}
        {#if !q && commits.length < total}
          <button class="moreb" disabled={loading} onclick={more}
            ><span class="material-symbols-outlined">keyboard_double_arrow_down</span>{t('git.graph.more', {
              n: total - commits.length,
              commits: tp(total - commits.length, ['коммит', 'коммита', 'коммитов'], ['commit', 'commits']),
            })}</button
          >
        {/if}
        {#if !commits.length && !loading}
          <div class="bs-gview-empty">{t('git.log.none')}</div>
        {:else if q && !visible.length}
          <div class="bs-gview-empty">{t('git.graph.notFound')}</div>
        {/if}
      </div>
    </div>

    {#if selection.length}
      <CommitPanel commits={selection} {details} onAction={act} onMenu={(e) => openMenu(e)} />
    {/if}
  </div>
</div>

{#if drag?.on}
  <div class="bs-graph-ghost" style:left="{drag.x + 12}px" style:top="{drag.y + 10}px">
    <GitBranchIcon size={12} />{drag.src}
  </div>
{/if}
{#if dropMenu}
  {@const m = dropMenu}
  <div class="bs-gitlayer" role="presentation" onpointerdown={() => (dropMenu = null)}></div>
  <div class="bs-dropmenu" role="menu" style:left="{m.x}px" style:top="{m.y}px">
    <button role="menuitem" onclick={() => dropAction('merge', m.src, m.dst)}
      ><span class="material-symbols-outlined">merge</span>{t('git.graph.dropMerge', {
        src: m.src,
        dst: m.dst,
      })}</button
    >
    <button role="menuitem" onclick={() => dropAction('rebase', m.src, m.dst)}
      ><span class="material-symbols-outlined">low_priority</span>{t('git.graph.dropRebase', {
        src: m.src,
        dst: m.dst,
      })}</button
    >
  </div>
{/if}

{#if menu && selection.length}
  <CommitMenu
    at={menu}
    commits={selection}
    {current}
    onCurrent={selection.every((c) => details[c.hash]?.branches.includes(current))}
    onAction={act}
    onClose={() => (menu = null)}
  />
{/if}

{#if rebaseTarget}
  <RebaseDialog onto={rebaseTarget} onClose={() => (rebaseTarget = null)} />
{/if}

{#if prompt}
  <div class="bs-overlay" role="dialog" aria-modal="true" aria-label={t(`git.graph.${prompt.kind}Prompt`)}>
    <div class="bs-modal" style="max-width:380px">
      <div class="bs-modal-b" style="padding:18px 18px 6px">
        <b>{t(`git.graph.${prompt.kind}Prompt`, { short: prompt.hash.slice(0, 7) })}</b>
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="bs-input"
          style="width:100%;margin-top:12px"
          bind:value={promptValue}
          autofocus
          onkeydown={(e) => {
            if (e.key === 'Enter') void submitPrompt();
            else if (e.key === 'Escape') prompt = null;
          }}
        />
      </div>
      <div class="bs-modal-f">
        <div class="grow"></div>
        <button type="button" class="bs-btn ghost" onclick={() => (prompt = null)}>{t('common.cancel')}</button>
        <button type="button" class="bs-btn primary" disabled={!promptValue.trim()} onclick={submitPrompt}
          >{t('git.graph.create')}</button
        >
      </div>
    </div>
  </div>
{/if}

<style>
  .bs-graphview {
    outline: none;
  }
  /* The title keeps its width; the search gives way when the header gets crowded. */
  .ttl {
    flex: 1 0 auto;
  }
  .search {
    flex: 0 1 300px;
    min-width: 120px;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 12px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    background: var(--color-field);
    color: var(--color-text-muted);
  }
  .search .material-symbols-outlined {
    font-size: 16px;
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--color-text);
    font: var(--font-size-ui) var(--font-ui);
  }
  .spin {
    animation: bs-graph-spin 1s linear infinite;
  }
  @keyframes bs-graph-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .split {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 12px;
    padding: 0 20px 20px;
  }
  .table {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
    background: var(--color-field);
    overflow: hidden;
  }
  .thead,
  .r {
    display: grid;
    grid-template-columns: var(--gw) minmax(0, 1fr) 28px 96px 64px;
    align-items: center;
    column-gap: 12px;
    padding: 0 16px 0 10px;
  }
  .thead {
    flex: none;
    height: 40px;
    border-bottom: 1px solid var(--color-border-subtle);
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro) var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
  }
  .rows {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 6px;
  }
  .r {
    width: 100%;
    height: 38px;
    padding-left: 4px;
    border-radius: 12px;
    color: var(--color-text);
    text-align: left;
  }
  .r:hover {
    background: var(--color-hover);
  }
  .r.sel {
    background: var(--color-selected);
  }
  .lanes {
    display: block;
    overflow: visible;
  }
  .lanes path {
    fill: none;
    stroke-width: 2;
  }
  .lanes .hollow {
    fill: var(--color-field);
    stroke-width: 2;
  }
  .lanes .ring {
    fill: var(--color-field);
    stroke-width: 3;
  }
  .msg {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    overflow: hidden;
    font-size: var(--font-size-ui);
  }
  .subj {
    flex: 0 1 auto;
    /* The message keeps room; branch labels give way first. */
    min-width: min(60%, 220px);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .merge .subj {
    color: var(--color-text-secondary);
  }
  .wt i {
    color: var(--color-text-secondary);
  }
  .chg {
    padding: 1px 8px;
    border-radius: var(--radius-control);
    background: var(--color-warning-soft);
    color: var(--color-warning);
    font: 500 var(--font-size-caption) var(--font-code);
    white-space: nowrap;
  }
  .r.drop {
    box-shadow: inset 0 0 0 2px var(--method-patch);
  }
  .ref:not(.tag) {
    cursor: grab;
  }
  .bs-graph-ghost {
    position: fixed;
    z-index: 70;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    padding: 0 10px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-control);
    background: var(--color-raised);
    box-shadow: 0 8px 24px var(--color-shadow);
    color: var(--color-text);
    font: var(--font-size-caption) var(--font-code);
    pointer-events: none;
  }
  .bs-dropmenu {
    position: fixed;
    z-index: 61;
    min-width: 260px;
    padding: 6px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
    background: var(--color-raised);
    box-shadow: 0 18px 48px var(--color-shadow);
  }
  .bs-dropmenu button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 34px;
    padding: 0 12px;
    border-radius: var(--radius-control);
    color: var(--color-text);
    font: var(--font-size-ui) var(--font-ui);
    text-align: left;
    white-space: nowrap;
  }
  .bs-dropmenu button:hover {
    background: var(--color-hover);
  }
  .bs-dropmenu .material-symbols-outlined {
    font-size: 16px;
    color: var(--color-text-muted);
  }
  .ref {
    flex: 0 1 auto;
    min-width: 28px;
    overflow: hidden;
    text-overflow: ellipsis;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 20px;
    padding: 0 8px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    color: var(--color-text-secondary);
    font: var(--font-size-caption) var(--font-code);
    white-space: nowrap;
  }
  .ref.head,
  .ref.branch {
    border-color: color-mix(in srgb, var(--lc) 70%, transparent);
    color: var(--lc);
  }
  .ref.head {
    background: color-mix(in srgb, var(--lc) 12%, transparent);
  }
  .ref .material-symbols-outlined {
    font-size: 12px;
  }
  .ahead {
    flex: none;
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-code);
  }
  .av {
    display: inline-flex;
    width: 22px;
    height: 22px;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--color-selected);
    color: var(--color-text-secondary);
    font: 600 8.5px var(--font-ui);
  }
  .date,
  .hash {
    color: var(--color-text-muted);
    font: var(--font-size-body) var(--font-code);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .moreb {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    height: 40px;
    margin-top: 6px;
    border-radius: 12px;
    color: var(--color-text-secondary);
    font-size: var(--font-size-body);
  }
  .moreb:hover {
    background: var(--color-hover);
  }
  .moreb .material-symbols-outlined {
    font-size: 16px;
  }
</style>
