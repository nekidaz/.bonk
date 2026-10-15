<script lang="ts">
  // DV4: every dynamic variable by group — what it is, an example, copy, insert at the cursor.
  import { t } from '$shared/i18n';
  import { portal } from '$shared/ui';
  import { DYNAMIC_GROUPS, searchDynamic, type DynamicGroup } from '$shared/model';
  import { insertAtLastCursor } from '$shared/editor';
  import { dynLocale } from '$shared/settings';
  import { dynamicVars, refreshDynamicSamples } from './dynamic.svelte';
  import { Button } from '$shared/ui/components';

  const ICONS: Record<DynamicGroup | 'all', string> = {
    all: 'apps',
    time: 'schedule',
    id: 'fingerprint',
    numbers: 'tag',
    text: 'notes',
    people: 'person',
    internet: 'language',
    finance: 'payments',
    address: 'location_on',
    files: 'folder',
  };

  let query = $state('');
  let group = $state<DynamicGroup | 'all'>('all');
  let copied = $state('');

  const found = $derived(searchDynamic(query, (name) => t(`dyn.${name}`)));
  const rows = $derived(group === 'all' ? found : found.filter((v) => v.group === group));
  const groupLabel = (g: DynamicGroup | 'all') => (g === 'all' ? t('dyn.all') : t(`dyn.group.${g}`));

  $effect(() => {
    if (dynamicVars.catalogOpen) void refreshDynamicSamples();
  });

  function close(): void {
    dynamicVars.catalogOpen = false;
    query = '';
  }

  function copy(name: string): void {
    void navigator.clipboard?.writeText(`{{${name}}}`);
    copied = name;
  }

  // «Вставить» goes where the cursor was; with no editor to go to it copies instead.
  function insert(name: string): void {
    if (insertAtLastCursor(`{{${name}}}`)) close();
    else copy(name);
  }

  function switchLocale(): void {
    dynLocale.current = dynLocale.current === 'ru' ? 'en' : 'ru';
    void refreshDynamicSamples();
  }

  function onKeydown(e: KeyboardEvent): void {
    if (dynamicVars.catalogOpen && e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      close();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if dynamicVars.catalogOpen}
  <div use:portal class="bs-overlay" role="dialog" aria-modal="true" aria-label={t('dyn.catalog.title')}>
    <div class="bs-modal dyn-catalog">
      <div class="bs-modal-h">
        <div class="head">
          <span class="kicker">{t('dyn.catalog.kicker', { n: found.length })}</span>
          <span class="title">{t('dyn.catalog.title')}</span>
        </div>
        <button class="x" aria-label={t('common.close')} onclick={close}
          ><span class="material-symbols-outlined" style="font-size:18px">close</span></button
        >
      </div>
      <div class="body">
        <nav class="groups" aria-label={t('dyn.catalog.title')}>
          <label class="search">
            <span class="material-symbols-outlined" aria-hidden="true">search</span>
            <!-- svelte-ignore a11y_autofocus -->
            <input
              type="text"
              placeholder={t('dyn.catalog.search')}
              aria-label={t('dyn.catalog.search')}
              spellcheck="false"
              autofocus
              bind:value={query}
            />
          </label>
          {#each ['all', ...DYNAMIC_GROUPS] as const as g (g)}
            {@const n = g === 'all' ? found.length : found.filter((v) => v.group === g).length}
            <button type="button" class="group" class:on={group === g} onclick={() => (group = g)}>
              <span class="material-symbols-outlined" aria-hidden="true">{ICONS[g]}</span>
              <span class="name">{groupLabel(g)}</span>
              <span class="count">{n}</span>
            </button>
          {/each}
        </nav>
        <section class="list">
          <div class="list-head">
            <span class="ttl">{groupLabel(group)}</span>
            <button type="button" class="locale" onclick={switchLocale}
              ><span class="material-symbols-outlined" aria-hidden="true">translate</span>{t(
                `dyn.locale.${dynLocale.current}`,
              )}</button
            >
            <span class="grow"></span>
            <button type="button" class="more" onclick={() => void refreshDynamicSamples()}
              ><span class="material-symbols-outlined" aria-hidden="true">refresh</span>{t('dyn.catalog.more')}</button
            >
          </div>
          <div class="rows" role="table">
            {#each rows as v (v.name)}
              <div class="row" role="row">
                <span class="chip" role="cell">{`{{${v.name}}}`}</span>
                <span class="desc" role="cell">{t(`dyn.${v.name}`)}</span>
                <span class="example" role="cell" title={dynamicVars.samples[v.name] ?? ''}
                  >{dynamicVars.samples[v.name] ?? ''}</span
                >
                <span class="acts" role="cell">
                  <button
                    type="button"
                    class="icon"
                    aria-label={t('dyn.catalog.copy')}
                    title={t('dyn.catalog.copy')}
                    onclick={() => copy(v.name)}
                    ><span class="material-symbols-outlined">{copied === v.name ? 'check' : 'content_copy'}</span
                    ></button
                  >
                  <button type="button" class="insert" onclick={() => insert(v.name)}>{t('dyn.catalog.insert')}</button>
                </span>
              </div>
            {:else}
              <div class="empty">{t('dyn.catalog.empty')}</div>
            {/each}
          </div>
        </section>
      </div>
      <div class="bs-modal-f">
        <span class="note">{t('dyn.catalog.footer')}</span>
        <div class="grow"></div>
        <Button variant="primary" onclick={close}>{t('dyn.catalog.done')}</Button>
      </div>
    </div>
  </div>
{/if}

<style>
  .dyn-catalog {
    width: 1040px;
    height: 660px;
  }
  .head {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .title {
    color: var(--color-text);
    font-size: 17px;
    font-weight: 600;
  }
  .kicker {
    color: var(--color-text-muted);
    font-size: 9.5px;
    letter-spacing: 0.12em;
    white-space: pre;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 232px minmax(0, 1fr);
    border-top: 1px solid var(--color-border-subtle);
  }
  .groups {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px;
    overflow: auto;
    border-right: 1px solid var(--color-border-subtle);
  }
  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    margin-bottom: 8px;
    padding: 0 9px;
    border-radius: 8px;
    border: 1px solid var(--color-border-subtle);
    background: var(--color-field);
    color: var(--color-text-muted);
  }
  .search .material-symbols-outlined {
    font-size: 15px;
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: var(--color-text);
    font: inherit;
    font-size: 12px;
  }
  .group {
    display: flex;
    align-items: center;
    gap: 9px;
    height: 30px;
    padding: 0 9px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--color-text-secondary);
    font-size: 12.5px;
    text-align: left;
  }
  .group:hover {
    background: var(--color-hover);
  }
  .group.on {
    background: var(--color-hover);
    color: var(--color-text);
  }
  .group .material-symbols-outlined {
    font-size: 16px;
    font-weight: 300;
  }
  .group .name {
    flex: 1;
  }
  .group .count {
    color: var(--color-text-muted);
    font-size: 11px;
  }
  .list {
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding: 12px 16px 12px;
  }
  .list-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }
  .list-head .ttl {
    color: var(--color-text);
    font-size: 15px;
    font-weight: 600;
  }
  .locale,
  .more {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 10px;
    border: 1px solid var(--color-border-subtle);
    border-radius: 999px;
    background: transparent;
    color: var(--color-text-secondary);
    font-size: 11px;
  }
  .more {
    border-color: transparent;
  }
  .locale:hover,
  .more:hover {
    background: var(--color-hover);
  }
  .locale .material-symbols-outlined,
  .more .material-symbols-outlined {
    font-size: 13px;
  }
  .grow {
    flex: 1;
  }
  .rows {
    flex: 1;
    min-height: 0;
    overflow: auto;
    border-radius: 10px;
    border: 1px solid var(--color-border-subtle);
  }
  .row {
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr) minmax(0, 1.1fr) 136px;
    align-items: center;
    gap: 12px;
    min-height: 38px;
    padding: 0 10px;
    border-bottom: 1px solid var(--color-border-subtle);
    font-size: 12px;
  }
  .row:last-child {
    border-bottom: none;
  }
  .row:hover {
    background: var(--color-hover);
  }
  .chip {
    justify-self: start;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 1px 5px;
    border-radius: 5px;
    background: color-mix(in srgb, var(--method-patch) 14%, transparent);
    color: var(--method-patch);
    font-family: var(--font-code);
    font-size: 11.5px;
  }
  .desc {
    color: var(--color-text-secondary);
  }
  .example {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text);
    font-family: var(--font-code);
    font-size: 11.5px;
  }
  .acts {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    opacity: 0;
  }
  .row:hover .acts,
  .row:focus-within .acts {
    opacity: 1;
  }
  .icon {
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
    padding: 0;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--color-text-muted);
  }
  .icon .material-symbols-outlined {
    font-size: 14px;
  }
  .icon:hover {
    background: var(--color-hover-strong, var(--hover2));
    color: var(--color-text);
  }
  .insert {
    padding: 3px 10px;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    background: var(--color-raised);
    color: var(--color-text);
    font-size: 11px;
    font-weight: 500;
  }
  .empty {
    padding: 24px;
    color: var(--color-text-muted);
    text-align: center;
  }
  .note {
    color: var(--color-text-muted);
    font-size: 11px;
  }
</style>
