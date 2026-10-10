<script lang="ts">
  // IM8: the same spec, a new version — what's new, changed and gone; the user's edits stay.
  import { untrack } from 'svelte';
  import { readOpenApi } from '$entities/workspace';
  import { methodColor, methodLabel, type FolderNode, type RequestNode } from '$shared/model';
  import { t, tp } from '$shared/i18n';
  import { applyUpdate } from './apply';
  import { HAR_DEFAULTS, harPlan } from './har';
  import { collectionPlan, openApiPlan, type Grouping } from './plan';
  import { bodyLines, diffCollection } from './reimport';
  import type { Loaded } from './source';

  let {
    collection,
    loaded,
    onBack,
    onDone,
  }: {
    collection: FolderNode;
    loaded: Loaded;
    onBack: () => void;
    onDone: (n: number) => void;
  } = $props();

  // Rebuild the requests exactly as the first import did: same grouping and switches.
  const opts = $derived((collection.source?.options ?? {}) as Record<string, unknown>);
  const plan = $derived.by(() => {
    if (loaded.format === 'openapi') {
      const spec = readOpenApi(loaded.doc, loaded.origin.name, {
        bodies: opts.bodies !== false,
        pathVars: opts.pathVars !== false,
        collectionAuth: opts.collectionAuth !== false,
      });
      return openApiPlan(spec, (opts.group as Grouping | undefined) ?? 'tags');
    }
    if (loaded.format === 'har') return harPlan(loaded.har, { ...HAR_DEFAULTS, ...opts });
    return collectionPlan(loaded.collection);
  });
  const diff = $derived(diffCollection(collection, plan));

  let skip = $state<Set<string>>(new Set());
  let drop = $state<Set<string>>(new Set());
  // The first changed body starts unfolded, like the mock.
  const firstBody = untrack(() => diff.changed.find((c) => c.body)?.key);
  let open = $state<Set<string>>(new Set(firstBody ? [firstBody] : []));
  let busy = $state(false);
  let error = $state('');

  const total = $derived(
    diff.added.filter((a) => !skip.has(a.key)).length +
      diff.changed.filter((c) => !skip.has(c.key)).length +
      diff.removed.filter((r) => drop.has(r.key)).length,
  );

  const flip = (set: Set<string>, key: string): Set<string> => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };
  const path = (n: RequestNode): string => n.request.url.replace(/^\{\{baseUrl\}\}/, '').split('?')[0];

  async function update(): Promise<void> {
    busy = true;
    error = '';
    try {
      const source = {
        ...collection.source!,
        format: loaded.label,
        ...(loaded.version ? { version: loaded.version } : {}),
      };
      onDone(await applyUpdate(collection, diff, skip, drop, source));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

{#snippet head(sign: string, kind: string, n: RequestNode)}
  <span class="sign {kind}">{sign}</span>
  <span class="m" style:color={methodColor(n.request.method)}>{methodLabel(n.request.method)}</span>
  <span class="nm">{n.name}</span>
  <span class="p">{path(n)}</span>
{/snippet}

{#snippet check(key: string, label: string)}
  <input
    type="checkbox"
    class="imp-check"
    aria-label={label}
    checked={!skip.has(key)}
    onchange={() => (skip = flip(skip, key))}
  />
{/snippet}

<div class="imp-body upd">
  <div class="sumrow">
    <span class="pill ok">{t('import.upd.new', { n: diff.added.length })}</span>
    <span class="pill warn">{t('import.upd.changed', { n: diff.changed.length })}</span>
    <span class="pill bad">{t('import.upd.removed', { n: diff.removed.length })}</span>
    <span class="pill">{t('import.upd.same', { n: diff.unchanged })}</span>
    <span class="keep"><span class="material-symbols-outlined">verified_user</span>{t('import.upd.keep')}</span>
  </div>

  <div class="list">
    {#if !diff.added.length && !diff.changed.length && !diff.removed.length}
      <div class="nothing">{t('import.upd.nothing')}</div>
    {/if}
    {#if diff.added.length}
      <div class="imp-eyebrow">{t('import.upd.sec.new', { n: diff.added.length })}</div>
      {#each diff.added as a (a.key)}
        <div class="row" class:off={skip.has(a.key)}>
          {@render check(a.key, a.req.node.name)}
          {@render head('+', 'ok', a.req.node)}
          <span class="what">
            {a.folder === null
              ? t('import.upd.toRoot')
              : a.folderExists
                ? t('import.upd.to', { folder: a.folder })
                : t('import.upd.toNew', { folder: a.folder })}
          </span>
        </div>
      {/each}
    {/if}
    {#if diff.changed.length}
      <div class="imp-eyebrow">{t('import.upd.sec.changed', { n: diff.changed.length })}</div>
      {#each diff.changed as c (c.key)}
        <div class="row" class:off={skip.has(c.key)} class:sel={open.has(c.key)}>
          {@render check(c.key, c.current.name)}
          <button
            type="button"
            class="rowbtn"
            disabled={!c.body}
            aria-expanded={c.body ? open.has(c.key) : undefined}
            onclick={() => (open = flip(open, c.key))}
          >
            {@render head('~', 'warn', c.current)}
            <span class="what">{c.what.join('; ')}</span>
          </button>
        </div>
        {#if c.body && open.has(c.key)}
          {@const lines = bodyLines(c.body.before, c.body.after)}
          <div class="diff">
            <div class="col">
              <div class="dh">{t('import.upd.was')}</div>
              {#each lines.was as [l, d], i (i)}<div class="ln" class:del={d}>{l}</div>{/each}
            </div>
            <div class="col">
              <div class="dh">
                {t('import.upd.now')}&nbsp;&nbsp;·&nbsp;&nbsp;{c.body.updated
                  ? t('import.upd.now.updated')
                  : t('import.upd.now.kept')}
              </div>
              {#each lines.now as [l, d], i (i)}<div class="ln" class:add={d}>{l}</div>{/each}
            </div>
          </div>
        {/if}
      {/each}
    {/if}
    {#if diff.removed.length}
      <div class="imp-eyebrow">{t('import.upd.sec.removed', { n: diff.removed.length })}</div>
      {#each diff.removed as r (r.key)}
        <div class="row">
          <span class="ck"></span>
          {@render head('−', 'bad', r.node)}
          <span class="what">
            <span class="bs-seg compact" role="radiogroup" aria-label={r.node.name}>
              <button
                type="button"
                role="radio"
                aria-checked={!drop.has(r.key)}
                class:on={!drop.has(r.key)}
                onclick={() => drop.has(r.key) && (drop = flip(drop, r.key))}>{t('import.upd.keepBtn')}</button
              >
              <button
                type="button"
                role="radio"
                aria-checked={drop.has(r.key)}
                class:on={drop.has(r.key)}
                onclick={() => !drop.has(r.key) && (drop = flip(drop, r.key))}>{t('import.upd.delBtn')}</button
              >
            </span>
          </span>
        </div>
      {/each}
    {/if}
  </div>
</div>

<div class="imp-foot">
  <span class="note" class:bad={!!error}>{error || t('import.upd.foot')}</span>
  <button type="button" class="imp-btn" onclick={onBack}>{t('common.cancel')}</button>
  <button type="button" class="imp-btn primary" disabled={busy || total === 0} onclick={update}>
    {t('import.upd.do', { n: `${total} ${tp(total, ['запрос', 'запроса', 'запросов'], ['request', 'requests'])}` })}
  </button>
</div>

<style>
  .upd {
    gap: 14px;
  }
  .sumrow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .pill {
    padding: 2px 10px;
    border-radius: var(--radius-control);
    background: var(--color-hover-strong);
    color: var(--color-text-secondary);
    font: var(--font-size-body) / 20px var(--font-ui);
  }
  .pill.ok {
    background: var(--color-success-soft);
    color: var(--color-success);
  }
  .pill.warn {
    background: var(--color-warning-soft);
    color: var(--color-warning);
  }
  .pill.bad {
    background: var(--color-danger-soft);
    color: var(--color-danger);
  }
  .keep {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
    color: var(--color-text-secondary);
    font: var(--font-size-body) var(--font-ui);
  }
  .keep .material-symbols-outlined {
    font-size: 16px;
    color: var(--color-success);
  }
  .list {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 16px 12px;
    overflow: auto;
    border-radius: var(--radius-card);
    background: var(--color-panel);
  }
  .list .imp-eyebrow {
    padding: 8px 12px 4px;
  }
  .nothing {
    padding: 24px 12px;
    color: var(--color-text-secondary);
    font: var(--font-size-ui) var(--font-ui);
    text-align: center;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 34px;
    padding: 0 12px;
    border-radius: var(--radius-md);
    font: var(--font-size-ui) / 18px var(--font-ui);
  }
  .row.sel {
    background: var(--color-hover);
  }
  .row.off .nm,
  .row.off .p,
  .row.off .what {
    color: var(--color-text-muted);
  }
  .rowbtn {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 34px;
    text-align: left;
  }
  .rowbtn:disabled {
    cursor: default;
  }
  .ck {
    flex: none;
    width: 16px;
  }
  .sign {
    flex: none;
    width: 12px;
    font: var(--weight-medium) var(--font-size-ui) var(--font-code);
  }
  .sign.ok {
    color: var(--color-success);
  }
  .sign.warn {
    color: var(--color-warning);
  }
  .sign.bad {
    color: var(--color-danger);
  }
  .m {
    flex: none;
    width: 52px;
    font: var(--weight-medium) var(--font-size-body) var(--font-code);
  }
  .nm {
    flex: none;
    max-width: 30%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .p {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--color-text-muted);
    font: var(--font-size-body) var(--font-code);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .what {
    flex: none;
    max-width: 45%;
    margin-left: auto;
    overflow: hidden;
    color: var(--color-text-secondary);
    font: var(--font-size-body) var(--font-ui);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .diff {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin: 2px 0 6px 140px;
  }
  .col {
    max-height: 180px;
    padding: 10px 12px;
    overflow: auto;
    border-radius: var(--radius-md);
    background: var(--color-field);
  }
  .dh {
    margin-bottom: 6px;
    color: var(--color-text-muted);
    font: var(--font-size-micro) var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
  }
  .ln {
    padding: 0 6px;
    border-radius: var(--radius-xs);
    font: var(--font-size-body) / 20px var(--font-code);
    white-space: pre;
  }
  .ln.del {
    background: var(--color-danger-soft);
  }
  .ln.add {
    background: var(--color-success-soft);
  }
</style>
