<script lang="ts">
  import {
    addFolder,
    clearHistory,
    collections,
    dirtyTabIds,
    historyLimit,
    historyPaused,
    openSavedRequest,
    runInRunner,
  } from '../stores';
  import { findNode } from '../domain/tree';
  import { appMenuWidth, type AppMenuState, type RequestProtocol } from '../domain/appShell';
  import type { Tab } from '../domain/types';
  import { t } from '../i18n';

  let {
    menu,
    closeMenu,
    tab,
    folderName,
    onNewHere,
    onNewFolderHere,
    onSwitch,
    onAddRequest,
    onAddFolder,
    onSaveHere,
    onRename,
    onDuplicate,
    onMove,
    onAuth,
    onDelete,
    onCopyCurl,
    onImportCurl,
    onImport,
    onExportOpenApi,
    onSaveAs,
    onRenameTab,
    onCopyCurlTab,
    onRevert,
    onRequestSettings,
  }: {
    menu: AppMenuState;
    closeMenu: () => void;
    /** Active request tab: the protocol menu checks its type, the ⋯ menu enables «Сбросить» by its dirty state. */
    tab: Tab | undefined;
    /** Folder of the active saved request: the create menu adds next to it. */
    folderName: string | undefined;
    onNewHere: (kind: RequestProtocol) => void;
    onNewFolderHere: () => void;
    onSwitch: (kind: RequestProtocol) => void;
    onAddRequest: (kind: RequestProtocol) => void;
    onAddFolder: () => void;
    onSaveHere: () => void;
    onRename: () => void;
    onDuplicate: () => void;
    onMove: () => void;
    onAuth: () => void;
    onDelete: () => void;
    onCopyCurl: () => void;
    onImportCurl: () => void;
    onImport: () => void;
    onExportOpenApi: (format: 'json' | 'yaml') => void;
    onSaveAs: () => void;
    onRenameTab: () => void;
    onCopyCurlTab: () => void;
    onRevert: () => void;
    onRequestSettings: () => void;
  } = $props();

  // Import sources (S22): every file format goes through the same import dialog, which sniffs the format.
  const importSources = [
    { label: 'OpenAPI 3', icon: 'description', hint: 'nav.menu.hintFileUrl' },
    { label: 'Postman', icon: 'inventory_2', hint: 'nav.menu.hintPostman' },
    { label: 'Insomnia', icon: 'inventory_2', hint: 'nav.menu.hintInsomnia' },
    { label: 'HAR', icon: 'data_object', hint: 'nav.menu.hintHar' },
  ];

  const historyLimits: { label: string; value: number }[] = [
    { label: '50', value: 50 },
    { label: '100', value: 100 },
    { label: '200', value: 200 },
    { label: '500', value: 500 },
    { label: '1000', value: 1000 },
    { label: 'nav.menu.all', value: 0 },
  ];

  let importOpen = $state(false);
  let importTop = $state(0);
  $effect(() => { if (!menu.kind) importOpen = false; });

  const node = $derived(menu.nodeId ? findNode($collections, menu.nodeId) : undefined);

  // Open upward when the menu would run past the bottom of the window.
  let menuEl = $state<HTMLDivElement>();
  let top = $state(0);
  $effect(() => {
    if (!menu.kind || !menuEl) return;
    const h = menuEl.offsetHeight;
    const maxTop = window.innerHeight - h - 8;
    top = menu.y <= maxTop ? menu.y : Math.max(8, Math.min(maxTop, (menu.flipY ?? menu.y) - h));
  });

  function showImport(e: Event): void {
    importTop = (e.currentTarget as HTMLElement).offsetTop - 33;
    importOpen = true;
  }

  function addRootFolder(): void {
    void addFolder();
    closeMenu();
  }

  // ↑↓ walk the items (focus lands on the first one when the menu opens); Esc is handled globally and returns focus.
  $effect(() => {
    if (menu.kind && menuEl) menuEl.querySelector<HTMLButtonElement>('button.mi:not(:disabled)')?.focus();
  });
  function menuKeydown(e: KeyboardEvent): void {
    if (!menuEl || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    const items = [...menuEl.querySelectorAll<HTMLButtonElement>('button.mi:not(:disabled)')];
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  }

  function openRequest(): void {
    if (node?.kind === 'request') openSavedRequest(node);
    closeMenu();
  }
</script>

{#snippet item(icon: string, label: string, run: () => void, shortcut = '', cls = '', disabled = false)}
  <button class="mi {cls}" role={cls.includes('check') ? 'menuitemradio' : 'menuitem'} aria-checked={cls.includes('check') ? cls.includes('on') : undefined} {disabled} onclick={run} onpointerenter={() => { if (!cls.includes('sub')) importOpen = false; }}>
    <span class="material-symbols-outlined ic" aria-hidden="true">{icon}</span>
    <span class="lb">{label}</span>
    {#if shortcut}<span class="sc">{shortcut}</span>{/if}
  </button>
{/snippet}

{#if menu.kind}
  <button class="bs-backdrop" aria-label={$t('nav.menu.closeMenu')} onclick={closeMenu}></button>
  <div class="bs-menu" role="menu" tabindex="-1" onkeydown={menuKeydown} bind:this={menuEl} style="left:{menu.x}px; top:{top}px; width:{appMenuWidth(menu.kind)}px">
    {#if menu.kind === 'create'}
      <div class="lbl">{folderName ? $t('nav.menu.inFolder', { name: folderName }) : $t('nav.menu.newRequest')}</div>
      {@render item('add', $t('nav.menu.http'), () => { closeMenu(); onNewHere('http'); }, '⌘N')}
      {@render item('hub', $t('nav.menu.grpc'), () => { closeMenu(); onNewHere('grpc'); }, '⌥⌘N')}
      {@render item('create_new_folder', $t('nav.menu.folder'), () => { closeMenu(); onNewFolderHere(); }, '⇧⌘F')}
      <div class="dv"></div>
      <div class="lbl">{$t('nav.menu.inWorkspace')}</div>
      {@render item('library_add', $t('nav.menu.collection'), addRootFolder, '⇧⌘N')}
      <button class="mi" class:open={importOpen} role="menuitem" aria-haspopup="menu" aria-expanded={importOpen} onpointerenter={showImport} onclick={showImport}>
        <span class="material-symbols-outlined ic" aria-hidden="true">download</span>
        <span class="lb">{$t('nav.menu.import')}</span>
        <span class="sc">›</span>
      </button>
      {#if importOpen}
        <div class="bs-menu bs-submenu" role="menu" style="top:{importTop}px">
          <div class="lbl">{$t('nav.menu.importFrom')}</div>
          {@render item('terminal', 'cURL', () => { closeMenu(); onImportCurl(); }, $t('nav.menu.pasteClip'), 'sub hint')}
          {#each importSources as src (src.label)}
            {@render item(src.icon, src.label, () => { closeMenu(); onImport(); }, $t(src.hint), 'sub hint')}
          {/each}
        </div>
      {/if}
    {:else if menu.kind === 'switch'}
      {@render item(tab?.protocol !== 'grpc' ? 'check' : '', 'HTTP', () => onSwitch('http'), '', `check ${tab?.protocol !== 'grpc' ? 'on' : ''}`)}
      {@render item(tab?.protocol === 'grpc' ? 'check' : '', 'gRPC', () => onSwitch('grpc'), '', `check ${tab?.protocol === 'grpc' ? 'on' : ''}`)}
    {:else if menu.kind === 'reqmore'}
      {#if menu.nodeId}
        {@render item('edit', $t('nav.menu.rename'), onRenameTab, 'F2')}
        {@render item('content_copy', $t('nav.menu.duplicate'), onDuplicate, '⌘D')}
        {#if tab?.protocol === 'http'}{@render item('code', $t('nav.menu.copyCurl'), onCopyCurlTab, '⌥⌘C')}{/if}
        {@render item('drive_file_move', $t('nav.menu.moveTo'), onMove, '›')}
        <div class="dv"></div>
        {@render item('undo', $t('nav.menu.revert'), onRevert, '', '', !tab || !$dirtyTabIds.has(tab.id))}
        {#if tab?.protocol === 'http'}{@render item('tune', $t('nav.menu.requestSettings'), onRequestSettings)}{/if}
        {@render item('play_arrow', $t('nav.menu.runInRunner'), () => { const id = menu.nodeId!; closeMenu(); runInRunner(id); })}
        <div class="dv"></div>
        {@render item('delete', $t('nav.menu.delete'), onDelete, '⌫', 'danger')}
      {:else}
        {@render item('drive_file_move', $t('nav.menu.saveToFolder'), () => { closeMenu(); onSaveAs(); })}
        {#if tab?.protocol === 'http'}
          {@render item('code', $t('nav.menu.copyCurl'), onCopyCurlTab, '⌥⌘C')}
          {@render item('tune', $t('nav.menu.requestSettings'), onRequestSettings)}
        {/if}
      {/if}
    {:else if menu.kind === 'coll'}
      <div class="lbl">{$t('nav.menu.inFolderDefault', { name: node?.name ?? $t('nav.menu.folderDefault') })}</div>
      {@render item('add', $t('nav.menu.http'), () => onAddRequest('http'))}
      {@render item('hub', $t('nav.menu.grpc'), () => onAddRequest('grpc'))}
      {@render item('create_new_folder', $t('nav.menu.folder'), onAddFolder)}
      {#if menu.nodeId}
        {@render item('note_add', $t('nav.menu.saveHere'), onSaveHere, '⌘S')}
        {#if menu.isFolder}
          <div class="dv"></div>
          {@render item('play_arrow', $t('nav.menu.runInRunner'), () => { const id = menu.nodeId!; closeMenu(); runInRunner(id); })}
          {@render item('lock', $t('nav.menu.collAuth'), onAuth)}
          {@render item('upload', $t('nav.menu.exportJson'), () => onExportOpenApi('json'))}
          {@render item('upload', $t('nav.menu.exportYaml'), () => onExportOpenApi('yaml'))}
        {/if}
        <div class="dv"></div>
        {@render item('edit', $t('nav.menu.rename'), onRename, 'F2')}
        {@render item('content_copy', $t('nav.menu.duplicate'), onDuplicate, '⌘D')}
        {@render item('drive_file_move', $t('nav.menu.moveTo'), onMove, '›')}
        <div class="dv"></div>
        {@render item('delete', $t('nav.menu.delete'), onDelete, '⌫', 'danger')}
      {/if}
    {:else if menu.kind === 'req'}
      {@render item('open_in_new', $t('nav.menu.openNewTab'), openRequest, '⌘↵', 'hint')}
      {@render item('edit', $t('nav.menu.rename'), onRename, 'F2')}
      {@render item('content_copy', $t('nav.menu.duplicate'), onDuplicate, '⌘D')}
      <div class="dv"></div>
      {#if node?.kind === 'request' && node.protocol === 'http'}{@render item('code', $t('nav.menu.copyCurl'), onCopyCurl, '⌥⌘C')}{/if}
      {@render item('drive_file_move', $t('nav.menu.moveTo'), onMove, '›')}
      <div class="dv"></div>
      {@render item('delete', $t('nav.menu.delete'), onDelete, '⌫', 'danger')}
    {:else if menu.kind === 'history'}
      {@render item($historyPaused ? 'play_arrow' : 'pause', $historyPaused ? $t('nav.menu.resume') : $t('nav.menu.pause'), () => { historyPaused.set(!$historyPaused); closeMenu(); })}
      {@render item('delete_sweep', $t('nav.menu.clearHistory'), () => { clearHistory(); closeMenu(); }, '', 'danger')}
      <div class="dv"></div>
      <div class="lbl">{$t('nav.menu.keepLast')}</div>
      {#each historyLimits as opt (opt.value)}
        {@render item($historyLimit === opt.value ? 'check' : '', opt.value === 0 ? $t('nav.menu.all') : opt.label, () => { historyLimit.set(opt.value); closeMenu(); })}
      {/each}
    {/if}
  </div>
{/if}
