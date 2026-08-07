<script lang="ts">
  /**
   * Inner content of the response panel for the active tab.
   *
   * Renders BOTH protocols from the passed `tab`:
   *  - HTTP: Body/Headers sub-tabs, pretty/raw/preview toggle, headers list,
   *    rendered body, and the empty state.
   *  - gRPC: status/time/size meta and the rendered message, plus its empty state.
   *
   * The outer `.bs-resp` wrapper, the split-resize handle, and the response
   * height live in App.svelte (resize state is App-level); this component owns
   * only the response-display state (`respTab`, `respMode`) and derives
   * everything else from `tab`.
   */
  import { buildUrl, formatBytes } from '../domain/http';
  import { presentGrpcError } from '../domain/grpcError';
  import { methodShort } from '../domain/grpc';
  import { openGrpcEditorSection } from '../grpcEditorUi';
  import { buildView, responseFormat, DISPLAY_CHARS, type ResponseView } from '../domain/responseRender';
  import { responseLineWrap } from '../stores';
  import type { Tab } from '../domain/types';

  const { tab }: { tab: Tab | undefined } = $props();

  let respTab = $state<'body' | 'headers' | 'tests'>('body');
  let respMode = $state<'pretty' | 'raw' | 'preview'>('pretty');

  const testResults = $derived(tab?.testResults);
  const passedCount = $derived(testResults?.tests.filter((t) => t.passed).length ?? 0);
  const testCount = $derived(testResults?.tests.length ?? 0);

  // If the visible sub-tab is Tests but a new response has no script output,
  // fall back to Body so the panel never shows an empty Tests view.
  $effect(() => {
    if (respTab === 'tests' && !testResults) respTab = 'body';
  });

  const STATUS_TEXT: Record<number, string> = { 200: 'OK', 201: 'Created', 204: 'No Content', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 500: 'Server Error' };
  const ok = (s: number) => s >= 200 && s < 300;

  function headerValue(headers: Record<string, string> | undefined, name: string): string {
    const lower = name.toLowerCase();
    const found = Object.entries(headers ?? {}).find(([k]) => k.toLowerCase() === lower);
    return found?.[1] ?? '';
  }

  const grpcView = $derived(
    tab?.protocol === 'grpc' && tab.grpcResult ? buildView(tab.grpcResult, 'application/json', 'pretty') : undefined,
  );
  const grpcError = $derived(
    tab?.protocol === 'grpc' && tab.grpcResult && !tab.grpcResult.ok
      ? presentGrpcError(tab.grpcResult.status, tab.grpcResult.body)
      : undefined,
  );
  const grpcErrorEndpoint = $derived(tab?.protocol === 'grpc' ? tab.grpc?.endpoint.trim() ?? '' : '');
  const grpcErrorMethod = $derived(
    tab?.protocol === 'grpc' && tab.grpc?.method ? methodShort(tab.grpc.method) : '',
  );
  const responseHeaderEntries = $derived(tab?.response ? Object.entries(tab.response.headers) : []);
  const responseContentType = $derived(tab?.response ? headerValue(tab.response.headers, 'content-type') : '');
  const responseFmt = $derived(tab?.response ? responseFormat(tab.response.body, responseContentType) : 'Text');
  const httpView = $derived(
    tab?.protocol === 'http' && tab.response && respTab === 'body' && respMode !== 'preview'
      ? buildView(tab.response, responseContentType, respMode)
      : undefined,
  );

  async function copyText(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard can be unavailable in non-Tauri browser smoke tests.
    }
  }
</script>

