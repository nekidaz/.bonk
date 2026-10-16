<script lang="ts">
  /**
   * S31 · Environments editor for environments and Globals, shown in the Environments tab.
   * Edits go into a local draft (deep copy of `environments`) and are written back
   * only on «Сохранить»; «Отмена» discards them.
   */
  import { tick, untrack } from 'svelte';
  import { getCurrentWebview } from '@tauri-apps/api/webview';
  import { t, tp } from '$shared/i18n';
  import { environments, ENV_COLORS, ENV_COLOR_VAR, envColor, isProtected, type EnvColor } from '$entities/environment';
  import { workspace } from '$entities/workspace';
  import { importReadFile, openapiImportPick } from '$shared/ipc';
  import { confirmState, requestConfirm } from '$shared/ui';
  import {
    type Environment,
    type EnvJsonFormat,
    type RowsDiff,
    type VarRow,
    countRequestsUsingVars,
    diffEnvRows,
    envFromJson,
    envToJson,
    maskSecret,
    mergeEnvRows,
  } from '$shared/model';
  import EnvJsonEditor from './EnvJsonEditor.svelte';
  import { Button } from '$shared/ui/components';
  import { Switch } from '$shared/ui/components';
  import { Segmented } from '$shared/ui/components';

  type Fmt = EnvJsonFormat | undefined;
  /** «Из JSON…»: the new environment is a draft in the list until «Создать окружение». */
  interface Creating {
    id: string;
    text: string;
    fmt: Fmt;
    /** The user typed a name: the one in the JSON no longer replaces it. */
    nameTouched: boolean;
    /** Where «Отмена» goes back to. */
    prev: string;
  }
  /** ⌘V of a JSON object into the table: what the merge would do, shown before it is applied. */
  interface Preview {
    base: VarRow[];
    merged: VarRow[];
    diff: RowsDiff;
    count: number;
  }

  const COLOR_LABEL: Record<EnvColor, string> = {
    red: 'env.color.red',
    amber: 'env.color.amber',
    green: 'env.color.green',
    blue: 'env.color.blue',
    violet: 'env.color.violet',
    gray: 'env.color.gray',
  };
  const GLOBALS = 'globals';

  let draft = $state<Environment[]>([]);
  let draftGlobals = $state<VarRow[]>([]);
  let selected = $state<string>(GLOBALS);
  let query = $state('');
  let menuOpen = $state(false);
  // Row indexes of secret values currently shown in clear text.
  let revealed = $state<number[]>([]);
  let nameInput = $state<HTMLInputElement | null>(null);
  let root = $state<HTMLElement | null>(null);

  // Table ⇄ JSON view of the open environment. In JSON mode a valid text is applied to the draft at once;
  // `jsonBase` is what the environment was when the view opened (flags and real secret values come from it).
  let view = $state<'table' | 'json'>('table');
  let jsonText = $state('');
  let jsonBase = $state.raw<VarRow[]>([]);
  let preview = $state.raw<Preview | null>(null);
  let addMenuOpen = $state(false);
  let creating = $state<Creating | null>(null);
  /** The environment made from JSON last, and the format it was read as (shown beside the variables). */
  let createdFrom = $state<{ id: string; format: string } | null>(null);
  let toast = $state<{ text: string; undo?: () => void } | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  const env = $derived(draft.find((e) => e.id === selected));
  const rows = $derived(env ? env.vars : draftGlobals);
  const viewRows = $derived<VarRow[]>([...rows, { key: '', value: '', enabled: true }]);
  const filtered = $derived(draft.filter((e) => e.name.toLowerCase().includes(query.trim().toLowerCase())));
  const workspaceLabel = $derived(
    (workspace.path.split('/').filter(Boolean).at(-1) ?? 'Local Workspace').toUpperCase(),
  );
  const usedIn = $derived(
    countRequestsUsingVars(
      workspace.tree,
      rows.map((r) => r.key),
    ),
  );
  const jsonResult = $derived(envFromJson(creating ? creating.text : jsonText, creating?.fmt));
  /** The JSON on screen has an error: «Сохранить» / «Создать» wait for a fix. */
  const jsonInvalid = $derived((creating !== null || view === 'json') && !jsonResult.ok);
  const nameFromJson = $derived(creating !== null && !creating.nameTouched && jsonResult.ok && !!jsonResult.env.name);
  const footNote = $derived(
    creating
      ? t('env.create.note')
      : view === 'json'
        ? t(jsonResult.ok ? 'env.json.note.ok' : 'env.json.note.err')
        : preview
          ? t('env.paste.note')
          : t('env.secrets_note'),
  );

  /** «1 окружение · 2–4 окружения · 5+ окружений». */
  function plural(n: number): string {
    return tp(n, ['окружение', 'окружения', 'окружений'], ['environment', 'environments']).toUpperCase();
  }
  function requestsWord(n: number): string {
    return tp(n, ['запросе', 'запросах', 'запросах'], ['request', 'requests']);
  }

  // What the draft was copied from: our own save keeps the draft, a change made elsewhere while the tab
  // is open (toolbar «+», sidebar, import) re-seeds it, so «Сохранить» never drops that change.
  let seededList: Environment[] | null = null;
  let seededGlobals: VarRow[] | null = null;

  function seed(): void {
    seededList = environments.list;
    seededGlobals = environments.globals;
    draft = environments.list.map((e) => ({ ...e, vars: e.vars.map((r) => ({ ...r })) }));
    draftGlobals = environments.globals.map((r) => ({ ...r }));
  }

  $effect(() => {
    const list = environments.list;
    const globals = environments.globals;
    untrack(() => {
      if (list === seededList && globals === seededGlobals) return;
      seed();
      selected = draft.some((e) => e.id === environments.activeId) ? environments.activeId! : (draft[0]?.id ?? GLOBALS);
      query = '';
      resetTransient();
    });
  });

  /** Back to a plain table: no menus, no JSON view, no half-made environment. */
  function resetTransient(): void {
    menuOpen = false;
    addMenuOpen = false;
    revealed = [];
    view = 'table';
    preview = null;
    creating = null;
    createdFrom = null;
    toast = null;
  }

  function discard(): void {
    seed();
    resetTransient();
  }

  function save(): void {
    if (jsonInvalid) return;
    const ids = new Set(draft.map((e) => e.id));
    // Snapshots: the saved state gets plain copies, not the editor's live $state proxies.
    environments.list = $state.snapshot(draft).map((e) => ({ ...e, name: e.name.trim() || t('env.default_name') }));
    environments.globals = $state.snapshot(draftGlobals);
    if (environments.activeId && !ids.has(environments.activeId)) environments.activeId = null;
    seededList = environments.list;
    seededGlobals = environments.globals;
  }

  function onKeydown(e: KeyboardEvent): void {
    if (confirmState.current) return;
    if (e.key === 'Escape') {
      // Innermost thing first: the pasted-JSON preview, the half-made environment, a menu.
      const handled = preview
        ? ((preview = null), true)
        : creating
          ? (cancelCreate(), true)
          : menuOpen || addMenuOpen
            ? ((menuOpen = addMenuOpen = false), true)
            : false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    // Shortcuts of the «Новое окружение» menu. The tab shares the window: only while focus is in it.
    if (!root?.contains(document.activeElement)) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && e.shiftKey && key === 'v') {
      e.preventDefault();
      startCreate();
    } else if (mod && !e.shiftKey && !e.altKey && key === 'd' && env && !creating) {
      e.preventDefault();
      duplicate();
    }
  }

  function onPointerdown(e: PointerEvent): void {
    if (!(e.target instanceof Element) || e.target.closest('.menu, .more, .addwrap')) return;
    menuOpen = addMenuOpen = false;
  }

  function select(id: string): void {
    selected = id;
    menuOpen = false;
    revealed = [];
    preview = null;
    createdFrom = null;
    if (view === 'json') seedJson();
  }

  function showToast(text: string, undo?: () => void): void {
    toast = { text, undo };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), 5000);
  }

  function seedJson(): void {
    jsonBase = rows;
    jsonText = envToJson(rows, 'mask');
  }

  function setView(next: 'table' | 'json'): void {
    if (view === next) return;
    view = next;
    revealed = [];
    preview = null;
    if (next === 'json') seedJson();
  }

  /** A valid text goes into the draft at once; an invalid one leaves the last valid version in the table. */
  function onJson(text: string): void {
    jsonText = text;
    const r = envFromJson(text);
    if (r.ok) commitRows(mergeEnvRows(jsonBase, r.env.rows, 'replace'));
  }

  /** ⌘V of a JSON object on a key cell (or the empty last row) previews the merge instead of pasting a line. */
  function onTablePaste(e: ClipboardEvent): void {
    const target = e.target instanceof Element ? e.target : null;
    if (!target || !(target.classList.contains('key') || target.closest('.tr.new'))) return;
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!text.trimStart().startsWith('{')) return;
    const r = envFromJson(text);
    if (!r.ok || !r.env.rows.length) return;
    e.preventDefault();
    const merged = mergeEnvRows(rows, r.env.rows, 'merge');
    preview = { base: rows, merged, diff: diffEnvRows(rows, merged), count: r.env.rows.length };
  }

  function applyPreview(): void {
    if (!preview) return;
    commitRows(preview.merged);
    preview = null;
    revealed = [];
  }

  async function copyJson(): Promise<void> {
    menuOpen = false;
    try {
      await navigator.clipboard.writeText(envToJson(rows, 'blank'));
      showToast(t('env.copied_json'));
    } catch {
      /* clipboard unavailable */
    }
  }

  function uniqueName(taken: string[], base: string): string {
    let name = base;
    for (let n = 2; taken.includes(name); n++) name = `${base} ${n}`;
    return name;
  }

  function startCreate(text = ''): void {
    addMenuOpen = menuOpen = false;
    preview = null;
    view = 'table';
    const id = crypto.randomUUID();
    creating = { id, text, fmt: undefined, nameTouched: false, prev: selected };
    draft = [...draft, { id, name: t('env.new'), vars: [] }];
    query = '';
    select(id);
    updateCreate({});
    void tick().then(() => root?.querySelector<HTMLElement>('.envjson .cm-content')?.focus());
  }

  /** New text / format for the draft; a name inside the JSON (Postman) becomes the environment's name. */
  function updateCreate(patch: Partial<Creating>): void {
    if (!creating) return;
    const next = { ...creating, ...patch };
    creating = next;
    const r = envFromJson(next.text, next.fmt);
    if (r.ok && r.env.name && !next.nameTouched) patchEnv({ name: r.env.name });
  }

  function confirmCreate(): void {
    const c = creating;
    const r = jsonResult;
    if (!c || !r.ok) return;
    const taken = draft.filter((e) => e.id !== c.id).map((e) => e.name);
    const name = uniqueName(taken, env?.name.trim() || t('env.new'));
    draft = draft.map((e) => (e.id === c.id ? { ...e, name, vars: r.env.rows } : e));
    createdFrom = { id: c.id, format: t(`env.fmt.${r.env.format}`) };
    creating = null;
    const n = r.env.rows.length;
    showToast(
      t('env.create.done', {
        name,
        n,
        word: tp(n, ['переменная', 'переменные', 'переменных'], ['variable', 'variables']),
      }),
      () => dropDraft(c.id, c.prev),
    );
  }

  function dropDraft(id: string, back: string): void {
    draft = draft.filter((e) => e.id !== id);
    select(draft.some((e) => e.id === back) ? back : (draft[0]?.id ?? GLOBALS));
  }

  function cancelCreate(): void {
    if (creating) dropDraft(creating.id, creating.prev);
    creating = null;
  }

  async function startFromFile(): Promise<void> {
    addMenuOpen = false;
    try {
      const f = await openapiImportPick();
      if (f) startCreate(f.text || (await importReadFile(f.path)).text);
    } catch {
      showToast(t('env.file_error'));
    }
  }

  // A .json dragged into the window while «Из JSON…» is open fills the editor. Tauri hands over file paths
  // (HTML5 drop events never fire in the macOS webview); the import window's drop zone steps aside for [data-env-drop].
  const dropOpen = $derived(creating !== null);
  $effect(() => {
    if (!dropOpen) return;
    let off: (() => void) | undefined;
    let cancelled = false;
    try {
      getCurrentWebview()
        .onDragDropEvent((e) => {
          const path = e.payload.type === 'drop' ? e.payload.paths.find((p) => /\.json$/i.test(p)) : undefined;
          if (path)
            void importReadFile(path)
              .then((f) => updateCreate({ text: f.text }))
              .catch(() => showToast(t('env.file_error')));
        })
        .then((fn) => (cancelled ? fn() : (off = fn)))
        .catch(() => {});
    } catch {
      /* not inside Tauri (browser preview) */
    }
    return () => {
      cancelled = true;
      off?.();
    };
  });

  function patchEnv(patch: Partial<Environment>): void {
    draft = draft.map((e) => (e.id === selected ? { ...e, ...patch } : e));
  }

  function commitRows(next: VarRow[]): void {
    // The trailing blank row is only the "add" affordance, not data.
    const last = next.at(-1);
    const trimmed = last && last.key === '' && last.value === '' ? next.slice(0, -1) : next;
    if (env) patchEnv({ vars: trimmed });
    else draftGlobals = trimmed;
  }

  function patchRow(i: number, patch: Partial<VarRow>): void {
    commitRows(viewRows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function removeRow(i: number): void {
    revealed = [];
    commitRows(viewRows.filter((_, idx) => idx !== i));
  }

  function toggleReveal(i: number): void {
    revealed = revealed.includes(i) ? revealed.filter((x) => x !== i) : [...revealed, i];
  }

  async function addEnv(): Promise<void> {
    addMenuOpen = false;
    const id = crypto.randomUUID();
    draft = [...draft, { id, name: t('env.new'), vars: [] }];
    query = '';
    select(id);
    await tick();
    nameInput?.focus();
    nameInput?.select();
  }

  function duplicate(): void {
    addMenuOpen = false;
    if (!env) return;
    const id = crypto.randomUUID();
    draft = [
      ...draft,
      { ...env, id, name: t('env.copy_suffix', { name: env.name }), vars: env.vars.map((r) => ({ ...r })) },
    ];
    select(id);
  }

  async function startRename(): Promise<void> {
    menuOpen = false;
    await tick();
    nameInput?.focus();
    nameInput?.select();
  }

  async function removeEnv(): Promise<void> {
    menuOpen = false;
    if (!env) return;
    if (!(await requestConfirm(t('env.delete_confirm', { name: env.name }), t('common.delete')))) return;
    const id = env.id;
    const next = draft.filter((e) => e.id !== id);
    draft = next;
    select(next[0]?.id ?? GLOBALS);
  }

  const valueShown = (row: VarRow, i: number): string =>
    row.secret && !revealed.includes(i) && i < rows.length ? maskSecret(row.value) : row.value;
</script>

<svelte:window onkeydown={onKeydown} onpointerdown={onPointerdown} />

<div bind:this={root} class="bs-envsheet embedded" role="region" aria-labelledby="bs-envsheet-title">
  {@render content()}
</div>

{#snippet content()}
  <header class="head">
    <div>
      <div class="kicker">{workspaceLabel}&nbsp;&nbsp;·&nbsp;&nbsp;{draft.length} {plural(draft.length)}</div>
      <h2 id="bs-envsheet-title">{t('env.title')}</h2>
    </div>
  </header>

  <div class="body">
    <aside class="list">
      <label class="search">
        <span class="material-symbols-outlined" aria-hidden="true">search</span>
        <input bind:value={query} placeholder={t('env.find')} aria-label={t('env.find')} />
      </label>
      <div class="items">
        <button class="item" class:on={selected === GLOBALS} type="button" onclick={() => select(GLOBALS)}>
          <span class="material-symbols-outlined lead" aria-hidden="true">public</span>
          <span class="label">Globals</span>
        </button>
        {#each filtered as e (e.id)}
          <button class="item" class:on={selected === e.id} type="button" onclick={() => select(e.id)}>
            <span class="dot" style:background={ENV_COLOR_VAR[envColor(e)]} aria-hidden="true"></span>
            <span class="label">{e.name}</span>
            {#if creating?.id === e.id}<span class="draft">{t('env.create.draft')}</span>{/if}
            {#if isProtected(e)}<span class="material-symbols-outlined lock" role="img" aria-label={t('env.protected')}
                >lock</span
              >{/if}
          </button>
        {/each}
      </div>
      <div class="addwrap">
        {#if addMenuOpen}
          <div class="menu addmenu" role="menu" aria-label={t('env.add.menu')}>
            <div class="mhead">{t('env.add.menu')}</div>
            <button type="button" role="menuitem" onclick={addEnv}
              ><span class="material-symbols-outlined" aria-hidden="true">add</span>{t('env.add.empty')}</button
            >
            <button type="button" role="menuitem" disabled={!env} onclick={duplicate}
              ><span class="material-symbols-outlined" aria-hidden="true">content_copy</span><span class="grow"
                >{env ? t('env.add.dup', { name: env.name }) : t('env.duplicate')}</span
              ><kbd>⌘D</kbd></button
            >
            <div class="msep" role="separator"></div>
            <button type="button" role="menuitem" class="json" onclick={() => startCreate()}
              ><span class="material-symbols-outlined" aria-hidden="true">data_object</span><span class="grow"
                >{t('env.add.json')}</span
              ><kbd>⇧⌘V</kbd></button
            >
            <button type="button" role="menuitem" onclick={startFromFile}
              ><span class="material-symbols-outlined" aria-hidden="true">upload_file</span>{t('env.add.file')}</button
            >
            <div class="mhint">{t('env.add.file_hint')}</div>
          </div>
        {/if}
        <button
          class="add"
          type="button"
          aria-haspopup="menu"
          aria-expanded={addMenuOpen}
          onclick={() => (addMenuOpen = !addMenuOpen)}
          ><span class="material-symbols-outlined" aria-hidden="true">add</span>{t('env.new')}</button
        >
      </div>
    </aside>

    <section class="detail" data-env-drop={creating ? '' : undefined}>
      <div class="titlebar">
        {#if env}
          <!-- Grows with the text so the «Защищено» badge sits right after the name (S31). -->
          <label class="namebox"
            ><span aria-hidden="true">{env.name || ' '}</span><input
              class="name"
              size="1"
              bind:this={nameInput}
              value={env.name}
              oninput={(e) => {
                if (creating) creating = { ...creating, nameTouched: true };
                patchEnv({ name: e.currentTarget.value });
              }}
              onblur={() => {
                if (!env?.name.trim()) patchEnv({ name: t('env.default_name') });
              }}
              onkeydown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              aria-label={t('env.name_aria')}
            /></label
          >
          {#if nameFromJson}<span class="badge json"
              ><span class="material-symbols-outlined" aria-hidden="true">data_object</span>{t(
                'env.create.name_from_json',
              )}</span
            >{:else if isProtected(env)}<span class="badge"
              ><span class="material-symbols-outlined" aria-hidden="true">lock</span>{t('env.protected')}</span
            >{/if}
          <div class="grow"></div>
          {#if !creating}
            <button class="quiet" type="button" onclick={duplicate}
              ><span class="material-symbols-outlined" aria-hidden="true">content_copy</span>{t(
                'env.duplicate',
              )}</button
            >
            <div class="more">
              <button
                class="icon"
                type="button"
                aria-label={t('env.more')}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onclick={() => (menuOpen = !menuOpen)}
                ><span class="material-symbols-outlined" aria-hidden="true">more_horiz</span></button
              >
              {#if menuOpen}
                <div class="menu" role="menu">
                  <button type="button" role="menuitem" onclick={startRename}>{t('env.rename')}</button>
                  <button type="button" role="menuitem" onclick={copyJson}>{t('env.copy_json')}</button>
                  <button type="button" role="menuitem" class="danger" onclick={removeEnv}>{t('common.delete')}</button>
                </div>
              {/if}
            </div>
          {/if}
        {:else}
          <h3 class="name static">Globals</h3>
        {/if}
      </div>

      {#if env && !creating}
        <div class="cards">
          <div class="card">
            <div class="eyebrow">{t('env.protection')}</div>
            <div class="switchrow">
              <span id="bs-env-protect-label">{t('env.protect_label')}</span>
              <Switch
                checked={isProtected(env)}
                aria-labelledby="bs-env-protect-label"
                onclick={() => patchEnv({ protected: !isProtected(env) })}
              />
            </div>
          </div>
          <div class="card">
            <div class="eyebrow">{t('env.label_color')}</div>
            <div class="swatches" role="radiogroup" aria-label={t('env.label_color_aria')}>
              {#each ENV_COLORS as c (c)}
                <button
                  class="swatch"
                  class:on={envColor(env) === c}
                  type="button"
                  role="radio"
                  aria-checked={envColor(env) === c}
                  aria-label={t(COLOR_LABEL[c])}
                  style:background={ENV_COLOR_VAR[c]}
                  onclick={() => patchEnv({ color: c })}
                ></button>
              {/each}
            </div>
          </div>
        </div>
      {/if}

      {#if creating}
        <div class="varhead">
          <span class="eyebrow">{t('env.create.paste')}</span>
          <span class="used">{t('env.create.drop')}</span>
        </div>
        <EnvJsonEditor
          create
          text={creating.text}
          onChange={(text) => updateCreate({ text })}
          result={jsonResult}
          base={[]}
          docId={creating.id}
          format={creating.fmt}
          onFormat={(fmt) => updateCreate({ fmt })}
        />
      {:else}
        <div class="varhead">
          <span class="eyebrow">{t('env.variables')}&nbsp;&nbsp;·&nbsp;&nbsp;{rows.length}</span>
          <span class="right">
            <span class="used"
              >{createdFrom?.id === selected
                ? t('env.created_from', { format: createdFrom.format })
                : t('env.used_in', { n: usedIn, word: requestsWord(usedIn) })}</span
            >
            <Segmented role="group" aria-label={t('env.view_aria')}>
              <button
                type="button"
                class:on={view === 'table'}
                aria-pressed={view === 'table'}
                onclick={() => setView('table')}>{t('env.view.table')}</button
              >
              <button
                type="button"
                class:on={view === 'json'}
                aria-pressed={view === 'json'}
                onclick={() => setView('json')}>{t('env.view.json')}</button
              >
            </Segmented>
          </span>
        </div>

        {#if view === 'json'}
          <EnvJsonEditor text={jsonText} onChange={onJson} result={jsonResult} base={jsonBase} docId={selected} />
        {:else}
          {#if preview}
            <div class="pv" role="status">
              <span class="material-symbols-outlined" aria-hidden="true">content_paste</span>
              <div class="pvtext">
                <div class="pvtitle">
                  {t('env.paste.title', {
                    n: preview.count,
                    word: tp(preview.count, ['ключ', 'ключа', 'ключей'], ['key', 'keys']),
                  })}
                </div>
                <div class="pvstat">
                  {#if preview.diff.added.length}<span class="s-new"
                      >{t('env.paste.added', {
                        n: preview.diff.added.length,
                        word: tp(preview.diff.added.length, ['новая', 'новые', 'новых'], ['new', 'new']),
                      })}</span
                    >{/if}
                  {#if preview.diff.changed.length}<span class="s-chg"
                      >{t('env.paste.changed', { n: preview.diff.changed.length })}</span
                    >{/if}
                  {#if preview.diff.same}<span>{t('env.paste.same', { n: preview.diff.same })}</span>{/if}
                </div>
              </div>
              <button class="quiet" type="button" onclick={() => (preview = null)}
                >{t('env.paste.cancel')}&nbsp;&nbsp;<kbd>Esc</kbd></button
              >
              <Button variant="primary" size="lg" onclick={applyPreview}>{t('env.paste.apply')}</Button>
            </div>
          {/if}

          <div class="table" role="table" aria-label={t('env.variables_aria')} onpaste={onTablePaste}>
            <div class="tr th" role="row">
              {#if preview}<span class="c-mk" aria-hidden="true"></span>{/if}
              <span class="c-key" role="columnheader">{t('env.col.key')}</span>
              <span class="c-val" role="columnheader">{t('env.col.value')}</span>
              <span class="c-sec" role="columnheader">{t('env.col.secret')}</span>
            </div>
            <div class="rows">
              {#if preview}
                {#each preview.merged as row (row.key)}
                  {@const state = preview.diff.added.includes(row.key)
                    ? 'new'
                    : preview.diff.changed.includes(row.key)
                      ? 'chg'
                      : 'same'}
                  {@const was = preview.base.find((r) => r.key === row.key)}
                  <div class="tr pv-{state}" role="row">
                    <span class="c-mk" aria-hidden="true">{state === 'new' ? '+' : state === 'chg' ? '~' : ''}</span>
                    <span class="c-key static" role="cell">{row.key}</span>
                    <span class="c-val static" role="cell"
                      >{#if state === 'chg' && was}<span class="was"
                          >{was.secret ? maskSecret(was.value) : was.value}</span
                        >&nbsp;→&nbsp;{/if}<span class="now">{row.secret ? maskSecret(row.value) : row.value}</span
                      ></span
                    >
                    <span class="c-sec" role="cell"
                      ><Switch disabled checked={!!row.secret} aria-label={t('env.secret')} /></span
                    >
                  </div>
                {/each}
              {:else}
                {#each viewRows as row, i (i)}
                  {@const isNew = i === rows.length}
                  <div class="tr" class:new={isNew} class:off={!row.enabled} role="row">
                    <span class="c-key" role="cell"
                      ><input
                        class="key"
                        placeholder={t('env.new_var')}
                        aria-label={t('env.key_aria')}
                        value={row.key}
                        oninput={(e) => patchRow(i, { key: e.currentTarget.value })}
                      /></span
                    >
                    <span class="c-val" role="cell">
                      <input
                        class="val"
                        placeholder={t('env.value_aria')}
                        aria-label={t('env.value_aria')}
                        value={valueShown(row, i)}
                        readonly={!!row.secret && !revealed.includes(i) && !isNew}
                        oninput={(e) => patchRow(i, { value: e.currentTarget.value })}
                      />
                      {#if !row.enabled}<button
                          class="offtag"
                          type="button"
                          title={t('env.enable_var')}
                          onclick={() => patchRow(i, { enabled: true })}>{t('env.off')}</button
                        >{/if}
                    </span>
                    <span class="c-sec" role="cell">
                      {#if !isNew}
                        <button
                          class="icon sm del"
                          type="button"
                          aria-label={t('env.delete_var')}
                          onclick={() => removeRow(i)}
                          ><span class="material-symbols-outlined" aria-hidden="true">close</span></button
                        >
                        {#if row.secret}
                          <button
                            class="icon sm"
                            type="button"
                            aria-label={revealed.includes(i) ? t('env.hide_value') : t('env.show_value')}
                            aria-pressed={revealed.includes(i)}
                            onclick={() => toggleReveal(i)}
                            ><span class="material-symbols-outlined" aria-hidden="true"
                              >{revealed.includes(i) ? 'visibility_off' : 'visibility'}</span
                            ></button
                          >
                        {/if}
                        <Switch
                          checked={!!row.secret}
                          aria-label={t('env.secret')}
                          onclick={() => {
                            revealed = [];
                            patchRow(i, { secret: !row.secret });
                          }}
                        />
                      {/if}
                    </span>
                  </div>
                {/each}
              {/if}
            </div>
          </div>
        {/if}
      {/if}
    </section>
  </div>

  <footer class="foot">
    <span class="note">{footNote}</span>
    {#if creating}
      <Button variant="ghost" size="lg" onclick={cancelCreate}>{t('common.cancel')}</Button>
      <Button variant="primary" size="lg" disabled={!jsonResult.ok} onclick={confirmCreate}
        >{t('env.create.button')}</Button
      >
    {:else}
      <Button variant="ghost" size="lg" onclick={discard}>{t('common.cancel')}</Button>
      <Button variant="primary" size="lg" disabled={jsonInvalid} onclick={save}>{t('common.save')}</Button>
    {/if}
  </footer>
{/snippet}

{#if toast}
  <div class="bs-toast" role="status">
    <span class="material-symbols-outlined" aria-hidden="true">check_circle</span>
    <span class="text">{toast.text}</span>
    {#if toast.undo}<button
        type="button"
        onclick={() => {
          toast?.undo?.();
          toast = null;
        }}>{t('env.create.undo')}</button
      >{/if}
  </div>
{/if}

<style>
  /* Sizes follow the S31 mock (Pencil node «Environments sheet»). */
  .bs-envsheet.embedded {
    width: 100%;
    height: 100%;
    max-height: none;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
  }
  .bs-envsheet.bs-envsheet {
    background: var(--color-raised);
  }
  .bs-envsheet {
    width: 1040px;
    max-width: 100%;
    height: 660px;
    max-height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: var(--radius-dialog);
    background: var(--color-raised);
    color: var(--color-text);
    font: var(--font-size-body) var(--font-ui);
  }
  .head {
    flex: none;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    height: 73px;
    padding: 18px 16px 16px 24px;
  }
  .kicker,
  .eyebrow {
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro)/13px var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
  }
  h2 {
    margin: 4px 0 0;
    font: 600 18px/22px var(--font-ui);
  }
  .icon {
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    color: var(--color-text-secondary);
  }
  .icon:hover {
    background: var(--color-hover);
    color: var(--color-text);
  }
  .icon .material-symbols-outlined {
    font-size: 17px;
  }
  .icon.sm {
    width: 22px;
    height: 22px;
  }
  .icon.sm .material-symbols-outlined {
    font-size: 15px;
    color: var(--color-text-muted);
  }

  .body {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .list {
    flex: none;
    width: 260px;
    display: flex;
    flex-direction: column;
    padding: 10px;
    background: var(--color-panel);
  }
  .search {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 34px;
    margin-bottom: 10px;
    padding: 0 14px;
    border-radius: var(--radius-control);
    background: var(--color-field);
    color: var(--color-text-muted);
  }
  .search .material-symbols-outlined {
    font-size: 15px;
  }
  .search input {
    flex: 1;
    min-width: 0;
    height: auto;
    padding: 0;
    border: 0;
    outline: none;
    box-shadow: none;
    background: transparent;
    color: var(--color-text);
    font: var(--font-size-body) var(--font-ui);
  }
  .search input::placeholder {
    color: var(--color-text-muted);
  }
  .items {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .item {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 32px;
    padding: 0 12px;
    border-radius: var(--radius-control);
    color: var(--color-text-secondary);
    font: var(--font-size-ui) var(--font-ui);
    text-align: left;
  }
  .item:hover {
    background: var(--color-hover);
  }
  .item.on {
    background: var(--color-selected);
    color: var(--color-text);
    font-weight: 600;
  }
  .item .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .item .dot {
    flex: 0 0 8px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .item .lead {
    flex: 0 0 8px;
    margin-right: 0;
    font-size: 14px;
    color: var(--color-text-muted);
    text-align: center;
  }
  .item .lock {
    font-size: 13px;
    color: var(--color-text-muted);
  }
  .add {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 34px;
    margin-top: 2px;
    padding: 0 12px;
    border-radius: var(--radius-control);
    color: var(--color-text-secondary);
    font: 500 var(--font-size-body) var(--font-ui);
  }
  .add:hover {
    background: var(--color-hover);
    color: var(--color-text);
  }
  .add .material-symbols-outlined {
    font-size: 15px;
  }

  .detail {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 20px 24px;
    overflow: auto;
  }
  .titlebar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 32px;
  }
  .namebox {
    display: inline-grid;
    min-width: 0;
    max-width: 420px;
  }
  .namebox > * {
    grid-area: 1 / 1;
    font: 600 22px/27px var(--font-ui);
  }
  .namebox > span {
    visibility: hidden;
    white-space: pre;
    overflow: hidden;
  }
  .name {
    width: 100%;
    min-width: 1ch;
    padding: 0;
    margin: 0;
    border: 0;
    outline: none;
    box-shadow: none;
    border-radius: var(--radius-xs);
    background: transparent;
    color: var(--color-text);
  }
  .name:focus-visible {
    outline: 2px solid var(--color-text);
    outline-offset: 2px;
  }
  .name.static {
    width: auto;
    margin: 0;
    font: 600 22px/27px var(--font-ui);
  }
  .grow {
    flex: 1;
  }
  .badge {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    padding: 0 10px 0 8px;
    border-radius: var(--radius-control);
    background: var(--color-danger-soft);
    color: var(--color-danger);
    font: 600 var(--font-size-caption) var(--font-ui);
  }
  .badge .material-symbols-outlined {
    font-size: 13px;
  }
  .quiet {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 12px;
    border-radius: var(--radius-control);
    color: var(--color-text-secondary);
    font: 500 var(--font-size-body) var(--font-ui);
  }
  .quiet:hover {
    background: var(--color-hover);
    color: var(--color-text);
  }
  .quiet .material-symbols-outlined {
    font-size: 16px;
  }
  .more {
    position: relative;
  }
  .menu {
    position: absolute;
    z-index: 5;
    top: calc(100% + 6px);
    right: 0;
    min-width: 180px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-card);
    background: var(--color-raised);
    box-shadow: var(--shadow-panel);
  }
  .menu button {
    height: 32px;
    padding: 0 12px;
    border-radius: var(--radius-control);
    text-align: left;
    color: var(--color-text);
    font: var(--font-size-body) var(--font-ui);
  }
  .menu button:hover {
    background: var(--color-hover);
  }
  .menu .danger {
    color: var(--color-danger);
  }

  .cards {
    flex: none;
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
    background: var(--color-field);
  }
  .cards .card {
    flex: 1;
    min-width: 0;
  }
  .switchrow {
    display: flex;
    align-items: center;
    gap: 10px;
    font: var(--font-size-body)/15px var(--font-ui);
  }
  .switchrow span {
    flex: 1;
  }
  .swatches {
    display: flex;
    gap: 8px;
    align-items: center;
    height: 24px;
  }
  .swatch {
    width: 24px;
    height: 24px;
    border-radius: 50%;
  }
  .swatch.on {
    box-shadow:
      0 0 0 2px var(--color-field),
      0 0 0 3px var(--color-text);
  }
  .swatch:focus-visible {
    outline: 2px solid var(--color-text);
    outline-offset: 3px;
  }

  .varhead {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 13px;
  }
  .varhead .right {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .used {
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-ui);
  }
  .table {
    flex: none;
    border-radius: var(--radius-card);
    background: var(--color-field);
    overflow: hidden;
  }
  .rows {
    max-height: 228px;
    overflow: auto;
  }
  .tr {
    display: flex;
    align-items: center;
    height: 38px;
    padding: 0 14px;
    border-top: 1px solid var(--color-border-subtle);
  }
  .tr.th {
    height: 32px;
    border-top: 0;
    color: var(--color-text-muted);
    font: var(--font-size-micro) var(--font-code);
  }
  .c-key {
    flex: none;
    width: 192px;
    padding-right: 12px;
  }
  .c-val {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding-right: 12px;
  }
  .c-sec {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    width: 90px;
  }
  .tr input {
    width: 100%;
    height: auto;
    padding: 0;
    border: 0;
    outline: none;
    box-shadow: none;
    background: transparent;
    font: var(--font-size-body) var(--font-code);
  }
  .tr input:focus-visible {
    outline: 2px solid var(--color-text);
    outline-offset: 4px;
    border-radius: 2px;
  }
  .tr .key {
    color: var(--color-var);
  }
  .tr .val {
    color: var(--color-text);
  }
  .tr.new input,
  .tr input::placeholder {
    color: var(--color-text-muted);
  }
  .tr .del {
    opacity: 0;
  }
  .tr:hover .del,
  .tr:focus-within .del {
    opacity: 1;
  }

  .item .draft {
    flex: none;
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-ui);
  }
  .badge.json {
    background: color-mix(in srgb, var(--color-var) 16%, transparent);
    color: var(--color-var);
  }
  kbd {
    color: var(--color-text-muted);
    font: var(--font-size-micro) var(--font-code);
  }

  .addwrap {
    position: relative;
    flex: none;
  }
  .addwrap .add {
    width: 100%;
  }
  .menu.addmenu {
    top: auto;
    bottom: calc(100% + 6px);
    left: 0;
    right: 0;
  }
  .addmenu button {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 10px;
  }
  .addmenu button:disabled {
    opacity: 0.45;
  }
  .addmenu .material-symbols-outlined {
    font-size: 15px;
    color: var(--color-text-muted);
  }
  .addmenu .json .material-symbols-outlined {
    color: var(--color-var);
  }
  .addmenu .grow {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mhead {
    padding: 6px 10px 4px;
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro)/13px var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
  }
  .msep {
    height: 1px;
    margin: 4px 0;
    background: var(--color-border-subtle);
  }
  .mhint {
    padding: 0 10px 6px 35px;
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-ui);
  }

  .pv {
    flex: none;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 4px 0 14px;
  }
  .pv > .material-symbols-outlined {
    font-size: 16px;
    color: var(--color-text-muted);
  }
  .pvtext {
    flex: 1;
    min-width: 0;
  }
  .pvtitle {
    font: 600 var(--font-size-body) var(--font-ui);
  }
  .pvstat {
    display: flex;
    gap: 12px;
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-ui);
  }
  .s-new {
    color: var(--color-success);
  }
  .s-chg {
    color: var(--color-warning);
  }
  .c-mk {
    flex: none;
    width: 22px;
    font: var(--font-size-body) var(--font-code);
  }
  .pv-new {
    background: var(--color-success-soft);
  }
  .pv-chg {
    background: var(--color-warning-soft);
  }
  .pv-new .c-mk {
    color: var(--color-success);
  }
  .pv-chg .c-mk {
    color: var(--color-warning);
  }
  .c-key.static,
  .c-val.static {
    font: var(--font-size-body) var(--font-code);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .c-key.static {
    color: var(--color-var);
  }
  .pv-same .c-key.static,
  .pv-same .c-val.static {
    opacity: 0.6;
  }
  .was {
    color: var(--color-text-muted);
  }
  .tr.off .key,
  .tr.off .val {
    opacity: 0.55;
  }
  .offtag {
    flex: none;
    height: 18px;
    padding: 0 7px;
    border-radius: var(--radius-control);
    background: var(--color-hover);
    color: var(--color-text-muted);
    font: var(--font-size-micro) var(--font-ui);
  }
  .offtag:hover {
    color: var(--color-text);
  }

  .foot {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 58px;
    padding: 12px 16px 12px 24px;
  }
  .note {
    flex: 1;
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-ui);
  }
</style>
