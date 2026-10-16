<script lang="ts">
  /**
   * Flow · gRPC Stream (ST1–ST7): the one feed for every stream kind — ↑ sent and ↓ received in time
   * order, a filter (text or `$.path`) and direction toggle above it, pause / “Jump to latest”, the
   * half-close marker, the closing line, and the message pane on the right when a row is picked.
   *
   * Pause is the parent's (`pause`, bindable) because the status pill shows it too; it is tied to the
   * stream's `startedAt`, so a new run starts unpaused.
   *
   * Flow · SSE: with `sse` the same feed shows an HTTP event-stream (server-only, no direction toggle);
   * a row's label (event name, `#id`) replaces the arrow, and the footer counts events and says how it
   * ended. `tab.grpcStream`, `tab.grpcResult`, `code` and `writable` are not read then.
   */
  import { t, tp } from '$shared/i18n';
  import {
    elapsedLabel,
    formatBytes,
    grpcStatusLabel,
    type GrpcStreamMessage,
    type SseEvent,
    type StreamEnd,
    type Tab,
  } from '$shared/model';
  import { responseFileName, saveResponseBody } from './saveResponse';
  import {
    formatCount,
    inlineJson,
    intervalLabel,
    intervalMs,
    jsonTokens,
    prettyJson,
    sseEndKey,
    sseMessages,
    streamClock,
    visibleMessages,
    type FeedMessage,
    type StreamDirection,
    type StreamKind,
  } from './streamFeed';
  import { IconButton } from '$shared/ui/components';
  import RespBody from './RespBody.svelte';

  let {
    tab,
    sending,
    writable,
    code,
    pause = $bindable(),
    sse,
  }: {
    tab: Tab;
    sending: boolean;
    /** Client/bidi: our side is still open for Send. */
    writable: boolean;
    /** gRPC status code of the finished call (`OK`, `INTERNAL`, `CANCELLED`…). */
    code: string;
    pause: { startedAt: number; at: number } | undefined;
    /** Flow · SSE: an HTTP event-stream instead of the gRPC stream; `end` once it is over. */
    sse?: { events: SseEvent[]; startedAt: number; end?: StreamEnd };
  } = $props();

  type FeedStream = { messages: FeedMessage[]; startedAt: number; kind?: StreamKind; halfClosedAt?: number };
  const stream = $derived<FeedStream>(
    sse ? { messages: sseMessages(sse.events), startedAt: sse.startedAt, kind: 'server' } : tab.grpcStream!,
  );
  const kind = $derived(stream.kind ?? 'server');
  const result = $derived(sse ? undefined : tab.grpcResult);
  const fmt = (n: number) => formatCount(n);
  const msgs = (n: number) => (sse ? tp(n, ['event', 'events']) : tp(n, ['message', 'messages']));

  const DIRS: [StreamDirection, string][] = [
    ['all', 'response.stream.all'],
    ['sent', 'response.stream.dir_sent'],
    ['recv', 'response.stream.dir_recv'],
  ];
  let query = $state('');
  let dir = $state<StreamDirection>('all');
  let list = $state<HTMLDivElement>();
  let picked = $state<{ startedAt: number; key: string }>();

  /** Messages frozen by the pause: the feed stops at this count while new ones keep arriving. */
  const frozenAt = $derived(pause?.startedAt === stream.startedAt ? pause.at : undefined);
  const all = $derived(frozenAt === undefined ? stream.messages : stream.messages.slice(0, frozenAt));
  const shown = $derived(visibleMessages(all, dir, query));
  const pos = $derived(new Map(stream.messages.map((m, i) => [m, i])));
  const key = (m: GrpcStreamMessage) => (m.sent ? 's' : 'r') + m.index;
  const selected = $derived(
    picked?.startedAt === stream.startedAt ? stream.messages.find((m) => key(m) === picked?.key) : undefined,
  );
  const halfIdx = $derived.by(() => {
    const at = stream.halfClosedAt;
    if (at === undefined) return -1;
    const i = shown.findIndex((m) => m.atMs > at);
    return i === -1 ? shown.length : i;
  });
  const interval = (m: GrpcStreamMessage) =>
    intervalMs(stream.messages, pos.get(m) ?? 0, stream.startedAt, stream.halfClosedAt);
  const method = $derived(
    sse ? undefined : tab.grpc?.tree?.services.flatMap((s) => s.methods).find((m) => m.symbol === tab.grpc?.method),
  );
  const trailers = $derived(Object.keys(result?.trailers ?? {}).length);
  const failed = $derived(!!result && !result.ok);
  const received = $derived(stream.messages.filter((m) => !m.sent).length);

  function pauseFeed(): void {
    pause = { startedAt: stream.startedAt, at: stream.messages.length };
  }
  function follow(): void {
    pause = undefined;
    if (list) list.scrollTop = list.scrollHeight;
  }
  // Live and not paused: keep the newest message in view.
  $effect(() => {
    void shown.length;
    if (frozenAt === undefined && list) list.scrollTop = list.scrollHeight;
  });
  /** Scrolling up while live pauses the feed, so it does not jump while you read. */
  function onScroll(): void {
    if (!sending || frozenAt !== undefined || !list) return;
    if (list.scrollHeight - list.scrollTop - list.clientHeight > 24) pauseFeed();
  }
  function pick(m: GrpcStreamMessage | undefined): void {
    picked = m && { startedAt: stream.startedAt, key: key(m) };
    if (m) list?.querySelector(`[data-key="${key(m)}"]`)?.scrollIntoView({ block: 'nearest' });
  }
  function onListKey(e: KeyboardEvent): void {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = selected ? shown.indexOf(selected) : -1;
    const next = e.key === 'ArrowDown' ? Math.min(i + 1, shown.length - 1) : Math.max(i - 1, 0);
    pick(shown[i === -1 ? shown.length - 1 : next]);
  }
  function onWindowKey(e: KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && e.key === '.' && frozenAt !== undefined) {
      e.preventDefault();
      follow();
    }
  }
  async function copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard can be unavailable in non-Tauri browser smoke tests.
    }
  }
  function save(m: GrpcStreamMessage): void {
    saveResponseBody(prettyJson(m.body), responseFileName(`${tab.title}-${m.index}`, 'JSON'), t('lb.save')).catch((e) =>
      console.error('stream: save failed', e),
    );
  }
