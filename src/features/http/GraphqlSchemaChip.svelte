<!--
  The schema status chip right of the «Query» label (spec «Статус схемы»): loading / types from the
  server / file name / «No schema», its menu (refresh, file, server) and the explorer toggle.
  Hidden until the endpoint has an entry.
-->
<script lang="ts">
  import { t, tp } from '$shared/i18n';
  import type { Tab } from '$shared/model';
  import { Backdrop, IconButton, Menu } from '$shared/ui/components';
  import { graphqlExplorerOpen, graphqlSchemas } from './graphqlSchemas.svelte';

  let { tab }: { tab: Tab } = $props();

  // Undefined while the URL is unfinished and during the 800 ms before the first fetch: no chip then.
  const entry = $derived(graphqlSchemas.entryFor(tab));

  const label = $derived.by(() => {
    if (!entry || entry.status === 'loading') return t('http.body.gql_schema_loading');
    if (entry.status === 'error') return t('http.body.gql_schema_none');
    if (entry.source === 'file') return t('http.body.gql_schema_file', { name: entry.name });
    return t('http.body.gql_schema_types', { n: entry.types, types: tp(entry.types, ['type', 'types']) });
  });
  const detail = $derived.by(() => {
    if (!entry || entry.status === 'loading') return '';
    if (entry.status === 'error') return entry.message;
    if (entry.source === 'file') return entry.path;
    const time = new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return t('http.body.gql_schema_fetched', { time });
  });

  type Item = { key: string; icon: string; run: (tab: Tab) => Promise<void> };
  const loadFile: Item = {
    key: 'http.body.gql_schema_load_file',
    icon: 'upload_file',
    run: (x) => graphqlSchemas.loadFile(x),
  };
  const fromServer: Item = {
    key: 'http.body.gql_schema_from_server',
    icon: 'cloud_download',
    run: (x) => graphqlSchemas.useServer(x),
  };
  const items = $derived.by((): Item[] => {
    if (!entry || entry.status === 'loading') return [];
    const refresh = (key: string): Item => ({ key, icon: 'refresh', run: (x) => graphqlSchemas.refresh(x) });
    if (entry.status === 'error')
      // A file that failed can still be swapped for the server (the binding stays until then).
      return entry.source === 'file'
        ? [refresh('http.body.gql_schema_retry'), fromServer, loadFile]
        : [refresh('http.body.gql_schema_retry'), loadFile];
    if (entry.source === 'file')
      return [
        refresh('http.body.gql_schema_reload'),
        fromServer,
        { ...loadFile, key: 'http.body.gql_schema_load_other' },
      ];
    return [refresh('http.body.gql_schema_refresh'), loadFile];
  });

  const WIDTH = 280;
  let menu = $state<{ left: number; top: number } | null>(null);

  function openMenu(e: MouseEvent): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu = { left: Math.max(8, Math.min(r.left, window.innerWidth - WIDTH - 8)), top: r.bottom + 4 };
  }

  function pick(item: Item): void {
    menu = null;
    void item.run(tab);
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape' && menu) {
      e.preventDefault();
      menu = null;
    }
  }}
/>

{#if entry}
  <span class="gs">
    {#if entry.status === 'loading'}
      <span class="gs-chip">
        <span class="material-symbols-outlined gs-spin" aria-hidden="true">progress_activity</span>
        <span class="gs-text">{label}</span>
      </span>
    {:else}
      <button
        type="button"
        class={['gs-chip', { warn: entry.status === 'error' }]}
        title={detail}
        aria-haspopup="menu"
        aria-expanded={!!menu}
        onclick={openMenu}
      >
        {#if entry.status === 'error'}<span class="material-symbols-outlined" aria-hidden="true">warning</span>{/if}
        <span class="gs-text">{label}</span>
        <span class="material-symbols-outlined" aria-hidden="true">keyboard_arrow_down</span>
      </button>
    {/if}
    <IconButton
      type="button"
      class={['gs-explorer', { on: graphqlExplorerOpen.current }]}
      title={t('http.body.gql_schema_explorer')}
      aria-label={t('http.body.gql_schema_explorer')}
      aria-pressed={graphqlExplorerOpen.current}
      disabled={entry.status !== 'ready'}
      onclick={() => (graphqlExplorerOpen.current = !graphqlExplorerOpen.current)}
    >
      <span class="material-symbols-outlined" aria-hidden="true">account_tree</span>
    </IconButton>
  </span>
{/if}

{#if menu}
  <Backdrop type="button" aria-label={t('nav.menu.closeMenu')} onclick={() => (menu = null)} />
  <Menu role="menu" style="left:{menu.left}px; top:{menu.top}px; width:{WIDTH}px">
    {#if detail}<div class="gs-detail">{detail}</div>{/if}
    {#each items as item (item.key)}
      <button class="mi" type="button" role="menuitem" onclick={() => pick(item)}>
        <span class="material-symbols-outlined ic" aria-hidden="true">{item.icon}</span>
        <span class="lb">{t(item.key)}</span>
      </button>
    {/each}
  </Menu>
{/if}

<style>
  .gs {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    margin-left: auto;
  }
  .gs-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    max-width: 260px;
    height: 22px;
    padding: 0 8px;
    border-radius: 999px;
    background: var(--color-panel);
    color: var(--color-text-secondary);
    font-size: 11px;
    font-weight: 500;
  }
  button.gs-chip:hover {
    background: var(--color-selected);
  }
  .gs-chip.warn {
    background: var(--color-warning-soft);
    color: var(--color-warning);
  }
  .gs-chip .material-symbols-outlined {
    flex: none;
    font-size: 14px;
  }
  .gs-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .gs-spin {
    animation: send-spin 0.9s linear infinite;
  }
  .gs :global(.gs-explorer) {
    flex: none;
    width: 24px;
    height: 24px;
  }
  .gs :global(.gs-explorer.on) {
    background: var(--color-selected);
    color: var(--color-text);
  }
  .gs :global(.gs-explorer:disabled) {
    opacity: 0.45;
    cursor: default;
  }
  .gs-detail {
    max-height: 120px;
    overflow: auto;
    padding: 6px 12px 8px;
    color: var(--color-text-secondary);
    font-size: 12px;
    font-weight: 400;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
</style>