{#snippet codeBody(view: ResponseView)}
  <div class="bs-rbody pretty">
    {#if view.kind === 'plain'}
      <div class="bs-response-editor" class:wrap={$responseLineWrap}>
        <div class="bs-response-gutter" aria-hidden="true">
          {#each view.lines as n}
            <div>{n}</div>
          {/each}
        </div>
        <div class="bs-code">{@html view.html}</div>
      </div>
    {:else if view.kind === 'lines'}
      <div class="bs-response-editor chunked" class:wrap={$responseLineWrap}>
        {#each view.chunks as c (c.firstLine)}
          <div class="bs-resp-chunk" style="contain-intrinsic-size: auto {c.estPx}px">
            <div class="bs-response-gutter" aria-hidden="true">
              {#each c.gutter as n}<div>{n}</div>{/each}
            </div>
            <div class="bs-code">{@html c.html}</div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="bs-response-editor chunked chars">
        {#each view.chunks as c (c.offset)}
          <div class="bs-resp-cchunk" style="contain-intrinsic-size: auto {c.estPx}px">
            <div class="bs-code">{@html c.html}</div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

{#if tab?.protocol === 'grpc'}
  <div class="bs-resph">
    <span class="ttl">Response</span>
    <div class="bs-rsub">
      <button class="x" class:on={respTab === 'body'} onclick={() => (respTab = 'body')}>Body</button>
      {#if testResults}
        <button class="x" class:on={respTab === 'tests'} onclick={() => (respTab = 'tests')}>
          Tests{#if testCount > 0}<span class="bs-test-badge" class:fail={passedCount < testCount}>{passedCount}/{testCount}</span>{/if}
        </button>
      {/if}
    </div>
    {#if tab.grpcResult}
      <div class="bs-meta">
        <span class="bs-stpill" class:err={!tab.grpcResult.ok}><span class="d"></span>{grpcError?.code ?? tab.grpcResult.status}</span>
        <span class="mo">Time <b>{tab.grpcResult.elapsed_ms} ms</b></span>
        <span class="mo">Size <b>{formatBytes(tab.grpcResult.size_bytes)}</b></span>
        {#if grpcView?.truncated}
          <span class="bs-format-pill warn">Showing first {formatBytes(DISPLAY_CHARS)} of {formatBytes(tab.grpcResult.size_bytes)}</span>
        {/if}
        <button class="bs-ric" aria-label="Copy response" title="Copy response" onclick={() => copyText(tab.grpcResult?.body ?? '')}><span class="material-symbols-outlined" style="font-size:15px">content_copy</span></button>
      </div>
    {/if}
  </div>
  {#if !tab.grpcResult}
    <div class="bs-empty-resp"><span class="material-symbols-outlined" style="font-size:38px">code_blocks</span><div>Invoke a method to see the response</div></div>
  {:else if respTab === 'tests' && testResults}
    <div class="bs-rbody bs-tests">
      {#if testResults.error}
        <div class="bs-test-error"><span class="material-symbols-outlined" style="font-size:15px">error</span>Script error: {testResults.error}</div>
      {/if}
      {#if testResults.tests.length > 0}
        <div class="bs-test-list">
          {#each testResults.tests as t, i (i)}
            <div class="bs-test-row" class:fail={!t.passed}>
              <span class="material-symbols-outlined ic" style="font-size:16px">{t.passed ? 'check_circle' : 'cancel'}</span>
              <span class="nm">{t.name}</span>
              {#if !t.passed && t.error}<span class="er">{t.error}</span>{/if}
            </div>
          {/each}
        </div>
      {:else if !testResults.error}
        <div style="color:var(--t3);padding:4px 0">No assertions ran. Add <code>pm.test(...)</code> in the Scripts tab.</div>
      {/if}
      {#if testResults.logs.length > 0}
        <div class="bs-test-console">
          <div class="hd">Console</div>
          {#each testResults.logs as line, i (i)}
            <div class="ln">{line}</div>
          {/each}
        </div>
      {/if}
    </div>
  {:else if grpcError}
    <div class="bs-grpc-error-view">
      <article class="bs-grpc-error-card" class:cancelled={grpcError.code === 'CANCELLED'}>
        <div class="bs-grpc-error-icon" aria-hidden="true">
          <span class="material-symbols-outlined">{grpcError.code === 'CANCELLED' ? 'stop_circle' : 'error'}</span>
        </div>
        <div class="bs-grpc-error-content">
          <div class="bs-grpc-error-kicker">gRPC request failed</div>
          <div class="bs-grpc-error-heading">
            <h3>{grpcError.title}</h3>
            <span class="bs-grpc-error-code">{grpcError.code}</span>
          </div>
          {#if grpcErrorEndpoint || grpcErrorMethod}
            <div class="bs-grpc-error-context">
              {#if grpcErrorEndpoint}
                <span><span class="material-symbols-outlined" aria-hidden="true">dns</span>{grpcErrorEndpoint}</span>
              {/if}
              {#if grpcErrorEndpoint && grpcErrorMethod}<span class="sep">/</span>{/if}
              {#if grpcErrorMethod}
                <span><span class="material-symbols-outlined" aria-hidden="true">function</span>{grpcErrorMethod}</span>
              {/if}
            </div>
          {/if}
          <p class="bs-grpc-error-message">{grpcError.message}</p>
          <div class="bs-grpc-error-hint">
            <div class="bs-grpc-error-hint-copy">
              <span class="material-symbols-outlined" aria-hidden="true">lightbulb</span>
              <div><b>Suggested fix</b><span>{grpcError.hint}</span></div>
            </div>
            {#if grpcError.action && grpcError.actionLabel}
              <button type="button" onclick={() => openGrpcEditorSection(tab.id, grpcError.action!)}>
                {grpcError.actionLabel}
                <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
              </button>
            {/if}
          </div>
          <details class="bs-grpc-error-details">
            <summary>Technical details</summary>
            <pre>{grpcError.raw}</pre>
          </details>
        </div>
        <button class="bs-grpc-error-copy" type="button" aria-label="Copy error details" title="Copy error details" onclick={() => copyText(grpcError.raw)}>
          <span class="material-symbols-outlined">content_copy</span>
        </button>
      </article>
    </div>
  {:else if grpcView}
    {@render codeBody(grpcView)}
  {/if}
{:else if tab}
  <div class="bs-resph">
    <span class="ttl">Response</span>
    <div class="bs-rsub">
      <button class="x" class:on={respTab === 'body'} onclick={() => (respTab = 'body')}>Body</button>
      <button class="x" class:on={respTab === 'headers'} onclick={() => (respTab = 'headers')}>Headers</button>
      {#if testResults}
        <button class="x" class:on={respTab === 'tests'} onclick={() => (respTab = 'tests')}>
          Tests{#if testCount > 0}<span class="bs-test-badge" class:fail={passedCount < testCount}>{passedCount}/{testCount}</span>{/if}
        </button>
      {/if}
    </div>
    {#if tab.response}
      <div class="bs-meta">
        <span class="bs-stpill" class:err={!ok(tab.response.status)}><span class="d"></span>{tab.response.status || 'ERR'} {STATUS_TEXT[tab.response.status] ?? ''}</span>
        <span class="mo">Time <b>{tab.response.elapsed_ms} ms</b></span>
        <span class="mo">Size <b>{formatBytes(tab.response.size_bytes)}</b></span>
        {#if tab.response.body_truncated}
          <span class="bs-format-pill warn">Truncated</span>
        {/if}
        <button class="bs-ric"><span class="material-symbols-outlined" style="font-size:15px">content_copy</span></button>
      </div>
    {/if}
  </div>
  {#if !tab.response}
    <div class="bs-empty-resp"><span class="material-symbols-outlined" style="font-size:38px">code_blocks</span><div>Send a request to see the response</div></div>
  {:else if respTab === 'tests' && testResults}
    <div class="bs-rbody bs-tests">
      {#if testResults.error}
        <div class="bs-test-error"><span class="material-symbols-outlined" style="font-size:15px">error</span>Script error: {testResults.error}</div>
      {/if}
      {#if testResults.tests.length > 0}
        <div class="bs-test-list">
          {#each testResults.tests as t, i (i)}
            <div class="bs-test-row" class:fail={!t.passed}>
              <span class="material-symbols-outlined ic" style="font-size:16px">{t.passed ? 'check_circle' : 'cancel'}</span>
              <span class="nm">{t.name}</span>
              {#if !t.passed && t.error}<span class="er">{t.error}</span>{/if}
            </div>
          {/each}
        </div>
      {:else if !testResults.error}
        <div style="color:var(--t3);padding:4px 0">No assertions ran. Add <code>pm.test(...)</code> in the Scripts tab.</div>
      {/if}
      {#if testResults.logs.length > 0}
        <div class="bs-test-console">
          <div class="hd">Console</div>
          {#each testResults.logs as line, i (i)}
            <div class="ln">{line}</div>
          {/each}
        </div>
      {/if}
    </div>
  {:else if respTab === 'headers'}
    <div class="bs-rbody"><div class="bs-code">{#each responseHeaderEntries as [k, v] (k)}<div><span class="k">{k}</span>: {v}</div>{/each}{#if responseHeaderEntries.length === 0}<span style="color:var(--t3)">No response headers.</span>{/if}</div></div>
  {:else}
    <div class="bs-response-view">
      <div class="bs-response-tools">
        <div class="bs-seg">
          <button class:on={respMode === 'pretty'} onclick={() => (respMode = 'pretty')}>Pretty</button>
          <button class:on={respMode === 'raw'} onclick={() => (respMode = 'raw')}>Raw</button>
          <button class:on={respMode === 'preview'} onclick={() => (respMode = 'preview')}>Preview</button>
        </div>
        <span class="bs-format-pill">{responseFmt}</span>
        {#if tab.response.body_truncated}
          <span class="bs-format-pill warn">Body truncated</span>
        {/if}
        {#if httpView?.truncated}
          <span class="bs-format-pill warn" title="Full response kept for Copy; only the first {formatBytes(DISPLAY_CHARS)} is rendered to stay fast.">Showing first {formatBytes(DISPLAY_CHARS)} of {formatBytes(tab.response.size_bytes)}</span>
        {/if}
        {#if responseContentType}
          <span class="bs-content-type">{responseContentType}</span>
        {/if}
        {#if tab.response.final_url && tab.response.final_url !== buildUrl(tab.request.url, tab.params)}
          <span class="bs-final-url" title={tab.response.final_url}>Final URL: {tab.response.final_url}</span>
        {/if}
        <button class="bs-tool-ic" title="Copy response" onclick={() => copyText(tab.response?.body ?? '')}>
          <span class="material-symbols-outlined" style="font-size:15px">content_copy</span>
        </button>
      </div>
      {#if respMode === 'preview'}
        {#if responseFmt === 'HTML'}
          <div class="bs-preview"><iframe title="Response preview" sandbox="" srcdoc={tab.response.body}></iframe></div>
        {:else}
          <div class="bs-empty-resp"><span class="material-symbols-outlined" style="font-size:38px">preview</span><div>Preview is available for HTML responses</div></div>
        {/if}
      {:else if httpView}
        {@render codeBody(httpView)}
      {/if}
    </div>
  {/if}
{/if}

<style>
  .bs-test-badge {
    margin-left: 6px;
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--green) 14%, transparent);
    color: var(--green);
  }
  .bs-test-badge.fail {
    background: color-mix(in srgb, var(--red) 14%, transparent);
    color: var(--red);
  }
  .bs-tests {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px 14px;
    overflow: auto;
  }
  .bs-test-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .bs-test-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 5px 8px;
    border-radius: 7px;
    font-size: 12.5px;
    color: var(--text);
  }
  .bs-test-row .ic {
    align-self: center;
    color: var(--green);
  }
  .bs-test-row.fail .ic {
    color: var(--red);
  }
  .bs-test-row .nm {
    font-weight: 500;
  }
  .bs-test-row .er {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--red);
  }
  .bs-test-error {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--red);
    font-family: var(--mono);
  }
  .bs-test-console {
    border-top: 0.5px solid var(--sep);
    padding-top: 8px;
  }
  .bs-test-console .hd {
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--t3);
    margin-bottom: 4px;
  }
  .bs-test-console .ln {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--t2);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .bs-tests code {
    font-family: var(--mono);
    font-size: 11px;
    background: var(--inset);
    border-radius: 4px;
    padding: 1px 4px;
  }
  .bs-grpc-error-view {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 24px;
    background: var(--response);
  }
  .bs-grpc-error-card {
    position: relative;
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr) 30px;
    gap: 12px;
    width: min(900px, 100%);
    margin: 0 auto;
    padding: 20px;
    color: var(--text);
    background: linear-gradient(135deg, color-mix(in srgb, var(--red) 5%, var(--surface)), var(--surface) 38%);
    border: 1px solid color-mix(in srgb, var(--red) 22%, var(--sep));
    border-radius: 12px;
    box-shadow: 0 10px 28px rgba(20, 20, 24, 0.09);
    overflow: hidden;
  }
  .bs-grpc-error-card::before {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    width: 3px;
    background: var(--red);
  }
  .bs-grpc-error-card.cancelled {
    border-color: color-mix(in srgb, var(--orange) 28%, var(--sep));
  }
  .bs-grpc-error-card.cancelled::before {
    background: var(--orange);
  }
  .bs-grpc-error-icon {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--red);
    background: color-mix(in srgb, var(--red) 11%, transparent);
    border-radius: 10px;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--red) 12%, transparent);
  }
  .bs-grpc-error-card.cancelled .bs-grpc-error-icon {
    color: var(--orange);
    background: color-mix(in srgb, var(--orange) 11%, transparent);
  }
  .bs-grpc-error-icon .material-symbols-outlined { font-size: 20px; }
  .bs-grpc-error-content { min-width: 0; }
  .bs-grpc-error-kicker {
    margin-bottom: 3px;
    color: var(--t3);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .bs-grpc-error-heading {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    min-height: 28px;
  }
  .bs-grpc-error-heading h3 {
    margin: 0;
    font-size: 16px;
    line-height: 1.35;
  }
  .bs-grpc-error-code {
    padding: 2px 7px;
    color: var(--red);
    background: color-mix(in srgb, var(--red) 10%, transparent);
    border-radius: 5px;
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 700;
  }
  .bs-grpc-error-card.cancelled .bs-grpc-error-code {
    color: var(--orange);
    background: color-mix(in srgb, var(--orange) 10%, transparent);
  }
  .bs-grpc-error-message {
    margin: 9px 0 14px;
    color: var(--t2);
    font-size: 13.5px;
    line-height: 1.55;
    overflow-wrap: anywhere;
  }
  .bs-grpc-error-context {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 7px;
    margin-top: 8px;
    color: var(--t3);
    font-family: var(--mono);
    font-size: 11px;
  }
  .bs-grpc-error-context > span:not(.sep) {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }
  .bs-grpc-error-context .material-symbols-outlined { font-size: 13px; }
  .bs-grpc-error-context .sep { color: var(--sep); }
  .bs-grpc-error-hint {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 11px 12px;
    color: var(--t2);
    background: var(--inset);
    border-radius: 7px;
    font-size: 12px;
    line-height: 1.45;
  }
  .bs-grpc-error-hint-copy {
    min-width: 0;
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  .bs-grpc-error-hint-copy > .material-symbols-outlined {
    flex: none;
    margin-top: 1px;
    color: var(--accent);
    font-size: 15px;
  }
  .bs-grpc-error-hint-copy div { min-width: 0; }
  .bs-grpc-error-hint-copy b {
    display: block;
    margin-bottom: 2px;
    color: var(--text);
    font-size: 11px;
  }
  .bs-grpc-error-hint-copy span:last-child { display: block; }
  .bs-grpc-error-hint > button {
    height: 30px;
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
    color: #fff;
    background: var(--accent);
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 650;
  }
  .bs-grpc-error-hint > button:hover { background: var(--accent-press); }
  .bs-grpc-error-hint > button .material-symbols-outlined { font-size: 14px; }
  .bs-grpc-error-details { margin-top: 11px; }
  .bs-grpc-error-details summary {
    width: max-content;
    color: var(--t3);
    font-size: 11.5px;
    cursor: pointer;
  }
  .bs-grpc-error-details[open] summary { color: var(--text); }
  .bs-grpc-error-details pre {
    margin: 9px 0 0;
    padding: 10px;
    overflow: auto;
    color: var(--t2);
    background: var(--canvas);
    border: 1px solid var(--sepsoft);
    border-radius: 6px;
    font-family: var(--mono);
    font-size: 11.5px;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .bs-grpc-error-copy {
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--t3);
    border-radius: 6px;
  }
  .bs-grpc-error-copy:hover { color: var(--text); background: var(--hover); }
  .bs-grpc-error-copy .material-symbols-outlined { font-size: 16px; }
  @media (max-width: 720px) {
    .bs-grpc-error-view { padding: 12px; }
    .bs-grpc-error-card { grid-template-columns: 30px minmax(0, 1fr); padding: 13px; }
    .bs-grpc-error-copy { display: none; }
    .bs-grpc-error-hint { align-items: stretch; flex-direction: column; }
    .bs-grpc-error-hint > button { width: max-content; }
  }
</style>