</script>

<svelte:window onkeydown={onWindowKey} />

{#snippet halfClose()}
  <div class="sys">
    <span class="material-symbols-outlined" aria-hidden="true">keyboard_tab</span>{t(
      'response.stream.half_closed',
    )}<span class="sp"></span><span class="hint">{streamClock(stream.halfClosedAt ?? 0)}</span>
  </div>
{/snippet}

<div class="bs-stream" class:split={!!selected}>
  {#if kind !== 'client'}
    <div class="bs-stream-bar">
      <label class="filter">
        <span class="material-symbols-outlined" aria-hidden="true">filter_list</span>
        <input bind:value={query} placeholder={t('response.stream.filter')} spellcheck="false" autocomplete="off" />
      </label>
      {#if kind === 'bidi'}
        <div class="dir" role="group" aria-label={t('response.stream.dir')}>
          {#each DIRS as [d, label] (d)}
            <button type="button" class:on={dir === d} aria-pressed={dir === d} onclick={() => (dir = d)}
              >{t(label)}</button
            >
          {/each}
        </div>
      {/if}
      {#if shown.length !== all.length}
        <span class="of">{t('response.stream.of', { n: fmt(shown.length), total: fmt(all.length) })}</span>
      {/if}
      <span class="sp"></span>
      {#if frozenAt !== undefined}
        <button type="button" class="warn" onclick={follow}
          ><span class="material-symbols-outlined" aria-hidden="true">play_arrow</span>{t(
            'response.stream.resume',
          )}</button
        >
      {:else if sending}
        <button type="button" onclick={pauseFeed}
          ><span class="material-symbols-outlined" aria-hidden="true">pause</span>{t('response.stream.pause')}</button
        >
      {/if}
      <button type="button" onclick={follow}
        ><span class="material-symbols-outlined" aria-hidden="true">vertical_align_bottom</span>{t(
          'response.stream.follow',
        )}</button
      >
    </div>
  {/if}
  <div class="bs-stream-body">
    <RespBody
      class="bs-stream-feed"
      bind:ref={list}
      onscroll={onScroll}
      onkeydown={onListKey}
      role="listbox"
      tabindex={0}
      aria-label={t('response.stream.feed')}
    >
      {#each shown as m, i (key(m))}
        {#if i === halfIdx}{@render halfClose()}{/if}
        <!-- prettier-ignore -->
        <div
          class="msg"
          class:sent={m.sent}
          class:on={m === selected}
          class:last={i === shown.length - 1 && !failed}
          data-key={key(m)}
          role="option"
          aria-selected={m === selected}
          tabindex="-1"
          onclick={() => pick(m)}
          onkeydown={(e) => e.key === 'Enter' && pick(m)}
        >{#if m.label}<span class="hint">{m.label}</span>{:else}<span class="material-symbols-outlined dir" aria-hidden="true">{m.sent ? 'arrow_upward' : 'arrow_downward'}</span>{/if}<span class="no">#{m.index}</span><span class="at">{streamClock(m.atMs, !!selected)}</span><code>{#each jsonTokens(inlineJson(m.body)) as tk, j (j)}<span class={tk.kind}>{tk.text}</span>{/each}</code><span class="dt">{m.sent ? t('response.stream.sent') : intervalLabel(interval(m))}</span></div>
      {/each}
      {#if halfIdx === shown.length}{@render halfClose()}{/if}
      {#if frozenAt !== undefined}
        <div class="sys warn">
          <span class="material-symbols-outlined" aria-hidden="true">pause_circle</span>{t('response.stream.paused', {
            n: fmt(stream.messages.length - frozenAt),
            msgs: msgs(stream.messages.length - frozenAt),
          })}<span class="sp"></span><button type="button" onclick={follow}
            >{t('response.stream.resume')}&nbsp;&nbsp;⌘.</button
          >
        </div>
      {:else if sse}
        {@const n = stream.messages.length}
        <div class="waiting" class:ended={!!sse.end} class:failed={sse.end?.reason === 'error'}>
          <span class="dot" aria-hidden="true"
          ></span>{`${fmt(n)} ${msgs(n)} · ${t(sse.end ? sseEndKey(sse.end) : 'response.stream.sse_live')}${sse.end?.error ? ` · ${sse.end.error}` : ''}`}
        </div>
      {:else if sending && writable}
        <div class="waiting open">
          <span class="dot" aria-hidden="true"></span>{t(
            kind === 'bidi' ? 'response.stream.open_bidi' : 'response.stream.open_client',
          )}{#if kind === 'client'}<span class="sp"></span><span class="hint">{t('response.stream.send_more')}</span
            >{/if}
        </div>
      {:else if sending}
        <div class="waiting"><span class="dot" aria-hidden="true"></span>{t('response.waiting_next')}</div>
      {:else if result?.ok}
        <div class="sys ok">
          <span class="material-symbols-outlined" aria-hidden="true">check_circle</span>{kind === 'client'
            ? t('response.stream.done', { status: grpcStatusLabel(code) })
            : t('response.stream.done_count', {
                status: grpcStatusLabel(code),
                n: fmt(received),
                msgs: msgs(received),
                time: elapsedLabel(result.elapsed_ms),
              })}<span class="sp"></span>{#if trailers}<span class="hint">trailers {trailers}</span>{/if}
        </div>
      {:else if result}
        {@const n = stream.messages.length}
        {@const saved = t('response.stream.saved', {
          n,
          msgs: msgs(n),
          recv: tp(n, ['', '']),
          until: t(code === 'CANCELLED' ? 'response.stream.until_stop' : 'response.stream.until_error'),
          saved: tp(n, ['', '']),
        })}
        {#if code !== 'CANCELLED'}
          <div class="msg err" role="alert">
            <span class="material-symbols-outlined dir" aria-hidden="true">close</span><span class="no"></span>
            <span class="at">{streamClock(stream.startedAt + result.elapsed_ms)}</span>
            <code>{grpcStatusLabel(code)} · {result.body}</code>
          </div>
        {/if}
        <div class="waiting ended">
          <span class="dot" aria-hidden="true"
          ></span>{`${t(code === 'CANCELLED' ? 'response.stream.stopped' : 'response.stream.closed')} ${saved}`}
        </div>
      {/if}
    </RespBody>
    {#if selected}
      {@const type = selected.sent ? method?.inputType : method?.outputType}
      <aside class="bs-stream-msg" aria-label={t('response.stream.message', { n: selected.index })}>
        <div class="hd">
          <span class="material-symbols-outlined" aria-hidden="true"
            >{selected.sent ? 'arrow_upward' : 'arrow_downward'}</span
          >
          <b>{t('response.stream.message', { n: selected.index })}</b>
          <span class="sp"></span>
          <IconButton type="button" title={t('common.copy')} onclick={() => copy(prettyJson(selected.body))}
            ><span class="material-symbols-outlined">content_copy</span></IconButton
          >
          <IconButton type="button" title={t('lb.save')} onclick={() => save(selected)}
            ><span class="material-symbols-outlined">download</span></IconButton
          >
          <IconButton type="button" title={t('common.close')} onclick={() => pick(undefined)}
            ><span class="material-symbols-outlined">close</span></IconButton
          >
        </div>
        <div class="meta">
          <div><span>{t('response.stream.time')}</span>{streamClock(selected.atMs)}</div>
          <div><span>{t('response.stream.interval')}</span>{intervalLabel(interval(selected), 3)}</div>
          <div>
            <span>{t('response.stream.size')}</span>{selected.sizeBytes ? formatBytes(selected.sizeBytes) : '—'}
          </div>
        </div>
        {#if type}<div class="type">{type}</div>{/if}
        <!-- prettier-ignore -->
        <pre class="json">{#each jsonTokens(prettyJson(selected.body)) as tk, j (j)}<span class={tk.kind}>{tk.text}</span>{/each}</pre>
        <div class="nav">{t('response.stream.neighbours')}</div>
      </aside>
    {/if}
  </div>
</div>

<style>
  :global(.bs) .bs-stream-bar :global(.dir) {
    display: flex;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    background: var(--color-field);
  }

  :global(.bs) .bs-stream-feed :global(.msg) {
    flex: none;
    display: flex;
    align-items: center;
    height: 30px;
    padding: 0 12px;
    border-radius: var(--radius-control);
    font: var(--font-size-body)/16px var(--font-code);
    white-space: pre;
    cursor: default;
  }

  :global(.bs) .bs-stream-feed :global(.msg.sent) {
    background: var(--color-field);
  }

  :global(.bs) .bs-stream-feed :global(.msg.last) {
    background: var(--color-hover);
  }

  :global(.bs) .bs-stream-feed :global(.msg.on) {
    background: var(--color-hover);
  }

  :global(.bs) .bs-stream-feed :global(.msg:hover) {
    background: var(--color-hover);
  }

  /* Belongs to response.css, but the cascade needs it before `:root .bs .bs-stream-feed code .s` (same elements, same specificity), so it lives here. */
  :global(.bs) .bs-stream-feed :global(code .k) {
    color: var(--sk);
  }

  :global(.bs) .bs-stream-feed :global(code .s) {
    color: var(--ss);
  }

  /* Belongs to response.css, but the cascade needs it before `:root .bs .bs-stream-feed code .p` (same elements, same specificity), so it lives here. */
  :global(.bs) .bs-stream-feed :global(code .n) {
    color: var(--sn);
  }

  :global(.bs) .bs-stream-feed :global(code .p) {
    color: var(--syntax-punct, var(--color-text-muted));
  }

  :global(.bs) .bs-stream-feed :global(.msg.err) {
    background: var(--color-danger-soft);
    color: var(--color-danger);
  }

  :global(.bs) .bs-stream-feed :global(.msg.err .at) {
    color: var(--color-danger);
  }

  :global(.bs) .bs-stream-feed :global(.msg.err code) {
    color: var(--color-danger);
  }

  /* S20 + Flow · gRPC Stream: toolbar, one feed for ↑ sent / ↓ received, system lines, message pane. */
  :global(.bs) .bs-stream {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  :global(.bs) .bs-stream-bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px 6px;
    font: 500 var(--font-size-caption) var(--font-ui);
  }

  :global(.bs) .bs-stream-bar :global(.filter) {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 240px;
    min-width: 120px;
    height: 25px;
    padding: 0 10px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    background: var(--color-field);
    color: var(--color-text-muted);
  }

  :global(.bs) .bs-stream-bar :global(.filter input) {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--color-text);
    font: var(--font-size-body) var(--font-code);
  }

  :global(.bs) .bs-stream-bar :global(.filter input::placeholder) {
    color: var(--color-text-muted);
    font-family: var(--font-ui);
  }

  :global(.bs) .bs-stream-bar :global(.filter:focus-within) {
    border-color: var(--color-border);
  }

  :global(.bs) .bs-stream-bar :global(.material-symbols-outlined) {
    font-size: 14px;
  }

  :global(.bs) .bs-stream-bar :global(button) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 22px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--color-text-secondary);
    font: inherit;
    white-space: nowrap;
  }

  :global(.bs) .bs-stream-bar :global(.dir button) {
    height: 19px;
  }

  :global(.bs) .bs-stream-bar :global(button:hover) {
    background: var(--color-hover);
    color: var(--color-text);
  }

  :global(.bs) .bs-stream-bar :global(.dir button.on) {
    background: var(--color-raised);
    color: var(--color-text);
    font-weight: 600;
  }

  :global(.bs) .bs-stream-bar :global(button.warn) {
    background: var(--color-warning-soft);
    color: var(--color-warning);
  }

  :global(.bs) .bs-stream-bar :global(button.warn:hover) {
    background: var(--color-warning-soft);
    color: var(--color-warning);
  }

  :global(.bs) .bs-stream-bar :global(.of) {
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-code);
    white-space: nowrap;
  }

  :global(.bs) .bs-stream :global(.sp) {
    flex: 1;
  }

  :global(.bs) .bs-stream-body {
    flex: 1;
    min-height: 0;
    display: flex;
  }

  :global(.bs) .bs-stream-feed {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px 12px 12px;
    overflow: auto;
    outline: 0;
  }

  :global(.bs) .bs-stream-feed :global(.dir) {
    flex: 0 0 13px;
    font-size: 13px;
    font-variation-settings: 'wght' 500;
    color: var(--color-text-muted);
  }

  :global(.bs) .bs-stream-feed :global(.no) {
    flex: 0 0 40px;
    margin-right: 14px;
    text-align: right;
    color: var(--color-text-muted);
    font: 600 var(--font-size-caption) var(--font-code);
  }

  :global(.bs) .bs-stream-feed :global(.at) {
    flex: 0 0 104px;
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-code);
  }

  :global(.bs) .bs-stream.split .bs-stream-feed :global(.at) {
    flex-basis: 80px;
  }

  :global(.bs) .bs-stream-feed :global(code) {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font: inherit;
    color: var(--color-text);
  }

  :global(:root .bs .bs-stream-feed .dt) {
    flex: none;
    margin-left: 12px;
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-code);
  }

  :global(.bs) .bs-stream-feed :global(.hint) {
    flex: none;
    margin-left: 12px;
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-code);
  }

  :global(:root .bs .bs-stream.split .bs-stream-feed .dt) {
    display: none;
  }

  :global(.bs) .bs-stream-feed :global(.msg.sent .dir) {
    color: var(--method-grpc);
  }

  :global(.bs) .bs-stream-feed :global(.msg.sent .no) {
    color: var(--method-grpc);
  }

  :global(.bs .bs-stream-feed .msg.sent) .dt {
    color: var(--method-grpc);
  }

  :global(.bs) .bs-stream-feed :global(.waiting) {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
    color: var(--color-text-muted);
    font: var(--font-size-body) var(--font-ui);
  }

  :global(:root .bs .bs-stream-feed .sys) {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
    color: var(--color-text-muted);
    font: var(--font-size-body) var(--font-ui);
  }

  :global(:root .bs .bs-stream-feed .sys) {
    border-radius: var(--radius-control);
  }

  :global(:root .bs .bs-stream-feed .sys .material-symbols-outlined) {
    font-size: 14px;
  }

  :global(:root .bs .bs-stream-feed .sys.ok) {
    background: var(--color-success-soft);
    color: var(--color-success);
  }

  :global(:root .bs .bs-stream-feed .sys.warn) {
    background: var(--color-warning-soft);
    color: var(--color-warning);
  }

  :global(:root .bs .bs-stream-feed .sys.warn button) {
    border: 0;
    background: transparent;
    color: inherit;
    font: 600 var(--font-size-caption) var(--font-ui);
  }

  :global(.bs) .bs-stream-feed :global(.waiting .dot) {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-success);
  }

  :global(.bs) .bs-stream-feed :global(.waiting.open) {
    color: var(--color-var);
  }

  :global(.bs) .bs-stream-feed :global(.waiting.open .dot) {
    background: var(--color-var);
  }

  :global(.bs) .bs-stream-feed :global(.msg.err .dir) {
    color: var(--color-danger);
  }

  :global(.bs) .bs-stream-feed :global(.waiting.ended .dot) {
    background: var(--color-text-muted);
  }

  /* SSE ended on an error: same danger tone as the gRPC error row. */
  :global(.bs) .bs-stream-feed :global(.waiting.ended.failed) {
    background: var(--color-danger-soft);
    color: var(--color-danger);
  }

  :global(.bs) .bs-stream-feed :global(.waiting.ended.failed .dot) {
    background: var(--color-danger);
  }

  /* ST3: the picked message in full. */
  :global(.bs) .bs-stream-msg {
    flex: 0 0 380px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 14px;
    border-left: 1px solid var(--color-border-subtle);
    overflow: auto;
  }

  :global(.bs) .bs-stream-msg :global(.hd) {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-text);
    font: 600 var(--font-size-ui) var(--font-ui);
  }

  :global(.bs) .bs-stream-msg :global(.hd > .material-symbols-outlined) {
    font-size: 14px;
    color: var(--color-text-secondary);
  }

  :global(.bs) .bs-stream-msg :global(.meta) {
    display: flex;
    gap: 14px;
    color: var(--color-text);
    font: var(--font-size-body) var(--font-code);
  }

  :global(.bs) .bs-stream-msg :global(.meta span) {
    display: block;
    margin-bottom: 3px;
    color: var(--color-text-muted);
    font: 500 9.5px var(--font-code);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  :global(.bs) .bs-stream-msg :global(.type) {
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-code);
  }

  :global(.bs) .bs-stream-msg :global(.json) {
    margin: 0;
    padding: 10px 12px;
    border: 1px solid var(--color-border-subtle);
    border-radius: 14px;
    background: var(--color-field);
    font: var(--font-size-body) / 20px var(--font-code);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  :global(.bs) .bs-stream-msg :global(.json .k) {
    color: var(--sk);
  }

  :global(.bs) .bs-stream-msg :global(.json .s) {
    color: var(--ss);
  }

  :global(.bs) .bs-stream-msg :global(.json .n) {
    color: var(--sn);
  }

  :global(.bs) .bs-stream-msg :global(.json .p) {
    color: var(--syntax-punct, var(--color-text-muted));
  }

  :global(.bs) .bs-stream-msg :global(.nav) {
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-ui);
  }
</style>
