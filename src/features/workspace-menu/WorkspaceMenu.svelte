<!--
  Toolbar → workspace menu (top left): current workspace, recent ones with search, open folder,
  new workspace, clone, MCP and workspace settings.
-->
<script lang="ts">
  import { openWorkspaceFolder, switchWorkspace, workspace } from '$entities/workspace';
  import { environments } from '$entities/environment';
  import { GIT_ENABLED, git } from '$entities/git';
  import { hotkeys, formatBinding } from '$shared/settings';
  import { mcpIntegrationStatus, revealPath } from '$shared/ipc';
  import { mcpConnected, pathParts, recentWorkspaceChoices, workspaceInitials, workspaceName } from '$shared/ui';
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
        if (live) mcpOn = mcpConnected(s.clients, workspace.path);
      })
      .catch(() => {
        if (live) mcpOn = false;
      });
    return () => {
      live = false;
    };
  });

  const nameOf = (path: string) => workspaceName(path) || t('workspace.local');
  const title = $derived(workspace.path ? nameOf(workspace.path) : t('workspace.local'));
  const recents = $derived(recentWorkspaceChoices(workspace.recent, workspace.path));
  const q = $derived(query.trim().toLowerCase());
  const hit = (path: string) => !q || path.toLowerCase().includes(q);
  const shownRecents = $derived(recents.filter(hit));
  const showCurrent = $derived(!!workspace.path && hit(workspace.path));

  function countRequests(nodes: TreeNode[]): number {
    return nodes.reduce((n, node) => n + (node.kind === 'folder' ? countRequests(node.children) : 1), 0);
  }
  const requestCount = $derived(countRequests(workspace.tree));

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

