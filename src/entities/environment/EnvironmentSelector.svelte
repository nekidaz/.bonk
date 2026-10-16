<!--
  Toolbar → environment picker: current environment chip and its dropdown (search, recent, all,
  «Manage» opens the Environments tab). Lives in entities because the toolbar and features both use it.
-->
<script lang="ts">
  import { t } from '$shared/i18n';
  import type { Environment } from '$shared/model';
  import { ENV_COLOR_VAR, envColor, envShortcutTargets, envToneOf, pushRecent } from './palette';
  import { addEnvironment, environments, openEnvironmentsTab, setActiveEnvironment } from './store.svelte';

  const RECENT_KEY = 'bonk.recentEnvironments';

  let open = $state(false);
  let query = $state('');
  let search = $state<HTMLInputElement | null>(null);
  let recentIds = $state<string[]>(readRecent());
  // The «All» list fades at the bottom only while more rows hide below.
  let moreBelow = $state(false);
  const measure = (el: HTMLElement): void => {
    moreBelow = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
  };

  const activeEnv = $derived(environments.active);
  const environmentName = $derived(activeEnv?.name ?? t('env.none'));
  const tone = $derived(activeEnv ? envToneOf(activeEnv) : 'none');
  const q = $derived(query.trim().toLowerCase());
  // S14: the active environment always heads the recents.
  const recent = $derived(
    [...new Set([...(environments.activeId ? [environments.activeId] : []), ...recentIds])]
      .slice(0, 3)
      .map((id) => environments.list.find((env) => env.id === id))
      .filter((env) => env !== undefined && (!q || env.name.toLowerCase().includes(q))),
  );
  const all = $derived(
    [...environments.list]
      .filter((env) => !q || env.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  // ⌘1…⌘9 pick from this list: recents, then the rest of the visible environments.
  const targets = $derived(envShortcutTargets(recent as Environment[], all));
  const keyFor = (env: Environment): string => {
    const i = targets.findIndex((x) => x.id === env.id);
    return i < 0 ? '' : `⌘${i + 1}`;
  };

  function readRecent(): string[] {
    try {
      return JSON.parse(globalThis.localStorage?.getItem(RECENT_KEY) ?? '[]');
    } catch {
      return [];
    }
  }

  function choose(id: string | null): void {
    setActiveEnvironment(id);
    if (id) {
      recentIds = pushRecent(recentIds, id);
      try {
        globalThis.localStorage?.setItem(RECENT_KEY, JSON.stringify(recentIds));
      } catch {
        /* storage unavailable: recents stay in memory */
      }
    }
    open = false;
  }
  function manage(): void {
    openEnvironmentsTab();
    open = false;
  }
  function create(): void {
    choose(addEnvironment());
    openEnvironmentsTab();
  }

  function toggle(): void {
    open = !open;
    query = '';
  }

  let menuEl = $state<HTMLDivElement | null>(null);

  // ⌘1…⌘9 pick a visible environment, ⌘E returns to the search field; ↑↓ walk the search field and the rows.
  function menuKeydown(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey) {
      const n = Number(e.key);
      if (n >= 1 && n <= 9 && targets[n - 1]) {
        e.preventDefault();
        e.stopPropagation();
        choose(targets[n - 1].id);
      } else if (e.key.toLowerCase() === 'e') {
        e.preventDefault();
        e.stopPropagation();
        search?.focus();
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const stops = [...(menuEl?.querySelectorAll<HTMLElement>('input, button') ?? [])];
      if (!stops.length) return;
      e.preventDefault();
      const i = stops.indexOf(document.activeElement as HTMLElement);
      stops[(i + (e.key === 'ArrowDown' ? 1 : -1) + stops.length) % stops.length].focus();
    } else if (e.key === 'Enter' && e.target === search && targets[0] && q) {
      // ↵ in a filtered search picks the first match; focused rows are plain buttons and click themselves.
      e.preventDefault();
      choose(targets[0].id);
    }
  }
</script>

<svelte:window
  onpointerdown={() => (open = false)}
  onkeydown={(e) => {
    if (e.key === 'Escape') open = false;
  }}
/>

{#snippet item(env: Environment | null, hint: string)}
  {@const tn = env ? envToneOf(env) : 'none'}
  {@const on = (env?.id ?? null) === environments.activeId}
  <button class="bs-env-item" class:on role="menuitemradio" aria-checked={on} onclick={() => choose(env?.id ?? null)}>
    {#if env && tn !== 'production'}<span class="lead"
        ><span class="dot" style:background={ENV_COLOR_VAR[envColor(env)]} aria-hidden="true"></span></span
      >{:else}<span class="material-symbols-outlined lead tone-{tn}" aria-hidden="true">{env ? 'lock' : 'block'}</span
      >{/if}
    <span class="label">{env?.name ?? t('env.none')}</span>
    {#if hint}<span class="hint">{hint}</span>{/if}
  </button>
{/snippet}

<div class="bs-toolbar-environment" role="presentation" onpointerdown={(e) => e.stopPropagation()}>
  <button
    class="bs-toolbar-env-button tone-{tone}"
    type="button"
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={toggle}
  >
    {#if tone === 'production'}<span class="material-symbols-outlined" aria-hidden="true">lock</span>{:else}<span
        class="dot"
        style:background={activeEnv ? ENV_COLOR_VAR[envColor(activeEnv)] : undefined}
        aria-hidden="true"
      ></span>{/if}
    <span class="bs-toolbar-env-name" title={environmentName}>{environmentName}</span>
    <span class="material-symbols-outlined chevron" aria-hidden="true">expand_more</span>
  </button>
  {#if open}
    <div
      class="bs-env-menu"
      role="menu"
      aria-label={t('env.select_aria')}
      tabindex="-1"
      bind:this={menuEl}
      onkeydown={menuKeydown}
    >
      <label class="bs-env-search">
        <span class="material-symbols-outlined" aria-hidden="true">search</span>
        <input
          bind:this={search}
          bind:value={query}
          placeholder={t('env.find')}
          aria-label={t('env.find')}
          {@attach (el) => el.focus()}
        />
        <kbd>⌘E</kbd>
      </label>
      {#if recent.length}
        <div class="bs-env-heading"><span>{t('env.recent')}</span></div>
        {#each recent as env, i (env!.id)}
          {@render item(env!, env!.id === environments.activeId ? '✓' : keyFor(env!))}
        {/each}
        <div class="bs-env-sep"></div>
      {/if}
      <div class="bs-env-heading">
        <span>{t('env.all')}&nbsp;&nbsp;·&nbsp;&nbsp;{all.length}</span><span class="sort">A–Z</span>
      </div>
      <!-- Re-measures when the filter changes the row count. -->
      <div
        class="bs-env-scroll"
        class:fade={moreBelow}
        onscroll={(e) => measure(e.currentTarget)}
        {@attach (el) => {
          void all.length;
          measure(el);
        }}
      >
        {#if !q || t('env.none').toLowerCase().includes(q)}{@render item(null, '')}{/if}
        {#each all as env (env.id)}{@render item(env, '')}{/each}
      </div>
      <div class="bs-env-sep"></div>
      <div class="bs-env-foot">
        <button class="bs-env-item" role="menuitem" onclick={manage}
          ><span class="material-symbols-outlined lead" aria-hidden="true">tune</span><span class="label"
            >{t('env.manage')}</span
          ></button
        >
        <button class="bs-env-new" role="menuitem" onclick={create}
          ><span class="material-symbols-outlined" aria-hidden="true">add</span>{t('env.new_short')}</button
        >
      </div>
    </div>
  {/if}
</div>

<style>
  .bs-toolbar-env-button :global(.chevron) {
    color: var(--color-text-muted);
    transition: transform 120ms ease;
  }

  .bs-toolbar-env-button[aria-expanded='true'] :global(.chevron) {
    transform: rotate(180deg);
  }

  .bs-env-item :global(.lead) {
    flex: 0 0 16px;
    display: flex;
    justify-content: center;
    font-size: 16px;
    color: var(--color-text-secondary);
  }

  .bs-env-item :global(.lead .dot) {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .bs-toolbar-env-button.tone-none :global(.dot) {
    background: transparent;
    box-shadow: inset 0 0 0 1.5px var(--color-text-muted);
  }

  .bs-toolbar-env-button.tone-staging :global(.dot) {
    background: var(--color-warning);
  }

  .bs-toolbar-env-button.tone-local :global(.dot) {
    background: var(--color-success);
  }

  .bs-toolbar-env-button.tone-production {
    border-color: transparent;
    background: var(--color-danger-soft);
    color: var(--color-danger);
  }

  .bs-toolbar-env-button.tone-production :global(.chevron) {
    color: var(--color-danger);
  }

  .bs-toolbar-env-button {
    display: flex;
    align-items: center;
    width: auto;
    height: 34px;
    padding: 0 9px 0 11px;
    gap: 8px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    background: var(--color-panel);
    color: var(--color-text);
  }

  .bs-toolbar-env-button:hover {
    background: var(--color-raised);
  }

  .bs-toolbar-env-button :global(.dot) {
    flex: 0 0 7px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--color-text-muted);
  }

  .bs-toolbar-env-button :global(.material-symbols-outlined) {
    font-size: 16px;
  }

  :global(:root[data-density='compact']) .bs-toolbar-env-button {
    height: 28px;
  }

  :global(:where(.bs)) .bs-env-menu {
    border: 1px solid var(--sep);
    border-radius: 6px;
    background: var(--surface-solid);
    box-shadow: var(--shadow-panel);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }

  .bs-toolbar-environment {
    position: relative;
    flex: 0 0 auto;
    height: 34px;
    border: 0;
  }

  .bs-toolbar-env-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
    flex: none;
    font-size: var(--font-size-body);
    font-weight: 600;
  }

  /* Environment list (S14): search, recent, all A–Z in a fading scroll area, manage + new. */
  .bs-env-menu {
    position: absolute;
    z-index: 110;
    top: calc(100% + 8px);
    right: -42px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 300px;
    padding: 6px;
    outline: 1px solid var(--color-border);
    outline-offset: -1px;
    border-radius: 22px;
    background: var(--color-raised);
    box-shadow: 0 16px 40px #00000080;
  }

  .bs-env-search {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 8px 0 12px;
    outline: 1px solid var(--color-border-subtle);
    outline-offset: -1px;
    border-radius: var(--radius-control);
    background: var(--color-field);
    color: var(--color-text-muted);
  }

  .bs-env-search :global(.material-symbols-outlined) {
    font-size: 16px;
  }

  .bs-env-search :global(input) {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: 0;
    outline: none;
    box-shadow: none;
    background: transparent;
    color: var(--color-text);
    font: var(--font-size-body) var(--font-ui);
  }

  .bs-env-search :global(input:focus) {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: 0;
    outline: none;
    box-shadow: none;
    background: transparent;
    color: var(--color-text);
    font: var(--font-size-body) var(--font-ui);
  }

  .bs-env-search :global(input::placeholder) {
    color: var(--color-text-muted);
  }

  .bs-env-search :global(kbd) {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 7px;
    border-radius: var(--radius-control);
    background: var(--color-selected);
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro) var(--font-code);
    opacity: 1;
  }

  .bs-env-heading {
    flex: none;
    display: flex;
    justify-content: space-between;
    height: 27px;
    padding: 10px 12px 4px;
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro)/13px var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
  }

  .bs-env-heading :global(.sort) {
    letter-spacing: 0.6px;
  }

  .bs-env-item {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 32px;
    padding: 0 12px;
    border-radius: var(--radius-control);
    color: var(--color-text);
    font: var(--font-size-body) var(--font-ui);
    text-align: left;
  }

  .bs-env-item:hover,
  .bs-env-item:focus-visible {
    background: var(--color-hover-strong);
    outline: none;
  }

  .bs-env-item.on {
    background: var(--color-selected);
    font-weight: 600;
  }

  .bs-env-item :global(.tone-production) {
    color: var(--color-danger);
  }

  .bs-env-item :global(.tone-staging) {
    color: var(--color-warning);
  }

  .bs-env-item :global(.tone-local) {
    color: var(--color-success);
  }

  .bs-env-item :global(.label) {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bs-env-item :global(.hint) {
    color: var(--color-text-muted);
    font: 400 var(--font-size-caption) var(--font-ui);
  }

  .bs-env-item.on :global(.hint) {
    color: var(--color-text);
  }

  .bs-env-sep {
    flex: none;
    height: 9px;
    margin: 0 12px;
    background: linear-gradient(var(--color-border-subtle), var(--color-border-subtle)) center / 100% 1px no-repeat;
  }

  .bs-env-scroll {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 200px;
    padding-right: 10px;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--color-text-muted) var(--color-hover);
  }

  .bs-env-scroll.fade {
    -webkit-mask: linear-gradient(#000 calc(100% - 40px), transparent);
    mask: linear-gradient(#000 calc(100% - 40px), transparent);
  }

  .bs-env-scroll::-webkit-scrollbar {
    width: 4px;
  }

  .bs-env-scroll::-webkit-scrollbar-track {
    margin: 4px 0;
    border-radius: 999px;
    background: var(--color-hover);
  }

  .bs-env-scroll::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: var(--color-text-muted);
  }

  .bs-env-foot {
    display: flex;
    gap: 4px;
  }

  .bs-env-foot .bs-env-item {
    flex: 1;
    width: auto;
  }

  .bs-env-new {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 32px;
    padding: 0 12px 0 10px;
    border-radius: var(--radius-control);
    background: var(--color-selected);
    color: var(--color-text);
    font: 600 var(--font-size-body) var(--font-ui);
  }

  .bs-env-new :global(.material-symbols-outlined) {
    font-size: 15px;
  }

  .bs-env-new:hover {
    background: var(--color-hover-strong);
  }

  :global(:root[data-density='compact']) .bs-toolbar-environment {
    height: 28px;
  }

  @media (max-width: 760px) {
    .bs-toolbar-env-name {
      max-width: 48px;
    }
  }
</style>
