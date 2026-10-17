<script lang="ts">
  /**
   * G1: the Git tab of the sidebar. Branch row (opens the branch popover), the commit box (G4b),
   * STAGED and CHANGES with per-file actions, STASHES (G10) and RECENT COMMITS. Clicking a file
   * opens its diff tab. Without a repo it is the G4 empty state with one button.
   */
  import { untrack } from 'svelte';
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import { GitBranchIcon } from '$shared/ui/components';
  import {
    commitChanges,
    describeFile,
    discardPaths,
    git,
    initRepo,
    MESSAGE_MAX_LINES,
    messageParts,
    openCommitEditorTab,
    openGitDiffTab,
    openGraphTab,
    undoLast,
    stashFiles,
    isConflict,
    abortOperation,
    continueOperation,
    skipOperation,
    openConflictsTab,
    openMergeTab,
    openProjectDiffTab,
    openStashTab,
    shortAgo,
    stagePaths,
    statusColor,
    SUBJECT_MAX,
    unstagePaths,
  } from '$entities/git';
  import { workspace } from '$entities/workspace';
  import { tabs } from '$entities/tab';
  import { methodColor, type GitCommit, type GitFile, type GitStash } from '$shared/model';
  import { requestConfirm } from '$shared/ui';
  import { t, tp } from '$shared/i18n';
  import { GitButton } from '$entities/git/components';

  const status = $derived(git.status);
  const files = $derived(status?.files ?? []);
  // Staged = the index slot holds a real change; changes = a worktree change or an untracked file.
  // A conflicted file (after a stopped cherry-pick / merge) is in neither list but its own.
  const conflicts = $derived(files.filter(isConflict));
  const staged = $derived(files.filter((f) => !isConflict(f) && f.index !== ' ' && f.index !== '?'));
  const changes = $derived(files.filter((f) => !isConflict(f) && (f.worktree !== ' ' || f.index === '?')));
  const activeGit = $derived(tabs.active?.protocol === 'git' ? tabs.active.git : undefined);
  const info = (f: GitFile) => describeFile(f.path, git.prefix, (id) => workspace.byId.get(id));
  // Ages in the lists recount on every refresh.
  const now = $derived.by(() => (void git.version, Date.now()));
  /** The letter for one side: the index change in STAGED, the worktree change (or U) in CHANGES. */
  const sideLetter = (f: GitFile, inIndex: boolean) => (inIndex ? f.index : f.index === '?' ? 'U' : f.worktree);

  // ---- The scroll area as one flat list (op banner, section headers, rows), virtualized below ----
  type Row =
    | { key: string; kind: 'op' | 'sec-conflicts' | 'sec-staged' | 'sec-changes' | 'none' | 'sec-stashes' | 'sec-log' }
    | { key: string; kind: 'conflict'; f: GitFile }
    | { key: string; kind: 'file'; f: GitFile; inIndex: boolean }
    | { key: string; kind: 'stash'; s: GitStash }
    | { key: string; kind: 'commit'; c: GitCommit; i: number };
  const rows = $derived.by(() => {
    const out: Row[] = [];
    if (status?.operation) out.push({ key: 'op', kind: 'op' });
    if (conflicts.length) out.push({ key: 'sec-conflicts', kind: 'sec-conflicts' });
    for (const f of conflicts) out.push({ key: `c:${f.path}`, kind: 'conflict', f });
    if (staged.length) out.push({ key: 'sec-staged', kind: 'sec-staged' });
    for (const f of staged) out.push({ key: `s:${f.path}`, kind: 'file', f, inIndex: true });
    out.push({ key: 'sec-changes', kind: 'sec-changes' });
    for (const f of changes) out.push({ key: `w:${f.path}`, kind: 'file', f, inIndex: false });
    if (!changes.length) out.push({ key: 'none', kind: 'none' });
    if (git.stashes.length) out.push({ key: 'sec-stashes', kind: 'sec-stashes' });
    for (const s of git.stashes) out.push({ key: `st:${s.hash}`, kind: 'stash', s });
    if (git.log.length) out.push({ key: 'sec-log', kind: 'sec-log' });
    git.log.forEach((c, i) => out.push({ key: `log:${c.hash}`, kind: 'commit', c, i }));
    return out;
  });
  /** First-guess heights; every rendered row is measured. */
  const estimate = (r: Row) =>
    r.kind === 'file' || r.kind === 'conflict'
      ? 25
      : r.kind.startsWith('sec')
        ? 31
        : ({ op: 150, none: 22, stash: 38, commit: 42 } as Record<string, number>)[r.kind];

  // Like the sidebar tree: only rows near the viewport are in the DOM, so a workspace with thousands
  // of changed files opens (and re-renders on every status refresh) fast. `$virtualizer` is a svelte/store.
  let scrollEl = $state<HTMLElement>();
  const virtualizer = createVirtualizer<HTMLElement, HTMLElement>({
    count: 0,
    getScrollElement: () => null,
    estimateSize: () => 25,
    overscan: 12,
  });
  // Pre: the count and keys must match `rows` before the list renders.
  $effect.pre(() => {
    const r = rows;
    const el = scrollEl;
    untrack(() => $virtualizer).setOptions({
      count: r.length,
      getItemKey: (i) => r[i].key,
      estimateSize: (i) => estimate(r[i]),
      getScrollElement: () => el ?? null,
    });
  });
  const items = $derived($virtualizer.getVirtualItems());
  const padTop = $derived(items[0]?.start ?? 0);
  const padBottom = $derived($virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0));
  const measureRow = (el: HTMLElement) => untrack(() => $virtualizer).measureElement(el);

  // ---- Branch row (G3 popover lives in app overlays) ----
  function openBranches(e: MouseEvent): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    git.branchMenu = { x: r.left, y: r.bottom + 6, up: false, w: r.width };
  }

  // ---- Commit box (G4b) ----
  let focused = $state(false);
  let box = $state<HTMLElement>();
  let area = $state<HTMLTextAreaElement>();
  const parts = $derived(messageParts(git.message));
  /** D: unfocused, a multi-line message shows only its subject and “N more lines”. */
  const collapsed = $derived(!focused && parts.more > 0);
  const subjectLen = $derived(git.message.split('\n')[0].length);
  const canCommit = $derived(!git.busy && git.message.trim() !== '' && (staged.length > 0 || git.amend));

  // Grow with the text up to MESSAGE_MAX_LINES lines, then scroll.
  $effect(() => {
    void git.message;
    if (!area) return;
    if (collapsed) {
      area.style.height = '';
      return;
    }
    area.style.height = 'auto';
    const line = parseFloat(getComputedStyle(area).lineHeight) || 18;
    area.style.height = `${Math.min(area.scrollHeight, line * MESSAGE_MAX_LINES)}px`;
  });

  function onBoxFocusOut(e: FocusEvent): void {
    if (!box?.contains(e.relatedTarget as Node | null)) focused = false;
  }

  async function commit(): Promise<void> {
    if (canCommit) await commitChanges(git.message, git.amend);
  }

  function onMessageKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void commit();
    } else if (e.key === 'Escape') {
      area?.blur();
    }
  }

  // ---- Stash popover (G10, rendered in app overlays) ----
  function openStash(e: MouseEvent): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    git.stashMenu = { x: r.left - 8, y: r.bottom + 8 };
  }

  async function discardOne(f: GitFile): Promise<void> {
    if (await requestConfirm(t('git.discard.confirm', { name: info(f).name }), t('git.discard')))
      await discardPaths([f.path]);
  }

  async function discardAll(): Promise<void> {
    if (
      await requestConfirm(
        t('git.discardAll.confirm', {
          n: changes.length,
          files: tp(changes.length, ['file', 'files']),
        }),
        t('git.discard'),
      )
    )
      await discardPaths(changes.map((f) => f.path));
  }

  /** Row actions are spans inside the row button: Enter / Space run them instead of the row. */
  function actKey(e: KeyboardEvent, run: () => void): void {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    run();
  }
