<script lang="ts">
  import { t, tp } from '$shared/i18n';
  import { filePick } from '$shared/ipc';
  import { CodeEditor, type CodeEditorLang } from '$shared/editor/components';
  import {
    formatMarkup,
    bodyPlaceholder,
    jsonErrorMessage,
    parseJsonForBeautify,
    isLargeBody,
    jsonProblem,
  } from '$shared/editor';
  import {
    currentBodyMode,
    currentRawFormat,
    type BodyMode,
    type BodyParamKind,
    type RawBodyFormat,
    type Tab,
  } from '$shared/model';
  import { bodyParamRows, emptyBodyParam, fileName } from './httpHeaders';
  import { updateActiveTab, updateTabById } from '$entities/tab';
  import { globals, environments, activeEnvironmentId, requestVariableHighlight } from '$entities/environment';

  let { tab }: { tab: Tab } = $props();

  // `{{var}}` inline highlight + hover quick-set for the body editor. Scripts
  // editors intentionally do NOT get this: `{{}}` is not resolved in scripts.
  const varHighlight = $derived(requestVariableHighlight($globals, $environments, $activeEnvironmentId));

  let bodyError = $state('');

  // S10: four body kinds, as in Postman; Form keeps both encodings and Raw keeps its formats (JSON first, GraphQL too) one level down.
  type Segment = 'none' | 'form' | 'raw' | 'binary';
  const segments: { key: Segment; label: string }[] = [
    { key: 'none', label: 'http.body.none' },
    { key: 'form', label: 'http.body.form' },
    { key: 'raw', label: 'http.body.raw' },
    { key: 'binary', label: 'http.body.binary' },
  ];
  const CONTENT_TYPE: Record<string, string> = {
    JSON: 'application/json',
    Text: 'text/plain',
    JavaScript: 'application/javascript',
    HTML: 'text/html',
    XML: 'application/xml',
  };
  const segment = $derived.by((): Segment => {
    const mode = currentBodyMode(tab);
    if (mode === 'none') return 'none';
    if (mode === 'form-data' || mode === 'urlencoded') return 'form';
    if (mode === 'binary') return 'binary';
    return 'raw';
  });
  const bodyInfo = $derived.by(() => {
    const mode = currentBodyMode(tab);
    const n = (count: number) => `  ·  ${count} ${tp(count, ['поле', 'поля', 'полей'], ['field', 'fields'])}`;
    if (mode === 'form-data' || mode === 'urlencoded')
      return `${mode === 'form-data' ? 'multipart/form-data' : 'application/x-www-form-urlencoded'}${n((tab.request.bodyParams ?? []).filter((p) => p.key).length)}`;
    if (mode === 'graphql') return 'application/json  ·  graphql';
    if (mode !== 'raw') return mode === 'binary' ? 'application/octet-stream' : '';
    const format = currentRawFormat(tab);
    if (format !== 'JSON') return CONTENT_TYPE[format] ?? '';
    try {
      const parsed = JSON.parse(tab.request.body ?? '');
      return `application/json${parsed && typeof parsed === 'object' ? n(Object.keys(parsed).length) : ''}`;
    } catch {
      return 'application/json';
    }
  });
  const canBeautify = $derived(
    currentBodyMode(tab) === 'raw' && ['JSON', 'HTML', 'XML'].includes(currentRawFormat(tab)),
  );
  // E1: a large text body loses this head — format, size, lines and tools move into the request tabs row.
  const large = $derived(
    (currentBodyMode(tab) === 'raw' || currentBodyMode(tab) === 'binary') && isLargeBody(tab.request.body ?? ''),
  );
  // S10: live syntax check, flagged next to the content type (the editor underlines the spot).
  const bodyInvalid = $derived(
    !large &&
      currentBodyMode(tab) === 'raw' &&
      currentRawFormat(tab) === 'JSON' &&
      !!jsonProblem(tab.request.body ?? ''),
  );

  function pickSegment(key: Segment): void {
    const mode = currentBodyMode(tab);
    if (key === segment) return; // keeps GraphQL when Raw is clicked again
    if (key === 'none' || key === 'binary' || key === 'raw') setBodyMode(key);
    else setBodyMode(mode === 'urlencoded' ? 'urlencoded' : 'form-data');
  }

  function pickRawFormat(value: string): void {
    if (value === 'GraphQL') setBodyMode('graphql');
    else setRawFormat(value as RawBodyFormat);
  }

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

  function setGraphqlVariables(value: string): void {
    updateActiveTab((t) => ({ ...t, request: { ...t.request, graphqlVariables: value } }));
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

  async function pickBinaryFile(): Promise<void> {
    const tabId = tab.id;
    const path = await filePick();
    if (!path) return;
    updateTabById(tabId, (t) => ({
      ...t,
      request: { ...t.request, bodyMode: 'binary', binaryFilePath: path },
    }));
  }

  function clearBinaryFile(): void {
    updateActiveTab((t) => ({
      ...t,
      request: { ...t.request, binaryFilePath: undefined },
    }));
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
      bodyError = format === 'JSON' ? jsonErrorMessage(body, e) : t('http.body.invalid', { format });
    }
  }
