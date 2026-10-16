<script lang="ts">
  // Flow · Консоль (CT1–CT3): every send newest first, its logs and tests under the row; a click
  // opens the request and response as they went; quick filters with an «N из M» counter.
  import { tick } from 'svelte';
  import { t } from '$shared/i18n';
  import { HTTP_STATUS_TEXT } from '$shared/model';
  import { appConsole, type AppConsoleEntry } from '$entities/request';
  import { openEntry, retryEntry } from './actions';
  import { utilityUi } from './store.svelte';
  import { terminal } from './terminal.svelte';
  import {
    CONSOLE_QUICK,
    consoleStatus,
    curlForShell,
    formatElapsed,
    isSecretHeader,
    maskSecret,
    matchesConsoleFilter,
    matchesQuick,
  } from './utilPanel';
  import { Spacer } from '$shared/ui/components';

  let { onTerminal }: { onTerminal: () => void } = $props();

  let outputEl = $state<HTMLDivElement | null>(null);
  let copied = $state(false);

  const total = $derived(appConsole.entries.length);
  // C1: newest first.
  const visible = $derived(
    appConsole.entries
      .filter((e) => matchesQuick(e, utilityUi.consoleQuick) && matchesConsoleFilter(e, utilityUi.consoleFilter))
      .reverse(),
  );
  const filtered = $derived(utilityUi.consoleQuick !== 'all' || utilityUi.consoleFilter.trim() !== '');

  const time = (at: number) =>
    new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const methodVar = (m: string) =>
    `var(--method-${['get', 'post', 'put', 'patch', 'delete'].includes(m.toLowerCase()) ? m.toLowerCase() : 'grpc'})`;
  const size = (b: number) => (b >= 1024 ? `${(b / 1024).toFixed(1)} KB` : `${b} B`);
  const showHeader = (name: string, value: string) => (isSecretHeader(name) ? maskSecret(value) : value);

  function resetFilter(): void {
    utilityUi.consoleQuick = 'all';
    utilityUi.consoleFilter = '';
  }

  async function copyCurl(e: AppConsoleEntry): Promise<void> {
    await navigator.clipboard.writeText(curlForShell(e).command).catch(() => {});
    copied = true;
    setTimeout(() => (copied = false), 1200);
  }

  function toTerminal(e: AppConsoleEntry): void {
    const { command, env } = curlForShell(e);
    void terminal.handOff(command, env);
    onTerminal();
  }

  $effect(() => {
    void appConsole.entries.length;
    void tick().then(() => outputEl?.scrollTo({ top: 0 }));
  });
</script>

