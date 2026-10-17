<!--
  The one popover menu of the window: «+» create, protocol switch, collection / request rows in the
  sidebar tree, a tab's context menu. Which one is open (`menu.kind`) and where lives in `shell.menu`;
  the actions are mostly in ./actions.ts.
-->
<script lang="ts">
  import { clearHistory, history } from '$entities/history';
  import {
    closeAllTabs,
    closeOtherTabs,
    closeTabsToRight,
    duplicateTab,
    requestCloseTab,
    togglePinTab,
  } from '$features/tabs';
  import { findNode, idToRel, workspace } from '$entities/workspace';
  import { git, openFileHistoryTab } from '$entities/git';
  import { openSavedRequest } from '$entities/request';
  import { runInRunner } from '$features/runner';
  import { appMenuWidth, type AppMenuState } from '$shared/ui';
  import type { RequestProtocol, Tab } from '$shared/model';
  import { t } from '$shared/i18n';
  import { Menu, Backdrop } from '$shared/ui/components';

  let {
    menu,
    closeMenu,
    tab,
    folderName,
    inHistory = false,
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
    onScripts,
    onDelete,
    onCopyCurl,
    onImportCurl,
    onImport,
    onUpdateFromSpec,
    onExportOpenApi,
    onRenameTab,
    onCopyCurlTab,
    onSaveTab,
    onSaveAsTab,
    onRevealTab,
  }: {
    menu: AppMenuState;
    closeMenu: () => void;
    /** Active request tab: the protocol menu checks its type, the ⋯ menu enables “Reset” by its dirty state. */
    tab: Tab | undefined;
    /** Folder of the active saved request: the create menu adds next to it. */
    folderName: string | undefined;
    /** S22c: the create menu opened from the History panel has no Folder row. */
    inHistory?: boolean;
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
    onScripts: () => void;
    onDelete: () => void;
    onCopyCurl: () => void;
    onImportCurl: () => void;
    onImport: (source?: string) => void;
    onUpdateFromSpec: (folderId: string) => void;
    onExportOpenApi: (format: 'json' | 'yaml') => void;
    onRenameTab: () => void;
    onCopyCurlTab: () => void;
    onSaveTab: () => void;
    onSaveAsTab: () => void;
    onRevealTab: () => void;
  } = $props();

  // Import sources (S22): every file format goes through the same import dialog, which sniffs the format.
  const importSources = [
    { src: 'openapi', label: 'OpenAPI 3', icon: 'description', hint: 'nav.menu.hintFileUrl' },
    { src: 'postman', label: 'Postman', icon: 'inventory_2', hint: 'nav.menu.hintPostman' },
    { src: 'insomnia', label: 'Insomnia', icon: 'inventory_2', hint: 'nav.menu.hintInsomnia' },
    { src: 'har', label: 'HAR', icon: 'data_object', hint: 'nav.menu.hintHar' },
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
  $effect(() => {
    if (!menu.kind) importOpen = false;
  });

  const node = $derived(menu.nodeId ? findNode(workspace.tree, menu.nodeId) : undefined);

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
    // Lines the submenu's first row up with Import: the dense card's padding (4).
    importTop = (e.currentTarget as HTMLElement).offsetTop - 4;
    importOpen = true;
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

  function openHistory(): void {
    const n = node; // read before closeMenu() clears it
    closeMenu();
    if (n) openFileHistoryTab(git.prefix + idToRel(n.id), n.name);
  }

  function openRequest(): void {
    if (node?.kind === 'request') void openSavedRequest(node);
    closeMenu();
  }
</script>

{#snippet item(icon: string, label: string, run: () => void, shortcut = '', cls = '', disabled = false)}
  <button
    class="mi {cls}"
    role={cls.includes('check') ? 'menuitemradio' : 'menuitem'}
    aria-checked={cls.includes('check') ? cls.includes('on') : undefined}
    {disabled}
    onclick={run}
    onpointerenter={() => {
      if (!cls.includes('sub')) importOpen = false;
    }}
  >
    <span class="material-symbols-outlined ic" aria-hidden="true">{icon}</span>
    <span class="lb">{label}</span>
    {#if shortcut}<span class="sc">{shortcut}</span>{/if}
  </button>
{/snippet}

{#if menu.kind}
  <Backdrop aria-label={t('nav.menu.closeMenu')} onclick={closeMenu} />
  <Menu
    class={menu.kind === 'create' ? 'dense' : undefined}
    role="menu"
    tabindex={-1}
    onkeydown={menuKeydown}
    bind:ref={menuEl}
    style="left:{menu.x}px; top:{top}px; width:{appMenuWidth(menu.kind)}px"
  >
    {#if menu.kind === 'create'}
      <!-- As in Postman, no «New request» heading; only a folder target is named. -->
      {#if folderName}<div class="lbl">{t('nav.menu.inFolder', { name: folderName })}</div>{/if}
      <!-- S22b/S22c: protocol rows, then Folder (Collections only) and Import. -->
      {@render item(
        'language',
        'HTTP',
        () => {
          closeMenu();
          onNewHere('http');
        },
        '⌘N',
        'proto http tint',
      )}
      {@render item(
        'hub',
        'gRPC',
        () => {
          closeMenu();
          onNewHere('grpc');
        },
        '⌥⌘N',
        'proto grpc',
      )}
      <div class="dv"></div>
      {#if !inHistory}{@render item(
          'folder',
          t('nav.menu.folder'),
          () => {
            closeMenu();
            onNewFolderHere();
          },
          '⇧⌘F',
        )}{/if}
      <button
        class="mi"
        class:open={importOpen}
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={importOpen}
        onpointerenter={showImport}
        onclick={showImport}
      >
        <span class="material-symbols-outlined ic" aria-hidden="true">download</span>
        <span class="lb">{t('nav.menu.import')}</span>
        <span class="sc">›</span>
      </button>
      {#if importOpen}
        <Menu class="bs-submenu dense" role="menu" style="top:{importTop}px">
          {@render item(
            'terminal',
            'cURL',
            () => {
              closeMenu();
              onImportCurl();
            },
            t('nav.menu.pasteClip'),
            'sub hint',
          )}
          {#each importSources as src (src.label)}
            {@render item(
              src.icon,
              src.label,
              () => {
                closeMenu();
                onImport(src.src);
              },
              t(src.hint),
              'sub hint',
            )}
          {/each}
        </Menu>
      {/if}
    {:else if menu.kind === 'switch'}
      <!-- P1/P2: protocol icon in front, the current type ticked on the right. -->
      {#each [{ p: 'http', icon: 'language', label: 'HTTP' }, { p: 'grpc', icon: 'hub', label: 'gRPC' }] as const as o (o.p)}
        {@const on = (tab?.protocol === 'grpc') === (o.p === 'grpc')}
        <button class="mi proto {o.p}" class:on role="menuitemradio" aria-checked={on} onclick={() => onSwitch(o.p)}>
          <span class="material-symbols-outlined ic" aria-hidden="true">{o.icon}</span>
          <span class="lb">{o.label}</span>
          {#if on}<span class="material-symbols-outlined sc check" aria-hidden="true">check</span>{/if}
        </button>
      {/each}
    {:else if menu.kind === 'coll'}
      <div class="lbl">{t('nav.menu.inFolderDefault', { name: node?.name ?? t('nav.menu.folderDefault') })}</div>
      {@render item('language', t('nav.menu.http'), () => onAddRequest('http'), '', 'proto http tint')}
      {@render item('hub', t('nav.menu.grpc'), () => onAddRequest('grpc'), '', 'proto grpc')}
      {@render item('create_new_folder', t('nav.menu.folder'), onAddFolder)}
      {#if menu.nodeId}
        <!-- No ⌘S here: ⌘S saves the tab where it already lives, not into this folder. -->
        {@render item('save', t('nav.menu.saveHere'), onSaveHere)}
        {#if menu.isFolder}
          <div class="dv"></div>
          {@render item('play_arrow', t('nav.menu.runInRunner'), () => {
            const id = menu.nodeId!;
            closeMenu();
            runInRunner(id);
          })}
          {@render item('lock', t('nav.menu.collAuth'), onAuth)}
          {@render item('code', t('nav.menu.collScripts'), onScripts)}
          {#if node?.kind === 'folder' && node.source}
            {@render item('sync', t('nav.menu.updateFromSpec'), () => onUpdateFromSpec(node.id))}
          {/if}
          {@render item('upload', t('nav.menu.exportJson'), () => onExportOpenApi('json'))}
          {@render item('upload', t('nav.menu.exportYaml'), () => onExportOpenApi('yaml'))}
        {/if}
        <div class="dv"></div>
        {@render item('edit', t('nav.menu.rename'), onRename, 'F2')}
        {@render item('content_copy', t('nav.menu.duplicate'), onDuplicate, '⌘D')}
        {@render item('drive_file_move', t('nav.menu.moveTo'), onMove)}
        <div class="dv"></div>
        {@render item('delete', t('nav.menu.delete'), onDelete, '⌫', 'danger')}
      {/if}
    {:else if menu.kind === 'req'}
      {@render item('open_in_new', t('nav.menu.openNewTab'), openRequest, '⌘↵', 'hint')}
      {@render item('edit', t('nav.menu.rename'), onRename, 'F2')}
      {@render item('content_copy', t('nav.menu.duplicate'), onDuplicate, '⌘D')}
      <div class="dv"></div>
      {#if node?.kind === 'request' && node.protocol === 'http'}{@render item(
          'code',
          t('nav.menu.copyCurl'),
          onCopyCurl,
          '⌥⌘C',
        )}{/if}
      {@render item('drive_file_move', t('nav.menu.moveTo'), onMove)}
      {#if git.status?.isRepo && node}{@render item('history', t('git.history.open'), openHistory)}{/if}
      <div class="dv"></div>
      {@render item('delete', t('nav.menu.delete'), onDelete, '⌫', 'danger')}
    {:else if menu.kind === 'tab' && tab}
      <!-- S17b: right-click on a tab; App makes it active first, so the request actions reuse the active-tab handlers. -->
      {@const id = tab.id}
      {@const request = tab.protocol === 'http' || tab.protocol === 'grpc'}
      {#if request}
        {@render item(
          'save',
          t('tabs.ctxSave'),
          () => {
            closeMenu();
            onSaveTab();
          },
          '⌘S',
        )}
        {@render item(
          'save_as',
          t('tabs.ctxSaveAs'),
          () => {
            closeMenu();
            onSaveAsTab();
          },
          '⇧⌘S',
        )}
        {@render item(
          'content_copy',
          t('nav.menu.duplicate'),
          () => {
            closeMenu();
            duplicateTab(id);
          },
          '⌘D',
        )}
        {@render item('edit', t('nav.menu.rename'), onRenameTab, 'F2')}
      {/if}
      {@render item('keep', tab.pinned ? t('tabs.ctxUnpin') : t('tabs.ctxPin'), () => {
        closeMenu();
        togglePinTab(id);
      })}
      {#if request}
        {@render item('account_tree', t('tabs.ctxReveal'), onRevealTab, '', '', !tab.savedPath)}
      {/if}
      {#if tab.protocol === 'http'}
        <div class="dv"></div>
        {@render item('code', t('nav.menu.copyCurl'), onCopyCurlTab, '⌥⌘C')}
      {/if}
      <div class="dv"></div>
      {@render item(
        'close',
        t('tabs.ctxClose'),
        () => {
          closeMenu();
          void requestCloseTab(id);
        },
        '⌘W',
      )}
      {@render item('tab_close', t('tabs.ctxCloseOthers'), () => {
        closeMenu();
        void closeOtherTabs(id);
      })}
      {@render item('tab_close_right', t('tabs.ctxCloseRight'), () => {
        closeMenu();
        void closeTabsToRight(id);
      })}
      {@render item(
        'clear_all',
        t('tabs.ctxCloseAll'),
        () => {
          closeMenu();
          void closeAllTabs();
        },
        '⌥⌘W',
      )}
    {:else if menu.kind === 'history'}
      {@render item(
        history.paused ? 'play_arrow' : 'pause',
        history.paused ? t('nav.menu.resume') : t('nav.menu.pause'),
        () => {
          history.paused = !history.paused;
          closeMenu();
        },
      )}
      {@render item(
        'delete_sweep',
        t('nav.menu.clearHistory'),
        () => {
          clearHistory();
          closeMenu();
        },
        '',
        'danger',
      )}
      <div class="dv"></div>
      <div class="lbl">{t('nav.menu.keepLast')}</div>
      {#each historyLimits as opt (opt.value)}
        {@render item(
          history.limit === opt.value ? 'check' : '',
          opt.value === 0 ? t('nav.menu.all') : opt.label,
          () => {
            history.limit = opt.value;
            closeMenu();
          },
        )}
      {/each}
    {/if}
  </Menu>
{/if}

<style>
  :global(.bs .bs-menu.bs-submenu) {
    position: absolute;
    left: calc(100% + 6px);
    width: 268px;
  }

  /* The create menu and its Import submenu are dense, like Postman's: 24px rows, no gaps, 16px icons. */
  :global(.bs .bs-menu.dense) {
    gap: 0;
    padding: 4px;
  }

  :global(.bs .bs-menu.dense) .mi {
    height: 24px;
    gap: 8px;
    padding: 0 8px;
  }

  :global(.bs .bs-menu.dense) .mi .ic {
    flex-basis: 16px;
    width: 16px;
    font-size: 16px;
  }

  :global(.bs .bs-menu.dense) .lbl {
    height: 21px;
    padding: 6px 8px 2px;
  }

  :global(.bs .bs-menu.dense) .dv {
    height: 9px;
    margin: 0 8px;
  }

  /* P1/P2: HTTP globe in text colour, gRPC hub in its method colour, tick on the right. */
  :global(.bs-menu) .mi.proto :global(.ic) {
    font-size: 15px;
    color: var(--color-text);
  }

  :global(.bs-menu) .mi.proto .sc.check {
    margin-left: auto;
    font: 14px/1 'Material Symbols Outlined';
    color: var(--color-text-secondary);
  }
</style>
