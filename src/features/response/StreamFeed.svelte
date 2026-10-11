<script lang="ts">
  /**
   * Flow · gRPC Stream (ST1–ST7): the one feed for every stream kind — ↑ sent and ↓ received in time
   * order, a filter (text or `$.path`) and direction toggle above it, pause / «К последнему», the
   * half-close marker, the closing line, and the message pane on the right when a row is picked.
   *
   * Pause is the parent's (`pause`, bindable) because the status pill shows it too; it is tied to the
   * stream's `startedAt`, so a new run starts unpaused.
   */
  import { t, tp, uiLanguage } from '$shared/i18n';
  import { elapsedLabel, formatBytes, grpcStatusLabel, type GrpcStreamMessage, type Tab } from '$shared/model';
  import { responseFileName, saveResponseBody } from './saveResponse';
  import {
    formatCount,
    inlineJson,
    intervalLabel,
    intervalMs,
    jsonTokens,
    prettyJson,
    streamClock,
    visibleMessages,
    type StreamDirection,
  } from './streamFeed';

  let {
    tab,
    sending,
    writable,
    code,
    pause = $bindable(),
  }: {
    tab: Tab;
    sending: boolean;
    /** Client/bidi: our side is still open for Send. */
    writable: boolean;
    /** gRPC status code of the finished call (`OK`, `INTERNAL`, `CANCELLED`…). */
    code: string;
    pause: { startedAt: number; at: number } | undefined;
  } = $props();

  const stream = $derived(tab.grpcStream!);
  const kind = $derived(stream.kind ?? 'server');
  const result = $derived(tab.grpcResult);
  const fmt = (n: number) => formatCount(n, uiLanguage.current);
  const msgs = (n: number) => tp(n, ['сообщение', 'сообщения', 'сообщений'], ['message', 'messages']);

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
    tab.grpc?.tree?.services.flatMap((s) => s.methods).find((m) => m.symbol === tab.grpc?.method),
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
    <div
      class="bs-rbody bs-stream-feed"
      bind:this={list}
      onscroll={onScroll}
      onkeydown={onListKey}
      role="listbox"
      tabindex="0"
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
        ><span class="material-symbols-outlined dir" aria-hidden="true">{m.sent ? 'arrow_upward' : 'arrow_downward'}</span><span class="no">#{m.index}</span><span class="at">{streamClock(m.atMs, !!selected)}</span><code>{#each jsonTokens(inlineJson(m.body)) as tk, j (j)}<span class={tk.kind}>{tk.text}</span>{/each}</code><span class="dt">{m.sent ? t('response.stream.sent') : intervalLabel(interval(m))}</span></div>
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
          recv: tp(n, ['полученное', 'полученные', 'полученных'], ['', '']),
          until: t(code === 'CANCELLED' ? 'response.stream.until_stop' : 'response.stream.until_error'),
          saved: tp(n, ['сохранено', 'сохранены', 'сохранены'], ['', '']),
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
    </div>
    {#if selected}
      {@const type = selected.sent ? method?.inputType : method?.outputType}
      <aside class="bs-stream-msg" aria-label={t('response.stream.message', { n: selected.index })}>
        <div class="hd">
          <span class="material-symbols-outlined" aria-hidden="true"
            >{selected.sent ? 'arrow_upward' : 'arrow_downward'}</span
          >
          <b>{t('response.stream.message', { n: selected.index })}</b>
          <span class="sp"></span>
          <button class="bs-ric" type="button" title={t('common.copy')} onclick={() => copy(prettyJson(selected.body))}
            ><span class="material-symbols-outlined">content_copy</span></button
          >
          <button class="bs-ric" type="button" title={t('lb.save')} onclick={() => save(selected)}
            ><span class="material-symbols-outlined">download</span></button
          >
          <button class="bs-ric" type="button" title={t('common.close')} onclick={() => pick(undefined)}
            ><span class="material-symbols-outlined">close</span></button
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