<!-- Rule 04: when the path doesn't fit, its start is cut and the last folder stays visible. -->
{#snippet pathLine(full: string)}
  {@const parts = pathParts(full)}
  <span class="sub"><span class="dir">{parts.dir}</span><span class="leaf">{parts.leaf}</span></span>
{/snippet}

<div class="bs-work-wrap" role="presentation" onpointerdown={(e) => e.stopPropagation()}>
  <button
    class="bs-work"
    class:open
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label={title}
    title={`${title}\n${workspace.path || t('workspace.local')}`}
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
      aria-label={t('workspace.title')}
      bind:this={menuEl}
      onkeydown={menuKeydown}
    >
      <label class="bs-work-search">
        <span class="material-symbols-outlined" aria-hidden="true">search</span>
        <input bind:this={searchEl} bind:value={query} placeholder={t('workspace.search')} onkeydown={searchKeydown} />
        {#if hotkeys.current.workspaceMenu}<kbd>{formatBinding(hotkeys.current.workspaceMenu).join('')}</kbd>{/if}
      </label>

      {#if showCurrent}
        <div class="bs-work-menu-label">{t('workspace.current')}</div>
        <button
          class="bs-work-item on"
          type="button"
          role="menuitem"
          title={workspace.path}
          onclick={() => (open = false)}
        >
          <span class="bs-work-avatar" aria-hidden="true">{workspaceInitials(nameOf(workspace.path))}</span>
          <span class="text">
            <span class="main">{nameOf(workspace.path)}</span>
            {@render pathLine(workspace.path)}
            <span class="meta">
              <span>{requestCount} {tp(requestCount, ['запрос', 'запроса', 'запросов'], ['request', 'requests'])}</span>
              <span
                >{`${environments.list.length} ${tp(environments.list.length, ['окружение', 'окружения', 'окружений'], ['environment', 'environments'])}`}</span
              >
              {#if mcpOn}<span class="mcp">{t('workspace.mcp')}</span>{/if}
            </span>
          </span>
          <span class="material-symbols-outlined ok" aria-hidden="true">check</span>
        </button>
      {:else if !workspace.path}
        <div class="bs-work-empty">{t('workspace.none')}</div>
      {/if}

      {#if shownRecents.length > 0}
        <div class="bs-work-menu-label">{t('workspace.recent')}</div>
        {#each shownRecents as path (path)}
          <button class="bs-work-item" type="button" role="menuitem" title={path} onclick={() => choose(path)}>
            <span class="bs-work-avatar muted" aria-hidden="true">{workspaceInitials(nameOf(path))}</span>
            <span class="text">
              <span class="main">{nameOf(path)}</span>
              {@render pathLine(path)}
            </span>
            <kbd>{formatBinding(`Mod+Alt+${recents.indexOf(path) + 2}`).join('')}</kbd>
          </button>
        {/each}
      {:else if q && !showCurrent}
        <div class="bs-work-empty">{t('workspace.noMatch')}</div>
      {/if}

      <div class="bs-work-menu-sep" role="separator"></div>
      <!-- A workspace is just a folder: the native picker offers «New Folder», so "new" and "open" share one flow.
           No hotkey hint on «new»: the design's ⌘⇧N is already «new collection». -->
      <button class="bs-work-item action" type="button" role="menuitem" onclick={() => run(openWorkspaceFolder)}>
        <span class="material-symbols-outlined" aria-hidden="true">create_new_folder</span>
        <span class="text"><span class="main">{t('workspace.new')}</span></span>
      </button>
      <button class="bs-work-item action" type="button" role="menuitem" onclick={() => run(openWorkspaceFolder)}>
        <span class="material-symbols-outlined" aria-hidden="true">folder_open</span>
        <span class="text"><span class="main">{t('workspace.openFolder')}</span></span>
        {#if hotkeys.current.openFolder}<kbd>{formatBinding(hotkeys.current.openFolder).join('')}</kbd>{/if}
      </button>
      {#if GIT_ENABLED}
        <button
          class="bs-work-item action"
          type="button"
          role="menuitem"
          onclick={() => run(() => (git.cloneOpen = true))}
        >
          <span class="material-symbols-outlined" aria-hidden="true">download</span>
          <span class="text"><span class="main">{t('git.clone.menu')}</span></span>
        </button>
      {/if}
      {#if workspace.path}
        <button
          class="bs-work-item action"
          type="button"
          role="menuitem"
          onclick={() => run(() => revealPath(workspace.path))}
        >
          <span class="material-symbols-outlined" aria-hidden="true">open_in_new</span>
          <span class="text"><span class="main">{t('workspace.reveal')}</span></span>
        </button>
        <div class="bs-work-menu-sep" role="separator"></div>
        <button class="bs-work-item action" type="button" role="menuitem" onclick={() => run(onSettings)}>
          <span class="material-symbols-outlined" aria-hidden="true">tune</span>
          <span class="text"><span class="main">{t('workspace.settings')}</span></span>
          {#if hotkeys.current.settings}<kbd>{formatBinding(hotkeys.current.settings).join('')}</kbd>{/if}
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .bs-work-item :global(.main) {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12.5px;
    font-weight: 650;
  }

  .bs-work :global(svg) {
    width: 13px;
    height: 13px;
    color: var(--t2);
  }

  .bs-work-wrap {
    position: relative;
    flex: 0 0 auto;
  }

  .bs-work-title {
    display: inline-block;
    max-width: 210px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bs-work-menu-label {
    padding: 4px 8px 6px;
    color: var(--t2);
    font-size: 11px;
    font-weight: 700;
  }

  .bs-work-item.on {
    background: var(--hover);
  }

  .bs-work-item :global(.material-symbols-outlined) {
    flex: 0 0 18px;
    color: var(--accent);
  }

  .bs-work-item :global(.text) {
    min-width: 0;
    display: block;
    flex: 1 1 auto;
  }

  .bs-work-item :global(.sub) {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-top: 1px;
    color: var(--t2);
    font-family: var(--mono);
    font-size: 10.5px;
  }

  .bs-work-item.action {
    min-height: 34px;
  }

  .bs-work-item.action :global(.main) {
    color: var(--accent);
  }

  .bs-work-menu-sep {
    height: 0.5px;
    margin: 7px 4px;
    background: var(--sepsoft);
  }

  .bs-work-empty {
    padding: 8px;
    color: var(--t2);
    font-size: 12.5px;
  }

  .bs-work {
    display: flex;
    align-items: center;
    gap: 6px;
    border: 0.5px solid transparent;
    color: var(--text);
    height: 26px;
    padding: 0 7px;
    border-radius: 4px;
    font-size: 11.5px;
    font-weight: 550;
  }

  .bs-work:hover {
    border-color: var(--sepsoft);
    background: var(--hover);
  }

  .bs-work.open {
    border-color: var(--sepsoft);
    background: var(--hover);
  }

  .bs-work-menu {
    position: absolute;
    z-index: 120;
    top: calc(100% + 8px);
    left: 0;
    width: min(300px, calc(100vw - 24px));
    padding: 7px;
    border: 1px solid var(--sep);
    border-radius: 6px;
    background: var(--surface-solid);
    box-shadow: var(--shadow-panel);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }

  :global(.dark) .bs-work-menu {
    background: var(--surface-solid);
  }

  .bs-work-item {
    width: 100%;
    min-height: 38px;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 7px 8px;
    color: var(--text);
    text-align: left;
    overflow: hidden;
    contain: paint;
    border-radius: 4px;
  }

  .bs-work-item:hover {
    color: var(--text);
    background: var(--hover);
  }

  .bs-work :global(.material-symbols-outlined:first-child) {
    font-size: 16px;
    color: var(--t2);
  }

  @media (max-width: 480px) {
    .bs-work-title {
      max-width: 100px;
    }
  }

  :global(.bs-tb) .bs-work-wrap {
    margin: 0;
    min-width: 0;
  }

  :global(.bs-tb) .bs-work {
    height: 32px;
    max-width: 100%;
    padding: 0 12px 0 4px;
    gap: 8px;
    border: 0;
    border-radius: var(--radius-control);
    background: var(--color-panel);
    color: var(--color-text);
    font-size: var(--font-size-body);
    font-weight: 600;
    box-shadow: none;
  }

  :global(.bs-tb) .bs-work:hover {
    background: var(--color-raised);
  }

  :global(.bs-tb) .bs-work.open {
    background: var(--color-raised);
  }

  :global(.bs-tb) .bs-work :global(.material-symbols-outlined) {
    color: var(--color-text-muted);
  }

  .bs-work-avatar {
    flex: 0 0 24px;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--color-inverse);
    color: var(--color-on-inverse);
    font: 700 var(--font-size-micro) var(--font-code);
  }

  :global(:root[data-density='compact'] .bs-tb) .bs-work {
    height: 28px;
  }

  /* Flow · Размеры окна: from 1920 down to the 720 × 520 minimum (tauri.conf.json). The sidebar never
     covers the content (layout.svelte.ts squeezes it to 220 first), then secondary labels and columns hide.
     Window widths in the mock map to: ≤ 1100 = 1024, ≤ 900 = 800, ≤ 760 = 720. The response's own items
     follow its container (response.css), so they also react to the side-by-side layout. */
  :global(.bs-tb) .bs-work {
    max-width: min(100%, 220px);
  }

  @media (max-width: 1100px) {
    :global(.bs-tb) .bs-work {
      max-width: min(100%, 160px);
    }
  }

  @media (max-width: 900px) {
    /* Only the avatar; the full name stays in the chip's tooltip. */
    .bs-work-title {
      display: none;
    }
  }

  /* S37 workspace switcher and S38 HTTP method menu */
  :global(.bs) .bs-work-menu {
    border: 1px solid var(--color-border);
    background: var(--color-raised);
    box-shadow: 0 16px 40px var(--color-shadow, rgba(0, 0, 0, 0.14));
    width: min(360px, calc(100vw - 24px));
    padding: 6px;
    border-radius: 22px;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }

  .bs-work-search {
    height: 36px;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 2px;
    padding: 0 8px 0 12px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    background: var(--color-field);
    color: var(--color-text-muted);
  }

  .bs-work-search :global(.material-symbols-outlined) {
    font-size: 16px;
  }

  .bs-work-search :global(input) {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: none;
    color: var(--color-text);
    font: var(--font-size-body) var(--font-ui);
  }

  /* base.css rings every focused input; this one is focused whenever the menu opens (like the ⌘K
     palette's), so only the field's border lights up instead of a square ring inside it. */
  :global(.bs) .bs-work-search :global(input:focus-visible) {
    box-shadow: none;
  }

  .bs-work-search:focus-within {
    border-color: var(--color-border);
  }

  .bs-work-search :global(input::placeholder) {
    color: var(--color-text-muted);
  }

  :global(.bs) .bs-work-search :global(kbd) {
    padding: 3px 7px;
    border-radius: var(--radius-control);
    background: var(--color-selected);
    color: var(--color-text-secondary);
    font: var(--font-size-micro) var(--font-ui);
    opacity: 1;
  }

  :global(.bs) .bs-work-menu .bs-work-menu-label {
    padding: 10px 12px 4px;
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro) var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
  }

  :global(.bs) .bs-work-menu .bs-work-item {
    min-height: 0;
    gap: 10px;
    padding: 8px 12px 8px 8px;
    border-radius: 16px;
    color: var(--color-text);
  }

  :global(.bs) .bs-work-menu .bs-work-item:hover {
    background: var(--color-selected);
  }

  :global(.bs) .bs-work-menu .bs-work-item.on {
    background: var(--color-selected);
  }

  :global(.bs) .bs-work-menu .bs-work-item .bs-work-avatar {
    flex-basis: 30px;
    width: 30px;
    height: 30px;
  }

  :global(.bs) .bs-work-menu .bs-work-avatar.muted {
    background: var(--color-raised);
    border: 1px solid var(--color-border-subtle);
    color: var(--color-text-secondary);
  }

  :global(.bs) .bs-work-menu .bs-work-item :global(.main) {
    font: 500 var(--font-size-ui) var(--font-ui);
  }

  :global(.bs) .bs-work-menu .bs-work-item :global(.sub) {
    color: var(--color-text-muted);
    font: var(--font-size-micro) var(--font-code);
  }

  /* Flow · Размеры окна, rules 04: the name wraps to at most two lines; the path's start gives way first. */
  :global(.bs) .bs-work-menu .bs-work-item :global(.main) {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    white-space: normal;
  }

  :global(.bs) .bs-work-menu .bs-work-item :global(.sub) {
    display: flex;
  }

  .bs-work-item :global(.sub > *) {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .bs-work-item :global(.sub .leaf) {
    flex: none;
    max-width: 100%;
  }

  :global(.bs) .bs-work-menu .bs-work-item :global(.meta) {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
  }

  :global(.bs) .bs-work-menu .bs-work-item :global(.meta span) {
    padding: 1px 8px;
    border-radius: var(--radius-control);
    background: var(--color-raised);
    color: var(--color-text-secondary);
    font: var(--font-size-micro) var(--font-ui);
  }

  :global(.bs) .bs-work-menu .bs-work-item :global(.ok) {
    flex: 0 0 auto;
    font-size: 16px;
    color: var(--color-text);
  }

  :global(.bs) .bs-work-menu .bs-work-item :global(kbd) {
    flex: 0 0 auto;
    color: var(--color-text-muted);
    font: var(--font-size-micro) var(--font-ui);
    opacity: 1;
  }

  :global(.bs) .bs-work-menu .bs-work-item.action {
    height: 32px;
    padding: 0 12px;
    border-radius: var(--radius-control);
  }

  :global(.bs) .bs-work-menu .bs-work-item.action :global(.material-symbols-outlined) {
    flex: 0 0 16px;
    font-size: 16px;
    color: var(--color-text-muted);
  }

  :global(.bs) .bs-work-menu .bs-work-item.action :global(.main) {
    color: var(--color-text);
    font-weight: 400;
    font-size: var(--font-size-body);
  }

  :global(.bs) .bs-work-menu .bs-work-menu-sep {
    height: 1px;
    margin: 4px 10px;
    background: var(--color-border-subtle);
  }

  :global(.bs) .bs-work-menu .bs-work-empty {
    padding: 8px 12px;
    color: var(--color-text-muted);
    font-size: var(--font-size-body);
  }

  /* Workspace picker: «● MCP подключён» chip in the current workspace's meta row. */
  :global(.bs) .bs-work-menu .bs-work-item :global(.meta span.mcp) {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  :global(.bs) .bs-work-menu .bs-work-item :global(.meta span.mcp::before) {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-success);
  }

  :global(.bs) .bs-work-menu .bs-work-item:focus-visible {
    outline: 2px solid var(--color-text);
    outline-offset: -2px;
  }
</style>
