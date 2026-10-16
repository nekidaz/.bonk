<script lang="ts">
  /**
   * Script console (SC5): both stages' console.log, variable and header writes and the send itself in one
   * feed, each row stamped with its time and stage. Filter by text or by kind; «Очистить» drops the feed.
   */
  import { t, tp } from '$shared/i18n';
  import type { ScriptEvent } from '$shared/model';
  import { clockMs, consoleRows, type ConsoleRow } from './scriptRun';
  import { Segmented } from '$shared/ui/components';

  let {
    events,
    onClear,
    onTests,
  }: {
    events: ScriptEvent[];
    onClear?: () => void;
    /** «→ Tests» on a test summary row. */
    onTests?: () => void;
  } = $props();

  type Kind = 'all' | 'log' | 'env';
  let kind = $state<Kind>('all');
  let query = $state('');

  const STAGE: Record<ConsoleRow['stage'], string> = { pre: 'PRE', send: 'SEND', post: 'POST' };

  function text(r: ConsoleRow): string {
    if (r.kind === 'test') return '';
    if (r.kind === 'log') return r.text ?? '';
    if (r.kind === 'send') return `${r.text ?? ''} ${r.status ?? ''} ${r.ms ?? ''}`;
    return `${r.op ?? ''} ${r.key ?? ''} ${r.value ?? ''}`;
  }
  const rows = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return consoleRows(events).filter(
      (r) =>
        (kind === 'all' || (kind === 'log' ? r.kind === 'log' : r.kind === 'env' || r.kind === 'glob')) &&
        (!q || text(r).toLowerCase().includes(q)),
    );
  });
  const KINDS: [Kind, string][] = [
    ['all', 'response.console.all'],
    ['log', 'log'],
    ['env', 'response.console.env'],
  ];
</script>

<div class="bs-script-console">
  <div class="head">
    <label class="filter-box">
      <span class="material-symbols-outlined" aria-hidden="true">filter_list</span>
      <input bind:value={query} placeholder={t('response.console.filter')} aria-label={t('response.console.filter')} />
    </label>
    <Segmented role="radiogroup" aria-label={t('response.console.kinds')}>
      {#each KINDS as [id, label] (id)}
        <button type="button" role="radio" aria-checked={kind === id} class:on={kind === id} onclick={() => (kind = id)}
          >{t(label)}</button
        >
      {/each}
    </Segmented>
    <span class="spacer"></span>
    {#if onClear}<button type="button" class="clear" onclick={onClear} disabled={!events.length}
        ><span class="material-symbols-outlined" aria-hidden="true">block</span>{t('response.console.clear')}</button
      >{/if}
  </div>
  {#if rows.length}
    <ol>
      {#each rows as r, i (i)}
        <li>
          <span class="time">{clockMs(r.t)}</span>
          <span class="stage {r.stage}">{STAGE[r.stage]}</span>
          <span class="kind">{r.kind === 'glob' ? 'glob' : r.kind === 'send' ? '' : r.kind}</span>
          <span class="text">
            {#if r.kind === 'test'}
              {`${r.total} ${tp(r.total, ['проверка', 'проверки', 'проверок'], ['check', 'checks'])}: `}<span class="ok"
                >{`${r.total - r.failed} ${tp(r.total - r.failed, ['прошла', 'прошли', 'прошли'], ['passed', 'passed'])}`}</span
              >{#if r.failed}{', '}<span class="bad"
                  >{`${r.failed} ${tp(r.failed, ['упала', 'упали', 'упали'], ['failed', 'failed'])}`}</span
                >{/if}
              {#if onTests}<button type="button" class="link" onclick={onTests}>→ Tests</button>{/if}
            {:else if r.kind === 'log'}
              {r.text}
            {:else if r.kind === 'send'}
              {r.text}<span class="dim">{' → '}</span><span class:ok={r.status?.startsWith('2') || r.status === 'OK'}
                >{r.status}</span
              ><span class="dim">{` · ${r.ms} ms`}</span>
            {:else if r.op === 'unset' || r.op === 'remove'}
              <span class="dim">{r.op} </span><span class="key">{r.key}</span>
            {:else}
              <span class="dim">{`${r.op} `}</span><span class="key">{r.key}</span
              >{#if r.kind === 'hdr'}{`: ${r.value}`}{:else}<span class="dim">{' = '}</span><span class="str"
                  >{JSON.stringify(r.value)}</span
                >{/if}
            {/if}
          </span>
        </li>
      {/each}
    </ol>
  {:else}
    <p class="empty">{t('response.console.empty')}</p>
  {/if}
</div>

<style>
  .bs-script-console {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .spacer {
    flex: 1;
  }
  .filter-box {
    width: 220px;
    height: 30px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
    color: var(--t3);
    background: var(--color-field);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
  }
  .filter-box:focus-within {
    border-color: color-mix(in srgb, var(--accent) 56%, var(--sep));
  }
  .filter-box .material-symbols-outlined {
    font-size: 15px;
  }
  .filter-box input {
    flex: 1;
    min-width: 0;
    color: var(--text);
    background: transparent;
    border: 0;
    outline: 0;
    font-size: var(--font-size-caption);
  }
  .clear {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--t2);
    font-size: var(--font-size-caption);
  }
  .clear:hover:not(:disabled) {
    color: var(--text);
  }
  .clear:disabled {
    opacity: 0.5;
  }
  .clear .material-symbols-outlined {
    font-size: 14px;
  }
  ol {
    margin: 0;
    padding: 0;
    list-style: none;
    overflow: auto;
    font: var(--font-size-caption) / 1.5 var(--mono);
  }
  li {
    display: grid;
    grid-template-columns: 92px 52px 36px minmax(0, 1fr);
    align-items: baseline;
    gap: 8px;
    padding: 4px 8px;
  }
  .time,
  .kind,
  .dim {
    color: var(--t3);
  }
  .stage {
    justify-self: start;
    padding: 0 6px;
    color: var(--t2);
    border: 1px solid var(--sep);
    border-radius: 999px;
    font-size: 9px;
    letter-spacing: 0.06em;
  }
  .stage.send {
    border-color: transparent;
    color: var(--t3);
  }
  .text {
    color: var(--text);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .key {
    color: var(--var, var(--accent));
  }
  .str {
    color: var(--ss);
  }
  .ok {
    color: var(--color-success);
  }
  .bad {
    color: var(--color-danger);
  }
  .link {
    margin-left: 6px;
    color: var(--t2);
    font: inherit;
  }
  .link:hover {
    color: var(--text);
    text-decoration: underline;
  }
  .empty {
    margin: 0;
    padding: 18px 8px;
    color: var(--t3);
    font-size: var(--font-size-caption);
  }
</style>
