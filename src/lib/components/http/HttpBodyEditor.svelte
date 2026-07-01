<script lang="ts">
  import { filePick } from '../../api';
  import CodeEditor, { type CodeEditorLang } from '../CodeEditor.svelte';
  import { formatMarkup } from '../../domain/highlight';
  import {
    currentBodyMode,
    currentRawFormat,
  } from '../../domain/httpBody';
  import { bodyParamRows, emptyBodyParam, fileName } from '../../domain/httpHeaders';
  import {
    bodyPlaceholder,
    jsonErrorMessage,
    parseJsonForBeautify,
  } from '../../domain/jsonEditor';
  import {
    updateActiveTab,
    updateTabById,
    globals,
    environments,
    activeEnvironmentId,
  } from '../../stores';
  import { requestVariableHighlight } from '../../editor/requestVarHighlight';
  import type { BodyMode, BodyParamKind, RawBodyFormat, Tab } from '../../domain/types';

  let { tab }: { tab: Tab } = $props();

  // `{{var}}` inline highlight + hover quick-set for the body editor. Scripts
  // editors intentionally do NOT get this: `{{}}` is not resolved in scripts.
  const varHighlight = $derived(
    requestVariableHighlight($globals, $environments, $activeEnvironmentId),
  );

  let bodyError = $state('');

  const bodyModes: { key: BodyMode; label: string }[] = [
    { key: 'none', label: 'none' },
    { key: 'form-data', label: 'form-data' },
    { key: 'urlencoded', label: 'x-www-form-urlencoded' },
    { key: 'raw', label: 'raw' },
    { key: 'binary', label: 'binary' },
    { key: 'graphql', label: 'GraphQL' },
  ];
  const rawFormats: RawBodyFormat[] = ['JSON', 'Text', 'JavaScript', 'HTML', 'XML'];

  /** CodeMirror language for the current body mode / raw sub-type. */
  const bodyLang = $derived.by((): CodeEditorLang => {
    const mode = currentBodyMode(tab);
    if (mode === 'graphql') return 'javascript';
    if (mode === 'binary') return 'text';
    const format = currentRawFormat(tab);
    if (format === 'JSON') return 'json';
    if (format === 'JavaScript') return 'javascript';
    return 'text';
  });

  function setBody(value: string): void {
    bodyError = '';
    updateActiveTab((t) => ({ ...t, request: { ...t.request, body: value } }));
  }

  function setBodyMode(mode: BodyMode): void {
    bodyError = '';
    updateActiveTab((t) => {
      const nextRequest = { ...t.request, bodyMode: mode };
      if (mode === 'raw' && !nextRequest.rawBodyFormat) nextRequest.rawBodyFormat = 'JSON';
      return { ...t, request: nextRequest };
    });
  }

  function setRawFormat(format: RawBodyFormat): void {
    bodyError = '';
    updateActiveTab((t) => ({ ...t, request: { ...t.request, bodyMode: 'raw', rawBodyFormat: format } }));
  }

  function setBodyParam(i: number, field: 'key' | 'value' | 'description' | 'filePath', value: string): void {
    updateActiveTab((t) => {
      const rows = [...(t.request.bodyParams ?? [])];
      while (i >= rows.length) rows.push(emptyBodyParam());
      rows[i] = { ...emptyBodyParam(), ...rows[i], [field]: value };
      return { ...t, request: { ...t.request, bodyParams: rows } };
    });
  }

  function setBodyParamKind(i: number, kind: BodyParamKind): void {
    updateActiveTab((t) => {
      const rows = [...(t.request.bodyParams ?? [])];
      while (i >= rows.length) rows.push(emptyBodyParam());
      rows[i] = {
        ...emptyBodyParam(),
        ...rows[i],
        kind,
        filePath: kind === 'file' ? rows[i]?.filePath : undefined,
      };
      return { ...t, request: { ...t.request, bodyParams: rows } };
    });
  }

  async function pickBodyFile(i: number): Promise<void> {
    // Capture the originating tab before the (awaited) picker so the file lands
    // on this tab even if the user switches tabs while the dialog is open.
    const tabId = tab.id;
    const path = await filePick();
    if (!path) return;
    updateTabById(tabId, (t) => {
      const rows = [...(t.request.bodyParams ?? [])];
      while (i >= rows.length) rows.push(emptyBodyParam());
      rows[i] = { ...emptyBodyParam(), ...rows[i], kind: 'file', value: fileName(path), filePath: path };
      return { ...t, request: { ...t.request, bodyParams: rows } };
    });
  }

  function toggleBodyParam(i: number): void {
    updateActiveTab((t) => {
      const rows = [...(t.request.bodyParams ?? [])];
      if (rows[i]) rows[i] = { ...rows[i], enabled: !rows[i].enabled };
      return { ...t, request: { ...t.request, bodyParams: rows } };
    });
  }

  function beautifyBody(): void {
    const body = tab.request.body ?? '';
    const format = currentRawFormat(tab);
    try {
      if (format === 'JSON') setBody(JSON.stringify(parseJsonForBeautify(body), null, 2));
      else if (format === 'HTML' || format === 'XML') setBody(formatMarkup(body));
      else setBody(body);
      bodyError = '';
    } catch (e) {
      bodyError = format === 'JSON' ? jsonErrorMessage(body, e) : `${format} body is not valid.`;
    }
  }

