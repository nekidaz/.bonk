<!--
  HTTP request → Body tab: the body mode (none, form-data, urlencoded, raw, binary, GraphQL) and its
  editor — a key/value table for forms, CodeMirror (shared/editor CodeEditor) for raw text and GraphQL.
-->
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
    unknownDynamicCount,
  } from '$shared/model';
  import { bodyParamRows, emptyBodyParam, fileName } from './httpHeaders';
  import { tabs } from '$entities/tab';
  import { environments, requestVariableHighlight } from '$entities/environment';
  import { BodyPanel, BodyCode, BeautifyButton, BodyHead } from '$entities/request/components';
  import GraphqlBody from './GraphqlBody.svelte';

  let { tab }: { tab: Tab } = $props();

  // DV6: `{{$typo}}` goes out as text — say so above the editor.
  const unknownDynamic = $derived(unknownDynamicCount(tab.request.body ?? ''));

  // `{{var}}` inline highlight + hover quick-set for the body editor. Scripts
  // editors intentionally do NOT get this: `{{}}` is not resolved in scripts.
  const varHighlight = $derived(
    requestVariableHighlight(environments.globals, environments.list, environments.activeId),
  );

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
    const n = (count: number) => `  ·  ${count} ${tp(count, ['field', 'fields'])}`;
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
    if (mode === 'binary') return 'text';
    const format = currentRawFormat(tab);
    if (format === 'JSON') return 'json';
    if (format === 'JavaScript') return 'javascript';
    return 'text';
  });

  function setBody(value: string): void {
    bodyError = '';
    tabs.updateActive((t) => ({ ...t, request: { ...t.request, body: value } }));
  }

  function setBodyMode(mode: BodyMode): void {
    bodyError = '';
    tabs.updateActive((t) => {
      const nextRequest = { ...t.request, bodyMode: mode };
      if (mode === 'raw' && !nextRequest.rawBodyFormat) nextRequest.rawBodyFormat = 'JSON';
      return { ...t, request: nextRequest };
    });
  }

  function setRawFormat(format: RawBodyFormat): void {
    bodyError = '';
    tabs.updateActive((t) => ({ ...t, request: { ...t.request, bodyMode: 'raw', rawBodyFormat: format } }));
  }

  function setBodyParam(i: number, field: 'key' | 'value' | 'description' | 'filePath', value: string): void {
    tabs.updateActive((t) => {
      const rows = [...(t.request.bodyParams ?? [])];
      while (i >= rows.length) rows.push(emptyBodyParam());
      rows[i] = { ...emptyBodyParam(), ...rows[i], [field]: value };
      return { ...t, request: { ...t.request, bodyParams: rows } };
    });
  }

  function setBodyParamKind(i: number, kind: BodyParamKind): void {
    tabs.updateActive((t) => {
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
    tabs.updateById(tabId, (t) => {
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
    tabs.updateById(tabId, (t) => ({
      ...t,
      request: { ...t.request, bodyMode: 'binary', binaryFilePath: path },
    }));
  }

  function clearBinaryFile(): void {
    tabs.updateActive((t) => ({
      ...t,
      request: { ...t.request, binaryFilePath: undefined },
    }));
  }

  function toggleBodyParam(i: number): void {
    tabs.updateActive((t) => {
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

<BodyPanel>
  {#if !large}
    <BodyHead>
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
        <BeautifyButton type="button" onclick={beautifyBody}
          ><span class="material-symbols-outlined" aria-hidden="true">format_align_left</span>{t(
            'http.body.beautify',
          )}</BeautifyButton
        >
      {/if}
      {#if unknownDynamic}
        <span class="dyn-bad"
          ><span class="material-symbols-outlined" aria-hidden="true">error</span>{`${unknownDynamic} ${tp(
            unknownDynamic,
            ['unknown variable', 'unknown variables'],
          )}`}</span
        >
      {/if}
    </BodyHead>
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
    <GraphqlBody {tab} {varHighlight} />
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
    <BodyCode class={{ invalid: !!bodyError }}>
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
    </BodyCode>
  {/if}
</BodyPanel>

<style>
  .bs-body-kv-row:not(.h):hover {
    background: var(--hover2);
  }

  :global(.bs) .bs-body-format :global(.material-symbols-outlined) {
    position: absolute;
    right: 8px;
    top: 7px;
    font-size: 16px;
    color: var(--color-text-muted);
    pointer-events: none;
  }

  .bs-body-kv-row {
    display: grid;
    grid-template-columns: 44px minmax(150px, 0.9fr) minmax(160px, 1.2fr) minmax(160px, 1fr);
    min-height: 40px;
    border-bottom: 0.5px solid var(--sepsoft);
    contain: paint;
  }

  .bs-body-error {
    padding: 8px 18px;
    border-bottom: 0.5px solid var(--sepsoft);
    color: var(--red);
    font-family: var(--mono);
    font-size: 12px;
    background: color-mix(in srgb, var(--red) 9%, transparent);
  }

  .bs-body-empty {
    flex: 1;
    min-height: 260px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--t2);
    background: radial-gradient(460px 240px at 50% 34%, rgba(10, 132, 255, 0.075), transparent 70%);
  }

  .bs-body-empty :global(.material-symbols-outlined) {
    width: 46px;
    height: 46px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 13px;
    background: color-mix(in srgb, var(--surface) 72%, transparent);
    border: 0.5px solid var(--sep);
    box-shadow: var(--shadow-sm);
  }

  .bs-body-empty :global(div) {
    font-size: 13px;
  }

  .bs-body-kv.formdata .bs-body-kv-row {
    grid-template-columns: 44px minmax(130px, 0.75fr) 112px minmax(180px, 1.15fr) minmax(150px, 0.9fr);
  }

  .bs-body-kv-row:last-child {
    border-bottom: 0;
  }

  :where(.bs-body-kv-row).h {
    min-height: 38px;
    background: color-mix(in srgb, var(--surface) 72%, var(--hover2));
    color: var(--t2);
    font-size: 11.5px;
    font-weight: 650;
  }

  .bs-body-kv-row :global(.c) {
    min-width: 0;
    display: flex;
    align-items: center;
    padding: 0 14px;
    border-right: 0.5px solid var(--sepsoft);
  }

  .bs-body-kv-row :global(.c:last-child) {
    border-right: 0;
  }

  .bs-body-kv-row :global(.c.on) {
    justify-content: center;
    padding: 0;
  }

  .bs-body-kv-row :global(input[type='checkbox']) {
    width: 15px;
    height: 15px;
    border-radius: 4px;
    accent-color: var(--accent);
  }

  .bs-body-kv-row :global(input:not([type='checkbox'])) {
    width: 100%;
    min-width: 0;
    background: transparent;
    border: 0;
    outline: 0;
    color: var(--text);
    font: inherit;
    font-family: var(--mono);
    font-size: 12.5px;
  }

  .bs-body-kv-row :global(select) {
    width: 100%;
    height: 28px;
    padding: 0 26px 0 9px;
    appearance: none;
    border: 0.5px solid var(--sep);
    border-radius: 7px;
    color: var(--text);
    font-family: inherit;
    font-size: 12px;
    background:
      linear-gradient(45deg, transparent 50%, var(--t2) 50%) right 12px center / 5px 5px no-repeat,
      linear-gradient(135deg, var(--t2) 50%, transparent 50%) right 7px center / 5px 5px no-repeat,
      color-mix(in srgb, var(--surface) 76%, transparent);
    outline: none;
  }

  .bs-body-kv-row :global(select:focus) {
    border-color: rgba(10, 132, 255, 0.58);
    box-shadow: var(--focus-ring);
  }

  .bs-file-picker {
    width: 100%;
    min-width: 0;
    height: 28px;
    padding: 0 10px;
    border-radius: 7px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 0.5px solid var(--sep);
    background: color-mix(in srgb, var(--surface) 76%, transparent);
    color: var(--text);
    font-family: var(--mono);
    font-size: 12px;
    box-shadow: var(--shadow-sm);
  }

  .bs-file-picker:hover {
    border-color: color-mix(in srgb, var(--accent) 42%, var(--sep));
    background: var(--hover2);
  }

  .bs-file-picker :global(span:last-child) {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bs-body-kv-row :global(input::placeholder) {
    color: var(--t3);
  }

  .bs-body-kv-row :global(.desc input) {
    font-family: inherit;
  }

  @media (max-width: 980px) {
    .bs-body-kv-row {
      grid-template-columns: 38px minmax(120px, 1fr) minmax(120px, 1fr);
    }

    .bs-body-kv.formdata .bs-body-kv-row {
      grid-template-columns: 38px minmax(100px, 0.8fr) 92px minmax(130px, 1fr);
    }

    .bs-body-kv-row :global(.desc) {
      display: none;
    }
  }

  .bs-body-kv {
    margin: 18px;
    border: 0.5px solid var(--sep);
    overflow: hidden;
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    border-radius: var(--radius-card);
  }

  :global([data-theme] .bs) .bs-body-empty {
    background: var(--canvas);
  }

  :global([data-theme] .bs) .bs-body-kv-row :global(select:focus) {
    border-color: var(--accent);
  }

  :global(.bs) .bs-body-seg {
    display: inline-flex;
    height: 30px;
    padding: 2px;
    gap: 2px;
    outline: 1px solid var(--color-border-subtle);
    outline-offset: -1px;
    border-radius: var(--radius-control);
    background: var(--color-field);
  }

  :global(.bs) .bs-body-seg :global(button) {
    height: 24px;
    margin: 1px 0;
    padding: 0 12px;
    border-radius: var(--radius-control);
    color: var(--color-text-secondary);
    font: 500 var(--font-size-caption) var(--font-ui);
  }

  :global(.bs) .bs-body-seg :global(button:hover) {
    color: var(--color-text);
  }

  :global(.bs) .bs-body-seg :global(button.on) {
    background: var(--color-raised);
    color: var(--color-text);
    font-weight: 600;
  }

  :global(.bs) .bs-body-format {
    position: relative;
  }

  :global(.bs) .bs-body-format :global(select) {
    appearance: none;
    -webkit-appearance: none;
    height: 30px;
    padding: 0 30px 0 12px;
    border: 0;
    outline: 1px solid var(--color-border-subtle);
    outline-offset: -1px;
    border-radius: var(--radius-control);
    background: var(--color-field);
    color: var(--color-text-secondary);
    font: 500 var(--font-size-caption) var(--font-ui);
    cursor: pointer;
  }

  :global(.bs) .bs-body-info {
    margin-left: auto;
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro) var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
    white-space: pre;
  }

  :global(.bs .bs-http-body) .bs-body-kv {
    border: 0;
    outline: 1px solid var(--color-border-subtle);
    outline-offset: -1px;
    border-radius: var(--radius-card);
    background: var(--color-field);
    overflow: hidden;
  }

  .bs-body-info .lb-bad {
    color: var(--color-danger);
    font-weight: 500;
  }

  .dyn-bad {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex: none;
    padding: 3px 10px;
    border-radius: 999px;
    background: var(--color-danger-soft);
    color: var(--color-danger);
    font-size: 11px;
  }
  .dyn-bad .material-symbols-outlined {
    font-size: 13px;
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
    border: 1px solid var(--sep);
    border-radius: 5px;
    background: var(--surface);
    color: var(--text);
    white-space: nowrap;
  }
  .bs-binary-picker button:hover,
  .bs-binary-file button:hover {
    background: var(--hover);
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
