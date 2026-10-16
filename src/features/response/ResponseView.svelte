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
   * height live in app/layout.svelte.ts (resize state is App-level); this component owns
   * only the response-display state (`respTab`, `respMode`) and derives
   * everything else from `tab`.
   */
  import { t, tp } from '$shared/i18n';
  import {
    formatBytes,
    GRPC_CODES,
    grpcStatusLabel,
    HTTP_STATUS_TEXT,
    inputNamesOf,
    type Tab,
    type TabTestResults,
  } from '$shared/model';
  import { inputPrompts, inputs } from '$entities/input';
  import { presentEditorError, presentGrpcError, grpcErrorNote, type EditorErrorPresentation } from './grpcError';
  import {
    methodShort,
    grpcCodeTone,
    dialFailureReason,
    isGrpcConnectionCode,
    isGrpcNoServicesHint,
    openGrpcEditorSection,
    requestGrpcEditorAction,
    requestRuntime,
    revealScriptLine,
    sendHttpTab,
  } from '$entities/request';
  import { environments, openEnvironmentsTab } from '$entities/environment';
  import { responseFormat } from './responseRender';
  import { requestPrefs } from '$shared/settings';
  import { tabs } from '$entities/tab';
  import ResponseBody, { type BodyInfo } from './ResponseBody.svelte';
  import ResponseCookies from './ResponseCookies.svelte';
  import ResponseHeaders from './ResponseHeaders.svelte';
  import SentRequest from './SentRequest.svelte';
  import { EditorTools, ScriptConsole, ScriptTests } from '$shared/editor/components';
  import { consoleRows, countLabel } from '$shared/editor';
  import { focusMode, toggleFocus, tablist } from '$shared/ui';
  import { responseFileName, saveResponseBody } from './saveResponse';
  import type { Snippet } from 'svelte';
  import { isCancelled, isTimeout, responseTone } from './responseHint';
  import StreamFeed from './StreamFeed.svelte';
  import { formatCount, streamCount } from './streamFeed';
  import { Segmented, StatusPill, IconButton } from '$shared/ui/components';
  import { TabCount, BeautifyButton } from '$entities/request/components';
  import RespBody from './RespBody.svelte';
  import CodeBlock from './CodeBlock.svelte';

  const { tab, onSettings = () => {} }: { tab: Tab | undefined; onSettings?: () => void } = $props();

  let respTab = $state<'body' | 'headers' | 'trailers' | 'cookies' | 'timeline' | 'tests' | 'console' | 'visualize'>(
    'body',
  );
  let respMode = $state<'pretty' | 'raw' | 'preview'>(requestPrefs.responsePrettyDefault.current ? 'pretty' : 'raw');
  /** gRPC responses get the same Pretty / Raw switch (E5). */
  let grpcMode = $state<'pretty' | 'raw'>(requestPrefs.responsePrettyDefault.current ? 'pretty' : 'raw');
  let bodyInfo = $state<BodyInfo | undefined>(undefined);

  // In-flight request for this tab: drives the "Sending…" meta and the live timer (S04).
  const busy = $derived(tab ? requestRuntime.busy[tab.id] : undefined);
  const sending = $derived(!!busy && busy.kind !== 'connect');
  // «Ask on send» variables the request uses: the empty state says Send will ask, and waits while it does.
  const askNames = $derived(
    tab
      ? inputNamesOf(tab.protocol === 'grpc' ? tab.grpc : { request: tab.request, params: tab.params }, inputs.defs)
      : [],
  );
  const waitingForInput = $derived(busy?.requestId ? inputPrompts.byRequest[busy.requestId] : undefined);
  const tone = $derived(tab?.response ? responseTone(tab.response) : 'success');
  let now = $state(Date.now());
  $effect(() => {
    if (!sending) return;
    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), 100);
    return () => clearInterval(timer);
  });

  const testResults = $derived(tab?.testResults);
  const passedCount = $derived(testResults?.tests.filter((t) => t.passed).length ?? 0);
  const testCount = $derived(testResults?.tests.length ?? 0);

  // If the visible sub-tab is Tests / Console but a new response has no script output,
  // fall back to Body so the panel never shows an empty view.
  $effect(() => {
    if ((respTab === 'tests' || respTab === 'console') && !testResults) respTab = 'body';
    if (respTab === 'visualize' && !testResults?.visualizer) respTab = 'body';
  });
  /** SC6: the pre-request script threw, so nothing was sent. */
  const preFailed = $derived(
    testResults?.errorPhase === 'pre' &&
      (tab?.protocol === 'grpc' ? !tab.grpcResult : !!tab?.response && tab.response.status === 0),
  );
  /** SC4: the last value each variable got from the scripts, for “The script updated the environment”. */
  const varWrites = $derived.by(() => {
    const last = new Map<string, { key: string; value: string; globals: boolean }>();
    for (const e of testResults?.events ?? [])
      if ((e.kind === 'env' || e.kind === 'glob') && e.op === 'set' && e.key)
        last.set(`${e.kind}:${e.key}`, { key: e.key, value: e.value ?? '', globals: e.kind === 'glob' });
    return [...last.values()];
  });

  const STATUS_TEXT = HTTP_STATUS_TEXT;
  // Mono: status reads without colour — glyph + code + text, falling back to the status class.
  const STATUS_CLASS: Record<number, string> = {
    1: 'response.status.info',
    2: 'response.status.success',
    3: 'response.status.redirect',
    4: 'response.status.client',
    5: 'response.status.server',
  };
  const statusText = (s: number) => STATUS_TEXT[s] ?? t(STATUS_CLASS[Math.floor(s / 100)] ?? 'response.status.network');
  const ok = (s: number) => s >= 200 && s < 300;
  function headerValue(headers: Record<string, string> | undefined, name: string): string {
    const lower = name.toLowerCase();
    const found = Object.entries(headers ?? {}).find(([k]) => k.toLowerCase() === lower);
    return found?.[1] ?? '';
  }

  /** The unary result body shown in the viewer (not for errors, empty bodies, or a stream's feed). */
  const grpcBody = $derived(
    tab?.protocol === 'grpc' && tab.grpcResult?.ok && tab.grpcResult.body ? tab.grpcResult : undefined,
  );
  const grpcError = $derived(
    tab?.protocol === 'grpc' && tab.grpcResult && !tab.grpcResult.ok
      ? presentGrpcError(tab.grpcResult.status, tab.grpcResult.body)
      : undefined,
  );
  const grpcErrorEndpoint = $derived(tab?.protocol === 'grpc' ? (tab.grpc?.endpoint.trim() ?? '') : '');
  const grpcCode = $derived(tab?.grpcResult?.ok ? 'OK' : (grpcError?.code ?? tab?.grpcResult?.status ?? ''));
  const grpcCodeNum = $derived(GRPC_CODES.indexOf(grpcCode));
  const grpcTone = $derived(tab?.grpcResult?.ok ? 'success' : grpcCodeTone(grpcCode));
  /** S25: the call never reached the server — a dedicated "unreachable" state. */
  const grpcUnreachable = $derived(grpcCode === 'UNAVAILABLE' && !tab?.grpcStream?.messages.length);
  /** No reply ever came (14 UNAVAILABLE / 4 DEADLINE_EXCEEDED, nothing streamed): there is no size to report. */
  const grpcNoReply = $derived(
    (grpcCode === 'UNAVAILABLE' || grpcCode === 'DEADLINE_EXCEEDED') && !tab?.grpcStream?.messages.length,
  );
  /** Received stream messages as one JSON array (what Copy takes while / after streaming). */
  const streamCopy = () =>
    `[${
      tab?.grpcStream?.messages
        .filter((m) => !m.sent)
        .map((m) => m.body)
        .join(',') ?? ''
    }]`;
  /** Feed pause (Flow · gRPC Stream ST7), tied to the stream it was set on; StreamFeed owns the logic. */
  let streamPause = $state<{ startedAt: number; at: number }>();
  const feedPaused = $derived(!!streamPause && streamPause.startedAt === tab?.grpcStream?.startedAt);
  const streamCountLabel = $derived(
    tab?.grpcStream ? streamCount(tab.grpcStream.kind ?? 'server', tab.grpcStream.messages, formatCount) : '',
  );
  function clearFeed(): void {
    if (tab)
      tabs.updateById(tab.id, (x) => (x.grpcStream ? { ...x, grpcStream: { ...x.grpcStream, messages: [] } } : x));
  }
  /** Re-run the request from the editor's Invoke button (same path as ⌘↵). */
  /** gRPC durations: `42 ms`, `3.4 s` (S20/S25/S26). */
  const grpcElapsed = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);
  const grpcHeaders = $derived(tab?.grpcResult?.metadata ?? tab?.grpcStream?.headers ?? {});
  const grpcTrailers = $derived(tab?.grpcResult?.trailers ?? {});
  const retry = () => document.querySelector<HTMLButtonElement>('.bs-send')?.click();
  // S25 also covers a failed connect (reflection / dial) before any call: same state, reconnect instead of re-invoke.
  const connectError = $derived(
    tab?.protocol === 'grpc' && !tab.grpcResult && !tab.grpcStream && !sending
      ? requestRuntime.grpcErrors[tab.id]
      : undefined,
  );
  const connectFailed = $derived(isGrpcConnectionCode(connectError?.code));
  /** A request-side problem (no schema, bad input, invalid endpoint) stands in for the response until the next call. */
  const editorError = $derived.by(() => {
    const e = tab?.protocol === 'grpc' ? requestRuntime.grpcErrors[tab.id] : undefined;
    if (!e || isGrpcConnectionCode(e.code) || preFailed) return undefined;
    return presentEditorError(e, isGrpcNoServicesHint(e.message));
  });
  const reconnecting = $derived(busy?.kind === 'connect');
  const responseHeaderEntries = $derived(tab?.response ? Object.entries(tab.response.headers) : []);
  // Set-Cookie values (several may arrive comma-joined); split before each `name=`.
  const responseCookies = $derived(
    tab?.response
      ? headerValue(tab.response.headers, 'set-cookie')
          .split(/,(?=\s*[^;,=\s]+=)/)
          .map((c) => c.trim())
          .filter(Boolean)
      : [],
  );
  const responseContentType = $derived(tab?.response ? headerValue(tab.response.headers, 'content-type') : '');
  const responseFmt = $derived(tab?.response ? responseFormat(tab.response.body, responseContentType) : 'Text');
  // Where the body viewer is on screen: its line count and Find / Fold tools only make sense then.
  const httpBodyShown = $derived(
    tab?.protocol === 'http' &&
      !!tab.response &&
      respTab === 'body' &&
      respMode !== 'preview' &&
      !(tab.response.status === 0 && !isCancelled(tab.response)),
  );
  const grpcBodyShown = $derived(!!grpcBody && respTab === 'body' && !tab?.grpcStream);
  const bodyShown = $derived(httpBodyShown || grpcBodyShown);
  const linesLabel = $derived(bodyShown && bodyInfo?.cm ? countLabel(bodyInfo.lines, 'lines') : '');

  let saved = $state<'idle' | 'ok' | 'fail'>('idle');
  async function saveBody(body: string, format: string): Promise<void> {
    if (!tab) return;
    try {
      const path = await saveResponseBody(body, responseFileName(tab.title, format), t('lb.save'));
      if (!path) return;
      saved = 'ok';
    } catch (err) {
      console.error('response: save failed', err);
      saved = 'fail';
    }
    setTimeout(() => (saved = 'idle'), 1500);
  }
  const expandResponse = () => (focusMode.current = toggleFocus(focusMode.current, 'response'));

  async function copyText(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard can be unavailable in non-Tauri browser smoke tests.
    }
  }