</script>

<div class="bs-http-body">
  <div class="bs-body-toolbar">
    <div class="bs-body-mode-group" role="radiogroup" aria-label="Body type">
      {#each bodyModes as mode (mode.key)}
        <button
          class:on={currentBodyMode(tab) === mode.key}
          role="radio"
          aria-checked={currentBodyMode(tab) === mode.key}
          type="button"
          onclick={() => setBodyMode(mode.key)}
        >
          <span class="dot"></span>
          {mode.label}
        </button>
      {/each}
    </div>
    <div class="bs-body-actions">
      {#if currentBodyMode(tab) === 'raw'}
        <button class="schema" type="button" title="Schema support is not implemented yet">
          <span class="material-symbols-outlined" style="font-size:16px">tune</span>
          Schema
        </button>
        <select value={currentRawFormat(tab)} onchange={(e) => setRawFormat(e.currentTarget.value as RawBodyFormat)}>
          {#each rawFormats as format (format)}
            <option value={format}>{format}</option>
          {/each}
        </select>
        <button class="beautify" type="button" onclick={beautifyBody}>Beautify</button>
      {/if}
    </div>
  </div>

  {#if bodyError}<div class="bs-body-error">{bodyError}</div>{/if}

  {#if currentBodyMode(tab) === 'none'}
    <div class="bs-body-empty">
      <span class="material-symbols-outlined" style="font-size:34px">hide_source</span>
      <div>No request body will be sent.</div>
    </div>
  {:else if currentBodyMode(tab) === 'form-data' || currentBodyMode(tab) === 'urlencoded'}
    <div class="bs-body-kv" class:formdata={currentBodyMode(tab) === 'form-data'}>
      <div class="bs-body-kv-row h">
        <div class="c on"></div>
        <div class="c key">Key</div>
        {#if currentBodyMode(tab) === 'form-data'}<div class="c type">Type</div>{/if}
        <div class="c val">Value</div>
        <div class="c desc">Description</div>
      </div>
      {#each bodyParamRows(tab) as row, i (i)}
        <div class="bs-body-kv-row">
          <div class="c on">
            <input type="checkbox" checked={row.enabled} onchange={() => toggleBodyParam(i)} aria-label="Enable body parameter" />
          </div>
          <div class="c key"><input placeholder="Key" value={row.key} oninput={(e) => setBodyParam(i, 'key', e.currentTarget.value)} /></div>
          {#if currentBodyMode(tab) === 'form-data'}
            <div class="c type">
              <select value={row.kind ?? 'text'} onchange={(e) => setBodyParamKind(i, e.currentTarget.value as BodyParamKind)} aria-label="Body parameter type">
                <option value="text">Text</option>
                <option value="file">File</option>
              </select>
            </div>
          {/if}
          <div class="c val">
            {#if currentBodyMode(tab) === 'form-data' && (row.kind ?? 'text') === 'file'}
              <button class="bs-file-picker" type="button" onclick={() => pickBodyFile(i)}>
                <span class="material-symbols-outlined" style="font-size:15px">attach_file</span>
                <span>{fileName(row.filePath ?? row.value)}</span>
              </button>
            {:else}
              <input placeholder="Value" value={row.value} oninput={(e) => setBodyParam(i, 'value', e.currentTarget.value)} />
            {/if}
          </div>
          <div class="c desc"><input placeholder="Description" value={row.description} oninput={(e) => setBodyParam(i, 'description', e.currentTarget.value)} /></div>
        </div>
      {/each}
    </div>
  {:else}
    <div class="bs-body-cm" class:invalid={!!bodyError}>
      <CodeEditor
        value={tab.request.body ?? ''}
        onChange={setBody}
        lang={bodyLang}
        placeholder={bodyPlaceholder(tab)}
        fill
        {varHighlight}
        docId={tab.id}
        ariaLabel="Request body"
      />
    </div>
  {/if}
</div>
