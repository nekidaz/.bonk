<script lang="ts">
  /**
   * G8: three-way merge of one conflicted file, as in GoLand — mine · result · theirs. Each change
   * is one aligned row across the columns: » / « take a side into the result, × rejects it,
   * «Слить непересекающиеся» takes every side that doesn't collide. Apply writes the result and
   * marks the file resolved once nothing is left to decide.
   */
  import { untrack } from 'svelte';
  import { findNode, workspace } from '$entities/workspace';
  import { describeFile, git, openConflictsTab, resolveFile } from '$entities/git';
  import { gitConflicts, gitOperationInfo } from '$shared/ipc';
  import { methodColor, type OperationInfo, type Tab } from '$shared/model';
  import { t } from '$shared/i18n';
  import {
    autoResolve,
    initialResolution,
    isPending,
    merge3,
    mergedText,
    resolvedLines,
    type Chunk,
    type Resolution,
  } from './merge3';

  let { tab, onClose }: { tab: Tab; onClose: () => void } = $props();

  let chunks = $state.raw<Chunk[]>([]);
  let res = $state.raw<Resolution[]>([]);
  let op = $state.raw<OperationInfo | null>(null);
  let missing = $state(false);
  let focus = $state(0);
  let loadedFor = '';

  const path = $derived(tab.git?.path ?? '');
  const info = $derived(describeFile(path, git.prefix, (id) => findNode(workspace.tree, id)));

  // Read the three versions once per file: later git refreshes must not wipe the user's choices.
  $effect(() => {
    const root = workspace.path;
    const p = path;
    if (!root || !p || untrack(() => loadedFor) === `${root}\0${p}`) return;
    loadedFor = `${root}\0${p}`;
    void Promise.all([gitConflicts(root), gitOperationInfo(root)]).then(([files, o]) => {
      op = o;
      const f = files.find((x) => x.path === p);
      missing = !f || f.mine === null || f.theirs === null;
      if (!f || missing) return;
      const split = (s: string | null) => (s === null ? [] : s.split('\n'));
      chunks = merge3(split(f.base), split(f.mine), split(f.theirs));
      res = chunks.map(initialResolution);
      focus = Math.max(0, nextPending(-1));
    });
  });

  const changes = $derived(chunks.map((c, i) => i).filter((i) => chunks[i].kind === 'change'));
  const conflicts = $derived(
    changes.filter((i) => {
      const c = chunks[i];
      return c.kind === 'change' && c.conflict;
    }),
  );
  const left = $derived(changes.filter((i) => isPending(res[i])).length);
  const autoCount = $derived(res.filter((r) => r.auto).length);
  const result = $derived(mergedText(chunks, res));

  function nextPending(from: number, dir = 1): number {
    const n = chunks.length;
    for (let k = 1; k <= n; k++) {
      const i = (((from + dir * k) % n) + n) % n;
      if (chunks[i]?.kind === 'change' && isPending(res[i])) return i;
    }
    return -1;
  }

  function set(i: number, side: 'mine' | 'theirs', state: 'taken' | 'rejected'): void {
    res = res.map((r, k) => (k === i ? { ...r, [side]: state, auto: false } : r));
    focus = i;
    if (!isPending(res[i])) {
      const next = nextPending(i);
      if (next !== -1) focus = next;
    }
  }

  function all(side: 'mine' | 'theirs'): void {
    const take: Resolution =
      side === 'mine' ? { mine: 'taken', theirs: 'rejected' } : { mine: 'rejected', theirs: 'taken' };
    res = chunks.map((c, i) => (c.kind === 'change' ? take : res[i]));
  }

  function go(dir: 1 | -1): void {
    const i = nextPending(focus, dir);
    if (i !== -1) {
      focus = i;
      document.querySelector(`[data-chunk="${i}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  async function apply(): Promise<void> {
    if (result === null) return;
    if (await resolveFile(path, result)) {
      onClose();
      openConflictsTab();
    }
  }

  function onKey(e: KeyboardEvent): void {
    if (!e.altKey || chunks[focus]?.kind !== 'change') return;
    if (e.key === 'ArrowLeft') set(focus, 'mine', 'taken');
    else if (e.key === 'ArrowRight') set(focus, 'theirs', 'taken');
    else if (e.key === 'ArrowDown') go(1);
    else if (e.key === 'ArrowUp') go(-1);
    else return;
    e.preventDefault();
  }

  // Line numbers per column, counted through the chunks.
  const numbers = $derived.by(() => {
    const n = { mine: 1, result: 1, theirs: 1 };
    return chunks.map((c, i) => {
      const at = { ...n };
      n.mine += c.kind === 'same' ? c.lines.length : c.mine.length;
      n.theirs += c.kind === 'same' ? c.lines.length : c.theirs.length;
      n.result += (resolvedLines(c, res[i]) ?? []).length;
      return at;
    });
  });
  const stateOf = (r: Resolution, side: 'mine' | 'theirs', c: Chunk) =>
    c.kind === 'change' && c.conflict && r[side] === 'pending' ? 'conflict' : r[side];
</script>

<svelte:window onkeydown={onKey} />

{#snippet cell(ls: string[], from: number, cls: string)}
  <div class="cell {cls}">
    {#each ls as l, k (k)}<div class="ln"><span class="no">{from + k}</span><code>{l}</code></div>{/each}
  </div>
{/snippet}

<div class="bs-gview">
  <div class="bs-ghead">
    <div class="ttl">
      <span class="crumb">{`${op?.kind ?? 'merge'}  ${op?.theirs ?? ''}  /  ${path}`}</span>
      <div class="row">
        {#if info.method}<b class="m" style:color={methodColor(info.method === 'gRPC' ? 'GRPC' : info.method)}
            >{info.method}</b
          >{/if}
        <h2>{info.name}</h2>
        {#if conflicts.length}
          <span class="bs-gtag bad"
            >{t('git.mg.counter', {
              i: Math.max(1, conflicts.indexOf(focus) + 1),
              n: conflicts.length,
            })}</span
          >
        {/if}
      </div>
    </div>
    <div class="bs-gseg">
      <button class="icon" title={t('git.mg.prev')} onclick={() => go(-1)}
        ><span class="material-symbols-outlined">keyboard_arrow_up</span></button
      >
      <button class="icon" title={t('git.mg.next')} onclick={() => go(1)}
        ><span class="material-symbols-outlined">keyboard_arrow_down</span></button
      >
    </div>
    <button class="bs-gbtn" onclick={() => (res = autoResolve(chunks, res))}
      ><span class="material-symbols-outlined">auto_fix_high</span>{t('git.mg.auto')}</button
    >
  </div>

  <div class="bs-gview-body">
    {#if missing}
      <div class="bs-gview-empty">{t('git.mg.missing')}</div>
    {:else}
      <div class="grid">
        <div class="hd mine">
          <span class="eb">{`${t('git.cf.mine')}  ·  ${op?.mine ?? ''}`}</span><span class="hash"
            >{git.log[0]?.short ?? ''}</span
          >
        </div>
        <div class="hd g"></div>
        <div class="hd">
          <span class="eb"><span class="material-symbols-outlined">merge</span>{t('git.mg.result')}</span><span
            class="hash">{t('git.mg.status', { i: changes.length - left, n: changes.length, auto: autoCount })}</span
          >
        </div>
        <div class="hd g"></div>
        <div class="hd theirs">
          <span class="eb">{`${t('git.cf.theirs')}  ·  ${op?.theirs ?? ''}`}</span><span class="hash"
            >{(op?.hash ?? '').slice(0, 7)}</span
          >
        </div>

        {#each chunks as c, i (i)}
          {@const r = res[i]}
          {@const at = numbers[i]}
          {#if c.kind === 'same'}
            {@render cell(c.lines, at.mine, '')}
            <div class="g"></div>
            {@render cell(c.lines, at.result, '')}
            <div class="g"></div>
            {@render cell(c.lines, at.theirs, '')}
          {:else}
            {@const out = resolvedLines(c, r)}
            {@render cell(c.mine, at.mine, `ch ${stateOf(r, 'mine', c)}${focus === i ? ' focus' : ''}`)}
            <div class="g" data-chunk={i}>
              {#if r.mine === 'pending'}
                <button title={t('git.mg.takeMine')} onclick={() => set(i, 'mine', 'taken')}>»</button>
                <button title={t('git.mg.reject')} onclick={() => set(i, 'mine', 'rejected')}>×</button>
              {:else if r.mine === 'taken' && c.from !== 'theirs'}
                <span class="ok material-symbols-outlined">{r.auto ? 'auto_fix_high' : 'check'}</span>
              {/if}
            </div>
            <div
              class="cell res {out === null ? (c.conflict ? 'conflict' : 'pending') : 'taken'}{focus === i
                ? ' focus'
                : ''}"
            >
              {#if out === null}
                {#if c.conflict}<div class="ln ask"><span class="no"></span><i>{t('git.mg.choose')}</i></div>{/if}
              {:else}
                {#each out as l, k (k)}<div class="ln">
                    <span class="no">{at.result + k}</span><code>{l}</code>{#if r.auto && k === 0}<span class="auto"
                        >{t('git.mg.autoTag')}</span
                      >{/if}
                  </div>{/each}
              {/if}
            </div>
            <div class="g">
              {#if r.theirs === 'pending'}
                <button title={t('git.mg.reject')} onclick={() => set(i, 'theirs', 'rejected')}>×</button>
                <button title={t('git.mg.takeTheirs')} onclick={() => set(i, 'theirs', 'taken')}>«</button>
              {:else if r.theirs === 'taken' && c.from !== 'mine'}
                <span class="ok material-symbols-outlined">{r.auto ? 'auto_fix_high' : 'check'}</span>
              {/if}
            </div>
            {@render cell(c.theirs, at.theirs, `ch ${stateOf(r, 'theirs', c)}${focus === i ? ' focus' : ''}`)}
          {/if}
        {/each}
      </div>
    {/if}

    <div class="foot">
      <span class="lg"><i class="c"></i>{t('git.mg.lgConflict')}</span>
      <span class="lg"><i class="a"></i>{t('git.mg.lgTaken')}</span>
      <span class="lg"><i class="r"></i>{t('git.mg.lgRejected')}</span>
      <span class="keys">{t('git.mg.keys')}</span>
      <span class="grow"></span>
      <button class="bs-gbtn" onclick={onClose}>{t('common.cancel')}</button>
      <button class="bs-gbtn" disabled={missing} onclick={() => all('mine')}>» {t('git.cf.allMine')}</button>
      <button class="bs-gbtn" disabled={missing} onclick={() => all('theirs')}>« {t('git.cf.allTheirs')}</button>
      <button class="bs-gbtn inv" disabled={result === null || git.busy} onclick={apply}
        ><span class="material-symbols-outlined">check</span>{left
          ? t('git.mg.applyLeft', { n: left })
          : t('git.mg.apply')}</button
      >
    </div>
  </div>
</div>

<style>
  .bad {
    background: var(--color-danger-soft);
    color: var(--color-danger);
  }
  .m {
    font: 700 var(--font-size-label) var(--font-code);
  }
  .grid {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 64px minmax(0, 1fr) 64px minmax(0, 1fr);
    align-content: start;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
    background: var(--color-field);
    font: 13px/26px var(--font-code);
  }
  .hd {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 44px;
    padding: 0 16px;
    margin-bottom: 8px;
    border-bottom: 1px solid var(--color-border-subtle);
    background: var(--color-field);
  }
  .eb {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro) var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
    white-space: pre;
  }
  .eb .material-symbols-outlined {
    font-size: 14px;
  }
  .mine .eb {
    padding-left: 8px;
    border-left: 3px solid var(--method-get);
  }
  .theirs .eb {
    padding-left: 8px;
    border-left: 3px solid var(--color-warning);
  }
  .hash {
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-code);
  }
  .cell {
    min-width: 0;
    overflow: hidden;
  }
  .ln {
    display: flex;
    white-space: pre;
    color: var(--color-text);
  }
  .no {
    flex: none;
    width: 44px;
    padding-right: 14px;
    text-align: right;
    color: var(--color-text-muted);
  }
  code {
    font: inherit;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ch.conflict,
  .res.conflict {
    background: var(--color-danger-soft);
  }
  .ch.pending,
  .res.pending {
    background: var(--color-selected);
  }
  .ch.taken,
  .res.taken {
    background: var(--color-success-soft);
  }
  .ch.rejected {
    background: var(--color-hover);
    color: var(--color-text-muted);
  }
  .ch.rejected .ln {
    color: var(--color-text-muted);
  }
  .ch:empty,
  .res:empty {
    min-height: 26px;
  }
  .focus {
    box-shadow:
      inset 0 1px 0 var(--color-danger),
      inset 0 -1px 0 var(--color-danger);
  }
  .g {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    gap: 2px;
    padding-top: 2px;
  }
  .g button {
    width: 22px;
    height: 22px;
    border-radius: var(--radius-control);
    color: var(--color-text-secondary);
    font: 600 15px/22px var(--font-ui);
  }
  .g button:hover {
    background: var(--color-hover);
    color: var(--color-text);
  }
  .ok {
    font-size: 16px;
    line-height: 22px;
    color: var(--color-success);
  }
  .ask i {
    color: var(--color-danger);
    font: italic var(--font-size-ui) var(--font-ui);
    line-height: 26px;
  }
  .auto {
    margin-left: 8px;
    padding: 0 7px;
    border-radius: var(--radius-control);
    background: var(--color-success-soft);
    color: var(--color-success);
    font: 600 var(--font-size-micro) / 18px var(--font-ui);
    align-self: center;
  }
  .foot {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--color-text-muted);
    font-size: var(--font-size-body);
  }
  .grow {
    flex: 1;
  }
  .lg {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .lg i {
    width: 10px;
    height: 10px;
    border-radius: 3px;
  }
  .lg .c {
    background: var(--color-danger);
  }
  .lg .a {
    background: var(--color-success);
  }
  .lg .r {
    background: var(--color-text-muted);
  }
  .keys {
    font: var(--font-size-caption) var(--font-code);
  }
  .foot .bs-gbtn {
    height: 36px;
  }
</style>