</script>

<div class="bs-http-body">
  {#if !large}
    <div class="bs-body-head">
      <div class="bs-body-seg" role="radiogroup" aria-label={t('http.body.type_aria')}>
        {#each segments as seg (seg.key)}
          <button
            class:on={segment === seg.key}
            role="radio"
            aria-checked={segment === seg.key}
            type="button"
            onclick={() => pickSegment(seg.key)}>{t(seg.label)}</button
          >
        {/each}
      </div>
      {#if segment === 'form'}
        <div class="bs-body-seg sub" role="radiogroup" aria-label={t('http.body.enc_aria')}>
          <button
            class:on={currentBodyMode(tab) === 'form-data'}
            role="radio"
            aria-checked={currentBodyMode(tab) === 'form-data'}
            type="button"
            onclick={() => setBodyMode('form-data')}>multipart</button
          >
          <button
            class:on={currentBodyMode(tab) === 'urlencoded'}
            role="radio"
            aria-checked={currentBodyMode(tab) === 'urlencoded'}
            type="button"
            onclick={() => setBodyMode('urlencoded')}>urlencoded</button
          >
        </div>
      {:else if segment === 'raw'}
        <span class="bs-body-format">
          <select
            aria-label={t('http.body.raw_format_aria')}
            value={currentBodyMode(tab) === 'graphql' ? 'GraphQL' : currentRawFormat(tab)}
            onchange={(e) => pickRawFormat(e.currentTarget.value)}
          >
            {#each ['JSON', 'Text', 'JavaScript', 'HTML', 'XML', 'GraphQL'] as format (format)}<option value={format}
                >{format === 'Text' ? t('http.body.text') : format}</option
              >{/each}
          </select>
          <span class="material-symbols-outlined" aria-hidden="true">keyboard_arrow_down</span>
        </span>
      {/if}
      <span class="bs-body-info"
        >{bodyInfo}{#if bodyInvalid}<b class="lb-bad">{'  ·  '}{t('lb.json.invalid')}</b>{/if}</span
      >
      {#if canBeautify}
        <button class="bs-body-beautify" type="button" onclick={beautifyBody}
          ><span class="material-symbols-outlined" aria-hidden="true">format_align_left</span>{t(
            'http.body.beautify',
          )}</button
        >
      {/if}
    </div>
  {/if}

  {#if bodyError}<div class="bs-body-error">{bodyError}</div>{/if}

  {#if currentBodyMode(tab) === 'none'}
    <div class="bs-body-empty">
      <span class="material-symbols-outlined" style="font-size:34px">hide_source</span>
      <div>{t('http.body.empty')}</div>
    </div>
  {:else if currentBodyMode(tab) === 'form-data' || currentBodyMode(tab) === 'urlencoded'}
    <div class="bs-body-kv" class:formdata={currentBodyMode(tab) === 'form-data'}>
      <div class="bs-body-kv-row h">
        <div class="c on"></div>
        <div class="c key">{t('http.col.key')}</div>
        {#if currentBodyMode(tab) === 'form-data'}<div class="c type">{t('http.body.type')}</div>{/if}
        <div class="c val">{t('http.col.value')}</div>
        <div class="c desc">{t('http.col.description')}</div>
      </div>
      {#each bodyParamRows(tab) as row, i (i)}
        <div class="bs-body-kv-row">
          <div class="c on">
            <input
              type="checkbox"
              checked={row.enabled}
              onchange={() => toggleBodyParam(i)}
              aria-label={t('http.body.enable_param')}
            />
          </div>
          <div class="c key">
            <input
              placeholder={t('http.col.key')}
              value={row.key}
              oninput={(e) => setBodyParam(i, 'key', e.currentTarget.value)}
            />
          </div>
          {#if currentBodyMode(tab) === 'form-data'}
            <div class="c type">
              <select
                value={row.kind ?? 'text'}
                onchange={(e) => setBodyParamKind(i, e.currentTarget.value as BodyParamKind)}
                aria-label={t('http.body.param_type_aria')}
              >
                <option value="text">{t('http.body.kind.text')}</option>
                <option value="file">{t('http.body.kind.file')}</option>
              </select>
            </div>
          {/if}
          <div class="c val">
            {#if currentBodyMode(tab) === 'form-data' && (row.kind ?? 'text') === 'file'}
              <button class="bs-file-picker" type="button" onclick={() => pickBodyFile(i)}>
                <span class="material-symbols-outlined" style="font-size:15px">attach_file</span>
                <span>{fileName(row.filePath ?? row.value, t)}</span>
              </button>
            {:else}
              <input
                placeholder={t('http.col.value')}
                value={row.value}
                oninput={(e) => setBodyParam(i, 'value', e.currentTarget.value)}
              />
            {/if}
          </div>
          <div class="c desc">
            <input
              placeholder={t('http.col.description')}
              value={row.description}
              oninput={(e) => setBodyParam(i, 'description', e.currentTarget.value)}
            />
          </div>
        </div>
      {/each}
    </div>
  {:else if currentBodyMode(tab) === 'binary' && tab.request.binaryFilePath}
    <div class="bs-binary-file">
      <span class="material-symbols-outlined" aria-hidden="true">description</span>
      <div class="bs-binary-file-details">
        <b>{fileName(tab.request.binaryFilePath)}</b>
        <span title={tab.request.binaryFilePath}>{tab.request.binaryFilePath}</span>
      </div>
      <button type="button" onclick={pickBinaryFile}>{t('http.body.choose_other')}</button>
      <button
        type="button"
        aria-label={t('http.body.remove_file')}
        title={t('http.body.remove_file')}
        onclick={clearBinaryFile}
      >
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </div>
  {:else if currentBodyMode(tab) === 'graphql'}
    <div class="bs-graphql-editors">
      <section class="bs-graphql-panel">
        <div class="bs-graphql-label">{t('http.body.gql_query')}</div>
        <div class="bs-body-cm" class:invalid={!!bodyError}>
          <CodeEditor
            value={tab.request.body ?? ''}
            onChange={setBody}
            lang="javascript"
            placeholder={bodyPlaceholder(tab, t)}
            fill
            {varHighlight}
            docId={`${tab.id}:graphql-query`}
            ariaLabel={t('http.body.gql_query_aria')}
          />
        </div>
      </section>
      <section class="bs-graphql-panel">
        <div class="bs-graphql-label">{t('http.body.gql_vars')}</div>
        <div class="bs-body-cm">
          <CodeEditor
            value={tab.request.graphqlVariables ?? ''}
            onChange={setGraphqlVariables}
            lang="json"
            placeholder={'{\n  "id": "1"\n}'}
            fill
            {varHighlight}
            docId={`${tab.id}:graphql-variables`}
            ariaLabel={t('http.body.gql_vars_aria')}
          />
        </div>
      </section>
    </div>
  {:else}
    {#if currentBodyMode(tab) === 'binary'}
      <div class="bs-binary-picker">
        <button type="button" onclick={pickBinaryFile}
          ><span class="material-symbols-outlined" aria-hidden="true">attach_file</span>
          {t('http.body.select_file')}</button
        >
        <span>{t('http.body.or_text')}</span>
      </div>
    {/if}
    <div class="bs-body-cm" class:invalid={!!bodyError}>
      <CodeEditor
        value={tab.request.body ?? ''}
        onChange={setBody}
        lang={bodyLang}
        placeholder={bodyPlaceholder(tab, t)}
        minHeight="120px"
        {varHighlight}
        lintJson
        autoFold
        docId={tab.id}
        ariaLabel={t('http.body.aria')}
      />
    </div>
  {/if}
</div>

<style>
  .bs-graphql-editors {
    display: flex;
    flex: 1;
    min-height: 0;
    flex-direction: column;
  }
  .bs-graphql-panel {
    display: flex;
    flex: 1;
    min-height: 140px;
    flex-direction: column;
  }
  .bs-graphql-panel + .bs-graphql-panel {
    border-top: 1px solid var(--sepsoft);
  }
  .bs-graphql-label {
    padding: 10px 16px 0;
    color: var(--t2);
    font-size: 12px;
    font-weight: 650;
  }
  .bs-binary-picker {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--sepsoft);
    color: var(--t3);
    font-size: 11px;
  }
  .bs-binary-picker button,
  .bs-binary-file button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 9px;
    border: 1px solid var(--sep) !important;
    border-radius: 5px;
    background: var(--surface) !important;
    color: var(--text) !important;
    white-space: nowrap;
  }
  .bs-binary-picker button:hover,
  .bs-binary-file button:hover {
    background: var(--hover) !important;
  }
  .bs-binary-picker .material-symbols-outlined {
    font-size: 15px;
  }
  .bs-binary-file {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    margin: 14px 16px;
    padding: 12px;
    border: 1px solid var(--sep);
    border-radius: 6px;
    background: var(--surface);
  }
  .bs-binary-file > .material-symbols-outlined {
    color: var(--accent);
    font-size: 22px;
  }
  .bs-binary-file-details {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    gap: 3px;
  }
  .bs-binary-file-details b,
  .bs-binary-file-details span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bs-binary-file-details span {
    color: var(--t3);
    font-size: 11px;
  }
  .bs-binary-file button .material-symbols-outlined {
    font-size: 15px;
  }
</style>
