<script lang="ts">
  /**
   * G8: three-way merge of one conflicted file, as in GoLand — mine · result · theirs. Each change
   * is one aligned row across the columns: » / « take a side into the result, × rejects it,
   * «Слить непересекающиеся» takes every side that doesn't collide. Apply writes the result and
   * marks the file resolved once nothing is left to decide. «Поля» merges a JSON request field by
   * field instead (mergeFields.ts): the same columns, one row per changed field. Any result block
   * or field can also be typed by hand (✎): it then counts as decided and is marked «вручную».
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
  import {
    autoChoices,
    chosenValue,
    parseValue,
    fields as fieldsOf,
    initialChoices,
    mergeFields,
    parseSide,
    type Field,
    type FieldChoice,
    type Obj,
    type Pairing,
  } from './mergeFields';
  import { mergeMode } from './store.svelte';
  import { GitButton, GitSeg, GitHead, GitView, GitViewBody, GitViewEmpty, GitTag } from '$entities/git/components';

  let { tab, onClose }: { tab: Tab; onClose: () => void } = $props();

  let chunks = $state.raw<Chunk[]>([]);
  let res = $state.raw<Resolution[]>([]);
  let op = $state.raw<OperationInfo | null>(null);
  let missing = $state(false);
  let focus = $state(0);
  let loadedFor = '';

  // «Поля»: the same file as fields, when all three sides are JSON objects.
  let fs = $state.raw<Field[]>([]);
  let choices = $state.raw<FieldChoice[]>([]);
  let fAuto = $state.raw<boolean[]>([]);
  let fieldsOk = $state(false);
  let showSame = $state(false);
  let ffocus = $state(0);
  let sides: [Obj, Obj, Obj] = [{}, {}, {}];
  /** Pairings by place the user turned down («Это замена»). */
  let pairing = $state.raw<Pairing>({ splits: new Set(), joins: new Set() });
  let trailing = false;
  const fieldsMode = $derived(fieldsOk && mergeMode.current === 'fields');

  // Hand edits of the result, one block (or field) at a time, in place.
  let editing = $state<number | null>(null);
  let draft = $state('');
  let draftError = $state('');
  const isManual = (c: FieldChoice) => !!c && typeof c === 'object';
  // Switching JSON | Поля changes what an index means: drop an open edit.
  $effect(() => {
    void fieldsMode;
    editing = null;
  });

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
      const [b, m, th] = [parseSide(f.base), parseSide(f.mine), parseSide(f.theirs)];
      fieldsOk = !!(b && m && th);
      if (b && m && th) {
        sides = [b, m, th];
        trailing = (f.mine ?? '').endsWith('\n');
        pairing = { splits: new Set(), joins: new Set() };
        fs = fieldsOf(b, m, th);
        choices = initialChoices(fs);
        fAuto = fs.map(() => false);
        ffocus = Math.max(0, fNext(-1));
      }
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

  const fChanged = $derived(fs.map((_, i) => i).filter((i) => fs[i].kind !== 'same'));
  const fConflicts = $derived(fChanged.filter((i) => fs[i].kind === 'conflict'));
  const fLeft = $derived(fChanged.filter((i) => choices[i] === null).length);
  const sameCount = $derived(fs.length - fChanged.length);
  const fResult = $derived(fieldsOk ? mergeFields(...sides, fs, choices, trailing, pairing) : null);
  // The first row of each element matched only by place carries «≈ по месту» and «Это замена».
  const guessHead = $derived(
    new Set(fs.map((f, i) => (f.guess && fs.findIndex((g) => g.guess?.[0] === f.guess?.[0]) === i ? i : -1))),
  );

  /**
   * «Это замена»: the element wasn't edited, it was swapped for another — turn its pairing down
   * (or undo a «Это правка» that made it).
   */
  function splitGuess(keys: string[]): void {
    const splits = new Set(pairing.splits);
    const joins = new Set(pairing.joins);
    for (const k of keys) if (!joins.delete(k)) splits.add(k);
    reread({ splits, joins });
  }

  /** «Это правка»: a removed and an added element are one element edited — pair them. */
  function joinPair(key: string): void {
    const splits = new Set(pairing.splits);
    const joins = new Set(pairing.joins);
    if (!splits.delete(key)) joins.add(key);
    reread({ splits, joins });
  }

  /** Re-read the fields under new pairings; every field that keeps its identity keeps its choice. */
  function reread(next: Pairing): void {
    pairing = next;
    const before = new Map(fs.map((f, i) => [f.id, { c: choices[i], a: fAuto[i] }]));
    fs = fieldsOf(...sides, pairing);
    const fresh = initialChoices(fs);
    choices = fs.map((f, i) => (before.has(f.id) ? before.get(f.id)!.c : fresh[i]));
    fAuto = fs.map((f) => before.get(f.id)?.a ?? false);
    editing = null;
    ffocus = Math.max(0, fNext(-1));
  }
  // What the header and footer show, for whichever mode is on.
  const view = $derived(
    fieldsMode
      ? {
          conflicts: fConflicts,
          focus: ffocus,
          left: fLeft,
          total: fChanged.length,
          auto: fAuto.filter(Boolean).length,
          result: fResult,
          open: fConflicts.filter((k) => choices[k] === null).length,
        }
      : {
          conflicts,
          focus,
          left,
          total: changes.length,
          auto: autoCount,
          result,
          open: conflicts.filter((k) => isPending(res[k])).length,
        },
  );

  function fNext(from: number, dir = 1): number {
    const n = fs.length;
    for (let k = 1; k <= n; k++) {
      const i = (((from + dir * k) % n) + n) % n;
      if (fs[i]?.kind !== 'same' && choices[i] === null) return i;
    }
    return -1;
  }

  function choose(i: number, c: FieldChoice): void {
    choices = choices.map((x, k) => (k === i ? c : x));
    fAuto = fAuto.map((a, k) => (k === i ? false : a));
    const next = fNext(i);
    ffocus = next === -1 ? i : next;
  }

  function autoAll(): void {
    // Afterwards the focus moves to the first thing still undecided, so ⌥←/⌥→ never overwrite an auto pick.
    if (!fieldsMode) {
      res = autoResolve(chunks, res);
      focus = Math.max(0, nextPending(-1));
      return;
    }
    const next = autoChoices(fs, choices);
    fAuto = fAuto.map((a, i) => a || (choices[i] === null && next[i] !== null));
    choices = next;
    ffocus = Math.max(0, fNext(-1));
  }

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
    if (fieldsMode) {
      choices = fs.map((f, i) => (f.kind === 'same' || f.kind === 'both' ? choices[i] : side));
      return;
    }
    const take: Resolution =
      side === 'mine' ? { mine: 'taken', theirs: 'rejected' } : { mine: 'rejected', theirs: 'taken' };
    res = chunks.map((c, i) => (c.kind === 'change' ? take : res[i]));
  }

  function go(dir: 1 | -1): void {
    if (fieldsMode) {
      const i = fNext(ffocus, dir);
      if (i === -1) return;
      ffocus = i;
      document.querySelector(`[data-field="${i}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    const i = nextPending(focus, dir);
    if (i !== -1) {
      focus = i;
      document.querySelector(`[data-chunk="${i}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  async function apply(): Promise<void> {
    const text = view.result;
    if (text === null) return;
    if (await resolveFile(path, text)) {
      onClose();
      openConflictsTab();
    }
  }

  function startEdit(i: number): void {
    if (fieldsMode) {
      const f = fs[i];
      const c = choices[i];
      const v = c === null ? f.mine : chosenValue(f, c);
      draft = v === undefined ? '' : JSON.stringify(v, null, 2);
    } else {
      const c = chunks[i];
      // An open conflict starts from both sides, mine first, to cut down from.
      draft = (resolvedLines(c, res[i]) ?? (c.kind === 'change' ? [...c.mine, ...c.theirs] : [])).join('\n');
    }
    draftError = '';
    editing = i;
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.bs-gview textarea.edit')?.focus());
  }

  function saveEdit(): void {
    const i = editing;
    if (i === null) return;
    if (fieldsMode) {
      let value;
      try {
        value = parseValue(draft);
      } catch {
        draftError = t('git.mg.badJson');
        return;
      }
      choose(i, { value });
    } else {
      res = res.map((r, k) => (k === i ? { ...r, edited: draft === '' ? [] : draft.split('\n'), auto: false } : r));
      const next = nextPending(i);
      if (next !== -1) focus = next;
    }
    editing = null;
  }

  /** Forget a hand edit: the block (or field) goes back to its sides. */
  function undoEdit(i: number): void {
    if (fieldsMode) choices = choices.map((c, k) => (k === i ? initialChoices([fs[i]])[0] : c));
    else res = res.map((r, k) => (k === i ? initialResolution(chunks[i]) : r));
  }

  function editKey(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      editing = null;
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      saveEdit();
    }
  }

  function onKey(e: KeyboardEvent): void {
    if ((e.target as HTMLElement | null)?.closest?.('textarea, input')) return;
    if (fieldsMode && e.altKey && fs[ffocus]) {
      if (e.key === 'ArrowLeft') choose(ffocus, 'mine');
      else if (e.key === 'ArrowRight') choose(ffocus, 'theirs');
      else if (e.key === 'ArrowDown') go(1);
      else if (e.key === 'ArrowUp') go(-1);
      else return;
      e.preventDefault();
      return;
    }
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
  // A block typed by hand took neither side as it was: both read as set aside.
  const stateOf = (r: Resolution, side: 'mine' | 'theirs', c: Chunk) =>
    r.edited ? 'rejected' : c.kind === 'change' && c.conflict && r[side] === 'pending' ? 'conflict' : r[side];
  /** A request file keeps everything under `request`: say the field without that prefix. */
  const fieldName = (label: string) => (label.startsWith('request.') ? label.slice('request.'.length) : label);
  /** A field cell's colour: what this side offers and whether it was taken. */
  function fieldState(f: Field, c: FieldChoice, side: 'mine' | 'theirs'): string {
    const other = side === 'mine' ? 'theirs' : 'mine';
    if (f.kind === 'same' || f.kind === other) return '';
    if (c === null) return f.kind === 'conflict' ? 'conflict' : 'pending';
    if (isManual(c)) return 'rejected';
    return c === side || f.kind === 'both' ? 'taken' : 'rejected';
  }
</script>

<svelte:window onkeydown={onKey} />

{#snippet cell(ls: string[], from: number, cls: string)}
  <div class="cell {cls}">
    {#each ls as l, k (k)}<div class="ln"><span class="no">{from + k}</span><code>{l}</code></div>{/each}
  </div>
{/snippet}

{#snippet editor()}
  <textarea
    class="edit"
    rows={Math.max(1, draft.split('\n').length)}
    bind:value={draft}
    spellcheck="false"
    aria-label={t('git.mg.edit')}
    onkeydown={editKey}></textarea>
  {#if draftError}<div class="editerr">{draftError}</div>{/if}
  <div class="editbar">
    <span>{fieldsMode ? t('git.mg.editHintField') : t('git.mg.editHint')}</span>
    <button onclick={() => (editing = null)}>{t('common.cancel')}</button>
    <button class="save" onclick={saveEdit}>{t('git.mg.save')}</button>
  </div>
{/snippet}

{#snippet tools(i: number, manual: boolean)}
  <span class="tools">
    {#if manual}<button title={t('git.mg.undoEdit')} aria-label={t('git.mg.undoEdit')} onclick={() => undoEdit(i)}
        ><span class="material-symbols-outlined">undo</span></button
      >{/if}
    <button title={t('git.mg.edit')} aria-label={t('git.mg.edit')} onclick={() => startEdit(i)}
      ><span class="material-symbols-outlined">edit</span></button
    >
  </span>
{/snippet}

{#snippet resultCell(i: number, c: Chunk, r: Resolution, from: number)}
  {@const out = resolvedLines(c, r)}
  {@const cls = r.edited
    ? 'edited'
    : c.kind === 'same'
      ? ''
      : out === null
        ? c.conflict
          ? 'conflict'
          : 'pending'
        : 'taken'}
  <div class="cell res {cls}{c.kind === 'change' && focus === i ? ' focus' : ''}">
    {#if editing === i}
      {@render editor()}
    {:else}
      {#if out === null}
        {#if c.kind === 'change' && c.conflict}<div class="ln ask">
            <span class="no"></span><i>{t('git.mg.choose')}</i>
          </div>{/if}
      {:else}
        {#each out as l, k (k)}<div class="ln">
            <span class="no">{from + k}</span><code>{l}</code>{#if k === 0 && r.edited}<span class="auto hand"
                >{t('git.mg.handTag')}</span
              >{:else if k === 0 && r.auto}<span class="auto">{t('git.mg.autoTag')}</span>{/if}
          </div>{/each}
        {#if !out.length && r.edited}<div class="ln">
            <span class="no"></span><span class="auto hand">{t('git.mg.handTag')}</span>
          </div>{/if}
      {/if}
      {@render tools(i, !!r.edited)}
    {/if}
  </div>
{/snippet}

{#snippet val(v: Field['mine'])}
  {#if v === undefined}<span class="none">{t('git.mg.absent')}</span>{:else}<code>{JSON.stringify(v, null, 2)}</code
    >{/if}
{/snippet}

<GitView>
  <GitHead>
    <div class="ttl">
      <span class="crumb">{`${op?.kind ?? 'merge'}  ${op?.theirs ?? ''}  /  ${path}`}</span>
      <div class="row">
        {#if info.method}<b class="m" style:color={methodColor(info.method === 'gRPC' ? 'GRPC' : info.method)}
            >{info.method}</b
          >{/if}
        <h2>{info.name}</h2>
        {#if view.open}
          <GitTag class="bad"
            >{t('git.mg.counter', {
              i: Math.max(1, view.conflicts.indexOf(view.focus) + 1),
              n: view.conflicts.length,
            })}</GitTag
          >
        {/if}
      </div>
    </div>
    <GitSeg>
      <button class="icon" title={t('git.mg.prev')} onclick={() => go(-1)}
        ><span class="material-symbols-outlined">keyboard_arrow_up</span></button
      >
      <button class="icon" title={t('git.mg.next')} onclick={() => go(1)}
        ><span class="material-symbols-outlined">keyboard_arrow_down</span></button
      >
    </GitSeg>
    <GitButton onclick={autoAll}
      ><span class="material-symbols-outlined">auto_fix_high</span>{t('git.mg.auto')}</GitButton
    >
    <GitSeg role="group" aria-label={t('git.mg.mode')}>
      <button class:on={!fieldsMode} aria-pressed={!fieldsMode} onclick={() => (mergeMode.current = 'json')}
        >JSON</button
      >
      <button
        class:on={fieldsMode}
        aria-pressed={fieldsMode}
        disabled={!fieldsOk}
        title={fieldsOk ? t('git.mg.fieldsHint') : t('git.mg.notJson')}
        onclick={() => (mergeMode.current = 'fields')}>{t('git.mg.fields')}</button
      >
    </GitSeg>
  </GitHead>

  <GitViewBody>
    {#if missing}
      <GitViewEmpty>{t('git.mg.missing')}</GitViewEmpty>
    {:else if fieldsMode}
      <div class="grid fields">
        <div class="hd"><span class="eb">{t('git.mg.field')}</span></div>
        <div class="hd mine">
          <span class="eb">{`${t('git.cf.mine')}  ·  ${op?.mine ?? ''}`}</span><span class="hash"
            >{git.log[0]?.short ?? ''}</span
          >
        </div>
        <div class="hd g"></div>
        <div class="hd">
          <span class="eb"><span class="material-symbols-outlined">merge</span>{t('git.mg.result')}</span><span
            class="hash">{t('git.mg.status', { i: view.total - view.left, n: view.total, auto: view.auto })}</span
          >
        </div>
        <div class="hd g"></div>
        <div class="hd theirs">
          <span class="eb">{`${t('git.cf.theirs')}  ·  ${op?.theirs ?? ''}`}</span><span class="hash"
            >{(op?.hash ?? '').slice(0, 7)}</span
          >
        </div>
        {#each fs as f, i (f.id)}
          {#if f.kind !== 'same' || showSame}
            {@const c = choices[i]}
            {@const hot = ffocus === i && f.kind !== 'same' ? ' focus' : ''}
            <div class="fp{hot}" data-field={i} title={f.label}>
              <span class="lbl">{fieldName(f.label)}</span>
              {#if guessHead.has(i)}
                <span class="guess" title={t('git.mg.guessHint')}>{t('git.mg.guess')}</span>
                <button class="split" title={t('git.mg.splitHint')} onclick={() => splitGuess(f.guess!)}
                  >{t('git.mg.split')}</button
                >
              {/if}
              {#each f.join ?? [] as j (j.key)}
                <button class="split" title={t('git.mg.joinHint', { label: j.label })} onclick={() => joinPair(j.key)}
                  >{t('git.mg.join', { label: j.label })}</button
                >
              {/each}
            </div>
            <div class="fv {fieldState(f, c, 'mine')}{hot}">{@render val(f.mine)}</div>
            <div class="g">
              {#if f.kind === 'mine' || f.kind === 'conflict'}
                {#if c === 'mine'}<span class="ok material-symbols-outlined"
                    >{fAuto[i] ? 'auto_fix_high' : 'check'}</span
                  >{:else}<button title={t('git.mg.takeMine')} onclick={() => choose(i, 'mine')}>»</button>{/if}
                {#if f.kind === 'mine' && c === null}<button
                    title={t('git.mg.reject')}
                    onclick={() => choose(i, 'theirs')}>×</button
                  >{/if}
              {/if}
            </div>
            <div
              class="fv res {isManual(c)
                ? 'edited'
                : c === null
                  ? f.kind === 'conflict'
                    ? 'conflict'
                    : 'pending'
                  : f.kind === 'same'
                    ? ''
                    : 'taken'}{hot}"
            >
              {#if editing === i}
                {@render editor()}
              {:else}
                {#if c === null}
                  {#if f.kind === 'conflict'}<i class="ask">{t('git.mg.choose')}</i>{/if}
                {:else}
                  {@render val(chosenValue(f, c))}{#if isManual(c)}<span class="auto hand">{t('git.mg.handTag')}</span
                    >{:else if fAuto[i]}<span class="auto">{t('git.mg.autoTag')}</span>{/if}
                {/if}
                {@render tools(i, isManual(c))}
              {/if}
            </div>
            <div class="g">
              {#if f.kind === 'theirs' || f.kind === 'conflict'}
                {#if f.kind === 'theirs' && c === null}<button
                    title={t('git.mg.reject')}
                    onclick={() => choose(i, 'mine')}>×</button
                  >{/if}
                {#if c === 'theirs'}<span class="ok material-symbols-outlined"
                    >{fAuto[i] ? 'auto_fix_high' : 'check'}</span
                  >{:else}<button title={t('git.mg.takeTheirs')} onclick={() => choose(i, 'theirs')}>«</button>{/if}
              {/if}
            </div>
            <div class="fv {fieldState(f, c, 'theirs')}{hot}">{@render val(f.theirs)}</div>
          {/if}
        {/each}
        {#if sameCount}
          <button class="sameb" onclick={() => (showSame = !showSame)}
            ><span class="material-symbols-outlined">{showSame ? 'unfold_less' : 'unfold_more'}</span>{showSame
              ? t('git.mg.hideSame', { n: sameCount })
              : t('git.mg.showSame', { n: sameCount })}</button
          >
        {/if}
      </div>
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
            {@render resultCell(i, c, r, at.result)}
            <div class="g"></div>
            {@render cell(c.lines, at.theirs, '')}
          {:else}
            {@render cell(c.mine, at.mine, `ch ${stateOf(r, 'mine', c)}${focus === i ? ' focus' : ''}`)}
            <div class="g" data-chunk={i}>
              {#if r.mine === 'pending' && !r.edited}
                <button title={t('git.mg.takeMine')} onclick={() => set(i, 'mine', 'taken')}>»</button>
                <button title={t('git.mg.reject')} onclick={() => set(i, 'mine', 'rejected')}>×</button>
              {:else if r.mine === 'taken' && c.from !== 'theirs' && !r.edited}
                <span class="ok material-symbols-outlined">{r.auto ? 'auto_fix_high' : 'check'}</span>
              {/if}
            </div>
            {@render resultCell(i, c, r, at.result)}
            <div class="g">
              {#if r.theirs === 'pending' && !r.edited}
                <button title={t('git.mg.reject')} onclick={() => set(i, 'theirs', 'rejected')}>×</button>
                <button title={t('git.mg.takeTheirs')} onclick={() => set(i, 'theirs', 'taken')}>«</button>
              {:else if r.theirs === 'taken' && c.from !== 'mine' && !r.edited}
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
      <GitButton onclick={onClose}>{t('common.cancel')}</GitButton>
      <GitButton disabled={missing} onclick={() => all('mine')}>» {t('git.cf.allMine')}</GitButton>
      <GitButton disabled={missing} onclick={() => all('theirs')}>« {t('git.cf.allTheirs')}</GitButton>
      <GitButton class="inv" disabled={view.result === null || git.busy} onclick={apply}
        ><span class="material-symbols-outlined">check</span>{view.left
          ? t('git.mg.applyLeft', { n: view.left })
          : t('git.mg.apply')}</GitButton
      >
    </div>
  </GitViewBody>
</GitView>

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
    /* Each row as tall as its tallest cell: a file taller than the window must not squeeze rows. */
    grid-auto-rows: max-content;
    align-content: start;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
    background: var(--color-field);
    font: 13px/26px var(--font-code);
  }
  .grid.fields {
    grid-template-columns: minmax(180px, 0.8fr) minmax(0, 1fr) 64px minmax(0, 1fr) 64px minmax(0, 1fr);
    row-gap: 4px;
  }
  .fp,
  .fv {
    min-width: 0;
    padding: 4px 14px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .fp .lbl {
    flex: 1 0 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .guess,
  .split {
    flex: none;
    margin-right: 6px;
    padding: 0 7px;
    border-radius: var(--radius-control);
    font: 500 var(--font-size-micro) / 18px var(--font-ui);
    white-space: nowrap;
  }
  .guess {
    background: var(--color-warning-soft);
    color: var(--color-warning);
  }
  .split {
    border: 1px solid var(--color-border-subtle);
    color: var(--color-text-secondary);
  }
  .split:hover {
    background: var(--color-hover);
    color: var(--color-text);
  }
  .fp {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    align-content: flex-start;
    row-gap: 4px;
    color: var(--color-text-secondary);
  }
  .fv.conflict {
    background: var(--color-danger-soft);
  }
  .fv.pending {
    background: var(--color-selected);
  }
  .fv.taken {
    background: var(--color-success-soft);
  }
  .fv.rejected {
    background: var(--color-hover);
    color: var(--color-text-muted);
  }
  .none {
    color: var(--color-text-muted);
    font-style: italic;
  }
  .sameb {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 36px;
    margin: 6px 6px 8px;
    border-radius: 12px;
    color: var(--color-text-secondary);
    font: var(--font-size-body) var(--font-ui);
  }
  .sameb:hover {
    background: var(--color-hover);
  }
  .sameb .material-symbols-outlined {
    font-size: 16px;
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
  .res {
    position: relative;
  }
  .res.edited {
    background: color-mix(in srgb, var(--method-get) 14%, transparent);
  }
  .tools {
    position: absolute;
    top: 2px;
    right: 6px;
    display: none;
    gap: 2px;
  }
  .res:hover .tools,
  .res:focus-within .tools {
    display: flex;
  }
  .tools button {
    display: inline-flex;
    width: 22px;
    height: 22px;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-control);
    background: var(--color-raised);
    color: var(--color-text-secondary);
  }
  .tools button:hover {
    color: var(--color-text);
  }
  .tools .material-symbols-outlined {
    font-size: 14px;
  }
  textarea.edit {
    display: block;
    width: 100%;
    padding: 0 10px 0 58px;
    border: 0;
    outline: 1px solid var(--method-get);
    outline-offset: -1px;
    resize: none;
    background: var(--color-raised);
    color: var(--color-text);
    font: inherit;
    white-space: pre;
  }
  .fv textarea.edit {
    padding: 0 10px;
  }
  .editerr {
    padding: 2px 10px;
    color: var(--color-danger);
    font: var(--font-size-caption) var(--font-ui);
  }
  .editbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-ui);
  }
  .editbar span {
    flex: 1;
  }
  .editbar button {
    height: 24px;
    padding: 0 10px;
    border-radius: var(--radius-control);
    color: var(--color-text-secondary);
  }
  .editbar .save {
    background: var(--color-inverse);
    color: var(--color-on-inverse);
    font-weight: 600;
  }
  .auto.hand {
    background: color-mix(in srgb, var(--method-get) 18%, transparent);
    color: var(--method-get);
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
