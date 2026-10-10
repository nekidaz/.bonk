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
  import { t, tp, uiLanguage } from '$shared/i18n';
  import { formatBytes, type Tab } from '$shared/model';
  import { presentGrpcError, grpcErrorNote } from './grpcError';
  import {
    methodShort,
    grpcCodeTone,
    dialFailureReason,
    isGrpcConnectionCode,
    openGrpcEditorSection,
    requestGrpcEditorAction,
    requestRuntime,
  } from '$entities/request';
  import { responseFormat } from './responseRender';
  import { GRPC_CODES, HTTP_STATUS_TEXT, grpcStatusLabel } from './statusLabel';
  import { requestPrefs } from '$shared/settings';
  import { tabs } from '$entities/tab';
  import ResponseBody, { type BodyInfo } from './ResponseBody.svelte';
  import { EditorTools } from '$shared/editor/components';
  import { countLabel } from '$shared/editor';
  import { focusMode, toggleFocus, tablist } from '$shared/ui';
  import { responseFileName, saveResponseBody } from './saveResponse';
  import type { Snippet } from 'svelte';
  import { isCancelled, isTimeout, responseTone } from './responseHint';

  const { tab, onSettings = () => {} }: { tab: Tab | undefined; onSettings?: () => void } = $props();

  let respTab = $state<'body' | 'headers' | 'trailers' | 'cookies' | 'timeline' | 'tests'>('body');
  let respMode = $state<'pretty' | 'raw' | 'preview'>(requestPrefs.responsePrettyDefault ? 'pretty' : 'raw');
  /** gRPC responses get the same Pretty / Raw switch (E5). */
  let grpcMode = $state<'pretty' | 'raw'>(requestPrefs.responsePrettyDefault ? 'pretty' : 'raw');
  let bodyInfo = $state<BodyInfo | undefined>(undefined);

  // In-flight request for this tab: drives the "Sending…" meta and the live timer (S04).
  const busy = $derived(tab ? requestRuntime.busy[tab.id] : undefined);
  const sending = $derived(!!busy && busy.kind !== 'connect');
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

  // If the visible sub-tab is Tests but a new response has no script output,
  // fall back to Body so the panel never shows an empty Tests view.
  $effect(() => {
    if (respTab === 'tests' && !testResults) respTab = 'body';
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
  /** HH:MM:SS.mmm for stream messages. */
  const streamClock = (ms: number) => {
    const d = new Date(ms);
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
  };
  /** One stream message as a spaced single line (`{ "k": v }`), split into syntax tokens. */
  function inlineJson(body: string): { text: string; kind: string }[] {
    let text = body;
    try {
      const v = JSON.parse(body);
      text =
        v && typeof v === 'object' && !Array.isArray(v)
          ? `{ ${Object.entries(v)
              .map(([k, x]) => `${JSON.stringify(k)}: ${JSON.stringify(x)}`)
              .join(', ')} }`
          : JSON.stringify(v);
    } catch {
      /* not JSON: show as is */
    }
    const out: { text: string; kind: string }[] = [];
    for (const m of text.matchAll(
      /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)|([^"\d\-tfn]+|.)/g,
    )) {
      if (m[1]) {
        out.push({ text: m[1], kind: m[2] ? 'k' : 's' });
        if (m[2]) out.push({ text: m[2], kind: 'p' });
      } else if (m[3]) out.push({ text: m[3], kind: 'n' });
      else out.push({ text: m[0], kind: 'p' });
    }
    return out;
  }

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
  const linesLabel = $derived(bodyShown && bodyInfo?.cm ? countLabel(bodyInfo.lines, 'lines', uiLanguage.current) : '');

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
  id: 'body' | 'headers' | 'trailers' | 'cookies' | 'timeline' | 'tests',
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
    {label}{#if count}<span class="bs-tab-count">{count}</span>{/if}{#if id === 'tests' && testCount > 0}<span
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
      <button class="bs-ric" aria-label={t('response.copy')} title={t('response.copy')} onclick={copy}
        ><span class="material-symbols-outlined">content_copy</span></button
      >
      <button
        class="bs-ric"
        aria-label={t('lb.save')}
        title={saved === 'fail' ? t('lb.saveFailed') : t('lb.save')}
        disabled={!body}
        onclick={() => saveBody(body, format)}
        ><span class="material-symbols-outlined"
          >{saved === 'ok' ? 'check' : saved === 'fail' ? 'error' : 'download'}</span
        ></button
      >
    {/snippet}
  </EditorTools>
{/snippet}

{#snippet modeSeg(value: string, set: (m: 'pretty' | 'raw' | 'preview') => void, preview: boolean)}
  <div class="bs-seg lb-mode" role="radiogroup" aria-label={t('lb.resp.mode')}>
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
  </div>
{/snippet}

{#snippet waitingForResponse(grpc: boolean)}
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
{/snippet}

{#snippet sendingMeta()}
  <div class="bs-meta">
    <span class="bs-stpill sending"><span class="g" aria-hidden="true">◌</span>{t('response.sending')}</span>
    <span class="mo now" title={t('response.time')}>{((now - (busy?.startedAt ?? now)) / 1000).toFixed(1)} s</span>
    <span class="mo lb-size" title={t('response.size')}>—</span>
    <button class="bs-ric" aria-label={t('response.copy')} title={t('response.copy')} disabled
      ><span class="material-symbols-outlined">content_copy</span></button
    >
  </div>
{/snippet}

{#snippet unreachableFacts()}
  {#if tab?.grpcResult}grpc-status 14{#if tab.grpcResult.attempts}{`\u00a0\u00a0·\u00a0\u00a0${tab.grpcResult.attempts} ${tp(tab.grpcResult.attempts, ['попытка', 'попытки', 'попыток'], ['attempt', 'attempts'])}`}{/if}{#if tab.grpcResult.backoffMs?.length}{`\u00a0\u00a0·\u00a0\u00a0backoff ${tab.grpcResult.backoffMs.map((ms) => ms / 1000).join(' → ')} s`}{/if}{/if}
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

{#if tab?.protocol === 'grpc'}
  {#if tab.grpcResult || sending || tab.grpcStream}
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
        {#if testResults}{@render rtab('tests', t('response.tab.tests'))}{/if}
      </div>
      {#if sending && tab.grpcStream}
        <div class="bs-meta">
          <span class="bs-stpill success"
            ><span class="g" aria-hidden="true">●</span>{t('response.streaming', {
              n: tab.grpcStream.messages.filter((m) => !m.sent).length,
            })}</span
          >
          <span class="mo lb-time" title={t('response.time')}
            >{((now - tab.grpcStream.startedAt) / 1000).toFixed(1)} s</span
          >
          <span class="mo lb-size" title={t('response.size')}
            >{formatBytes(tab.grpcStream.messages.reduce((n, m) => n + m.sizeBytes, 0))}</span
          >
          <button
            class="bs-ric"
            aria-label={t('response.copy_messages')}
            title={t('response.copy_messages')}
            onclick={() => copyText(streamCopy())}><span class="material-symbols-outlined">content_copy</span></button
          >
          <button
            class="bs-ric"
            aria-label={t('response.clear_feed')}
            title={t('response.clear_feed')}
            disabled={!tab.grpcStream.messages.length}
            onclick={clearFeed}><span class="material-symbols-outlined">mop</span></button
          >
        </div>
      {:else if sending}
        {@render sendingMeta()}
      {:else if tab.grpcResult}
        <div class="bs-meta">
          <span class="bs-stpill {grpcTone}"
            ><span class="g" aria-hidden="true"
              >{grpcTone === 'success' ? '✓' : grpcTone === 'warning' ? '!' : '×'}</span
            >{grpcStatusLabel(grpcCode)}</span
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
            <button
              class="bs-ric"
              aria-label={t('response.copy_messages')}
              title={t('response.copy_messages')}
              onclick={() => copyText(streamCopy())}><span class="material-symbols-outlined">content_copy</span></button
            >
            <button
              class="bs-ric"
              aria-label={t('response.clear_feed')}
              title={t('response.clear_feed')}
              onclick={clearFeed}><span class="material-symbols-outlined">mop</span></button
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
    class:dim={sending && !tab.grpcStream}
    role="tabpanel"
    id="bs-resppanel"
    aria-labelledby="bs-resptab-{respTab}"
  >
    {#snippet mdList(md: Record<string, string>)}
      <div class="bs-rbody">
        <div class="bs-code">
          {#each Object.entries(md) as [k, v] (k)}<div><span class="k">{k}</span>: {v}</div>{/each}
        </div>
      </div>
    {/snippet}
    {#if respTab === 'headers' && Object.keys(grpcHeaders).length}
      {@render mdList(grpcHeaders)}
    {:else if respTab === 'trailers' && Object.keys(grpcTrailers).length}
      {@render mdList(grpcTrailers)}
    {:else if tab.grpcStream && respTab !== 'timeline' && respTab !== 'tests' && !(tab.grpcResult && !tab.grpcResult.ok && !tab.grpcStream.messages.length)}
      <div class="bs-rbody bs-stream-feed">
        {#each tab.grpcStream.messages as m, i ((m.sent ? 's' : 'r') + m.index)}
          <div
            class="msg"
            class:sent={m.sent}
            class:last={i === tab.grpcStream.messages.length - 1 && !(tab.grpcResult && !tab.grpcResult.ok)}
          >
            <span class="no">{m.sent ? '↑' : '#'}{m.index}</span>
            <span class="at">{streamClock(m.atMs)}</span>
            <code
              >{#each inlineJson(m.body) as t}<span class={t.kind}>{t.text}</span>{/each}</code
            >
          </div>
        {/each}
        {#if sending}<div class="waiting">
            <span class="dot" aria-hidden="true"></span>{t('response.waiting_next')}
          </div>{/if}
        {#if tab.grpcResult && !tab.grpcResult.ok}
          {@const n = tab.grpcStream.messages.length}
          {@const saved = t('response.stream.saved', {
            n,
            msgs: tp(n, ['сообщение', 'сообщения', 'сообщений'], ['message', 'messages']),
            recv: tp(n, ['полученное', 'полученные', 'полученных'], ['', '']),
            until: t(grpcCode === 'CANCELLED' ? 'response.stream.until_stop' : 'response.stream.until_error'),
            saved: tp(n, ['сохранено', 'сохранены', 'сохранены'], ['', '']),
          })}
          {#if grpcCode !== 'CANCELLED'}
            <div class="msg err" role="alert">
              <span class="no">×</span>
              <span class="at">{streamClock(tab.grpcStream.startedAt + tab.grpcResult.elapsed_ms)}</span>
              <code>{grpcStatusLabel(grpcCode)} · {tab.grpcResult.body}</code>
            </div>
          {/if}
          <div class="waiting ended">
            <span class="dot" aria-hidden="true"
            ></span>{`${t(grpcCode === 'CANCELLED' ? 'response.stream.stopped' : 'response.stream.closed')} ${saved}`}
          </div>
        {/if}
      </div>
    {:else if !tab.grpcResult}
      {#if connectFailed}
        {@render unreachable(
          connectError?.message ?? '',
          () => requestGrpcEditorAction(tab.id, 'reconnect'),
          () => requestGrpcEditorAction(tab.id, 'tls'),
        )}
      {:else if !sending}{@render waitingForResponse(true)}{/if}
    {:else if respTab === 'tests' && testResults}
      <div class="bs-rbody bs-tests">
        {#if testResults.error}
          <div class="bs-test-error">
            <span class="material-symbols-outlined" style="font-size:15px">error</span>{t('response.script_error', {
              error: testResults.error,
            })}
          </div>
        {/if}
        {#if testResults.tests.length > 0}
          <div class="bs-test-list">
            {#each testResults.tests as t, i (i)}
              <div class="bs-test-row" class:fail={!t.passed}>
                <span class="material-symbols-outlined ic" style="font-size:16px"
                  >{t.passed ? 'check_circle' : 'cancel'}</span
                >
                <span class="nm">{t.name}</span>
                {#if !t.passed && t.error}<span class="er">{t.error}</span>{/if}
              </div>
            {/each}
          </div>
        {:else if !testResults.error}
          <div style="color:var(--t3);padding:4px 0">
            {t('response.tests.none_a')}<code>pm.test(...)</code>{t('response.tests.none_b')}
          </div>
        {/if}
        {#if testResults.logs.length > 0}
          <div class="bs-test-console">
            <div class="hd">{t('response.console')}</div>
            {#each testResults.logs as line, i (i)}
              <div class="ln">{line}</div>
            {/each}
          </div>
        {/if}
      </div>
    {:else if respTab === 'timeline'}
      <!-- prettier-ignore -->
      <div class="bs-rbody"><div class="bs-code bs-timeline">
        <div><span class="k">{t('response.status')}</span>{grpcStatusLabel(grpcCode)}</div>
        <div><span class="k">{t('response.time')}</span>{grpcElapsed(tab.grpcResult.elapsed_ms)}</div>
        <div><span class="k">{t('response.size')}</span>{formatBytes(tab.grpcResult.size_bytes)}</div>
        {#if tab.grpc?.endpoint}<div><span class="k">{t('response.endpoint')}</span>{tab.grpc.endpoint}</div>{/if}
        {#if tab.grpc?.method}<div><span class="k">{t('response.method')}</span>{tab.grpc.method}</div>{/if}
      </div></div>
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
            <button
              class="bs-body-beautify"
              type="button"
              onclick={() => openGrpcEditorSection(tab.id, grpcError.action!)}>{grpcError.actionLabel}</button
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
        {@render rtab('cookies', t('response.tab.cookies'), responseCookies.length, tab.response?.status === 0)}
        {@render rtab('timeline', t('response.tab.timeline'))}
        {#if testResults}{@render rtab('tests', t('response.tab.tests'))}{/if}
      </div>
      {#if sending}
        {@render sendingMeta()}
      {:else if tab.response}
        <div class="bs-meta">
          <span class="bs-stpill {tone}"
            ><span class="g" aria-hidden="true">{tone === 'success' ? '✓' : tab.response.status ? '!' : '×'}</span>{tab
              .response.status
              ? `${tab.response.status} ${statusText(tab.response.status)}`
              : isCancelled(tab.response)
                ? t('response.status.cancelled')
                : t('response.status.none')}</span
          >
          <span class="mo lb-time" title={t('response.time')}
            >{tab.response.elapsed_ms >= 1000
              ? `${(tab.response.elapsed_ms / 1000).toFixed(tab.response.elapsed_ms >= 10_000 ? 1 : 2)} s`
              : `${tab.response.elapsed_ms} ms`}</span
          >
          <span class="mo lb-size" title={t('response.size')}
            >{tab.response.status ? formatBytes(tab.response.size_bytes) : '—'}</span
          >
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
    class:dim={sending}
    role="tabpanel"
    id="bs-resppanel"
    aria-labelledby="bs-resptab-{respTab}"
  >
    {#if !tab.response}
      {#if !sending}{@render waitingForResponse(false)}{/if}
    {:else if respTab === 'tests' && testResults}
      <div class="bs-rbody bs-tests">
        {#if testResults.error}
          <div class="bs-test-error">
            <span class="material-symbols-outlined" style="font-size:15px">error</span>{t('response.script_error', {
              error: testResults.error,
            })}
          </div>
        {/if}
        {#if testResults.tests.length > 0}
          <div class="bs-test-list">
            {#each testResults.tests as t, i (i)}
              <div class="bs-test-row" class:fail={!t.passed}>
                <span class="material-symbols-outlined ic" style="font-size:16px"
                  >{t.passed ? 'check_circle' : 'cancel'}</span
                >
                <span class="nm">{t.name}</span>
                {#if !t.passed && t.error}<span class="er">{t.error}</span>{/if}
              </div>
            {/each}
          </div>
        {:else if !testResults.error}
          <div style="color:var(--t3);padding:4px 0">
            {t('response.tests.none_a')}<code>pm.test(...)</code>{t('response.tests.none_b')}
          </div>
        {/if}
        {#if testResults.logs.length > 0}
          <div class="bs-test-console">
            <div class="hd">{t('response.console')}</div>
            {#each testResults.logs as line, i (i)}
              <div class="ln">{line}</div>
            {/each}
          </div>
        {/if}
      </div>
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
    {:else if respTab === 'cookies'}
      <!-- prettier-ignore -->
      <div class="bs-rbody"><div class="bs-code">{#each responseCookies as c, i (i)}<div>{c}</div>{/each}{#if responseCookies.length === 0}<span style="color:var(--t3)">{t('response.no_cookies')}</span>{/if}</div></div>
    {:else if respTab === 'timeline'}
      <!-- prettier-ignore -->
      <div class="bs-rbody"><div class="bs-code bs-timeline">
        <div><span class="k">{t('response.status')}</span>{tab.response.status || 'ERR'} {statusText(tab.response.status)}</div>
        <div><span class="k">{t('response.time')}</span>{tab.response.elapsed_ms} ms</div>
        <div><span class="k">{t('response.size')}</span>{formatBytes(tab.response.size_bytes)}{tab.response.body_truncated ? t('response.truncated_paren') : ''}</div>
        {#if responseContentType}<div><span class="k">Content-Type</span>{responseContentType}</div>{/if}
        {#if tab.response.final_url}<div><span class="k">URL</span>{tab.response.final_url}</div>{/if}
      </div></div>
    {:else if respTab === 'headers'}
      <!-- prettier-ignore -->
      <div class="bs-rbody"><div class="bs-code">{#each responseHeaderEntries as [k, v] (k)}<div><span class="k">{k}</span>: {v}</div>{/each}{#if responseHeaderEntries.length === 0}<span style="color:var(--t3)">{t('response.no_headers')}</span>{/if}</div></div>
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
