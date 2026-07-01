<script lang="ts">
  /**
   * Environments + Globals manager (Postman-style variables), shown as a
   * full-pane 'env' tab (see openEnvironmentsTab) so many variable rows fit —
   * the successor of the old EnvironmentsModal. Left: the list of environments
   * plus a "Globals" pseudo-entry, with add / rename / delete for
   * environments. Right: a key / value / enabled row table for the selected
   * scope, mirroring HttpParamsEditor. All edits are written back through the
   * environments store helpers; the view holds no source-of-truth state.
   */
  import {
    globals,
    environments,
    activeEnvironmentId,
    addEnvironment,
    renameEnvironment,
    deleteEnvironment,
    setEnvVars,
    setGlobalVars,
    requestConfirm,
  } from '../stores';
  import type { VarRow } from '../domain/types';

  // Which scope the right pane edits: 'globals' or an environment id.
  let selected = $state<'globals' | string>('globals');

  // Keep `selected` valid: if the chosen environment disappears (deleted), fall
  // back to Globals so the right pane never points at nothing.
  $effect(() => {
    if (selected !== 'globals' && !$environments.some((e) => e.id === selected)) {
      selected = 'globals';
    }
  });

  // The rows backing the currently-selected scope (empty for Globals sentinel).
  const rows = $derived(
    selected === 'globals'
      ? $globals
      : ($environments.find((e) => e.id === selected)?.vars ?? []),
  );

  // Table view: stored rows plus one trailing blank row to type a new var into
  // (mirrors HttpParamsEditor's `paramRows`).
  const viewRows = $derived<VarRow[]>([...rows, { key: '', value: '', enabled: true }]);

  /** Persist rows for the selected scope, trimming trailing fully-empty rows. */
  function commit(next: VarRow[]): void {
    // Drop rows that are entirely empty (no key and no value); an all-blank
    // trailing row is just the "add" affordance, not real data.
    const trimmed = next.filter((r, i) =>
      i < next.length - 1 ? true : r.key.trim() !== '' || r.value.trim() !== '',
    );
    if (selected === 'globals') setGlobalVars(trimmed);
    else setEnvVars(selected, trimmed);
  }

  function setField(i: number, field: keyof VarRow, value: string): void {
    const next = viewRows.map((r) => ({ ...r }));
    while (i >= next.length) next.push({ key: '', value: '', enabled: true });
    next[i] = { ...next[i], [field]: value };
    commit(next);
  }

  function toggleRow(i: number): void {
    const next = viewRows.map((r) => ({ ...r }));
    while (i >= next.length) next.push({ key: '', value: '', enabled: true });
    next[i] = { ...next[i], enabled: !next[i].enabled };
    commit(next);
  }

  function deleteRow(i: number): void {
    commit(viewRows.filter((_, idx) => idx !== i));
  }

  // ---- Environment list actions ----
  let editingId = $state<string | undefined>(undefined);
  let editValue = $state('');

  function addEnv(): void {
    const id = addEnvironment();
    selected = id;
    editingId = id;
    editValue = 'New Environment';
  }

  function startRename(id: string, name: string): void {
    editingId = id;
    editValue = name;
  }
  function commitRename(): void {
    const id = editingId;
    const v = editValue.trim();
    editingId = undefined;
    if (id && v) renameEnvironment(id, v);
  }
  function renameKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
    else if (e.key === 'Escape') { e.preventDefault(); editingId = undefined; }
  }

  async function removeEnv(id: string, name: string): Promise<void> {
    if (await requestConfirm(`Delete environment “${name}”? This can’t be undone.`, 'Delete')) {
      if (selected === id) selected = 'globals';
      deleteEnvironment(id);
    }
  }
</script>