</script>

{#snippet fileRow(f: GitFile, inIndex: boolean)}
  {@const i = info(f)}
  {@const letter = sideLetter(f, inIndex)}
  <button
    class="row"
    class:sel={activeGit?.path === f.path &&
      (activeGit.view ?? 'file') === 'file' &&
      (activeGit.mode === 'staged') === inIndex}
    class:gone={letter === 'D'}
    title={f.path}
    onclick={() => openGitDiffTab(f.path, inIndex ? 'staged' : 'working', i.name)}
  >
    <span class="m" style:color={i.method ? methodColor(i.method === 'gRPC' ? 'GRPC' : i.method) : undefined}
      >{i.method}</span
    >
    <span class="nm">{i.name}</span>
    <span class="dir">{i.dir}</span>
    <span class="acts">
      {#if inIndex}
        <span
          class="act"
          role="button"
          tabindex="0"
          title={t('git.unstage')}
          onclick={(e) => {
            e.stopPropagation();
            void unstagePaths([f.path]);
          }}
          onkeydown={(e) => actKey(e, () => void unstagePaths([f.path]))}
          ><span class="material-symbols-outlined">remove</span></span
        >
      {:else}
        <span
          class="act"
          role="button"
          tabindex="0"
          title={t('git.discardChanges')}
          onclick={(e) => {
            e.stopPropagation();
            void discardOne(f);
          }}
          onkeydown={(e) => actKey(e, () => void discardOne(f))}
          ><span class="material-symbols-outlined">undo</span></span
        >
        <span
          class="act"
          role="button"
          tabindex="0"
          title={t('git.stashFile')}
          onclick={(e) => {
            e.stopPropagation();
            void stashFiles([f.path], info(f).name);
          }}
          onkeydown={(e) => actKey(e, () => void stashFiles([f.path], info(f).name))}
          ><span class="material-symbols-outlined">inventory_2</span></span
        >
        <span
          class="act"
          role="button"
          tabindex="0"
          title={t('git.stage')}
          onclick={(e) => {
            e.stopPropagation();
            void stagePaths([f.path]);
          }}
          onkeydown={(e) => actKey(e, () => void stagePaths([f.path]))}
          ><span class="material-symbols-outlined">add</span></span
        >
      {/if}
    </span>
    <span class="st" style:color={statusColor(letter)}>{letter}</span>
  </button>
{/snippet}

<div class="bs-gitpanel" class:busy={git.busy}>
  {#if !workspace.path}
    <div class="empty">
      <span class="tile material-symbols-outlined" aria-hidden="true">folder_open</span>
      <b>{t('git.noWorkspace')}</b>
      <p>{t('git.noWorkspace.hint')}</p>
    </div>
  {:else if status && !status.isRepo}
    <div class="empty">
      <span class="tile"><GitBranchIcon size={20} /></span>
      <b>{t('git.notRepo')}</b>
      <p>{t('git.notRepo.hint')}</p>
      <GitButton class="inv init" onclick={initRepo}><GitBranchIcon size={15} />{t('git.init')}</GitButton>
      <code>{t('git.init.hint', { path: workspace.path.replace(/^\/Users\/[^/]+/, '~') })}</code>
    </div>
  {:else if status}
    <div class="branchrow">
      <button class="branch" title={t('git.branch.switch')} onclick={openBranches}>
        <GitBranchIcon size={14} />
        <span class="bn">{status.branch || t('git.noBranch')}</span>
        <span class="material-symbols-outlined chev" aria-hidden="true">unfold_more</span>
      </button>
      {#if status.upstream}
        <button class="sync" title={t('git.branch.aheadBehind')} onclick={openBranches}>
          <span class="material-symbols-outlined" aria-hidden="true">arrow_downward</span>{status.behind}
          <span class="material-symbols-outlined" aria-hidden="true">arrow_upward</span>{status.ahead}
        </button>
      {/if}
      {#if git.undo}
        <!-- GitKraken's Undo: takes back the last action (commit, checkout, discard, reset, branch). -->
        <button class="sync" title={git.undo.label} aria-label={git.undo.label} disabled={git.busy} onclick={undoLast}
          ><span class="material-symbols-outlined" aria-hidden="true">undo</span></button
        >
      {/if}
    </div>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="commit" class:focused bind:this={box} onfocusin={() => (focused = true)} onfocusout={onBoxFocusOut}>
      {#if collapsed}
        <!-- Not focusable and keeps focus off itself: the textarea below stays mounted, so focusing it expands. -->
        <button class="collapsed" tabindex="-1" onpointerdown={(e) => e.preventDefault()} onclick={() => area?.focus()}>
          <span class="subj">{parts.subject}</span>
          <span class="more"
            ><span class="material-symbols-outlined">expand_more</span>{t('git.commit.more', {
              n: parts.more,
              lines: tp(parts.more, ['line', 'lines']),
            })}</span
          >
        </button>
      {/if}
      {#if focused}
        <div class="subjhead">
          <span>{t('git.commit.subject')}</span>
          <span class="cnt" class:over={subjectLen > SUBJECT_MAX}>{subjectLen} / {SUBJECT_MAX}</span>
          <button class="ico" title={t('git.commit.openEditor')} onclick={openCommitEditorTab}
            ><span class="material-symbols-outlined">open_in_full</span></button
          >
        </div>
      {/if}
      <textarea
        bind:this={area}
        bind:value={git.message}
        class:hide={collapsed}
        rows="1"
        placeholder={t('git.commit.placeholder')}
        aria-label={t('git.commit.placeholder')}
        onkeydown={onMessageKey}></textarea>
      {#if focused && subjectLen > SUBJECT_MAX}
        <div class="warn">
          <span class="material-symbols-outlined">lightbulb</span>{t('git.commit.tooLong')}
        </div>
      {/if}
      <div class="foot">
        {#if focused}
          <label class="amend"><input type="checkbox" bind:checked={git.amend} />Amend</label>
        {/if}
        <span class="hint">{t('git.commit.staged', { n: staged.length })}</span>
        <GitButton class="inv sm" disabled={!canCommit} onclick={commit}
          ><span class="material-symbols-outlined">check</span>{t('git.commit')}<kbd>⌘↵</kbd></GitButton
        >
      </div>
    </div>

    <div class="scroll" bind:this={scrollEl}>
      <!-- Virtual (@tanstack/svelte-virtual, like the sidebar tree): only rows near the viewport are in the DOM,
           so thousands of changed files open and refresh fast. Padding stands in for the rest. -->
      <div style="padding:{padTop}px 0 {padBottom}px">
        {#each items as item (item.key)}
          {@const row = rows[item.index]}
          <!-- A flex wrapper, so the measured height includes the row's margins. -->
          <div data-index={item.index} class="vrow" {@attach measureRow}>
            {#if row?.kind === 'op'}
              <div class="op">
                <div class="oph">
                  <span class="material-symbols-outlined">commit</span>{git.op?.total
                    ? t('git.op.step', { kind: status.operation, i: git.op.step, n: git.op.total })
                    : status.operation}
                </div>
                {#if git.op?.hash}<div class="opc">{`${git.op.hash.slice(0, 7)} · ${git.op.subject}`}</div>{/if}
                <p>
                  {conflicts.length
                    ? t('git.op.conflicts', {
                        n: conflicts.length,
                        files: tp(conflicts.length, ['conflict', 'conflicts']),
                      })
                    : git.op?.paused
                      ? t('git.op.paused')
                      : t('git.op.ready')}
                </p>
                <div class="opb">
                  <GitButton class="sm" disabled={git.busy} onclick={abortOperation}
                    ><span class="material-symbols-outlined">close</span>{t('git.op.abort')}</GitButton
                  >
                  <GitButton
                    class="sm"
                    disabled={git.busy || status.operation === 'merge' || !!git.op?.paused}
                    onclick={skipOperation}
                    ><span class="material-symbols-outlined">skip_next</span>{t('git.op.skip')}</GitButton
                  >
                </div>
                <GitButton class="sm inv cont" disabled={git.busy || conflicts.length > 0} onclick={continueOperation}
                  >{t('git.op.continue')}<span class="material-symbols-outlined">arrow_forward</span></GitButton
                >
              </div>
            {:else if row?.kind === 'sec-conflicts'}
              <div class="sec conflicts">
                <span class="eb">{t('git.conflicts')}</span><span class="n">{conflicts.length}</span>
                <button class="ico" title={t('git.tab.conflicts')} onclick={openConflictsTab}
                  ><span class="material-symbols-outlined">north_east</span></button
                >
              </div>
            {:else if row?.kind === 'conflict'}
              {@const f = row.f}
              {@const i = info(f)}
              <button
                class="row"
                title={f.path}
                onclick={() => (i.method ? openMergeTab(f.path, i.name) : openConflictsTab())}
              >
                <span
                  class="m"
                  style:color={i.method ? methodColor(i.method === 'gRPC' ? 'GRPC' : i.method) : undefined}
                  >{i.method}</span
                >
                <span class="nm">{i.name}</span>
                <span class="dir">{f.index === 'D' || f.worktree === 'D' ? t('git.cf.deleted') : i.dir}</span>
                <span class="st" style:color="var(--color-danger)">!</span>
              </button>
            {:else if row?.kind === 'sec-staged'}
              <div class="sec">
                <span class="eb">{t('git.staged')}</span><span class="n">{staged.length}</span>
                <button
                  class="ico"
                  disabled={git.busy}
                  title={t('git.unstageAll')}
                  onclick={() => unstagePaths(staged.map((f) => f.path))}
                  ><span class="material-symbols-outlined">remove</span></button
                >
              </div>
            {:else if row?.kind === 'sec-changes'}
              <div class="sec">
                <span class="eb">{t('git.changes')}</span><span class="n">{changes.length}</span>
                {#if files.length}
                  <button class="ico" title={t('git.changes.openAll')} onclick={openProjectDiffTab}
                    ><span class="material-symbols-outlined">difference</span></button
                  >
                {/if}
                {#if changes.length}
                  <button class="ico" disabled={git.busy} title={t('git.stash.title')} onclick={openStash}
                    ><span class="material-symbols-outlined">inventory_2</span></button
                  >
                  <button class="ico" disabled={git.busy} title={t('git.discardAll')} onclick={discardAll}
                    ><span class="material-symbols-outlined">undo</span></button
                  >
                  <button
                    class="ico"
                    disabled={git.busy}
                    title={t('git.stageAll')}
                    onclick={() => stagePaths(changes.map((f) => f.path))}
                    ><span class="material-symbols-outlined">add</span></button
                  >
                {/if}
              </div>
            {:else if row?.kind === 'file'}
              {@render fileRow(row.f, row.inIndex)}
            {:else if row?.kind === 'none'}
              <p class="none">{t('git.changes.none')}</p>
            {:else if row?.kind === 'sec-stashes'}
              <div class="sec">
                <span class="eb">{t('git.stashes')}</span><span class="n">{git.stashes.length}</span>
              </div>
            {:else if row?.kind === 'stash'}
              {@const s = row.s}
              <button
                class="row tall"
                class:sel={activeGit?.view === 'stash' && activeGit.path === s.hash}
                onclick={() => openStashTab(s.hash, s.message)}
              >
                <span class="material-symbols-outlined lead" aria-hidden="true">inventory_2</span>
                <span class="two">
                  <span class="nm">{s.message}</span>
                  <span class="meta">{`stash@{${s.index}} · ${shortAgo(s.time, now)}`}</span>
                </span>
              </button>
            {:else if row?.kind === 'sec-log'}
              <div class="sec">
                <span class="eb">{t('git.log')}</span><span class="n"></span>
                <button class="graphlink" onclick={() => openGraphTab()}
                  >{t('git.graph.link')}<span class="material-symbols-outlined">north_east</span></button
                >
              </div>
            {:else if row?.kind === 'commit'}
              {@const c = row.c}
              <button
                class="commitrow"
                class:linked={row.i > 0}
                title={`${c.subject}\n${c.author} · ${c.date}`}
                onclick={() => openGraphTab(c.hash)}
              >
                <span class="dot" class:head={row.i === 0} aria-hidden="true"></span>
                <span class="two">
                  <span class="nm">{c.subject}</span>
                  <span class="meta">{`${c.short} · ${shortAgo(c.time, now)}`}</span>
                </span>
              </button>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {:else}
    <p class="none">{t('git.loading')}</p>
  {/if}
</div>

<style>
  :global(:root .bs-gbtn.sm) {
    height: 26px;
    padding: 0 12px;
    font-size: 11.5px;
  }

  .bs-gitpanel.busy {
    cursor: progress;
  }
  .bs-gitpanel {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 4px 8px 8px;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    margin: 0 -8px;
    padding: 0 8px 8px;
  }
  .vrow {
    display: flex;
    flex-direction: column;
  }
  .branchrow {
    display: flex;
    gap: 6px;
  }
  .branch,
  .sync {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 29px;
    padding: 0 10px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    background: var(--color-field);
    color: var(--color-text-secondary);
    font: var(--font-size-caption) var(--font-code);
  }
  .branch {
    flex: 1;
    min-width: 0;
  }
  .branch:hover,
  .sync:hover {
    background: var(--color-hover);
  }
  .branch .material-symbols-outlined,
  .sync .material-symbols-outlined {
    font-size: 14px;
  }
  .sync {
    gap: 3px;
    padding: 0 9px;
  }
  .bn {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
    color: var(--color-text);
  }
  .chev {
    color: var(--color-text-muted);
  }

  .commit {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
    border: 1px solid var(--color-border-subtle);
    border-radius: 18px;
    background: var(--color-field);
  }
  .commit.focused {
    border-color: var(--color-text-muted);
  }
  .commit textarea.hide {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }
  .commit textarea {
    width: 100%;
    min-height: 18px;
    padding: 2px 4px;
    border: 0;
    outline: none;
    resize: none;
    background: transparent;
    color: var(--color-text);
    font: var(--font-size-ui) / 1.45 var(--font-ui);
  }
  .subjhead {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 4px;
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro) var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
  }
  .subjhead span:first-child {
    flex: 1;
  }
  .cnt {
    letter-spacing: 0;
  }
  .cnt.over {
    color: var(--color-warning);
    font-weight: 600;
  }
  .warn {
    display: flex;
    gap: 6px;
    padding: 7px 9px;
    border-radius: var(--radius-sm);
    background: var(--color-warning-soft);
    color: var(--color-warning);
    font-size: var(--font-size-caption);
    line-height: 1.4;
  }
  .warn .material-symbols-outlined {
    font-size: 14px;
  }
  .collapsed {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    padding: 2px 4px;
    text-align: left;
  }
  .subj {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text);
    font-size: var(--font-size-ui);
  }
  .more {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1px 8px 1px 4px;
    border-radius: var(--radius-control);
    background: var(--color-selected);
    color: var(--color-text-secondary);
    font-size: var(--font-size-caption);
  }
  .more .material-symbols-outlined {
    font-size: 14px;
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-left: 4px;
  }
  .hint {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
  }
  .amend {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--color-text-secondary);
    font-size: var(--font-size-caption);
  }
  .amend input {
    margin: 0;
    accent-color: var(--color-text);
  }

  .sec {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 21px;
    margin-top: 10px;
    padding: 0 8px;
    color: var(--color-text-muted);
    font: var(--font-size-micro) var(--font-code);
  }
  .eb {
    font-weight: 500;
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
  }
  .sec .n {
    flex: 1;
  }
  .ico {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: var(--radius-control);
    color: var(--color-text-muted);
  }
  .ico:disabled {
    opacity: 0.4;
    cursor: progress;
  }
  .ico:hover:not(:disabled) {
    background: var(--color-hover);
    color: var(--color-text);
  }
  .ico .material-symbols-outlined {
    font-size: 14px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 25px;
    padding: 0 8px 0 10px;
    border-radius: var(--radius-control);
    color: var(--color-text);
    text-align: left;
  }
  .row:hover {
    background: var(--color-hover);
  }
  .row.sel {
    background: var(--color-selected);
  }
  .m {
    flex: none;
    width: 32px;
    font: 700 9.5px var(--font-code);
  }
  .nm {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-size-body);
  }
  .gone .nm {
    color: var(--color-text-muted);
  }
  .dir {
    flex: none;
    max-width: 70px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-muted);
    font-size: 10.5px;
  }
  .acts {
    display: none;
    gap: 2px;
  }
  .row:hover .acts,
  .row:focus-within .acts {
    display: flex;
  }
  .row:hover .dir,
  .row:focus-within .dir {
    display: none;
  }
  .act {
    display: inline-flex;
    width: 18px;
    justify-content: center;
    color: var(--color-text-secondary);
  }
  .act:hover {
    color: var(--color-text);
  }
  .act .material-symbols-outlined {
    font-size: 14px;
  }
  .st {
    flex: none;
    width: 10px;
    font: 700 var(--font-size-micro) var(--font-code);
    text-align: center;
  }
  .row.tall {
    height: auto;
    padding: 5px 8px 5px 10px;
    border-radius: 14px;
  }
  .lead {
    flex: none;
    font-size: 15px;
    color: var(--color-text-muted);
  }
  .two {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .two .nm {
    font-size: 11.5px;
  }
  .meta {
    color: var(--color-text-muted);
    font: var(--font-size-micro) var(--font-code);
  }
  .op {
    margin: 4px 0 6px;
    padding: 12px;
    border-radius: 16px;
    background: var(--color-warning-soft);
  }
  .oph {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--color-warning);
    font: 600 var(--font-size-micro) var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
  }
  .oph .material-symbols-outlined {
    font-size: 14px;
  }
  .opc {
    margin-top: 6px;
    color: var(--color-text);
    font-size: var(--font-size-body);
  }
  :global(:root .cont) {
    width: 100%;
    margin-top: 6px;
  }
  .op p {
    margin: 6px 0 10px;
    color: var(--color-text-secondary);
    font-size: var(--font-size-caption);
    line-height: 1.4;
  }
  .opb {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .conflicts .eb {
    color: var(--color-danger);
  }
  .graphlink {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    height: 20px;
    padding: 0 8px;
    border-radius: var(--radius-control);
    background: var(--color-raised);
    color: var(--color-text);
    font: 500 var(--font-size-caption) var(--font-ui);
    letter-spacing: 0;
  }
  .graphlink .material-symbols-outlined {
    font-size: 12px;
  }
  .commitrow {
    width: 100%;
    text-align: left;
    border-radius: 14px;
  }
  .commitrow:hover {
    background: var(--color-hover);
  }
  .commitrow {
    position: relative;
    display: flex;
    gap: 9px;
    padding: 5px 8px 5px 12px;
  }
  .commitrow.linked::before {
    content: '';
    position: absolute;
    left: 16px;
    top: -14px;
    height: 20px;
    border-left: 1px solid var(--color-border-subtle);
  }
  .commitrow .nm {
    color: var(--color-text-secondary);
  }
  .dot {
    flex: none;
    width: 9px;
    height: 9px;
    margin-top: 3px;
    border: 1.5px solid var(--color-text-muted);
    border-radius: 50%;
    background: var(--color-sidebar);
  }
  .dot.head {
    border-color: var(--color-text);
    background: var(--color-text);
  }
  .dot.head + .two .nm {
    color: var(--color-text);
  }
  .none {
    margin: 2px 10px;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
  }

  .empty {
    margin: auto 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 0 16px 40px;
    text-align: center;
  }
  .tile {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-field);
    color: var(--color-text-secondary);
    font-size: 20px;
  }
  .empty b {
    color: var(--color-text);
    font: 600 var(--font-size-title) var(--font-ui);
  }
  .empty p {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--font-size-body);
    line-height: 1.5;
  }
  :global(.bs-gbtn.init) {
    height: 34px;
    margin-top: 6px;
    padding: 0 16px;
  }
  .empty code {
    color: var(--color-text-muted);
    font: var(--font-size-micro) / 1.5 var(--font-code);
    word-break: break-all;
  }
</style>
