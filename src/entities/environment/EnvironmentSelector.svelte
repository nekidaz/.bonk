<script lang="ts">
  import { t } from '$shared/i18n';
  import type { Environment } from '$shared/model';
  import { ENV_COLOR_VAR, envColor, envShortcutTargets, envToneOf, pushRecent, type EnvTone } from './palette';
  import {
    activeEnvironmentId,
    addEnvironment,
    environments,
    openEnvironmentsSheet,
    setActiveEnvironment,
  } from './store';

  const RECENT_KEY = 'bonk.recentEnvironments';
  const TONE_ICON: Record<EnvTone, string> = {
    production: 'lock',
    staging: 'circle',
    local: 'circle',
    other: 'circle',
  };

  let open = $state(false);
  let query = $state('');
  let search = $state<HTMLInputElement | null>(null);
  let recentIds = $state<string[]>(readRecent());

  const activeEnv = $derived($environments.find((env) => env.id === $activeEnvironmentId));
  const environmentName = $derived(activeEnv?.name ?? $t('env.none'));
  const tone = $derived(activeEnv ? envToneOf(activeEnv) : 'none');
  const q = $derived(query.trim().toLowerCase());
  // S14: the active environment always heads the recents.
  const recent = $derived(
    [...new Set([...($activeEnvironmentId ? [$activeEnvironmentId] : []), ...recentIds])]
      .slice(0, 3)
      .map((id) => $environments.find((env) => env.id === id))
      .filter((env) => env !== undefined && (!q || env.name.toLowerCase().includes(q))),
  );
  const all = $derived(
    [...$environments]
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
    openEnvironmentsSheet();
    open = false;
  }
  function create(): void {
    choose(addEnvironment());
    openEnvironmentsSheet();
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
  {@const on = (env?.id ?? null) === $activeEnvironmentId}
  <button class="bs-env-item" class:on role="menuitemradio" aria-checked={on} onclick={() => choose(env?.id ?? null)}>
    <span
      class="material-symbols-outlined lead tone-{tn}"
      style:color={env && tn !== 'production' ? ENV_COLOR_VAR[envColor(env)] : undefined}
      aria-hidden="true">{env ? TONE_ICON[tn as EnvTone] : 'block'}</span
    >
    <span class="label">{env?.name ?? $t('env.none')}</span>
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
    <span class="bs-toolbar-env-name">{environmentName}</span>
    <span class="material-symbols-outlined chevron" aria-hidden="true">keyboard_arrow_up</span>
  </button>
  {#if open}
    <div
      class="bs-env-menu"
      role="menu"
      aria-label={$t('env.select_aria')}
      tabindex="-1"
      bind:this={menuEl}
      onkeydown={menuKeydown}
    >
      <label class="bs-env-search">
        <span class="material-symbols-outlined" aria-hidden="true">search</span>
        <input
          bind:this={search}
          bind:value={query}
          placeholder={$t('env.find')}
          aria-label={$t('env.find')}
          {@attach (el) => el.focus()}
        />
        <kbd>⌘E</kbd>
      </label>
      {#if recent.length}
        <div class="bs-env-heading"><span>{$t('env.recent')}</span></div>
        {#each recent as env, i (env!.id)}
          {@render item(env!, env!.id === $activeEnvironmentId ? '✓' : keyFor(env!))}
        {/each}
        <div class="bs-env-sep"></div>
      {/if}
      <div class="bs-env-heading">
        <span>{$t('env.all')}&nbsp;&nbsp;·&nbsp;&nbsp;{all.length}</span><span class="sort">A–Z</span>
      </div>
      <div class="bs-env-scroll">
        {#if !q || $t('env.none').toLowerCase().includes(q)}{@render item(null, '')}{/if}
        {#each all as env (env.id)}{@render item(env, '')}{/each}
      </div>
      <div class="bs-env-sep"></div>
      <div class="bs-env-foot">
        <button class="bs-env-item" role="menuitem" onclick={manage}
          ><span class="material-symbols-outlined lead" aria-hidden="true">tune</span><span class="label"
            >{$t('env.manage')}</span
          ></button
        >
        <button class="bs-env-new" role="menuitem" onclick={create}
          ><span class="material-symbols-outlined" aria-hidden="true">add</span>{$t('env.new_short')}</button
        >
      </div>
    </div>
  {/if}
</div>