</script>

{#snippet rtab(
  id: 'body' | 'headers' | 'trailers' | 'cookies' | 'timeline' | 'tests' | 'console' | 'visualize',
  label: string,
  count?: number,
  disabled = false,
)}
  <button
    class="x"
    class:on={respTab === id}
    {disabled}
    role="tab"
    id="bs-resptab-{id}"
    aria-selected={respTab === id}
    aria-controls="bs-resppanel"
    tabindex={respTab === id ? 0 : -1}
    onclick={() => (respTab = id)}
  >
    {label}{#if count}<TabCount>{count}</TabCount>{/if}{#if id === 'tests' && testCount > 0}<span
        class="bs-test-badge"
        class:fail={passedCount < testCount}>{passedCount}/{testCount}</span
      >{/if}
  </button>
{/snippet}

{#snippet bodyTools(copy: () => void, body: string, format: string)}
  <EditorTools
    scope="#bs-resppanel"
    editor={bodyShown && !!bodyInfo?.cm}
    onExpand={expandResponse}
    expanded={focusMode.current === 'response'}
  >
    {#snippet extra()}
      <IconButton aria-label={t('response.copy')} title={t('response.copy')} onclick={copy}
        ><span class="material-symbols-outlined">content_copy</span></IconButton
      >
      <IconButton
        class="lb-save"
        aria-label={t('lb.save')}
        title={saved === 'fail' ? t('lb.saveFailed') : t('lb.save')}
        disabled={!body}
        onclick={() => saveBody(body, format)}
        ><span class="material-symbols-outlined"
          >{saved === 'ok' ? 'check' : saved === 'fail' ? 'error' : 'download'}</span
        ></IconButton
      >
    {/snippet}
  </EditorTools>
{/snippet}

{#snippet modeSeg(value: string, set: (m: 'pretty' | 'raw' | 'preview') => void, preview: boolean)}
  <Segmented class="lb-mode" role="radiogroup" aria-label={t('lb.resp.mode')}>
    <button
      type="button"
      role="radio"
      class:on={value === 'pretty'}
      aria-checked={value === 'pretty'}
      onclick={() => set('pretty')}>{t('response.mode.pretty')}</button
    >
    <button
      type="button"
      role="radio"
      class:on={value === 'raw'}
      aria-checked={value === 'raw'}
      onclick={() => set('raw')}>{t('response.mode.raw')}</button
    >
    {#if preview}<button
        type="button"
        role="radio"
        class:on={value === 'preview'}
        aria-checked={value === 'preview'}
        onclick={() => set('preview')}>{t('response.mode.preview')}</button
      >{/if}
  </Segmented>
{/snippet}

{#snippet waitingForResponse(grpc: boolean)}
  {#if waitingForInput?.session}
    <div class="bs-empty-resp bs-response-waiting">
      <span class="mark" aria-hidden="true"><span class="material-symbols-outlined">hourglass_empty</span></span>
      <strong
        >{t('sessionrun.waiting.title', { request: `${tab?.request.method ?? ''} ${tab?.title ?? ''}`.trim() })}</strong
      >
      <p>{t('sessionrun.waiting.sub')}</p>
    </div>
  {:else if waitingForInput}
    {@const code = waitingForInput.fields.length === 1 && waitingForInput.fields[0].type === 'code'}
    <div class="bs-empty-resp bs-response-waiting">
      <span class="mark" aria-hidden="true"><span class="material-symbols-outlined">hourglass_empty</span></span>
      <strong>{t('input.send.title', { what: t(code ? 'input.send.waitCode' : 'input.send.waitInput') })}</strong>
      <p>{t(code ? 'input.send.waitCodeBody' : 'input.send.waitBody')}</p>
    </div>
  {:else if askNames.length > 0}
    <div class="bs-empty-resp bs-response-waiting">
      <span class="mark" aria-hidden="true"><span class="material-symbols-outlined">keyboard</span></span>
      <strong>{t('response.empty.title')}</strong>
      <p>{t('input.send.noResponse', { names: askNames.map((n) => `{{${n}}}`).join(', ') })}</p>
    </div>
  {:else}
    <div class="bs-empty-resp bs-response-waiting">
      <span class="mark" aria-hidden="true"><span class="material-symbols-outlined">send</span></span>
      <strong>{t('response.empty.title')}</strong>
      <p>
        {grpc
          ? t(
              !tab?.grpc?.endpoint.trim()
                ? 'response.empty.grpcNoAddress'
                : !tab.grpc.method
                  ? 'response.empty.grpcNoMethod'
                  : 'response.empty.grpc',
            )
          : t('response.empty.http')}
      </p>
    </div>
  {/if}
{/snippet}

{#snippet sendingMeta()}
  <div class="bs-meta">
    <StatusPill class="sending"><span class="g" aria-hidden="true">◌</span>{t('response.sending')}</StatusPill>
    <span class="mo now" title={t('response.time')}>{((now - (busy?.startedAt ?? now)) / 1000).toFixed(1)} s</span>
    <span class="mo lb-size" title={t('response.size')}>—</span>
    <IconButton aria-label={t('response.copy')} title={t('response.copy')} disabled
      ><span class="material-symbols-outlined">content_copy</span></IconButton
    >
  </div>
{/snippet}

{#snippet unreachableFacts()}
  {#if tab?.grpcResult}grpc-status 14{#if tab.grpcResult.attempts}{`\u00a0\u00a0·\u00a0\u00a0${tab.grpcResult.attempts} ${tp(tab.grpcResult.attempts, ['attempt', 'attempts'])}`}{/if}{#if tab.grpcResult.backoffMs?.length}{`\u00a0\u00a0·\u00a0\u00a0backoff ${tab.grpcResult.backoffMs.map((ms) => ms / 1000).join(' → ')} s`}{/if}{/if}
{/snippet}

{#snippet unreachable(error: string, onRetry: () => void, onTls: () => void, facts?: Snippet)}
  <div class="bs-grpc-unreachable" role="alert">
    <span class="mark" aria-hidden="true"><span class="material-symbols-outlined">cloud_off</span></span>
    <strong>{t('response.unreachable.title')}</strong>
    <p>
      {t('response.unreachable.body', {
        endpoint: grpcErrorEndpoint || t('response.the_server'),
        reason: dialFailureReason(error),
      })}
    </p>
    {#if facts}<span class="facts">{@render facts()}</span>{/if}
    <div class="actions">
      <button class="retry" type="button" disabled={reconnecting} onclick={onRetry}
        >{reconnecting ? t('grpc.connecting') : t('response.hint.retry')}</button
      >
      <button type="button" onclick={onTls}
        ><span class="material-symbols-outlined" aria-hidden="true">{facts ? 'timer' : 'lock'}</span>{facts
          ? t('response.deadline_tls')
          : t('response.unreachable.tls')}</button
      >
    </div>
    {#if !facts && dialFailureReason(error) !== error.toLowerCase()}
      <details>
        <summary>{t('response.technical')}</summary>
        <pre>{error}</pre>
      </details>
    {/if}
  </div>
{/snippet}

{#snippet editorErrorView(e: EditorErrorPresentation)}
  <div class="bs-net-error" class:guidance={e.kind === 'schema'} role="alert">
    <span class="mark" aria-hidden="true"><span class="material-symbols-outlined">{e.icon}</span></span>
    <strong>{e.title}</strong>
    <p>{e.message}</p>
    {#if e.raw !== e.message}<code title={e.raw}>{e.raw}</code>{/if}
    <div class="actions">
      {#if e.kind === 'schema' && tab}<button
          class="retry"
          type="button"
          onclick={() => requestGrpcEditorAction(tab.id, 'importProto')}>{t('grpc.picker.importProto')}</button
        >{/if}
      {#if tab}<button class="quiet" type="button" onclick={() => requestRuntime.clearGrpcError(tab.id)}
          >{t('common.close')}</button
        >{/if}
    </div>
  </div>
{/snippet}

{#snippet scriptTestsView(results: TabTestResults)}
  {@const envName = environments.active?.name}
  <RespBody class="bs-tests">
    {#if results.error}
      <div class="bs-test-error">
        <span class="material-symbols-outlined" aria-hidden="true">error</span><span
          >{t('response.script_error', { error: results.error })}</span
        >{#if results.errorLine && tab}<button
            type="button"
            onclick={() => revealScriptLine(tab.id, results.errorPhase ?? 'post', results.errorLine)}
            >{t('script.line', { n: results.errorLine })}</button
          >{/if}
      </div>
    {/if}
    {#if results.tests.length > 0}
      <ScriptTests {results} onLine={(test, line) => tab && revealScriptLine(tab.id, test.stage ?? 'post', line)} />
    {:else if !results.error}
      <div class="bs-tests-none">{t('response.tests.none_a')}<code>pm.test(...)</code>{t('response.tests.none_b')}</div>
    {/if}
    {#if varWrites.length}
      {@const env = varWrites.some((w) => !w.globals)}
      <div class="bs-env-written">
        <span class="material-symbols-outlined" aria-hidden="true">database</span>
        <span>{env ? t('response.env.updated') : t('response.env.updatedGlobals')}</span>
        {#each varWrites.slice(0, 3) as w (w.key + w.globals)}<code title={w.value}>{`${w.key} = ${w.value}`}</code
          >{/each}
        {#if varWrites.length > 3}<span class="more">+{varWrites.length - 3}</span>{/if}
        {#if env && envName}<span class="in">{t('response.env.in', { env: envName })}</span>{/if}
        <span class="spacer"></span>
        <button type="button" onclick={openEnvironmentsTab}>{t('response.env.open')}</button>
      </div>
    {/if}
  </RespBody>
{/snippet}

{#snippet scriptConsoleView(results: TabTestResults)}
  <RespBody>
    <ScriptConsole
      events={results.events ?? []}
      onClear={() =>
        tab &&
        tabs.updateById(tab.id, (x) => (x.testResults ? { ...x, testResults: { ...x.testResults, events: [] } } : x))}
      onTests={() => (respTab = 'tests')}
    />
  </RespBody>
{/snippet}

<!-- Same sandbox as the HTML preview: the template's HTML/CSS render, its <script>s do not. -->
{#snippet visualizerView(viz: { html?: string; error?: string })}
  {#if viz.error}
    <RespBody><CodeBlock>{viz.error}</CodeBlock></RespBody>
  {:else}
    <div class="bs-preview">
      <iframe title={t('response.visualize_title')} sandbox="" srcdoc={viz.html ?? ''}></iframe>
    </div>
  {/if}
{/snippet}

{#snippet preFailedView(results: TabTestResults, canSendWithout: boolean)}
  <div class="bs-net-error bs-pre-failed">
    <span class="mark" aria-hidden="true"><span class="material-symbols-outlined">link_off</span></span>
    <strong>{t('response.pre.failed')}</strong>
    <p class="err">
      {`${results.error ?? ''}${results.errorLine ? `  ·  ${t('script.line', { n: results.errorLine })}` : ''}`}
    </p>
    <div class="actions">
      <button type="button" onclick={() => tab && revealScriptLine(tab.id, 'pre', results.errorLine)}
        >{results.errorLine ? t('response.pre.goto', { n: results.errorLine }) : t('response.pre.open')}</button
      >
      {#if canSendWithout && tab}<button
          type="button"
          class="quiet"
          onclick={() => void sendHttpTab(tab, { skipScripts: true })}>{t('response.pre.withoutScripts')}</button
        >{/if}
    </div>
  </div>
{/snippet}

{#if tab?.protocol === 'grpc'}
  {#if (tab.grpcResult || sending || tab.grpcStream) && !editorError}
    <div class="bs-resph">
      <div class="bs-rsub" role="tablist" aria-label={t('response.aria')} use:tablist>
        {@render rtab(
          'body',
          tab.grpcStream?.messages.length
            ? t('response.tab.messages')
            : tab.grpcResult && !tab.grpcResult.ok
              ? t('response.tab.error')
              : t('response.tab.message'),
          tab.grpcStream?.messages.length,
        )}
        {@render rtab(
          'headers',
          t('response.tab.metadata'),
          Object.keys(grpcHeaders).length,
          !Object.keys(grpcHeaders).length,
        )}
        {@render rtab(
          'trailers',
          t('response.tab.trailers'),
          Object.keys(grpcTrailers).length,
          !Object.keys(grpcTrailers).length,
        )}
        {@render rtab('timeline', t('response.tab.timeline'))}
        {#if testResults}{@render rtab('tests', t('response.tab.tests'))}{@render rtab(
            'console',
            t('response.tab.console'),
            consoleRows(testResults.events ?? []).length,
          )}{/if}
        {#if testResults?.visualizer}{@render rtab('visualize', t('response.tab.visualize'))}{/if}
      </div>
      {#if sending && tab.grpcStream}
        <div class="bs-meta">
          {#if feedPaused}
            <StatusPill class="warning"
              ><span class="g" aria-hidden="true">‖</span>{t('response.stream.paused_pill', {
                n: formatCount(tab.grpcStream.messages.filter((m) => !m.sent).length),
              })}</StatusPill
            >
          {:else if busy?.writable}
            <StatusPill class="open"
              ><span class="g" aria-hidden="true">●</span>{t('response.stream.open_pill', {
                n: streamCountLabel,
              })}</StatusPill
            >
          {:else}
            <StatusPill class="success"
              ><span class="g" aria-hidden="true">●</span>{t('response.streaming', { n: streamCountLabel })}</StatusPill
            >
          {/if}
          <span class="mo lb-time" title={t('response.time')}
            >{((now - tab.grpcStream.startedAt) / 1000).toFixed(1)} s</span
          >
          <span class="mo lb-size" title={t('response.size')}
            >{formatBytes(tab.grpcStream.messages.reduce((n, m) => n + m.sizeBytes, 0))}</span
          >
          <IconButton
            aria-label={t('response.copy_messages')}
            title={t('response.copy_messages')}
            onclick={() => copyText(streamCopy())}
            ><span class="material-symbols-outlined">content_copy</span></IconButton
          >
          <IconButton
            aria-label={t('response.clear_feed')}
            title={t('response.clear_feed')}
            disabled={!tab.grpcStream.messages.length}
            onclick={clearFeed}><span class="material-symbols-outlined">mop</span></IconButton
          >
        </div>
      {:else if sending}
        {@render sendingMeta()}
      {:else if tab.grpcResult}
        <div class="bs-meta">
          <StatusPill class={grpcTone}
            ><span class="g" aria-hidden="true"
              >{grpcTone === 'success' ? '✓' : grpcTone === 'warning' ? '!' : '×'}</span
            >{grpcStatusLabel(grpcCode)}{tab.grpcStream?.messages.length ? ` · ${streamCountLabel}` : ''}</StatusPill
          >
          <span class="mo lb-time" title={t('response.time')}>{grpcElapsed(tab.grpcResult.elapsed_ms)}</span>
          <span class="mo lb-size" title={t('response.size')}
            >{grpcNoReply ? '—' : formatBytes(tab.grpcResult.size_bytes)}</span
          >
          {#if linesLabel}<span class="mo lb-lines">{linesLabel}</span>{/if}
          {#if grpcBodyShown && bodyInfo?.capped}
            <span class="bs-format-pill warn"
              >{t('response.showing_first', {
                shown: formatBytes(bodyInfo.shown),
                total: formatBytes(tab.grpcResult.size_bytes),
              })}</span
            >
          {/if}
          {#if grpcBodyShown}{@render modeSeg(grpcMode, (m) => (grpcMode = m === 'raw' ? 'raw' : 'pretty'), false)}{/if}
          {#if tab.grpcStream?.messages.length}
            <IconButton
              aria-label={t('response.copy_messages')}
              title={t('response.copy_messages')}
              onclick={() => copyText(streamCopy())}
              ><span class="material-symbols-outlined">content_copy</span></IconButton
            >
            <IconButton aria-label={t('response.clear_feed')} title={t('response.clear_feed')} onclick={clearFeed}
              ><span class="material-symbols-outlined">mop</span></IconButton
            >
          {:else}
            {@render bodyTools(
              () => copyText(tab.grpcResult?.body ?? ''),
              tab.grpcResult.ok ? tab.grpcResult.body : '',
              'JSON',
            )}
          {/if}
        </div>
      {/if}
    </div>
  {/if}
  <div
    class="bs-resppanel"
    class:dim={sending && !tab.grpcStream && !waitingForInput}
    role="tabpanel"
    id="bs-resppanel"
    aria-labelledby="bs-resptab-{respTab}"
  >
    {#if editorError}
      {@render editorErrorView(editorError)}
    {:else if respTab === 'headers' && Object.keys(grpcHeaders).length}
      <ResponseHeaders entries={Object.entries(grpcHeaders)} />
    {:else if respTab === 'trailers' && Object.keys(grpcTrailers).length}
      <ResponseHeaders entries={Object.entries(grpcTrailers)} />
    {:else if tab.grpcStream && respTab !== 'timeline' && respTab !== 'tests' && !(tab.grpcResult && !tab.grpcResult.ok && !tab.grpcStream.messages.length)}
      <StreamFeed {tab} {sending} writable={!!busy?.writable} code={grpcCode} bind:pause={streamPause} />
    {:else if !tab.grpcResult && preFailed && testResults && !sending}
      {@render preFailedView(testResults, false)}
    {:else if !tab.grpcResult}
      {#if connectFailed}
        {@render unreachable(
          connectError?.message ?? '',
          () => requestGrpcEditorAction(tab.id, 'reconnect'),
          () => requestGrpcEditorAction(tab.id, 'tls'),
        )}
      {:else if !sending || waitingForInput}{@render waitingForResponse(true)}{/if}
    {:else if respTab === 'tests' && testResults}
      {@render scriptTestsView(testResults)}
    {:else if respTab === 'console' && testResults}
      {@render scriptConsoleView(testResults)}
    {:else if respTab === 'visualize' && testResults?.visualizer}
      {@render visualizerView(testResults.visualizer)}
    {:else if respTab === 'timeline'}
      <!-- prettier-ignore -->
      <RespBody><CodeBlock class="bs-timeline">
        <div><span class="k">{t('response.status')}</span>{grpcStatusLabel(grpcCode)}</div>
        <div><span class="k">{t('response.time')}</span>{grpcElapsed(tab.grpcResult.elapsed_ms)}</div>
        <div><span class="k">{t('response.size')}</span>{formatBytes(tab.grpcResult.size_bytes)}</div>
        {#if tab.grpc?.endpoint}<div><span class="k">{t('response.endpoint')}</span>{tab.grpc.endpoint}</div>{/if}
        {#if tab.grpc?.method}<div><span class="k">{t('response.method')}</span>{tab.grpc.method}</div>{/if}
      </CodeBlock></RespBody>
    {:else if grpcError && grpcUnreachable}
      {@render unreachable(grpcError.message, retry, onSettings, unreachableFacts)}
    {:else if grpcError}
      {@const note = grpcErrorNote(grpcError.code, grpcCodeNum)}
      <div class="bs-grpc-status-view">
        <div class="kicker" class:warning={grpcTone === 'warning'}>
          grpc-status {grpcCodeNum >= 0 ? `${grpcCodeNum} · ` : ''}{grpcError.code}
        </div>
        <div class="gmsg"><span>grpc-message:</span> "{grpcError.message}"</div>
        {#each tab.grpcResult.details ?? [] as d, i (i)}
          <div class="bs-grpc-details">
            <div class="hd">{t('response.details')} <code>{d.typeName}</code></div>
            {#each d.fieldViolations as v, j (j)}
              <div class="row">
                <span class="lbl">{t('response.field')}</span>
                <span class="chip">{v.field}</span>
                <span class="desc">{v.description}</span>
                <button type="button" onclick={() => openGrpcEditorSection(tab.id, 'message')}
                  ><span class="material-symbols-outlined" aria-hidden="true">arrow_upward</span>{t(
                    'response.to_field',
                  )}</button
                >
              </div>
            {/each}
          </div>
        {/each}
        {#if note}<p class="note">{note}</p>{/if}
        {#if grpcError.action && grpcError.actionLabel && !tab.grpcResult.details?.length}
          <div>
            <BeautifyButton type="button" onclick={() => openGrpcEditorSection(tab.id, grpcError.action!)}
              >{grpcError.actionLabel}</BeautifyButton
            >
          </div>
        {/if}
        {#if grpcError.raw !== grpcError.message}
          <details>
            <summary>{t('response.technical')}</summary>
            <pre>{grpcError.raw}</pre>
          </details>
        {/if}
      </div>
    {:else if grpcBody}
      <ResponseBody source={grpcBody} contentType="application/json" mode={grpcMode} bind:info={bodyInfo} />
    {/if}
  </div>
{:else if tab}
  {#if tab.response || sending}
    <div class="bs-resph">
      <div class="bs-rsub" role="tablist" aria-label={t('response.aria')} use:tablist>
        {@render rtab('body', t('response.tab.body'))}
        {@render rtab('headers', t('response.tab.headers'), responseHeaderEntries.length, tab.response?.status === 0)}
        {@render rtab(
          'cookies',
          t('response.tab.cookies'),
          tab.response?.cookies?.length ?? responseCookies.length,
          tab.response?.status === 0,
        )}
        {@render rtab('timeline', t('response.tab.timeline'))}
        {#if testResults}{@render rtab('tests', t('response.tab.tests'))}{@render rtab(
            'console',
            t('response.tab.console'),
            consoleRows(testResults.events ?? []).length,
          )}{/if}
        {#if testResults?.visualizer}{@render rtab('visualize', t('response.tab.visualize'))}{/if}
      </div>
      {#if sending}
        {@render sendingMeta()}
      {:else if tab.response}
        <div class="bs-meta">
          <!-- The reason phrase hides on a narrow panel; the title keeps it. -->
          <StatusPill
            class={tone}
            title={tab.response.status ? `${tab.response.status} ${statusText(tab.response.status)}` : undefined}
            ><span class="g" aria-hidden="true">{tone === 'success' ? '✓' : tab.response.status ? '!' : '×'}</span
            >{#if tab.response.status}<span
                >{tab.response.status}<span class="lb-reason">{` ${statusText(tab.response.status)}`}</span></span
              >{:else}{preFailed
                ? t('response.status.notSent')
                : isCancelled(tab.response)
                  ? t('response.status.cancelled')
                  : t('response.status.none')}{/if}</StatusPill
          >
          {#if !preFailed}
            <span class="mo lb-time" title={t('response.time')}
              >{tab.response.elapsed_ms >= 1000
                ? `${(tab.response.elapsed_ms / 1000).toFixed(tab.response.elapsed_ms >= 10_000 ? 1 : 2)} s`
                : `${tab.response.elapsed_ms} ms`}</span
            >
            <span class="mo lb-size" title={t('response.size')}
              >{tab.response.status ? formatBytes(tab.response.size_bytes) : '—'}</span
            >
          {/if}
          {#if linesLabel}<span class="mo lb-lines">{linesLabel}</span>{/if}
          {#if tab.response.body_truncated}
            <span class="bs-format-pill warn">{t('response.truncated')}</span>
          {/if}
          {#if respTab === 'body' && tab.response.status !== 0}{@render modeSeg(
              respMode,
              (m) => (respMode = m),
              responseFmt === 'HTML',
            )}{/if}
          {@render bodyTools(() => copyText(tab.response?.body ?? ''), tab.response.body, responseFmt)}
        </div>
      {/if}
    </div>
  {/if}
  <div
    class="bs-resppanel"
    class:dim={sending && !waitingForInput}
    role="tabpanel"
    id="bs-resppanel"
    aria-labelledby="bs-resptab-{respTab}"
  >
    <!-- A send waiting for the sign-in code replaces even an older response: the request goes out again. -->
    {#if !tab.response || waitingForInput?.session}
      {#if !sending || waitingForInput}{@render waitingForResponse(false)}{/if}
    {:else if preFailed && testResults && (respTab === 'body' || respTab === 'headers' || respTab === 'cookies')}
      {@render preFailedView(testResults, true)}
    {:else if respTab === 'tests' && testResults}
      {@render scriptTestsView(testResults)}
    {:else if respTab === 'console' && testResults}
      {@render scriptConsoleView(testResults)}
    {:else if respTab === 'visualize' && testResults?.visualizer}
      {@render visualizerView(testResults.visualizer)}
    {:else if tab.response.status === 0 && !isCancelled(tab.response) && respTab !== 'timeline' && respTab !== 'tests'}
      {@const timeout = isTimeout(tab.response)}
      <div class="bs-net-error">
        <span class="mark" aria-hidden="true"><span class="material-symbols-outlined">wifi_off</span></span>
        <strong
          >{timeout
            ? t('response.net.timeout_title', { n: Math.round(tab.response.elapsed_ms / 1000) || '' }).replace(
                '  ',
                ' ',
              )
            : t('response.net.fail_title')}</strong
        >
        <p>
          {timeout
            ? t('response.net.timeout_body', {
                host:
                  tab.request.url.match(/\{\{[^{}]+\}\}/)?.[0] ??
                  tab.response.final_url.match(/^\w+:\/\/([^/]+)/)?.[1] ??
                  t('response.the_server'),
              })
            : t('response.net.fail_body')}
        </p>
        <code title={tab.response.body}
          >{timeout ? 'ETIMEDOUT' : tab.response.body.split('\n')[0].slice(0, 60)}&nbsp;&nbsp;·&nbsp;&nbsp;wait {(
            tab.response.elapsed_ms / 1000
          ).toFixed(1)} s</code
        >
        <div class="actions">
          <button
            type="button"
            class="retry"
            onclick={() => document.querySelector<HTMLButtonElement>('.bs-send')?.click()}
            >{t('response.hint.retry')}</button
          >
          <button type="button" class="quiet" onclick={onSettings}
            ><span class="material-symbols-outlined" aria-hidden="true">timer</span>{t(
              'response.net.timeout_proxy',
            )}</button
          >
        </div>
      </div>
    {:else if respTab === 'cookies' && (tab.response.cookies || tab.response.jar_sends != null)}
      <ResponseCookies response={tab.response} />
    {:else if respTab === 'cookies'}
      <!-- Responses from before the jar (history, MCP): the raw Set-Cookie lines. -->
      <!-- prettier-ignore -->
      <RespBody><CodeBlock>{#each responseCookies as c, i (i)}<div>{c}</div>{/each}{#if responseCookies.length === 0}<span style="color:var(--t3)">{t('response.no_cookies')}</span>{/if}</CodeBlock></RespBody>
    {:else if respTab === 'timeline'}
      <!-- prettier-ignore -->
      <RespBody><CodeBlock class="bs-timeline">
        <div><span class="k">{t('response.status')}</span>{tab.response.status || 'ERR'} {statusText(tab.response.status)}</div>
        <div><span class="k">{t('response.time')}</span>{tab.response.elapsed_ms} ms</div>
        <div><span class="k">{t('response.size')}</span>{formatBytes(tab.response.size_bytes)}{tab.response.body_truncated ? t('response.truncated_paren') : ''}</div>
        {#if responseContentType}<div><span class="k">Content-Type</span>{responseContentType}</div>{/if}
        {#if tab.response.final_url}<div><span class="k">URL</span>{tab.response.final_url}</div>{/if}
      </CodeBlock>{#if tab.sent}<SentRequest {tab} sent={tab.sent} />{/if}</RespBody>
    {:else if respTab === 'headers'}
      <ResponseHeaders entries={responseHeaderEntries} />
    {:else}
      <div class="bs-response-view">
        <!-- Mono 3.0: JSON renders straight into the card; other formats keep the view switch. -->
        {#if tab.response.body_truncated || (httpBodyShown && bodyInfo?.capped)}
          <div class="bs-response-tools">
            <span class="bs-format-pill">{responseFmt}</span>
            {#if tab.response.body_truncated}
              <span class="bs-format-pill warn">{t('response.body_truncated')}</span>
            {/if}
            {#if httpBodyShown && bodyInfo?.capped}
              <span class="bs-format-pill warn" title={t('response.full_kept', { n: formatBytes(bodyInfo.shown) })}
                >{t('response.showing_first', {
                  shown: formatBytes(bodyInfo.shown),
                  total: formatBytes(tab.response.size_bytes),
                })}</span
              >
            {/if}
            {#if responseContentType}
              <span class="bs-content-type">{responseContentType}</span>
            {/if}
          </div>
        {/if}
        {#if respMode === 'preview'}
          {#if responseFmt === 'HTML'}
            <div class="bs-preview">
              <iframe title={t('response.preview_title')} sandbox="" srcdoc={tab.response.body}></iframe>
            </div>
          {:else}
            <div class="bs-empty-resp">
              <span class="material-symbols-outlined">preview</span>
              <div>{t('response.preview_html_only')}</div>
            </div>
          {/if}
        {:else}
          <ResponseBody
            source={tab.response}
            contentType={responseContentType}
            mode={respMode === 'raw' ? 'raw' : 'pretty'}
            bind:info={bodyInfo}
          />
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  @container response (max-width: 480px) {
    :global(:root #bs-resptab-cookies) {
      display: none;
    }

    :global(:root #bs-resptab-timeline) {
      display: none;
    }
  }

  .bs-empty-resp > :global(.material-symbols-outlined) {
    display: grid;
    place-items: center;
    width: 80px;
    height: 64px;
    font-size: 56px;
    color: var(--sep);
  }

  /* Belongs to response.css, but the cascade needs it before `:root .bs .bs-body-beautify .material-symbols-outlined` (same elements, same specificity), so it lives here. */
  .bs-net-error :global(.mark .material-symbols-outlined) {
    font-size: 22px;
  }

  /* Belongs to response.css, but the cascade needs it before `:root .bs .bs-body-beautify .material-symbols-outlined` (same elements, same specificity), so it lives here. */
  .bs-net-error :global(.quiet .material-symbols-outlined) {
    font-size: 16px;
  }

  .bs-net-error :global(.actions button) {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 16px;
    border-radius: var(--radius-control);
    font: 500 var(--font-size-body) var(--font-ui);
  }

  .bs-rsub :global(.x) {
    color: var(--t2);
  }

  .bs-rsub :global(:where(.x).on) {
    font-weight: 600;
  }

  .bs-meta .mo :global(b) {
    color: var(--text);
    font-weight: 600;
  }

  :where(.bs-format-pill).warn {
    background: color-mix(in srgb, var(--orange) 14%, transparent);
    color: var(--orange);
  }

  .bs-preview {
    flex: 1;
    min-height: 0;
    background: #fff;
  }

  .bs-preview :global(iframe) {
    width: 100%;
    height: 100%;
    border: 0;
    background: #fff;
  }

  .bs-empty-resp :global(svg) {
    width: 38px;
    height: 38px;
  }

  .bs-resppanel {
    display: contents;
  }

  .bs-resph {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }

  .bs-response-tools {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }

  /* Editor and response panel */
  .bs-response-view {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--canvas);
  }

  .bs-meta {
    font-size: 11px;
  }

  .bs-empty-resp :global(:where(.material-symbols-outlined)) {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--t3);
    border-radius: 0;
    box-shadow: none;
    width: auto;
    height: auto;
    border: 0;
    background: transparent;
    font-size: 30px;
  }

  .bs-empty-resp > :global(div) {
    max-width: 320px;
    text-align: center;
    line-height: 1.45;
    font-size: 11.5px;
  }

  .bs-rsub :global(.x) {
    font-size: 12px;
  }

  .bs-rsub :global(.x.on) {
    color: var(--text);
  }

  .bs-rsub :global(.x.on::after) {
    background: var(--accent);
  }

  :global(:root .bs-timeline > div) {
    display: flex;
    gap: 16px;
  }

  :global(:root .bs-timeline .k) {
    flex: 0 0 110px;
    color: var(--color-text-muted);
  }

  :global(.bs .bs-resp) .bs-response-view {
    background: transparent;
  }

  .bs-meta .mo.now {
    color: var(--color-text);
  }

  /* .bs-resppanel is display: contents, so dim what it wraps. */
  .bs-resppanel.dim > :global(*) {
    opacity: 0.35;
  }

  .bs-resph {
    display: flex;
    align-items: center;
    backdrop-filter: none;
    box-shadow: none;
    height: 50px;
    flex-shrink: 0;
    padding: 0 10px;
    gap: 14px;
    border: 0;
    border-bottom: 1px solid var(--color-border-subtle);
    border-radius: 0;
    background: transparent;
  }

  .bs-rsub {
    display: flex;
    height: 30px;
    gap: 2px;
    align-items: stretch;
  }

  :global(.bs) .bs-rsub :global(.x) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    margin: 0;
    padding: 0 12px;
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--color-text-secondary);
    font: 500 var(--font-size-body) var(--font-ui);
  }

  :global(.bs) .bs-rsub :global(.x:hover) {
    color: var(--color-text);
    background: var(--hover);
  }

  :global(.bs) .bs-rsub :global(.x.on) {
    background: var(--color-raised);
    color: var(--color-text);
    font-weight: 600;
    box-shadow: 0 1px 3px var(--color-shadow);
  }

  .bs-meta {
    display: flex;
    align-items: center;
    margin-left: auto;
    gap: 14px;
  }

  :global(.bs) .bs-rsub :global(.x:disabled) {
    opacity: 0.4;
    cursor: default;
  }

  :global(.bs) .bs-rsub :global(.x:disabled:hover) {
    background: transparent;
    color: var(--color-text-secondary);
  }

  /* S08: no response at all. */
  .bs-net-error {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 12px 40px 16px;
    text-align: center;
  }

  .bs-net-error :global(.mark) {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--color-danger-soft);
    color: var(--color-danger);
  }

  .bs-net-error :global(strong) {
    color: var(--color-text);
    font: 600 var(--font-size-title)/18px var(--font-ui);
  }

  .bs-net-error :global(p) {
    max-width: 440px;
    margin: -4px 0 0;
    color: var(--color-text-secondary);
    font: var(--font-size-body)/1.5 var(--font-ui);
  }

  .bs-net-error :global(code) {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    height: 22px;
    padding: 0 10px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    border-radius: var(--radius-control);
    background: var(--color-selected);
    color: var(--color-text-secondary);
    font: var(--font-size-micro) var(--font-code);
  }

  .bs-net-error :global(.actions) {
    display: flex;
    gap: 8px;
    padding-top: 6px;
  }

  /* No schema yet: guidance, not a failure. */
  .bs-net-error.guidance :global(.mark) {
    background: var(--color-raised);
    color: var(--color-text-secondary);
  }

  .bs-net-error :global(.retry) {
    outline: 1px solid var(--color-border-subtle);
    outline-offset: -1px;
    background: var(--color-panel);
    color: var(--color-text);
  }

  .bs-net-error :global(.retry:hover) {
    background: var(--color-selected);
  }

  .bs-net-error :global(.quiet) {
    background: transparent;
    color: var(--color-text-secondary);
  }

  .bs-net-error :global(.quiet:hover) {
    background: var(--hover);
    color: var(--color-text);
  }

  .bs-response-tools {
    display: flex;
    align-items: center;
    overflow: hidden;
    backdrop-filter: none;
    box-shadow: none;
    min-height: 40px;
    padding: 0 16px;
    gap: 8px;
    border-bottom: 1px solid var(--color-border-subtle);
    background: transparent;
  }

  .bs-format-pill {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    height: 22px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--radius-control);
    background: var(--color-selected);
    color: var(--color-text-secondary);
    font: 500 var(--font-size-caption) var(--font-ui);
  }

  .bs-content-type {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-code);
  }

  .bs-empty-resp {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 18px;
    color: var(--t2);
    font-size: 12px;
    border-radius: 0;
    background: transparent;
  }

  .bs-response-waiting :global(.mark) {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--color-field);
    color: var(--color-text-secondary);
  }

  .bs-response-waiting :global(strong) {
    font: 600 var(--font-size-ui)/16px var(--font-ui);
    color: var(--color-text);
  }

  .bs-response-waiting :global(p) {
    margin: 0;
    color: var(--color-text-muted);
    font: var(--font-size-body)/15px var(--font-ui);
  }

  :global(:root[data-density='compact']) .bs-resph {
    height: 38px;
  }

  :global(:root[data-density='compact']) .bs-rsub {
    height: 26px;
  }

  :global(:root[data-density='compact'] .bs) .bs-rsub :global(.x) {
    height: 26px;
  }

  .bs-response-waiting {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 24px 24px 28px;
    text-align: center;
    min-height: 0;
    overflow: auto;
  }

  @container response (max-height: 165px) {
    .bs-response-waiting :global(.mark) {
      display: none;
    }
  }

  :global(:root .bs .bs-stpill.open) {
    background: var(--color-var-soft);
    color: var(--color-var);
  }

  .bs-meta :global(.lb-mode) {
    flex: none;
  }

  .bs-meta .mo {
    font: var(--font-size-caption) var(--font-code);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .bs-meta :global(.bs-ric:disabled) {
    opacity: 0.4;
    cursor: default;
  }

  @container response (max-width: 900px) {
    .bs-meta .lb-lines {
      display: none;
    }
  }

  @container response (max-width: 800px) {
    .bs-resph {
      gap: 8px;
    }

    .bs-meta {
      gap: 8px;
    }
  }

  @container response (max-width: 560px) {
    .bs-meta .lb-size {
      display: none;
    }
  }

  @container response (max-width: 480px) {
    .bs-meta .lb-time {
      display: none;
    }
  }

  @container response (max-width: 700px) {
    /* Wraps only if a line still doesn't fit; a single line keeps the usual height. */
    .bs-resph {
      flex-wrap: wrap;
      height: auto;
      min-height: 50px;
      padding-top: 4px;
      padding-bottom: 4px;
      row-gap: 6px;
    }

    :global(:root[data-density='compact']) .bs-resph {
      flex-wrap: wrap;
      height: auto;
      min-height: 50px;
      padding-top: 4px;
      padding-bottom: 4px;
      row-gap: 6px;
    }

    :global(:root[data-density='compact']) .bs-resph {
      min-height: 38px;
    }

    .bs-meta {
      margin-left: auto;
    }

    /* One line, as in Flow · Window sizes: of the body controls only Copy stays; expanding is still on its hotkey. */
    :global(.bs-stpill) .lb-reason {
      display: none;
    }

    .bs-meta :global(:is(.lb-mode, .lb-save, .lb-expand)) {
      display: none;
    }
  }

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
  :global(:root .bs-tests) {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px 14px;
    overflow: auto;
  }
  .bs-test-error {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--red);
    font-family: var(--mono);
  }
  .bs-test-error .material-symbols-outlined {
    font-size: 15px;
  }
  .bs-test-error button {
    margin-left: auto;
    color: var(--t3);
    font: inherit;
    font-size: var(--font-size-micro);
  }
  .bs-test-error button:hover {
    color: var(--text);
    text-decoration: underline;
  }
  .bs-tests-none {
    padding: 4px 0;
    color: var(--t3);
  }
  /* SC4: “The script updated the environment” pinned under the checks. */
  .bs-env-written {
    flex: none;
    margin-top: auto;
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 10px 14px;
    color: var(--t2);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
    font-size: var(--font-size-caption);
  }
  .bs-env-written > span:not(.spacer) {
    flex: none;
    white-space: nowrap;
  }
  .bs-env-written > .material-symbols-outlined {
    font-size: 16px;
    color: var(--t3);
  }
  :global(:root .bs-tests .bs-env-written code) {
    min-width: 0;
    max-width: 220px;
    overflow: hidden;
    padding: 2px 8px;
    color: var(--var, var(--accent));
    background: var(--var-soft, var(--accentsoft));
    border-radius: 999px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bs-env-written .in,
  .bs-env-written .more {
    color: var(--t3);
  }
  .bs-env-written .spacer {
    flex: 1;
  }
  .bs-env-written button {
    color: var(--text);
    font-weight: 500;
  }
  .bs-env-written button:hover {
    text-decoration: underline;
  }
  /* SC6: the pre-request script threw. */
  .bs-pre-failed .err {
    color: var(--color-danger);
    font-family: var(--mono);
    white-space: pre;
  }
  .bs-pre-failed .actions .quiet {
    background: transparent;
    border-color: transparent;
  }
  :global(:root .bs-tests code) {
    font-family: var(--mono);
    font-size: 11px;
    background: var(--inset);
    border-radius: 4px;
    padding: 1px 4px;
  }
  .bs-grpc-status-view {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 18px 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .bs-grpc-status-view .kicker {
    font: 600 var(--font-size-caption) var(--font-code);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-danger);
  }
  .bs-grpc-status-view .kicker.warning {
    color: var(--color-warning);
  }
  .bs-grpc-status-view .gmsg {
    font: var(--font-size-label) var(--font-code);
    color: var(--color-text);
  }
  .bs-grpc-status-view .gmsg span {
    color: var(--color-text-muted);
  }
  .bs-grpc-details {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }
  .bs-grpc-details .hd {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 10px 18px;
    border-bottom: 1px solid var(--color-border);
    font: 600 var(--font-size-micro) var(--font-code);
    letter-spacing: 0.08em;
    color: var(--color-text-muted);
  }
  .bs-grpc-details .hd code {
    font: var(--font-size-body) var(--font-code);
    letter-spacing: 0;
    color: var(--method-get, var(--color-text));
  }
  .bs-grpc-details .row {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 10px 18px;
    font: var(--font-size-body) var(--font-code);
  }
  .bs-grpc-details .row + .row {
    border-top: 1px solid var(--color-border);
  }
  .bs-grpc-details .lbl {
    color: var(--color-text-muted);
  }
  .bs-grpc-details .chip {
    padding: 2px 10px;
    border-radius: var(--radius-control);
    background: var(--color-warning-soft);
    color: var(--color-warning);
  }
  .bs-grpc-details .desc {
    flex: 1;
    min-width: 0;
    color: var(--color-text);
  }
  .bs-grpc-details .row button,
  .bs-grpc-unreachable .actions button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 14px;
    border-radius: var(--radius-control);
    color: var(--color-text-secondary);
    font: 500 var(--font-size-body) var(--font-ui);
  }
  .bs-grpc-details .row button:hover,
  .bs-grpc-unreachable .actions button:hover {
    background: var(--color-hover);
    color: var(--color-text);
  }
  .bs-grpc-details .material-symbols-outlined,
  .bs-grpc-unreachable .actions .material-symbols-outlined {
    font-size: 15px;
  }
  .bs-grpc-status-view .note {
    margin: 0;
    color: var(--color-text-secondary);
    font: var(--font-size-body)/1.5 var(--font-ui);
  }
  .bs-grpc-status-view details {
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-ui);
  }
  .bs-grpc-status-view summary {
    width: max-content;
    cursor: pointer;
  }
  .bs-grpc-status-view pre {
    margin: 6px 0 0;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    background: var(--color-field);
    font: var(--font-size-caption)/1.5 var(--font-code);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .bs-grpc-unreachable {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 24px;
    text-align: center;
  }
  .bs-grpc-unreachable .mark {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    margin-bottom: 4px;
    border-radius: 50%;
    background: var(--color-danger-soft);
    color: var(--color-danger);
  }
  .bs-grpc-unreachable .mark .material-symbols-outlined {
    font-size: 20px;
  }
  .bs-grpc-unreachable strong {
    font: 600 var(--font-size-label) var(--font-ui);
    color: var(--color-text);
  }
  .bs-grpc-unreachable p {
    max-width: 460px;
    margin: 0;
    color: var(--color-text-secondary);
    font: var(--font-size-body)/1.5 var(--font-ui);
  }
  .bs-grpc-unreachable .facts {
    margin-top: 4px;
    padding: 3px 12px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-control);
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-code);
  }
  .bs-grpc-unreachable .actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
  .bs-grpc-unreachable .actions .retry {
    border: 1px solid var(--color-border);
    color: var(--color-text);
  }
  .bs-grpc-unreachable .actions button:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .bs-grpc-unreachable details {
    max-width: 460px;
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-ui);
  }
  .bs-grpc-unreachable summary {
    cursor: pointer;
  }
  .bs-grpc-unreachable pre {
    margin: 6px 0 0;
    padding: 8px 10px;
    border-radius: var(--radius-md);
    background: var(--color-field);
    color: var(--color-text-secondary);
    font: var(--font-size-caption)/1.5 var(--font-code);
    text-align: left;
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