<div class="bs-envview">
  <!-- Left: scope list -->
  <div class="bs-env-list">
    <button
      class="bs-env-item"
      class:on={selected === 'globals'}
      type="button"
      onclick={() => (selected = 'globals')}
    >
      <span class="material-symbols-outlined" style="font-size:16px">public</span>
      <span class="bs-env-name">Globals</span>
    </button>

    <div class="bs-env-label">Environments</div>
    {#each $environments as e (e.id)}
      <div class="bs-env-row" class:on={selected === e.id}>
        {#if editingId === e.id}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="bs-env-rename"
            autofocus
            value={editValue}
            oninput={(ev) => (editValue = ev.currentTarget.value)}
            onkeydown={renameKeydown}
            onblur={commitRename}
          />
        {:else}
          <button class="bs-env-item grow" type="button" onclick={() => (selected = e.id)} ondblclick={() => startRename(e.id, e.name)}>
            <span class="material-symbols-outlined" style="font-size:16px">layers</span>
            <span class="bs-env-name">{e.name}</span>
            {#if $activeEnvironmentId === e.id}<span class="bs-env-active">active</span>{/if}
          </button>
          <button class="bs-env-icon" title="Rename" aria-label="Rename environment" onclick={() => startRename(e.id, e.name)}>
            <span class="material-symbols-outlined" style="font-size:15px">edit</span>
          </button>
          <button class="bs-env-icon danger" title="Delete" aria-label="Delete environment" onclick={() => removeEnv(e.id, e.name)}>
            <span class="material-symbols-outlined" style="font-size:15px">delete</span>
          </button>
        {/if}
      </div>
    {/each}
    {#if $environments.length === 0}
      <div class="bs-env-empty">No environments yet.</div>
    {/if}
    <button class="bs-env-add" type="button" onclick={addEnv}>
      <span class="material-symbols-outlined" style="font-size:16px">add</span>
      New Environment
    </button>
  </div>

  <!-- Right: variable table for the selected scope -->
  <div class="bs-env-vars">
    <div class="bs-env-vars-head">
      {selected === 'globals' ? 'Global variables' : ($environments.find((e) => e.id === selected)?.name ?? '')}
    </div>
    <div class="bs-pt">
      <div class="bs-pr h">
        <div class="bs-pc c"></div>
        <div class="bs-pc k">Variable</div>
        <div class="bs-pc v">Value</div>
        <div class="bs-pc del"></div>
      </div>
      {#each viewRows as row, i (i)}
        <div class="bs-pr" class:disabled={!row.enabled}>
          <div class="bs-pc c">
            <input type="checkbox" checked={row.enabled} onchange={() => toggleRow(i)} aria-label="Enable variable" />
          </div>
          <div class="bs-pc k"><input placeholder="Variable" value={row.key} oninput={(e) => setField(i, 'key', e.currentTarget.value)} /></div>
          <div class="bs-pc v"><input placeholder="Value" value={row.value} oninput={(e) => setField(i, 'value', e.currentTarget.value)} /></div>
          <div class="bs-pc del">
            {#if i < viewRows.length - 1}
              <button class="bs-env-icon danger" title="Remove" aria-label="Remove variable" onclick={() => deleteRow(i)}>
                <span class="material-symbols-outlined" style="font-size:15px">close</span>
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
    <div class="bs-env-hint">Reference these with <code>{'{{name}}'}</code> in the URL, headers, or body.</div>
  </div>
</div>

<style>
  .bs-envview {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 0;
    overflow: hidden;
  }
  .bs-env-list {
    width: 260px;
    flex: none;
    border-right: 0.5px solid var(--sepsoft);
    padding: 12px 10px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: auto;
  }
  .bs-env-label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--t3);
    margin: 12px 8px 4px;
  }
  .bs-env-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 9px;
    border-radius: 7px;
    font-size: 13px;
    color: var(--text);
    text-align: left;
  }
  .bs-env-item.grow { flex: 1; min-width: 0; }
  .bs-env-item:hover { background: var(--hover); }
  .bs-env-item.on { background: var(--hover2); }
  .bs-env-item .material-symbols-outlined { color: var(--t2); flex: none; }
  .bs-env-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bs-env-active {
    margin-left: auto;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--accent);
  }
  .bs-env-row { display: flex; align-items: center; border-radius: 7px; }
  .bs-env-row.on { background: var(--hover2); }
  .bs-env-icon {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    color: var(--t3);
    flex: none;
  }
  .bs-env-icon:hover { background: var(--hover); color: var(--text); }
  .bs-env-icon.danger:hover { color: var(--red); }
  .bs-env-rename {
    flex: 1;
    height: 30px;
    margin: 2px 4px;
    border-radius: 6px;
    border: 2px solid var(--accent);
    background: var(--inset);
    padding: 0 8px;
    font-size: 13px;
    color: var(--text);
    outline: none;
  }
  .bs-env-empty { padding: 8px 9px; font-size: 12px; color: var(--t3); }
  .bs-env-add {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    padding: 7px 9px;
    border-radius: 7px;
    font-size: 13px;
    font-weight: 600;
    color: var(--accent);
    text-align: left;
  }
  .bs-env-add:hover { background: var(--hover); }
  .bs-env-vars { flex: 1; min-width: 0; padding: 14px 16px; overflow: auto; }
  .bs-env-vars-head { font-size: 13px; font-weight: 700; color: var(--text); margin-bottom: 10px; }
  .bs-env-vars .bs-pc.del { width: 34px; flex: none; display: flex; align-items: center; justify-content: center; padding: 0; }
  .bs-env-hint { margin-top: 10px; font-size: 11.5px; color: var(--t3); }
  .bs-env-hint code { font-family: var(--mono); color: var(--accent); }
</style>
