<script lang="ts">
  /**
   * «+ Запрос» search: every request of the workspace by name, URL or folder. ↑/↓ move, Enter
   * picks, Esc closes. Used by R1 «Собрать из запросов» and the R2 list.
   */
  import { workspace } from '$entities/workspace';
  import { methodColor } from '$shared/model';
  import { t } from '$shared/i18n';
  import { searchRequests } from './runnerPlan';
  import { onMount } from 'svelte';

  let {
    onpick,
    onclose,
    exclude = [],
  }: { onpick: (id: string) => void; onclose?: () => void; exclude?: string[] } = $props();

  let query = $state('');
  let input: HTMLInputElement | undefined = $state();
  // Not `autofocus`: Svelte only honours it when nothing has focus, and the button that opened us does.
  onMount(() => input?.focus());
  let sel = $state(0);
  const hits = $derived(searchRequests(workspace.tree, query, 40).filter((h) => !exclude.includes(h.node.id)));
  const method = (n: (typeof hits)[number]['node']) => (n.protocol === 'grpc' ? 'gRPC' : n.request.method);

  function onkeydown(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sel = Math.max(0, Math.min(hits.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1)));
    } else if (e.key === 'Enter' && hits[sel]) {
      e.preventDefault();
      onpick(hits[sel].node.id);
    } else if (e.key === 'Escape' && onclose) {
      e.preventDefault();
      onclose();
    }
  }
</script>

<div class="qp">
  <label class="qp-search">
    <span class="material-symbols-outlined" aria-hidden="true">search</span>
    <input
      bind:this={input}
      type="search"
      bind:value={query}
      oninput={() => (sel = 0)}
      {onkeydown}
      placeholder={t('runner.compose.search')}
      aria-label={t('runner.compose.search')}
    />
  </label>
  {#if hits.length > 0}
    <div class="qp-list" role="listbox" aria-label={t('runner.compose.search')}>
      {#each hits as h, i (h.node.id)}
        <button
          class="qp-item"
          class:on={i === sel}
          type="button"
          role="option"
          aria-selected={i === sel}
          onmouseenter={() => (sel = i)}
          onclick={() => onpick(h.node.id)}
        >
          <b class="qp-method" style="color:{methodColor(h.node.protocol === 'grpc' ? 'GRPC' : h.node.request.method)}"
            >{method(h.node)}</b
          >
          <span class="qp-name">{h.node.name}</span>
          <small class="qp-path">{h.path}</small>
        </button>
      {/each}
    </div>
  {:else}
    <p class="rn-muted qp-empty">{t('runner.pick.none')}</p>
  {/if}
</div>

<style>
  .qp {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .qp-search {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    background: var(--color-field);
  }
  .qp-search:focus-within {
    border-color: var(--color-border);
  }
  .qp-search .material-symbols-outlined {
    font-size: 16px;
    color: var(--color-text-muted);
  }
  .qp-search input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--color-text);
    font: 13px var(--font-ui);
  }
  .qp-list {
    display: flex;
    flex-direction: column;
    max-height: 260px;
    overflow: auto;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
    background: var(--color-field);
  }
  .qp-item {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 6px 10px;
    border: 0;
    background: transparent;
    color: var(--color-text);
    font: 13px/18px var(--font-ui);
    text-align: left;
    cursor: pointer;
  }
  .qp-item.on {
    background: var(--color-selected);
  }
  .qp-method {
    flex: none;
    min-width: 42px;
    font: 600 11px var(--font-code);
  }
  .qp-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .qp-path {
    margin-left: auto;
    overflow: hidden;
    color: var(--color-text-muted);
    font: 11px var(--font-ui);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .qp-empty {
    margin: 4px 2px;
  }
</style>
