<script lang="ts">
  /**
   * S31 · Environments sheet: modal manager for environments and Globals.
   * Edits go into a local draft (deep copy of the stores) and are written back
   * only on «Сохранить»; «Отмена» / Esc / scrim discard them.
   * `embedded` renders the same editor inside the Environments tab (no scrim).
   */
  import { tick, untrack } from 'svelte';
  import { t, tp } from '$shared/i18n';
  import {
    activeEnvironmentId,
    environments,
    environmentsSheetOpen,
    globals,
    ENV_COLORS,
    ENV_COLOR_VAR,
    envColor,
    isProtected,
    type EnvColor,
  } from '$entities/environment';
  import { collections, workspacePath } from '$entities/workspace';
  import { confirmState, requestConfirm } from '$shared/ui';
  import { type Environment, type VarRow, countRequestsUsingVars, maskSecret } from '$shared/model';

  const { embedded = false }: { embedded?: boolean } = $props();

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
  let opener: HTMLElement | null = null;
  let nameInput = $state<HTMLInputElement | null>(null);
  let searchInput = $state<HTMLInputElement | null>(null);

  const env = $derived(draft.find((e) => e.id === selected));
  const rows = $derived(env ? env.vars : draftGlobals);
  const viewRows = $derived<VarRow[]>([...rows, { key: '', value: '', enabled: true }]);
  const filtered = $derived(draft.filter((e) => e.name.toLowerCase().includes(query.trim().toLowerCase())));
  const workspace = $derived(($workspacePath.split('/').filter(Boolean).at(-1) ?? 'Local Workspace').toUpperCase());
  const usedIn = $derived(
    countRequestsUsingVars(
      $collections,
      rows.map((r) => r.key),
    ),
  );

  /** «1 окружение · 2–4 окружения · 5+ окружений». */
  function plural(n: number): string {
    return tp(n, ['окружение', 'окружения', 'окружений'], ['environment', 'environments']).toUpperCase();
  }
  function requestsWord(n: number): string {
    return tp(n, ['запросе', 'запросах', 'запросах'], ['request', 'requests']);
  }

  const shown = $derived(embedded || $environmentsSheetOpen);

  function seed(): void {
    draft = $environments.map((e) => ({ ...e, vars: e.vars.map((r) => ({ ...r })) }));
    draftGlobals = $globals.map((r) => ({ ...r }));
  }

  // Seed the draft each time the sheet opens (and remember who to refocus on close).
  $effect(() => {
    if (!shown) return;
    untrack(() => {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      draft = $environments.map((e) => ({ ...e, vars: e.vars.map((r) => ({ ...r })) }));
      draftGlobals = $globals.map((r) => ({ ...r }));
      selected = draft.some((e) => e.id === $activeEnvironmentId) ? $activeEnvironmentId! : (draft[0]?.id ?? GLOBALS);
      query = '';
      menuOpen = false;
      revealed = [];
    });
    if (!embedded) void tick().then(() => searchInput?.focus());
  });

  function close(): void {
    if (embedded) {
      seed();
      revealed = [];
      return;
    }
    environmentsSheetOpen.set(false);
    void tick().then(() => opener?.focus());
  }

  function save(): void {
    const ids = new Set(draft.map((e) => e.id));
    environments.set(draft.map((e) => ({ ...e, name: e.name.trim() || t('env.default_name') })));
    globals.set(draftGlobals);
    if ($activeEnvironmentId && !ids.has($activeEnvironmentId)) activeEnvironmentId.set(null);
    if (!embedded) close();
  }

  function onKeydown(e: KeyboardEvent): void {
    if (embedded || !$environmentsSheetOpen || e.key !== 'Escape' || confirmState.current) return;
    e.preventDefault();
    e.stopPropagation();
    if (menuOpen) menuOpen = false;
    else close();
  }

  function select(id: string): void {
    selected = id;
    menuOpen = false;
    revealed = [];
  }

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
    const id = crypto.randomUUID();
    draft = [...draft, { id, name: t('env.new'), vars: [] }];
    query = '';
    select(id);
    await tick();
    nameInput?.focus();
    nameInput?.select();
  }

  function duplicate(): void {
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

<svelte:window onkeydown={onKeydown} />

{#if embedded}
  <div class="bs-envsheet embedded" role="region" aria-labelledby="bs-envsheet-title">{@render content()}</div>
{:else if $environmentsSheetOpen}
  <div
    class="bs-overlay bs-envsheet-overlay"
    role="presentation"
    onpointerdown={(e) => {
      if (e.target === e.currentTarget) close();
    }}
  >
    <div class="bs-modal bs-envsheet" role="dialog" aria-modal="true" aria-labelledby="bs-envsheet-title">
      {@render content()}
    </div>
  </div>
{/if}

{#snippet content()}
  <header class="head">
    <div>
      <div class="kicker">{workspace}&nbsp;&nbsp;·&nbsp;&nbsp;{draft.length} {plural(draft.length)}</div>
      <h2 id="bs-envsheet-title">{t('env.title')}</h2>
    </div>
    {#if !embedded}<button class="icon" type="button" aria-label={t('common.close')} onclick={close}
        ><span class="material-symbols-outlined" aria-hidden="true">close</span></button
      >{/if}
  </header>

  <div class="body">
    <aside class="list">
      <label class="search">
        <span class="material-symbols-outlined" aria-hidden="true">search</span>
        <input bind:this={searchInput} bind:value={query} placeholder={t('env.find')} aria-label={t('env.find')} />
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
            {#if isProtected(e)}<span class="material-symbols-outlined lock" role="img" aria-label={t('env.protected')}
                >lock</span
              >{/if}
          </button>
        {/each}
      </div>
      <button class="add" type="button" onclick={addEnv}
        ><span class="material-symbols-outlined" aria-hidden="true">add</span>{t('env.new')}</button
      >
    </aside>

    <section class="detail">
      <div class="titlebar">
        {#if env}
          <!-- Grows with the text so the «Защищено» badge sits right after the name (S31). -->
          <label class="namebox"
            ><span aria-hidden="true">{env.name || ' '}</span><input
              class="name"
              size="1"
              bind:this={nameInput}
              value={env.name}
              oninput={(e) => patchEnv({ name: e.currentTarget.value })}
              onblur={() => {
                if (!env?.name.trim()) patchEnv({ name: t('env.default_name') });
              }}
              onkeydown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              aria-label={t('env.name_aria')}
            /></label
          >
          {#if isProtected(env)}<span class="badge"
              ><span class="material-symbols-outlined" aria-hidden="true">lock</span>{t('env.protected')}</span
            >{/if}
          <div class="grow"></div>
          <button class="quiet" type="button" onclick={duplicate}
            ><span class="material-symbols-outlined" aria-hidden="true">content_copy</span>{t('env.duplicate')}</button
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
                <button type="button" role="menuitem" class="danger" onclick={removeEnv}>{t('common.delete')}</button>
              </div>
            {/if}
          </div>
        {:else}
          <h3 class="name static">Globals</h3>
        {/if}
      </div>

      {#if env}
        <div class="cards">
          <div class="card">
            <div class="eyebrow">{t('env.protection')}</div>
            <div class="switchrow">
              <span id="bs-env-protect-label">{t('env.protect_label')}</span>
              <button
                class="mono-switch"
                type="button"
                role="switch"
                aria-checked={isProtected(env)}
                aria-labelledby="bs-env-protect-label"
                onclick={() => patchEnv({ protected: !isProtected(env) })}
              ></button>
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

      <div class="varhead">
        <span class="eyebrow">{t('env.variables')}&nbsp;&nbsp;·&nbsp;&nbsp;{rows.length}</span>
        <span class="used">{t('env.used_in', { n: usedIn, word: requestsWord(usedIn) })}</span>
      </div>

      <div class="table" role="table" aria-label={t('env.variables_aria')}>
        <div class="tr th" role="row">
          <span class="c-key" role="columnheader">{t('env.col.key')}</span>
          <span class="c-val" role="columnheader">{t('env.col.value')}</span>
          <span class="c-sec" role="columnheader">{t('env.col.secret')}</span>
        </div>
        <div class="rows">
          {#each viewRows as row, i (i)}
            {@const isNew = i === rows.length}
            <div class="tr" class:new={isNew} role="row">
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
                  <button
                    class="mono-switch"
                    type="button"
                    role="switch"
                    aria-checked={!!row.secret}
                    aria-label={t('env.secret')}
                    onclick={() => {
                      revealed = [];
                      patchRow(i, { secret: !row.secret });
                    }}
                  ></button>
                {/if}
              </span>
            </div>
          {/each}
        </div>
      </div>
    </section>
  </div>

  <footer class="foot">
    <span class="note">{t('env.secrets_note')}</span>
    <button class="bs-btn ghost" type="button" onclick={close}>{t('common.cancel')}</button>
    <button class="bs-btn primary" type="button" onclick={save}>{t('common.save')}</button>
  </footer>
{/snippet}

<style>
  /* Sizes follow the S31 mock (Pencil node «Environments sheet»). */
  .bs-envsheet-overlay {
    background: var(--color-scrim);
  }
  .bs-envsheet.embedded {
    width: 100%;
    height: 100%;
    max-height: none;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
  }
  /* Centered over the workspace (below the header), as in the mock: y = 80 at 800 px. */
  .bs-envsheet:not(.embedded) {
    transform: translateY(10px);
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
  .head .icon {
    margin-top: 4px;
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
    height: 13px;
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
  .foot :global(.bs-btn) {
    height: 34px;
    padding: 0 16px;
    border: 0;
    border-radius: var(--radius-control);
    font: 500 var(--font-size-body) var(--font-ui);
  }
  .foot :global(.bs-btn.ghost) {
    background: var(--color-panel);
    color: var(--color-text);
  }
  .foot :global(.bs-btn.primary) {
    background: var(--color-action);
    color: var(--color-on-action);
    font-weight: 600;
  }
</style>
