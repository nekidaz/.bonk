<script lang="ts">
  import {
    workspacePath,
    recentWorkspacePaths,
    openWorkspaceFolder,
    switchWorkspace,
    collections,
  } from '$entities/workspace';
  import { environments } from '$entities/environment';
  import { hotkeys, formatBinding } from '$shared/settings';
  import { mcpIntegrationStatus, revealPath } from '$shared/ipc';
  import { mcpConnected, recentWorkspaceChoices, workspaceInitials, workspaceName } from '$shared/ui';
  import type { TreeNode } from '$shared/model';
  import { t, tp } from '$shared/i18n';

  // Two-way bound from the parent so close-on-outside-click (handled by App's
  // window pointerdown listener) keeps working without new logic here.
  let { open = $bindable(), onSettings }: { open: boolean; onSettings: () => void } = $props();

  let query = $state('');
  let searchEl = $state<HTMLInputElement>();
  $effect(() => {
    if (!open) query = '';
    else searchEl?.focus();
  });

  // «● MCP подключён»: some installed AI client points at this workspace. Re-checked each time the menu opens.
  let mcpOn = $state(false);
  $effect(() => {
    if (!open) return;
    let live = true;
    mcpIntegrationStatus()
      .then((s) => {
        if (live) mcpOn = mcpConnected(s.clients, $workspacePath);
      })
      .catch(() => {
        if (live) mcpOn = false;
      });
    return () => {
      live = false;
    };
  });

  const nameOf = (path: string) => workspaceName(path) || $t('workspace.local');
  const title = $derived($workspacePath ? nameOf($workspacePath) : $t('workspace.local'));
  const recents = $derived(recentWorkspaceChoices($recentWorkspacePaths, $workspacePath));
  const q = $derived(query.trim().toLowerCase());
  const hit = (path: string) => !q || path.toLowerCase().includes(q);
  const shownRecents = $derived(recents.filter(hit));
  const showCurrent = $derived(!!$workspacePath && hit($workspacePath));

  function countRequests(nodes: TreeNode[]): number {
    return nodes.reduce((n, node) => n + (node.kind === 'folder' ? countRequests(node.children) : 1), 0);
  }
  const requestCount = $derived(countRequests($collections));

  async function choose(path: string): Promise<void> {
    open = false;
    await switchWorkspace(path);
  }

  function run(fn: () => unknown): void {
    open = false;
    void fn();
  }

  // ↑↓ walk the search field and every row; focus returns to the trigger on Esc (handled in App).
  let menuEl = $state<HTMLDivElement>();
  function menuKeydown(e: KeyboardEvent): void {
    if (!menuEl || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    const stops = [...menuEl.querySelectorAll<HTMLElement>('input, button.bs-work-item')];
    const i = stops.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    stops[(i + (e.key === 'ArrowDown' ? 1 : -1) + stops.length) % stops.length]?.focus();
  }

  // ↵ in the search opens the first recent match.
  function searchKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && shownRecents[0]) {
      e.preventDefault();
      void choose(shownRecents[0]);
    }
  }
</script>

