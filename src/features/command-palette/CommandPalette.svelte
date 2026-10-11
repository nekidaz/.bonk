<script module lang="ts">
  export interface PaletteCommand {
    label: string;
    icon: string;
    shortcut?: string;
    run: () => void;
  }
</script>

<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { t } from '$shared/i18n';
  import {
    environments,
    setActiveEnvironment,
    ENV_COLOR_VAR,
    envColor,
    envToneOf,
    paletteSlot,
    searchEnvironments,
    searchRequests,
  } from '$entities/environment';
  import { workspace } from '$entities/workspace';
  import { openSavedRequest } from '$entities/request';
  import { methodColor, methodLabel, type RequestNode } from '$shared/model';
  import { applyAppearance, pickTheme, theme, themeInfo, THEMES, type Theme } from '$shared/settings';

  let { open = $bindable(), commands }: { open: boolean; commands: PaletteCommand[] } = $props();

  let query = $state('');
  let sel = $state(0);
  let listEl = $state<HTMLDivElement | null>(null);
  let returnFocus: HTMLElement | null = null;
  // Flow · Темы TH2: «Тема» narrows the palette to themes; the selected one is tried on the whole UI right away,
  // Enter keeps it, Esc (or closing) puts back `saved`.
  let scope = $state<'all' | 'theme'>('all');
  let saved = $state<Theme>(theme.current);

  const q = $derived(query.trim().toLowerCase());
  const themes = $derived(THEMES.filter((x) => x.name.toLowerCase().includes(q)));
  const requests = $derived(searchRequests(workspace.tree, query));
  const themeCommand: PaletteCommand = { label: '', icon: 'palette', run: enterThemes };
  const matchedCommands = $derived(
    [...commands, { ...themeCommand, label: t('palette.cmd.theme') }].filter((c) => c.label.toLowerCase().includes(q)),
  );
  const envs = $derived(searchEnvironments(environments.list, query));
  const counts = $derived({ requests: requests.length, envs: envs.length, commands: matchedCommands.length });
  const total = $derived(scope === 'theme' ? themes.length : counts.requests + counts.envs + counts.commands);

  $effect(() => {
    if (!open) return;
    untrack(() => {
      query = '';
      sel = 0;
      scope = 'all';
      returnFocus = document.activeElement as HTMLElement | null;
    });
  });
  // The theme on screen: the one being tried, otherwise the saved one (also after Esc, a click outside, or Enter).
  $effect(() => {
    applyAppearance(open && scope === 'theme' && themes[sel] ? themes[sel].id : theme.current);
  });
  $effect(() => {
    listEl?.querySelector(`[data-index="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  });

  function close(): void {
    open = false;
    returnFocus?.focus();
  }

  async function openRequest(node: RequestNode, send: boolean): Promise<void> {
    open = false;
    openSavedRequest(node);
    if (!send || node.protocol !== 'http') return;
    await tick();
    document.querySelector<HTMLButtonElement>('.bs-send')?.click();
  }

  function enterThemes(): void {
    saved = theme.current;
    scope = 'theme';
    query = '';
    sel = THEMES.findIndex((x) => x.id === saved);
  }

  function leaveThemes(): void {
    scope = 'all';
    sel = 0;
  }

  function runAt(i: number, send = false): void {
    if (scope === 'theme') {
      if (!themes[i]) return;
      pickTheme(themes[i].id);
      close();
      return;
    }
    const slot = paletteSlot(i, counts);
    if (!slot) return;
    if (slot.group === 'request') void openRequest(requests[slot.index].node, send);
    else if (slot.group === 'env') {
      open = false;
      setActiveEnvironment(envs[slot.index].id);
    } else {
      const c = matchedCommands[slot.index];
      if (c.run !== enterThemes) open = false;
      c.run();
    }
  }

  function keydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (total) sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + total) % total;
    } else if (e.key === 'Backspace' && scope === 'theme' && !query) {
      e.preventDefault();
      leaveThemes();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      runAt(sel, e.metaKey || e.ctrlKey);
    }
  }
</script>

{#if open}
  <div
    class="bs-palette-scrim"
    role="presentation"
    onpointerdown={(e) => {
      if (e.target === e.currentTarget) close();
    }}
  >
    <div class="bs-palette" role="dialog" aria-modal="true" aria-label={t('palette.title')}>
      <div class="bs-palette-search">
        <span class="material-symbols-outlined" aria-hidden="true">{scope === 'theme' ? 'palette' : 'search'}</span>
        {#if scope === 'theme'}<span class="bs-palette-scope">{t('palette.theme')}</span>{/if}
        <input
          bind:value={query}
          {@attach (el) => el.focus()}
          oninput={() => (sel = 0)}
          placeholder={scope === 'theme' ? t('palette.theme.search') : t('palette.search')}
          aria-label={scope === 'theme' ? t('palette.theme.search') : t('palette.search')}
          role="combobox"
          aria-expanded="true"
          aria-controls="bs-palette-list"
          aria-activedescendant={total ? `bs-palette-${sel}` : undefined}
          onkeydown={keydown}
        />
        <kbd class="code">Esc</kbd>
      </div>
      <div class="bs-palette-list" id="bs-palette-list" role="listbox" bind:this={listEl}>
        {#if scope === 'theme'}
          <div class="bs-palette-heading"><span>{t('palette.themes')}</span><span>{themes.length}</span></div>
          {#each themes as th, i (th.id)}
            <div
              class="bs-palette-item cmd"
              class:on={sel === i}
              id="bs-palette-{i}"
              data-index={i}
              role="option"
              aria-selected={sel === i}
              tabindex="-1"
              onpointermove={() => (sel = i)}
              onclick={() => runAt(i)}
              onkeydown={() => {}}
            >
              <span class="bs-palette-swatch" data-theme={th.id} aria-hidden="true"><i></i><i></i><i></i><i></i></span>
              <span class="name">{th.name}</span>
              {#if th.id === saved}
                <span class="bs-palette-current"
                  ><span class="material-symbols-outlined" aria-hidden="true">check</span>{t(
                    'palette.theme.current',
                  )}</span
                >
              {:else if sel === i}
                <span class="bs-palette-trying"
                  ><span class="material-symbols-outlined" aria-hidden="true">visibility</span>{t(
                    'palette.theme.trying',
                  )}</span
                >
              {/if}
            </div>
          {/each}
        {/if}
        {#if scope === 'all' && requests.length}
          <div class="bs-palette-heading"><span>{t('palette.requests')}</span><span>{requests.length}</span></div>
          {#each requests as r, i (r.node.id)}
            <div
              class="bs-palette-item"
              class:on={sel === i}
              id="bs-palette-{i}"
              data-index={i}
              role="option"
              aria-selected={sel === i}
              tabindex="-1"
              onpointermove={() => (sel = i)}
              onclick={(e) => runAt(i, e.metaKey || e.ctrlKey)}
              onkeydown={() => {}}
            >
              <span class="m" style="color:{methodColor(r.node.protocol === 'grpc' ? 'GRPC' : r.node.request.method)}"
                >{r.node.protocol === 'grpc' ? 'gRPC' : methodLabel(r.node.request.method)}</span
              >
              <span class="name">{r.node.name}</span>
              <span class="meta">{r.folder}</span>
              {#if sel === i}<kbd>↵</kbd>{/if}
            </div>
          {/each}
        {/if}
        {#if scope === 'all' && envs.length}
          <div class="bs-palette-heading"><span>{t('palette.envs')}</span><span>{envs.length}</span></div>
          {#each envs as env, j (env.id)}
            {@const i = requests.length + j}
            {@const tone = envToneOf(env)}
            <div
              class="bs-palette-item cmd"
              class:on={sel === i}
              id="bs-palette-{i}"
              data-index={i}
              role="option"
              aria-selected={sel === i}
              tabindex="-1"
              onpointermove={() => (sel = i)}
              onclick={() => runAt(i)}
              onkeydown={() => {}}
            >
              <span
                class="material-symbols-outlined"
                style:color={tone === 'production' ? undefined : ENV_COLOR_VAR[envColor(env)]}
                aria-hidden="true">{tone === 'production' ? 'lock' : 'circle'}</span
              >
              <span class="name">{env.name}</span>
              {#if env.id === environments.activeId}<span class="material-symbols-outlined" aria-hidden="true"
                  >check</span
                >{/if}
            </div>
          {/each}
        {/if}
        {#if scope === 'all' && matchedCommands.length}
          <div class="bs-palette-heading">
            <span>{t('palette.commands')}</span><span>{matchedCommands.length}</span>
          </div>
          {#each matchedCommands as c, j (c.label)}
            {@const i = requests.length + envs.length + j}
            <div
              class="bs-palette-item cmd"
              class:on={sel === i}
              id="bs-palette-{i}"
              data-index={i}
              role="option"
              aria-selected={sel === i}
              tabindex="-1"
              onpointermove={() => (sel = i)}
              onclick={() => runAt(i)}
              onkeydown={() => {}}
            >
              <span class="material-symbols-outlined" aria-hidden="true">{c.icon}</span>
              <span class="name">{c.label}</span>
              {#if c.shortcut}<span class="sc">{c.shortcut}</span>{/if}
            </div>
          {/each}
        {/if}
        {#if !total}<div class="bs-palette-empty">{t('palette.empty', { q: query.trim() })}</div>{/if}
      </div>
      <div class="bs-palette-foot">
        {#if scope === 'theme'}
          <span><kbd class="code">↑↓</kbd>{t('palette.theme.try')}</span>
          <span><kbd>↵</kbd>{t('palette.theme.keep')}</span>
          <span><kbd class="code">Esc</kbd>{t('palette.theme.revert', { name: themeInfo(saved).name })}</span>
        {:else}
          <span><kbd class="code">↑↓</kbd>{t('palette.select')}</span>
          <span><kbd>↵</kbd>{t('palette.open')}</span>
          <span><kbd>⌘↵</kbd>{t('palette.openSend')}</span>
        {/if}
      </div>
    </div>
  </div>
{/if}