<div class="bs-console-quick">
  {#each CONSOLE_QUICK as q (q)}
    <button
      type="button"
      class="bs-chip"
      class:on={utilityUi.consoleQuick === q}
      aria-pressed={utilityUi.consoleQuick === q}
      onclick={() => (utilityUi.consoleQuick = q)}>{t(`util.quick.${q}`)}</button
    >
  {/each}
  <Spacer />
  {#if filtered}<span class="bs-console-of">{t('util.console.of', { n: visible.length, m: total })}</span>{/if}
  <span class="bs-console-keep"
    ><span class="material-symbols-outlined" aria-hidden="true">history</span>{t('util.console.keep')}</span
  >
</div>

<div class="bs-console-output" bind:this={outputEl} role="log" aria-live="polite">
  {#if visible.length === 0}
    <div class="bs-utility-empty">
      <span class="material-symbols-outlined">data_object</span>
      <div>{total ? t('util.console.none') : t('util.empty.console')}</div>
    </div>
  {:else}
    {#each visible as entry (entry.id)}
      {@const st = consoleStatus(entry)}
      {@const open = utilityUi.openEntry === entry.id}
      <article class="bs-console-entry" class:open>
        <button
          type="button"
          class="bs-console-row"
          aria-expanded={open}
          onclick={() => (utilityUi.openEntry = open ? null : entry.id)}
        >
          <time>{time(entry.at)}</time>
          <span class="protocol">{entry.protocol === 'grpc' ? 'gRPC' : 'HTTP'}</span>
          <span class="method" style:color={methodVar(entry.method)}>{entry.method}</span>
          <span class="url" title={entry.url}>{entry.url || '—'}</span>
          <span class="status {st.tone}">{st.label}</span>
          <span class="elapsed">{formatElapsed(entry.elapsedMs)}</span>
          <span class="material-symbols-outlined chevron" aria-hidden="true">{open ? 'expand_less' : ''}</span>
        </button>
        {#if entry.message}<pre
            class="bs-console-detail {st.tone === 'warn' ? 'warn' : 'error'}">{entry.message}</pre>{/if}
        {#each entry.logs ?? [] as log, i (i)}<pre class="bs-console-detail"><span class="log">console.log</span
            >  {log}</pre>{/each}
        {#if entry.tests?.length}
          <div class="bs-console-detail tests">
            {#each entry.tests as test, i (i)}{#if i}<span class="sep">·</span>{/if}<span class:fail={!test.passed}
                >{test.passed ? '✓' : '✗'} {test.name}</span
              >{/each}
          </div>
        {/if}
        {#if open}
          <div class="bs-console-cards">
            <section>
              <h4>{t('util.console.request')}</h4>
              <div><b>{entry.method}</b> {entry.url}</div>
              {#each Object.entries(entry.request?.headers ?? {}) as [k, v] (k)}
                <div><span class="k">{k}:</span> {showHeader(k, v)}</div>
              {/each}
              {#if entry.request?.body}<pre>{entry.request.body}</pre>{/if}
              {#if entry.env}<div><span class="k">{t('util.console.env')}:</span> {entry.env}</div>{/if}
            </section>
            <section>
              <h4>
                {t('util.console.response')} · {entry.status}{HTTP_STATUS_TEXT[Number(entry.status)]
                  ? ` ${HTTP_STATUS_TEXT[Number(entry.status)].toUpperCase()}`
                  : ''}
              </h4>
              {#each Object.entries(entry.response?.headers ?? {}) as [k, v] (k)}
                <div><span class="k">{k}:</span> {v}</div>
              {/each}
              {#if entry.response?.body}<pre class="body">{entry.response.body}</pre>{:else if !entry.response}<div
                  class="none"
                >
                  {entry.message || t('util.console.noResponse')}
                </div>{/if}
            </section>
            <section>
              <h4>{t('util.console.timing')} · {formatElapsed(entry.elapsedMs).toUpperCase()}</h4>
              <div><span class="k">{t('util.console.sentAt')}</span> {time(entry.at)}</div>
              <div><span class="k">{t('util.console.total')}</span> {formatElapsed(entry.elapsedMs)}</div>
              {#if entry.response}<div>
                  <span class="k">{t('util.console.size')}</span>
                  {size(entry.response.sizeBytes)}
                </div>{/if}
              {#if entry.runner}<div><span class="k">Runner</span></div>{/if}
            </section>
          </div>
          <div class="bs-console-actions">
            <button type="button" disabled={!entry.tabId && !entry.nodeId} onclick={() => openEntry(entry)}
              ><span class="material-symbols-outlined" aria-hidden="true">open_in_new</span>{t('util.act.open')}</button
            >
            <button type="button" disabled={!entry.tabId && !entry.nodeId} onclick={() => void retryEntry(entry)}
              ><span class="material-symbols-outlined" aria-hidden="true">replay</span>{t('util.act.retry')}</button
            >
            {#if entry.protocol !== 'grpc'}
              <button type="button" onclick={() => void copyCurl(entry)}
                ><span class="material-symbols-outlined" aria-hidden="true">content_copy</span>{copied
                  ? t('util.act.copied')
                  : t('util.act.curl')}</button
              >
              <button type="button" onclick={() => toTerminal(entry)}
                ><span class="material-symbols-outlined" aria-hidden="true">terminal</span>{t(
                  'util.act.terminal',
                )}</button
              >
            {/if}
          </div>
        {/if}
      </article>
    {/each}
    {#if filtered && total > visible.length}
      <div class="bs-console-end">
        {t('util.console.hidden', { n: total - visible.length })} ·
        <button type="button" onclick={resetFilter}>{t('util.reset')}</button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .bs-console-quick {
    flex: none;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 10px 2px;
    font-size: 11.5px;
  }
  .bs-console-of,
  .bs-console-keep {
    color: var(--t3);
    font-size: 11px;
  }
  .bs-console-keep {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    margin-left: 10px;
  }
  .bs-console-keep .material-symbols-outlined {
    font-size: 13px;
  }
  .bs-console-output {
    min-height: 0;
    flex: 1;
    overflow: auto;
    padding: 4px 8px 8px;
    font-family: var(--mono);
    scrollbar-gutter: stable;
  }
  .bs-console-entry {
    padding: 2px 0 6px;
    border: 1px solid transparent;
    border-radius: var(--radius-card);
  }
  .bs-console-entry.open {
    border-color: var(--sepsoft);
    background: color-mix(in srgb, var(--hover) 50%, transparent);
  }
  .bs-console-row {
    width: 100%;
    display: grid;
    grid-template-columns: 64px 38px 64px minmax(120px, 1fr) auto 62px 16px;
    align-items: center;
    gap: 8px;
    min-height: 26px;
    padding: 0 4px 0 10px;
    color: var(--text);
    font: inherit;
    font-size: 11px;
    text-align: left;
  }
  .bs-console-row time,
  .bs-console-row .elapsed,
  .bs-console-row .protocol {
    color: var(--t3);
  }
  .bs-console-row .protocol {
    font-size: 9.5px;
  }
  .bs-console-row .elapsed {
    text-align: right;
  }
  .bs-console-row .method {
    font-weight: 700;
  }
  .bs-console-row .url {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bs-console-row .chevron {
    color: var(--t3);
    font-size: 14px;
  }
  .status {
    justify-self: end;
    height: 18px;
    padding: 0 8px;
    border-radius: 999px;
    color: var(--green);
    background: color-mix(in srgb, var(--green) 14%, transparent);
    font-weight: 700;
    line-height: 18px;
    white-space: nowrap;
  }
  .status.info,
  .status.muted {
    color: var(--t2);
    background: var(--hover);
  }
  .status.warn {
    color: var(--orange);
    background: color-mix(in srgb, var(--orange) 14%, transparent);
  }
  .status.err {
    color: var(--red);
    background: color-mix(in srgb, var(--red) 14%, transparent);
  }
  .bs-console-detail {
    margin: 2px 0 0 120px;
    color: var(--t2);
    font: inherit;
    font-size: 11px;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .bs-console-detail .log {
    color: var(--t3);
  }
  .bs-console-detail.error {
    color: var(--red);
  }
  .bs-console-detail.warn {
    color: var(--orange);
  }
  .bs-console-detail.tests .fail {
    color: var(--red);
  }
  .bs-console-detail.tests .sep {
    margin: 0 7px;
    color: var(--t3);
  }
  .bs-console-cards {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    margin: 8px 10px 0;
  }
  .bs-console-cards section {
    min-width: 0;
    max-height: 180px;
    overflow: auto;
    padding: 8px 10px;
    border-radius: var(--radius-md);
    background: var(--inset);
    font-size: 11px;
    line-height: 1.6;
  }
  .bs-console-cards section > div {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bs-console-cards h4 {
    margin: 0 0 4px;
    color: var(--t3);
    font-size: 9.5px;
    font-weight: 500;
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
  }
  .bs-console-cards .k {
    color: var(--accent);
  }
  .bs-console-cards pre {
    margin: 0;
    font: inherit;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .bs-console-cards .body {
    color: var(--green);
  }
  .bs-console-cards .none {
    color: var(--t3);
    white-space: normal;
  }
  .bs-console-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 8px 8px 0;
    font-family: var(--font-ui);
  }
  .bs-console-actions button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 10px;
    color: var(--t2);
    border-radius: var(--radius-control);
    font-size: 12px;
  }
  .bs-console-actions button:first-child {
    color: var(--text);
    background: var(--hover);
  }
  .bs-console-actions button:hover:not(:disabled) {
    color: var(--text);
    background: var(--hover2);
  }
  .bs-console-actions button:disabled {
    opacity: 0.45;
  }
  .bs-console-actions .material-symbols-outlined {
    font-size: 15px;
  }
  .bs-console-end {
    padding: 14px;
    color: var(--t3);
    font-family: var(--font-ui);
    font-size: 11.5px;
    text-align: center;
  }
  .bs-console-end button {
    color: var(--t2);
    font: inherit;
  }
  .bs-console-end button:hover {
    color: var(--text);
  }
</style>
