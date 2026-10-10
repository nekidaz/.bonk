<script lang="ts">
  // The left half of the preview (IM4/IM5/IM9): the future collection with checkboxes.
  import { methodColor, methodLabel } from '$shared/model';
  import { t } from '$shared/i18n';
  import { requestsIn, type PlanItem } from './plan';

  let {
    items,
    excluded = $bindable(),
  }: {
    items: PlanItem[];
    /** Unchecked request keys. Replaced, never mutated. */
    excluded: Set<string>;
  } = $props();

  /** Collapsed folder keys; the first two folders start open, like the mock. */
  let collapsed = $state<Set<string>>(new Set());
  let seeded = false;
  $effect(() => {
    if (seeded || !items.length) return;
    seeded = true;
    collapsed = new Set(items.filter((i, n) => i.kind === 'folder' && n >= 2).map((i) => i.key));
  });

  function setAll(keys: string[], on: boolean): void {
    const next = new Set(excluded);
    for (const k of keys) {
      if (on) next.delete(k);
      else next.add(k);
    }
    excluded = next;
  }

  function toggleFolder(key: string): void {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    collapsed = next;
  }
</script>

{#snippet check(state: 'on' | 'off' | 'mixed', disabled: boolean, label: string, set: (on: boolean) => void)}
  <input
    type="checkbox"
    class="imp-check"
    aria-label={label}
    checked={state === 'on'}
    indeterminate={state === 'mixed'}
    {disabled}
    onchange={(e) => set(e.currentTarget.checked)}
  />
{/snippet}

{#snippet rows(list: PlanItem[], depth: number)}
  {#each list as item (item.key)}
    {#if item.kind === 'folder'}
      {@const keys = requestsIn(item.items).map((r) => r.key)}
      {@const on = keys.filter((k) => !excluded.has(k)).length}
      {@const empty = keys.length === 0}
      {@const open = !collapsed.has(item.key) && !empty}
      <div class="row folder" class:off={empty || on === 0} style:padding-left="{12 + depth * 32}px">
        {@render check(empty ? 'off' : on === keys.length ? 'on' : on ? 'mixed' : 'off', empty, item.name, (v) =>
          setAll(keys, v),
        )}
        <button
          type="button"
          class="chev"
          aria-label={item.name}
          aria-expanded={open}
          disabled={empty}
          onclick={() => toggleFolder(item.key)}
        >
          <span class="material-symbols-outlined">{open ? 'expand_more' : 'chevron_right'}</span>
        </button>
        <span class="material-symbols-outlined ic">{item.domain ? 'language' : 'folder'}</span>
        <span class="nm" class:mono={item.domain}>{item.name}</span>
        <span class="cnt">{item.total ?? keys.length}</span>
      </div>
      {#if open}{@render rows(item.items, depth + 1)}{/if}
    {:else}
      {@const on = !excluded.has(item.key)}
      <div class="row req" class:warn={item.warn} class:off={!on} style:padding-left="{12 + depth * 32}px">
        {@render check(on ? 'on' : 'off', false, item.node.name, (v) => setAll([item.key], v))}
        <span class="m" style:color={methodColor(item.node.request.method)}
          >{methodLabel(item.node.request.method)}</span
        >
        <span class="nm">{item.node.name}</span>
        <span class="hint">{item.hint}</span>
        {#if item.variants}<span class="badge">{t('import.variant', { n: item.variants })}</span>{/if}
        {#if item.warn}<span class="material-symbols-outlined wi" aria-hidden="true">warning</span>{/if}
      </div>
    {/if}
  {/each}
{/snippet}

<div class="imp-tree" role="tree">{@render rows(items, 0)}</div>

<style>
  .imp-tree {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 29px;
    padding-right: 12px;
    border-radius: var(--radius-sm);
    font: var(--font-size-ui) / 18px var(--font-ui);
  }
  .row.folder {
    font-weight: var(--weight-medium);
  }
  .row.off .nm,
  .row.off .ic,
  .row.off .cnt,
  .row.off .chev {
    color: var(--color-text-muted);
  }
  .row.req.off .m {
    opacity: 0.5;
  }
  .row.warn {
    background: var(--color-warning-soft);
  }
  .chev {
    width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
    margin-left: -4px;
    color: var(--color-text-muted);
  }
  .chev .material-symbols-outlined,
  .ic {
    font-size: 16px;
  }
  .ic {
    color: var(--color-text-secondary);
  }
  .m {
    flex: none;
    width: 48px;
    font: var(--weight-medium) var(--font-size-body) var(--font-code);
  }
  .nm {
    flex: none;
    max-width: 60%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .nm.mono {
    font-family: var(--font-code);
  }
  .hint {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--color-text-muted);
    font: var(--font-size-body) var(--font-code);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cnt {
    margin-left: auto;
    color: var(--color-text-muted);
    font: var(--font-size-body) var(--font-code);
  }
  .badge {
    flex: none;
    padding: 1px 8px;
    border-radius: var(--radius-control);
    background: var(--color-hover-strong);
    color: var(--color-text-secondary);
    font: var(--font-size-caption) var(--font-ui);
  }
  .wi {
    flex: none;
    font-size: 15px;
    color: var(--color-warning);
  }
  /* Rounded-square check (Pencil «Checkbox»): filled with the text colour when on, a dash when mixed. */
  :global(.imp-check) {
    appearance: none;
    flex: none;
    width: 16px;
    height: 16px;
    margin: 0;
    display: inline-grid;
    place-content: center;
    border: 1px solid var(--color-border);
    border-radius: 5px;
    background: transparent;
    cursor: pointer;
  }
  :global(.imp-check:checked),
  :global(.imp-check:indeterminate) {
    border-color: var(--color-text);
    background: var(--color-text);
  }
  :global(.imp-check:checked::after) {
    content: '';
    width: 8px;
    height: 4px;
    margin-top: -2px;
    border: solid var(--color-raised);
    border-width: 0 0 2px 2px;
    transform: rotate(-45deg);
  }
  :global(.imp-check:indeterminate::after) {
    content: '';
    width: 8px;
    height: 2px;
    background: var(--color-raised);
  }
  :global(.imp-check:disabled) {
    opacity: 0.4;
    cursor: default;
  }
  :global(.imp-check:focus-visible) {
    outline: 2px solid var(--color-text);
    outline-offset: 2px;
  }
</style>