<div class="bs-work-wrap" role="presentation" onpointerdown={(e) => e.stopPropagation()}>
  <button
    class="bs-work"
    class:open
    aria-haspopup="menu"
    aria-expanded={open}
    title={$workspacePath || $t('workspace.local')}
    onclick={() => (open = !open)}
  >
    <span class="bs-work-avatar" aria-hidden="true">{workspaceInitials(title)}</span>
    <span class="bs-work-title">{title}</span>
    <span class="material-symbols-outlined" style="font-size:14px">keyboard_arrow_down</span>
  </button>
  {#if open}
    <div
      class="bs-work-menu"
      role="menu"
      tabindex="-1"
      aria-label={$t('workspace.title')}
      bind:this={menuEl}
      onkeydown={menuKeydown}
    >
      <label class="bs-work-search">
        <span class="material-symbols-outlined" aria-hidden="true">search</span>
        <input bind:this={searchEl} bind:value={query} placeholder={$t('workspace.search')} onkeydown={searchKeydown} />
        {#if $hotkeys.workspaceMenu}<kbd>{formatBinding($hotkeys.workspaceMenu).join('')}</kbd>{/if}
      </label>

      {#if showCurrent}
        <div class="bs-work-menu-label">{$t('workspace.current')}</div>
        <button
          class="bs-work-item on"
          type="button"
          role="menuitem"
          title={$workspacePath}
          onclick={() => (open = false)}
        >
          <span class="bs-work-avatar" aria-hidden="true">{workspaceInitials(nameOf($workspacePath))}</span>
          <span class="text">
            <span class="main">{nameOf($workspacePath)}</span>
            <span class="sub">{$workspacePath}</span>
            <span class="meta">
              <span>{requestCount} {$tp(requestCount, ['запрос', 'запроса', 'запросов'], ['request', 'requests'])}</span
              >
              <span
                >{`${$environments.length} ${$tp($environments.length, ['окружение', 'окружения', 'окружений'], ['environment', 'environments'])}`}</span
              >
              {#if mcpOn}<span class="mcp">{$t('workspace.mcp')}</span>{/if}
            </span>
          </span>
          <span class="material-symbols-outlined ok" aria-hidden="true">check</span>
        </button>
      {:else if !$workspacePath}
        <div class="bs-work-empty">{$t('workspace.none')}</div>
      {/if}

      {#if shownRecents.length > 0}
        <div class="bs-work-menu-label">{$t('workspace.recent')}</div>
        {#each shownRecents as path (path)}
          <button class="bs-work-item" type="button" role="menuitem" title={path} onclick={() => choose(path)}>
            <span class="bs-work-avatar muted" aria-hidden="true">{workspaceInitials(nameOf(path))}</span>
            <span class="text">
              <span class="main">{nameOf(path)}</span>
              <span class="sub">{path}</span>
            </span>
            <kbd>{formatBinding(`Mod+Alt+${recents.indexOf(path) + 2}`).join('')}</kbd>
          </button>
        {/each}
      {:else if q && !showCurrent}
        <div class="bs-work-empty">{$t('workspace.noMatch')}</div>
      {/if}

      <div class="bs-work-menu-sep" role="separator"></div>
      <!-- A workspace is just a folder: the native picker offers «New Folder», so "new" and "open" share one flow.
           No hotkey hint on «new»: the design's ⌘⇧N is already «new collection». -->
      <button class="bs-work-item action" type="button" role="menuitem" onclick={() => run(openWorkspaceFolder)}>
        <span class="material-symbols-outlined" aria-hidden="true">create_new_folder</span>
        <span class="text"><span class="main">{$t('workspace.new')}</span></span>
      </button>
      <button class="bs-work-item action" type="button" role="menuitem" onclick={() => run(openWorkspaceFolder)}>
        <span class="material-symbols-outlined" aria-hidden="true">folder_open</span>
        <span class="text"><span class="main">{$t('workspace.openFolder')}</span></span>
        {#if $hotkeys.openFolder}<kbd>{formatBinding($hotkeys.openFolder).join('')}</kbd>{/if}
      </button>
      {#if $workspacePath}
        <button
          class="bs-work-item action"
          type="button"
          role="menuitem"
          onclick={() => run(() => revealPath($workspacePath))}
        >
          <span class="material-symbols-outlined" aria-hidden="true">open_in_new</span>
          <span class="text"><span class="main">{$t('workspace.reveal')}</span></span>
        </button>
        <div class="bs-work-menu-sep" role="separator"></div>
        <button class="bs-work-item action" type="button" role="menuitem" onclick={() => run(onSettings)}>
          <span class="material-symbols-outlined" aria-hidden="true">tune</span>
          <span class="text"><span class="main">{$t('workspace.settings')}</span></span>
          {#if $hotkeys.settings}<kbd>{formatBinding($hotkeys.settings).join('')}</kbd>{/if}
        </button>
      {/if}
    </div>
  {/if}
</div>
