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
        <span class="bs-stpill" class:err={!tab.grpcResult.ok}><span class="d"></span>{tab.grpcResult.status}</span>
        <span class="mo">Time <b>{tab.grpcResult.elapsed_ms} ms</b></span>
        <span class="mo">Size <b>{formatBytes(tab.grpcResult.size_bytes)}</b></span>
        {#if grpcView?.truncated}
          <span class="bs-format-pill warn">Showing first {formatBytes(DISPLAY_CHARS)} of {formatBytes(tab.grpcResult.size_bytes)}</span>
        {/if}
        <button class="bs-ric"><span class="material-symbols-outlined" style="font-size:15px">content_copy</span></button>
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
    background: color-mix(in srgb, #30d158 22%, transparent);
    color: #248a3d;
  }
  .bs-test-badge.fail {
    background: color-mix(in srgb, #ff453a 22%, transparent);
    color: #d70015;
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
    color: #248a3d;
  }
  .bs-test-row.fail .ic {
    color: #d70015;
  }
  .bs-test-row .nm {
    font-weight: 500;
  }
  .bs-test-row .er {
    font-family: var(--mono);
    font-size: 11px;
    color: #d70015;
  }
  .bs-test-error {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #d70015;
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
</style>
