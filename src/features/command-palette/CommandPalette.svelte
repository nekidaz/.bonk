<script module lang="ts">
  export interface PaletteCommand {
    label: string;
    icon: string;
    shortcut?: string;
    run: () => void;
  }
</script>

<script lang="ts">
  import { tick } from 'svelte';
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
  import { methodColor, type RequestNode } from '$shared/model';

  let { open = $bindable(), commands }: { open: boolean; commands: PaletteCommand[] } = $props();

  let query = $state('');
  let sel = $state(0);
  let listEl = $state<HTMLDivElement | null>(null);
  let returnFocus: HTMLElement | null = null;

  const requests = $derived(searchRequests(workspace.tree, query));
  const matchedCommands = $derived(commands.filter((c) => c.label.toLowerCase().includes(query.trim().toLowerCase())));
  const envs = $derived(searchEnvironments(environments.list, query));
  const counts = $derived({ requests: requests.length, envs: envs.length, commands: matchedCommands.length });
  const total = $derived(counts.requests + counts.envs + counts.commands);

  $effect(() => {
    if (!open) return;
    query = '';
    returnFocus = document.activeElement as HTMLElement | null;
  });
  $effect(() => {
    void query;
    sel = 0;
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

  function runAt(i: number, send = false): void {
    const slot = paletteSlot(i, counts);
    if (!slot) return;
    if (slot.group === 'request') void openRequest(requests[slot.index].node, send);
    else if (slot.group === 'env') {
      open = false;
      setActiveEnvironment(envs[slot.index].id);
    } else {
      open = false;
      matchedCommands[slot.index].run();
    }
  }

  function keydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (total) sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + total) % total;
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
        <span class="material-symbols-outlined" aria-hidden="true">search</span>
        <input
          bind:value={query}
          {@attach (el) => el.focus()}
          placeholder={t('palette.search')}
          aria-label={t('palette.search')}
          role="combobox"
          aria-expanded="true"
          aria-controls="bs-palette-list"
          aria-activedescendant={total ? `bs-palette-${sel}` : undefined}
          onkeydown={keydown}
        />
        <kbd class="code">Esc</kbd>
      </div>
      <div class="bs-palette-list" id="bs-palette-list" role="listbox" bind:this={listEl}>
        {#if requests.length}
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
                >{r.node.protocol === 'grpc' ? 'gRPC' : r.node.request.method.toUpperCase()}</span
              >
              <span class="name">{r.node.name}</span>
              <span class="meta">{r.folder}</span>
              {#if sel === i}<kbd>↵</kbd>{/if}
            </div>
          {/each}
        {/if}
        {#if envs.length}
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
        {#if matchedCommands.length}
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
        <span><kbd class="code">↑↓</kbd>{t('palette.select')}</span>
        <span><kbd>↵</kbd>{t('palette.open')}</span>
        <span><kbd>⌘↵</kbd>{t('palette.openSend')}</span>
      </div>
    </div>
  </div>
{/if}
