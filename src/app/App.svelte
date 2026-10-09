<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { slide } from 'svelte/transition';
  import { tabs } from '$entities/tab';
  import {
    revealNode,
    addFolder,
    removeNode,
    renameNode,
    duplicateNode,
    exportOpenApiFolder,
    withInheritedAuth,
    openWorkspaceFolder,
    switchWorkspace,
    importApiFile,
    findNode,
    parentId,
    workspace,
  } from '$entities/workspace';
  import { hydrate } from './persistence.svelte';
  import {
    newTab,
    requestCloseTab,
    duplicateTab,
    closeAllTabs,
    setActiveProtocol,
    reopenClosedTab,
  } from '$features/tabs';
  import {
    autoUpdateCheck,
    uiFontSize,
    codeFont,
    codeFontSize,
    density,
    themeFollowSystem,
    hotkeys,
    requestLayout,
    afterSend,
    sideOnWide,
    SIDE_BY_SIDE_MIN,
    commandFor,
    eventToBinding,
    formatBinding,
    setTheme,
  } from '$shared/settings';
  import {
    saveActiveRequest,
    addRequestToFolder,
    requestSaveDialog,
    applyCurlToActiveTab,
    restoreSavedRequest,
    openSavedRequest,
    requestGrpcEditorAction,
  } from '$entities/request';
  import {
    requestConfirm,
    focusMode,
    expandTarget,
    nextTabIndex,
    appMenuWidth,
    recentWorkspaceChoices,
    snapPanelSize,
    type AppMenuKind,
    type AppMenuState,
    type UtilityMode,
  } from '$shared/ui';
  import { openRunnerTab } from '$features/runner';
  import {
    openEnvironmentsTab,
    currentVarScope,
    clock,
    historyDay,
    matchSaved,
    searchRequests,
  } from '$entities/environment';
  import { history } from '$entities/history';
  import FocusBar from './FocusBar.svelte';
  import RequestStrip from './RequestStrip.svelte';
  import { ResponseStrip, ResponsePane } from '$features/response/components';
  import { t } from '$shared/i18n';
  import { methodColor, toCurl, type RequestProtocol } from '$shared/model';
  import { flushPendingSaves, loadState, saveState } from '$shared/persist';
  import { GrpcEditor } from '$features/grpc/components';
  import { HttpRequestEditor } from '$features/http/components';
  import AppPopoverMenu from './AppPopoverMenu.svelte';
  import AppStatusBar from './AppStatusBar.svelte';
  import AppTabBar from './AppTabBar.svelte';
  import AppToolbar from './AppToolbar.svelte';
  import RequestHeader from './RequestHeader.svelte';
  import { Sidebar, MoveDialog, FolderAuthDialog } from '$features/sidebar/components';
  import { GitDiffView, ProjectDiffView } from '$features/git/components';
  import { SettingsModal } from '$features/settings/components';
  import { EnvironmentsSheet } from '$features/environments/components';
  import { RunnerView } from '$features/runner/components';
  import { FlowView } from '$features/flow/components';
  import { ConfirmDialog } from '$shared/ui/components';
  import { SaveRequestDialog, ProductionGuard } from '$entities/request/components';
  import { OpenApiImportDialog } from '$features/import/components';
  import { UpdateBanner } from '$features/updater/components';
  import { UtilityPanel } from '$features/utility-panel/components';
  import { CommandPalette, type PaletteCommand } from '$features/command-palette/components';
  import WelcomeView from './WelcomeView.svelte';
  import { checkForUpdate } from '$shared/updater';

  const active = $derived(tabs.active);

  // The HTTP method-picker open state stays here because App's
  // `<svelte:window onpointerdown>` below resets it on outside-click; it's
  // bound into HttpRequestEditor.
  let httpMethodOpen = $state(false);
  let workspaceMenuOpen = $state(false);
  let searchTerm = $state('');
  // S34: hidden by the user (⌘\, or dragged past the collapse edge); persisted.
  let sidebarHidden = $state(false);
  // Width shown in the S33 tooltip while the handle is dragged.
  let sidebarDragWidth = $state<number | null>(null);
  // S36: the Runner tab auto-hides the sidebar without touching the user's choice;
  // showing it there explicitly (⌘\, grip) holds until the tab changes.
  let runnerReveal = $state(false);
  const sidebarShown = $derived(!sidebarHidden && (active?.protocol !== 'runner' || runnerReveal));
  $effect(() => {
    void tabs.activeId;
    untrack(() => (runnerReveal = false));
  });
  function setSidebarShown(show: boolean): void {
    sidebarHidden = !show;
    runnerReveal = show;
    void saveState('sidebarHidden', sidebarHidden);
  }
  function toggleSidebar(): void {
    setSidebarShown(!sidebarShown);
  }
  function showSidebar(panel: 'collections' | 'history' | 'flows'): void {
    sidebarPanel = panel;
    setSidebarShown(true);
  }
  // Resizable panels (Postman-style). Persisted across restarts.
  // S33: 220–420 px, narrower than 180 collapses; double-click restores the default.
  const SIDEBAR_MIN = 220;
  const SIDEBAR_MAX = 420;
  const SIDEBAR_DEFAULT = 264;
  const SIDEBAR_COLLAPSE_AT = 180;
  let sidebarWidth = $state(SIDEBAR_DEFAULT);
  // S35: below this window width the sidebar gives up width first (down to SIDEBAR_MIN),
  // then the main area adapts. Pure CSS, so it tracks window resizes for free.
  const SQUEEZE_BELOW = 1100;
  const sidebarCssWidth = $derived(
    `clamp(${SIDEBAR_MIN}px, calc(${sidebarWidth}px + 100vw - ${SQUEEZE_BELOW}px), ${sidebarWidth}px)`,
  );
  // Width is remembered per workspace.
  let sidebarWidths = $state.raw<Record<string, number>>({});
  $effect(() => {
    sidebarWidth = clamp(sidebarWidths[workspace.path] ?? SIDEBAR_DEFAULT, SIDEBAR_MIN, SIDEBAR_MAX);
  });
  function saveSidebarWidth(): void {
    sidebarWidths = { ...sidebarWidths, [workspace.path]: sidebarWidth };
    void saveState('sidebarWidths', sidebarWidths);
  }

  const PANE_MIN = 120; // min height for both the request pane and the response
  const RESPONSE_COLLAPSE_AT = 72;
  const RESPONSE_DEFAULT_HEIGHT = null; // null = default flex:1
  let responseHeight = $state<number | null>(RESPONSE_DEFAULT_HEIGHT);
  // Panel open/close animates via CSS; drags must track the pointer 1:1, so
  // this flag turns the transitions off for the duration of a drag.
  let panelDragging = $state(false);
  const PANEL_ANIM_MS =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180;

  let menu = $state<AppMenuState>({ kind: null, x: 0, y: 0 });
  // Escape returns focus here (Mono: menus close on Escape, focus goes back to the trigger).
  let menuTrigger: HTMLElement | null = null;
  function openMenu(kind: Exclude<AppMenuKind, null>, e: MouseEvent, nodeId?: string, isFolder?: boolean): void {
    menuTrigger = e.currentTarget as HTMLElement;
    const r = menuTrigger.getBoundingClientRect();
    const w = appMenuWidth(kind);
    const at =
      e.type === 'contextmenu'
        ? { x: e.clientX, y: e.clientY, flipY: e.clientY }
        : { x: r.left, y: r.bottom + 8, flipY: r.top - 8 };
    menu = { kind, x: Math.min(at.x, window.innerWidth - w - 8), y: at.y, flipY: at.flipY, nodeId, isFolder };
  }

  function closeMenu(): void {
    menu = { kind: null, x: 0, y: 0 };
  }

  // Tree node actions (operate on menu.nodeId when present).
  function collAddFolder(): void {
    if (menu.nodeId) void addFolder(menu.nodeId);
    else void addFolder();
    closeMenu();
  }
  function nodeRename(): void {
    const n = menu.nodeId ? findNode(workspace.tree, menu.nodeId) : undefined;
    if (!n || !menu.nodeId) {
      closeMenu();
      return;
    }
    editingNodeId = menu.nodeId;
    editValue = n.name;
    closeMenu();
  }
  function commitInlineRename(): void {
    const v = editValue.trim();
    const id = editingNodeId;
    editingNodeId = undefined;
    if (v && id) void renameNode(id, v);
  }
  function inlineRenameKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitInlineRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      editingNodeId = undefined;
    }
  }
  async function nodeDelete(): Promise<void> {
    const id = menu.nodeId;
    const isFolder = menu.isFolder;
    closeMenu();
    if (!id) return;
    const name = findNode(workspace.tree, id)?.name ?? t('app.node.thisItem');
    const msg = isFolder ? t('app.node.deleteFolder', { name }) : t('app.node.deleteItem', { name });
    if (await requestConfirm(msg, t('common.delete'))) await removeNode(id);
  }
  function nodeSaveHere(): void {
    if (menu.nodeId) void saveActiveRequest(menu.nodeId);
    closeMenu();
  }
  function nodeDuplicate(): void {
    if (menu.nodeId) void duplicateNode(menu.nodeId);
    closeMenu();
  }
  let moveOpen = $state(false);
  let moveSourceId = $state<string | undefined>(undefined);
  let authFolderId = $state<string | undefined>(undefined);
  function nodeAuth(): void {
    authFolderId = menu.nodeId;
    closeMenu();
  }
  function nodeMove(): void {
    moveSourceId = menu.nodeId;
    moveOpen = true;
    closeMenu();
  }
  function addReq(p: RequestProtocol): void {
    void addRequestToFolder(menu.nodeId, p);
    closeMenu();
  }
  let importOpen = $state(false);
  function importOpenApi(): void {
    closeMenu();
    importOpen = true;
  }
  // Welcome chips: OpenAPI keeps the paste/file dialog; file formats go straight to the picker (format is sniffed, then the matching importer runs).
  function importFrom(source?: string): void {
    if (!source || source === 'openapi') return importOpenApi();
    closeMenu();
    importApiFile().catch((err) => showToast({ text: err instanceof Error ? err.message : String(err) }));
  }

  let paletteOpen = $state(false);
  let sidebarPanel = $state<'collections' | 'history' | 'git' | 'flows'>('collections');
  // S21: a tab opened from history says so, and links back to the saved request it came from.
  const historySnapshot = $derived.by(() => {
    const entry = active?.historyId ? $history.find((h) => h.id === active.historyId) : undefined;
    return entry ? { entry, original: matchSaved(entry, searchRequests(workspace.tree, '', Infinity)) } : undefined;
  });

  // Folder of the active saved request: palette offers "new request" right next to it.
  const activeFolderId = $derived(active?.savedPath ? parentId(active.savedPath) : undefined);
  const activeFolderName = $derived(activeFolderId ? findNode(workspace.tree, activeFolderId)?.name : undefined);
  function newRequestHere(kind: RequestProtocol = 'http'): void {
    if (activeFolderId) void addRequestToFolder(activeFolderId, kind);
    else newTab(kind);
  }
  function newFolderHere(): void {
    void addFolder(activeFolderId);
  }
  // Clipboard cURL → a fresh request; without clipboard access, focus the URL bar for a manual paste.
  async function importCurlFromClipboard(): Promise<void> {
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch {
      /* no clipboard permission */
    }
    if (/^\s*curl\s/i.test(text)) {
      newTab();
      applyCurlToActiveTab(text);
    } else await pasteCurl();
  }
  // Request header ⋯ menu: node actions run against the active tab's saved request (menu.nodeId = savedPath).
  function tabRename(): void {
    closeMenu();
    void tick().then(() => document.querySelector<HTMLElement>('.bs-reqhead .nm.rename')?.click());
  }
  /** cURL of the tab as it is now (unsaved edits included), unlike the tree action that copies the file. */
  function tabCopyCurl(): void {
    closeMenu();
    if (active?.protocol !== 'http') return;
    void navigator.clipboard.writeText(toCurl(withInheritedAuth(active, active.savedPath), currentVarScope(true)));
  }
  // S17b: a right-click makes the tab active, so the menu's request actions reuse the active-tab handlers.
  function tabContext(e: MouseEvent, id: string): void {
    e.preventDefault();
    e.stopPropagation();
    tabs.activeId = id;
    openMenu('tab', e, id);
  }
  function tabKeydown(e: KeyboardEvent, id: string): void {
    const mod = e.metaKey || e.ctrlKey;
    const act =
      e.key === 'F2'
        ? tabRename
        : mod && e.altKey && e.code === 'KeyC'
          ? tabCopyCurl
          : mod && !e.altKey && e.code === 'KeyD'
            ? () => duplicateTab(id)
            : undefined;
    if (!act) return;
    e.preventDefault();
    e.stopPropagation();
    tabs.activeId = id;
    act();
  }
  function tabReveal(): void {
    closeMenu();
    const id = active?.savedPath;
    if (!id) return;
    showSidebar('collections');
    revealNode(id);
    void tick().then(() => document.querySelector<HTMLElement>('.bs-tree .bs-trow.sel')?.focus());
  }
  function nodeOpen(): void {
    const n = menu.nodeId ? findNode(workspace.tree, menu.nodeId) : undefined;
    closeMenu();
    if (n?.kind === 'request') openSavedRequest(n);
  }
  function nodeCopyCurl(): void {
    const n = menu.nodeId ? findNode(workspace.tree, menu.nodeId) : undefined;
    closeMenu();
    if (n?.kind !== 'request') return;
    const tab = { id: n.id, protocol: 'http' as const, title: n.name, request: n.request, params: n.params };
    void navigator.clipboard.writeText(toCurl(withInheritedAuth(tab, n.id), currentVarScope(true)));
  }
  /** Run a tree action against `id` (keyboard shortcuts on a focused row reuse the menu handlers). */
  function nodeAction(id: string, isFolder: boolean, run: () => void): void {
    menu = { kind: null, x: 0, y: 0, nodeId: id, isFolder };
    run();
  }
  function treeKeydown(e: KeyboardEvent, id: string, isFolder: boolean): void {
    const mod = e.metaKey || e.ctrlKey;
    const act =
      e.key === 'F2'
        ? nodeRename
        : mod && e.key.toLowerCase() === 'd'
          ? nodeDuplicate
          : (e.key === 'Backspace' || e.key === 'Delete') && !isFolder
            ? nodeDelete
            : mod && e.altKey && e.code === 'KeyC' && !isFolder
              ? nodeCopyCurl
              : mod && e.key === 'Enter' && !isFolder
                ? nodeOpen
                : undefined;
    if (!act) return;
    e.preventDefault();
    e.stopPropagation();
    nodeAction(id, isFolder, act);
  }
  // cURL import = paste into the URL bar of a fresh request (HttpUrlBar turns `curl …` into a request).
  async function pasteCurl(): Promise<void> {
    newTab();
    await tick();
    document.querySelector<HTMLElement>('.bs-urlfield .cm-content')?.focus();
  }
  const keys = (id: string): string => formatBinding(hotkeys.current[id] ?? '').join('');
  const paletteCommands: PaletteCommand[] = $derived([
    {
      label: activeFolderName ? t('palette.cmd.newIn', { folder: activeFolderName }) : t('palette.cmd.new'),
      icon: 'add',
      shortcut: keys('newRequest'),
      run: () => newRequestHere(),
    },
    {
      label: activeFolderName ? t('palette.cmd.curlIn', { folder: activeFolderName }) : t('palette.cmd.curl'),
      icon: 'terminal',
      run: () => void pasteCurl(),
    },
    { label: t('palette.cmd.openapi'), icon: 'upload_file', run: importOpenApi },
    { label: t('palette.cmd.envs'), icon: 'layers', shortcut: keys('env'), run: openEnvironmentsTab },
    {
      label: t('palette.cmd.workspace'),
      icon: 'folder_managed',
      shortcut: keys('workspaceMenu'),
      run: () => (workspaceMenuOpen = true),
    },
    { label: 'Flows', icon: 'account_tree', run: () => showSidebar('flows') },
    { label: t('palette.cmd.runner'), icon: 'play_arrow', run: openRunnerTab },
    { label: t('palette.cmd.sidebar'), icon: 'left_panel_open', shortcut: keys('sidebar'), run: toggleSidebar },
    {
      label: t('palette.cmd.response'),
      icon: 'bottom_panel_open',
      run: () => {
        responseHidden = !responseHidden;
        requestHidden = false;
      },
    },
    { label: t('palette.cmd.code'), icon: 'code', shortcut: keys('codePanel'), run: () => toggleCodePanel() },
    {
      label: t('palette.cmd.folder'),
      icon: 'folder_open',
      shortcut: keys('openFolder'),
      run: () => void openWorkspaceFolder(),
    },
    {
      label: t('palette.cmd.settings'),
      icon: 'settings',
      shortcut: keys('settings'),
      run: () => (settingsOpen = true),
    },
  ]);
  function exportOpenApi(format: 'json' | 'yaml'): void {
    const id = menu.nodeId;
    closeMenu();
    if (id) void exportOpenApiFolder(id, format);
  }

  // Inline rename of a tree node (window.prompt is unavailable in the Tauri webview)
  let editingNodeId = $state<string | undefined>(undefined);
  let editValue = $state('');

  let settingsOpen = $state(false);

  // Code snippets belong to the request tab that opened them. Keeping the tab
  // id (instead of one global boolean) prevents the panel jumping between tabs.
  let codePanelTabId = $state<string | undefined>(undefined);
  const codePanelAvailable = $derived(active?.protocol === 'http' || active?.protocol === 'grpc');
  const codeOpen = $derived(codePanelAvailable && codePanelTabId === active?.id);
  let responseHidden = $state(false);
  /** The response dragged all the way up: the request editor hides (URL bar and tabs stay). */
  let requestHidden = $state(false);
  // ---- Layout (S32.5b, E1–E7) ----
  const requestTab = $derived(active?.protocol === 'http' || active?.protocol === 'grpc');
  let innerWidth = $state(window.innerWidth);
  /** E7: request | response side by side — chosen, or automatic on a wide window. Expanded mode wins. */
  const sideBySide = $derived(
    requestTab &&
      !focusMode.current &&
      (requestLayout.current === 'side' || (sideOnWide.current && innerWidth >= SIDE_BY_SIDE_MIN)),
  );
  /** In stacked layouts a hidden pane folds into its 44 px strip. */
  const respStrip = $derived(!sideBySide && (responseHidden || focusMode.current === 'request'));
  const reqStrip = $derived(!sideBySide && requestHidden && !focusMode.current);
  // Expanded mode belongs to the tab it was opened on.
  let focusTabId: string | undefined;
  $effect(() => {
    const id = active?.id;
    if (id !== focusTabId) {
      focusTabId = id;
      untrack(() => (focusMode.current = null));
    }
  });
  // Entering expanded mode brings that pane back from its strip.
  $effect(() => {
    const m = focusMode.current;
    untrack(() => {
      if (m === 'request') requestHidden = false;
      else if (m === 'response') responseHidden = false;
    });
  });
  // A fresh response (not a tab switch): auto-focus and «После отправки: раскрыть ответ» give it the height.
  let seenResponse: { tab?: string; res?: unknown } = {};
  $effect(() => {
    const res = active?.protocol === 'grpc' ? active.grpcResult : active?.response;
    const id = active?.id;
    if (
      res &&
      id &&
      seenResponse.tab === id &&
      seenResponse.res !== res &&
      !sideBySide &&
      (requestLayout.current === 'focus' || afterSend.current === 'expand')
    ) {
      untrack(() => {
        responseHidden = false;
        requestHidden = true;
      });
    }
    seenResponse = { tab: id, res };
  });
  /** Auto-focus: the pane being worked in fills, the other folds into its strip. */
  function autoFocusIn(e: FocusEvent): void {
    if (requestLayout.current !== 'focus' || sideBySide || focusMode.current) return;
    const el = e.target instanceof Element ? e.target : null;
    if (el?.closest('.bs-reqpane')) {
      requestHidden = false;
      responseHidden = true;
    } else if (el?.closest('.bs-resp-host') && !el.closest('.bs-resizer-row')) {
      responseHidden = false;
      requestHidden = true;
    }
  }
  function showResponse(): void {
    focusMode.current = null;
    responseHidden = false;
    if (requestLayout.current === 'focus') requestHidden = true;
  }
  function showRequest(): void {
    focusMode.current = null;
    requestHidden = false;
    if (requestLayout.current === 'focus') responseHidden = true;
  }

  let utilityMode = $state<UtilityMode | null>(null);
  let utilityPanelHeight = $state(220);
  /** Save-to dialog (SaveRequestDialog flashes the Save button itself); `copy` = Save As. */
  function openSaveDialog(copy = false): void {
    void requestSaveDialog(copy);
  }

  // Brief "Saved ✓" feedback on the Save button after a successful write.
  let savedFlash = $state(false);
  let savedFlashTimer: ReturnType<typeof setTimeout> | undefined;
  // S09b: confirmation toast after a save, with a one-step undo (⌘Z while it is visible).
  // P3/P4 bring their own icon (swap_horiz in the new protocol's colour) and undo label («Вернуть HTTP»).
  type Toast = { text: string; undo?: () => void; undoLabel?: string; icon?: string; iconColor?: string };
  let toast = $state<Toast | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function showToast(next: Toast): void {
    toast = next;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), 5000);
  }
  function undoToast(): void {
    toast?.undo?.();
    toast = null;
  }

  function flashSaved(): void {
    savedFlash = true;
    if (savedFlashTimer) clearTimeout(savedFlashTimer);
    savedFlashTimer = setTimeout(() => (savedFlash = false), 1200);
  }

  /**
   * Smart save: if the active tab is already backed by a collection file
   * (`savedPath` set), overwrite it in place — no modal. If it's a new,
   * unsaved request, open the destination picker so the user chooses where
   * it lands. Bound to the Save button and ⌘/Ctrl+S.
   */
  async function smartSave(): Promise<void> {
    if (!active || (active.protocol !== 'http' && active.protocol !== 'grpc')) return;
    if (active.savedPath) {
      const prev = findNode(workspace.tree, active.savedPath);
      const folder = parentId(active.savedPath);
      try {
        await saveActiveRequest(folder, active.title);
        flashSaved();
        showToast({
          text: t('app.toast.savedIn', {
            where:
              (folder && findNode(workspace.tree, folder)?.name) ||
              (workspace.path.split('/').filter(Boolean).at(-1) ?? t('app.toast.workspace')),
          }),
          undo: prev?.kind === 'request' ? () => void restoreSavedRequest(prev) : undefined,
        });
      } catch (err) {
        console.error('workspace: smartSave failed', err);
      }
    } else {
      openSaveDialog();
    }
  }

  function globalKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      const trigger = menu.kind
        ? menuTrigger
        : document.querySelector<HTMLElement>('[aria-haspopup][aria-expanded="true"]');
      if (!trigger && !menu.kind) {
        // Esc leaves expanded mode; CodeMirror's own Esc (find panel, completion) prevents default first.
        if (focusMode.current && !e.defaultPrevented && !document.querySelector('.bs-modal, .bs-overlay')) {
          e.preventDefault();
          focusMode.current = null;
        }
        return;
      }
      e.preventDefault();
      closeMenu();
      httpMethodOpen = grpcMethodOpen = workspaceMenuOpen = false;
      trigger?.focus();
      return;
    }
    if (
      toast?.undo &&
      (e.metaKey || e.ctrlKey) &&
      e.code === 'KeyZ' &&
      !e.shiftKey &&
      !(e.target instanceof Element && e.target.closest('input, textarea, [contenteditable], .cm-editor'))
    ) {
      e.preventDefault();
      undoToast();
      return;
    }
    // ⌥⌘2…⌥⌘9: jump to the n-th recent workspace from the switcher (S37).
    const recentKey = /^Mod\+Alt\+([2-9])$/.exec(eventToBinding(e) ?? '');
    const recentPath = recentKey && recentWorkspaceChoices(workspace.recent, workspace.path)[Number(recentKey[1]) - 2];
    if (recentPath) {
      e.preventDefault();
      workspaceMenuOpen = false;
      void switchWorkspace(recentPath);
      return;
    }
    const id = commandFor(e, hotkeys.current);
    if (!id) return;
    if (
      id === 'send' &&
      !(
        (active?.protocol === 'http' || active?.protocol === 'grpc') &&
        !(e.target instanceof Element && e.target.closest('.bs-modal'))
      )
    )
      return;
    e.preventDefault();
    switch (id) {
      case 'send':
        (document.querySelector('.bs-send') as HTMLButtonElement | null)?.click();
        break;
      case 'save':
        void smartSave();
        break;
      case 'saveAs':
        if (active?.protocol === 'http' || active?.protocol === 'grpc') openSaveDialog(true);
        break;
      case 'codePanel':
        toggleCodePanel();
        break;
      case 'newRequest':
        newRequestHere('http');
        break;
      case 'newGrpc':
        newRequestHere('grpc');
        break;
      case 'newCollection':
        void addFolder();
        break;
      case 'newFolder':
        newFolderHere();
        break;
      case 'palette':
        paletteOpen = !paletteOpen;
        break;
      case 'env':
        document.querySelector<HTMLButtonElement>('.bs-toolbar-env-button')?.click();
        break;
      case 'sidebar':
      case 'sidebarAlt':
        toggleSidebar();
        break;
      case 'showCollections':
        showSidebar('collections');
        break;
      case 'showHistory':
        showSidebar('history');
        break;
      case 'terminal':
        toggleUtilityPanel('terminal');
        break;
      case 'workspaceMenu':
        workspaceMenuOpen = !workspaceMenuOpen;
        break;
      case 'openFolder':
        void openWorkspaceFolder();
        break;
      case 'settings':
        settingsOpen = true;
        break;
      case 'closeTab':
        void requestCloseTab(tabs.activeId);
        break;
      case 'closeAllTabs':
        void closeAllTabs();
        break;
      case 'newTab':
        newTab();
        break;
      case 'reopenTab':
        reopenClosedTab();
        break;
      case 'expand':
        if (requestTab)
          focusMode.current = expandTarget(focusMode.current, !!document.activeElement?.closest('.bs-resp-host'));
        break;
      case 'toggleResponse':
        if (sideBySide) break;
        if (respStrip) showResponse();
        else {
          focusMode.current = null;
          responseHidden = true;
          requestHidden = false;
        }
        break;
      case 'toggleRequest':
        if (sideBySide) break;
        if (reqStrip || focusMode.current === 'response') showRequest();
        else {
          focusMode.current = null;
          requestHidden = true;
          responseHidden = false;
        }
        break;
      case 'nextTab':
      case 'prevTab': {
        const i = tabs.list.findIndex((t) => t.id === tabs.activeId);
        const next =
          i < 0 ? undefined : nextTabIndex(id === 'prevTab' ? 'ArrowLeft' : 'ArrowRight', i, tabs.list.length);
        if (next !== undefined) tabs.activeId = tabs.list[next].id;
        break;
      }
    }
  }

  // Settings → Внешний вид: text size shifts the whole type scale (13 = design default),
  // the code font/size feed --font-code and the editors, density sets row heights.
  $effect(() => {
    const root = document.documentElement;
    const d = uiFontSize.current - 13;
    for (const [token, base] of [
      ['micro', 10],
      ['caption', 11],
      ['body', 12],
      ['ui', 13],
      ['label', 14],
      ['title', 15],
    ] as const) {
      root.style.setProperty(`--font-size-${token}`, `${base + d}px`);
    }
    root.style.setProperty(
      '--font-code',
      `'${codeFont.current}', 'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, monospace`,
    );
    root.style.setProperty('--code-font-size', `${codeFontSize.current}px`);
    root.dataset.density = density.current;
  });

  // «Как в системе»: track the OS appearance while the setting is on.
  $effect(() => {
    if (!themeFollowSystem.current) return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const sync = () => setTheme(mq.matches ? 'smooth-dark' : 'smooth-light');
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  });

  onMount(async () => {
    await hydrate();
    sidebarWidths = await loadState<Record<string, number>>('sidebarWidths', {});
    sidebarHidden = await loadState('sidebarHidden', false);
    const savedResponseHeight = await loadState<number | null>('responseHeight', null);
    responseHeight = savedResponseHeight == null ? null : Math.max(PANE_MIN, savedResponseHeight);
    utilityPanelHeight = clamp(
      await loadState('utilityPanelHeight', 220),
      140,
      Math.max(140, window.innerHeight - 180),
    );
  });

  function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  // Keep the request pane's PANE_MIN guarantee when the window shrinks: a fixed
  // response height set earlier could otherwise collapse the request pane to 0.
  function clampResponseToViewport(): void {
    if (responseHeight == null) return;
    const resp = document.querySelector('.bs-resp-host') as HTMLElement | null;
    const column = resp?.parentElement as HTMLElement | null;
    if (!column) return;
    const max = column.getBoundingClientRect().height - PANE_MIN;
    responseHeight = clamp(responseHeight, PANE_MIN, Math.max(PANE_MIN, max));
  }
  onMount(() => {
    const onResize = () => clampResponseToViewport();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  // Silently check for an update shortly after launch (Settings → Общие can turn
  // it off); the banner only appears if one is available (failures stay quiet).
  onMount(() => {
    const t = setTimeout(
      () =>
        void autoUpdateCheck.ready.then(() => {
          if (autoUpdateCheck.current) void checkForUpdate();
        }),
      2500,
    );
    return () => clearTimeout(t);
  });

  onMount(() => {
    const flush = () => void flushPendingSaves();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('beforeunload', flush);
    // pagehide also fires on macOS Tauri window close, where beforeunload can be
    // skipped; without it the last debounced save can be lost.
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  });

  /**
   * Shared pointer-drag plumbing. Listeners live on `window` so the drag keeps
   * tracking even when the cursor leaves the thin handle, and `setPointerCapture`
   * is best-effort (some environments reject it for synthetic pointers).
   */
  function beginDrag(e: PointerEvent, cursor: string, onMove: (ev: PointerEvent) => void, onDone: () => void): void {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // Pointer capture is an enhancement; the window listeners drive the drag.
    }
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = cursor;
    panelDragging = true;
    // Coalesce pointermove bursts to one layout per frame; more events than
    // frames otherwise re-runs full app layout mid-frame and the drag stutters.
    let pending: PointerEvent | null = null;
    let raf = 0;
    function move(ev: PointerEvent): void {
      pending = ev;
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (pending) onMove(pending);
          pending = null;
        });
    }
    function up(): void {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (raf) cancelAnimationFrame(raf);
      if (pending) onMove(pending);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      panelDragging = false;
      onDone();
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /** Drag the sidebar's right edge to resize it; from the hidden-state grip, drag it open. */
  function startSidebarDrag(e: PointerEvent): void {
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const startShown = sidebarShown;
    const before = { hidden: sidebarHidden, reveal: runnerReveal };
    beginDrag(
      e,
      'col-resize',
      (ev) => {
        const snapped = snapPanelSize(
          (startShown ? startWidth : 0) + (ev.clientX - startX),
          SIDEBAR_MIN,
          SIDEBAR_MAX,
          SIDEBAR_COLLAPSE_AT,
        );
        // Collapsing keeps the pre-drag width so reopening restores the user's
        // layout; a grip pull that never got wide enough changes nothing.
        sidebarHidden = snapped.collapsed ? startShown || before.hidden : false;
        runnerReveal = snapped.collapsed ? !startShown && before.reveal : true;
        sidebarWidth = snapped.collapsed ? startWidth : snapped.size;
        sidebarDragWidth = snapped.collapsed ? null : snapped.size;
      },
      () => {
        sidebarDragWidth = null;
        saveSidebarWidth();
        void saveState('sidebarHidden', sidebarHidden);
      },
    );
  }

  /** Drag the response panel's top border to resize the request/response split. */
  function startSplitDrag(e: PointerEvent): void {
    const handle = e.currentTarget as HTMLElement;
    const resp = handle.closest('.bs-resp-host') as HTMLElement | null;
    const column = resp?.parentElement as HTMLElement | null;
    if (!resp || !column) return;
    const startY = e.clientY;
    // Seed from the live height so the first drag from default (flex:1) is smooth.
    const liveHeight = responseHeight ?? resp.getBoundingClientRect().height;
    // A collapsed response opens from zero, following the pointer.
    const startHeight = responseHidden ? 0 : resp.getBoundingClientRect().height;
    // The space the split shares; the request pane is 0 tall while hidden.
    const reqPane = column.querySelector('.bs-reqpane') as HTMLElement | null;
    const total = reqPane
      ? startHeight + reqPane.getBoundingClientRect().height
      : column.getBoundingClientRect().height;
    beginDrag(
      e,
      'row-resize',
      (ev) => {
        const raw = startHeight - (ev.clientY - startY);
        // Past the top snap edge the request editor hides and the response fills.
        requestHidden = total - raw <= RESPONSE_COLLAPSE_AT;
        if (requestHidden) {
          responseHidden = false;
          return;
        }
        // Otherwise the request pane keeps PANE_MIN, and the response collapses past its own snap edge.
        const snapped = snapPanelSize(raw, PANE_MIN, Math.max(PANE_MIN, total - PANE_MIN), RESPONSE_COLLAPSE_AT);
        responseHidden = snapped.collapsed;
        responseHeight = snapped.collapsed ? liveHeight : snapped.size;
      },
      () => void saveState('responseHeight', responseHeight),
    );
  }

  // ---- gRPC ----
  // The gRPC method-picker open state stays here because App's
  // `<svelte:window onpointerdown>` below resets it on outside-click; it's
  // bound into GrpcEditor.
  let grpcMethodOpen = $state(false);

  function switchTo(kind: RequestProtocol): void {
    closeMenu();
    const prev = setActiveProtocol(kind);
    if (!prev) return;
    const name = (p: RequestProtocol) => (p === 'grpc' ? 'gRPC' : 'HTTP');
    showToast({
      text: t('app.toast.protocol', { kind: name(kind) }),
      undo: () => tabs.update((list) => list.map((x) => (x.id === prev.id ? prev : x))),
      undoLabel: t('app.toast.protocolUndo', { kind: name(prev.protocol as RequestProtocol) }),
      icon: 'swap_horiz',
      iconColor: methodColor(kind === 'grpc' ? 'GRPC' : 'GET'),
    });
  }

  function toggleCodePanel(): void {
    if (!codePanelAvailable || !active) return;
    codePanelTabId = codeOpen ? undefined : active.id;
  }

  function toggleUtilityPanel(mode: UtilityMode): void {
    utilityMode = utilityMode === mode ? null : mode;
    if (utilityMode) queueMicrotask(clampResponseToViewport);
  }

  // Double-click on a resize handle restores the panel's default size.
  function resetSidebarWidth(): void {
    sidebarWidth = SIDEBAR_DEFAULT;
    saveSidebarWidth();
  }
  function resetResponseSize(): void {
    responseHidden = false;
    requestHidden = false;
    responseHeight = RESPONSE_DEFAULT_HEIGHT;
    void saveState('responseHeight', responseHeight);
  }
</script>

<svelte:window
  bind:innerWidth
  onpointerdown={() => {
    grpcMethodOpen = false;
    httpMethodOpen = false;
    workspaceMenuOpen = false;
  }}
  onkeydown={globalKeydown}
/>

<div
  class="bs"
  class:sidebar-hidden={!sidebarShown}
  data-focus={requestTab && focusMode.current ? focusMode.current : undefined}
>
  <AppToolbar bind:workspaceMenuOpen onSearch={() => (paletteOpen = true)} onSettings={() => (settingsOpen = true)} />

  <div class="bs-body">
    <!-- Sidebar. Stays mounted while hidden: width animates to 0 and the
         fixed-width clip wrapper keeps the content from reflowing mid-slide. -->
    <aside class="bs-side" class:no-anim={panelDragging} style="width:{sidebarShown ? sidebarCssWidth : '0px'}">
      <div class="bs-side-clip" style="width:{sidebarCssWidth}">
        <Sidebar
          {openMenu}
          {editingNodeId}
          bind:editValue
          bind:filter={searchTerm}
          bind:panel={sidebarPanel}
          onTreeKey={treeKeydown}
          {commitInlineRename}
          {inlineRenameKeydown}
        />
      </div>
    </aside>
    {#if sidebarShown}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="bs-resizer-col"
        class:dragging={sidebarDragWidth !== null}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('app.sidebar.resize')}
        aria-valuenow={sidebarWidth}
        aria-valuemin={SIDEBAR_MIN}
        aria-valuemax={SIDEBAR_MAX}
        onpointerdown={startSidebarDrag}
        ondblclick={resetSidebarWidth}
      >
        <span class="grip" aria-hidden="true"></span>
      </div>
    {:else}
      <!-- S34: no toggle button — the hidden sidebar leaves a grip to pull it back open. -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="bs-side-grip"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('app.sidebar.open')}
        onpointerdown={startSidebarDrag}
      >
        <span class="mono-tip" role="tooltip">{t('app.sidebar.pull')}<kbd>⌘\</kbd></span>
      </div>
    {/if}

    <div class="bs-workspace-shell">
      <div class="bs-workspace-main">
        <!-- Main -->
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
        <main
          class="bs-main"
          class:req-hidden={requestHidden && !sideBySide}
          class:side={sideBySide}
          onfocusin={autoFocusIn}
          onclick={(e) => {
            if (requestHidden && (e.target as HTMLElement).closest('.bs-rtab')) requestHidden = false;
          }}
        >
          <AppTabBar
            onNew={() => {
              newTab();
              void tick().then(() => document.querySelector<HTMLElement>('.bs-urlbar .cm-content')?.focus());
            }}
            onContext={tabContext}
            onTabKey={tabKeydown}
          />
          {#if active && requestTab && focusMode.current}<FocusBar tab={active} mode={focusMode.current} />{/if}

          {#if active}
            {#if active.protocol === 'git'}
              {#if active.git?.view === 'project'}
                <ProjectDiffView />
              {:else}
                <GitDiffView tab={active} />
              {/if}
            {:else if active.protocol === 'env'}
              <EnvironmentsSheet embedded />
            {:else if active.protocol === 'runner'}
              <RunnerView />
            {:else if active.protocol === 'flow'}
              {#key active.flowId}
                <FlowView tab={active} />
              {/key}
            {:else}
              {#if historySnapshot}
                <div class="bs-history-banner" role="status">
                  <span class="material-symbols-outlined" aria-hidden="true">history</span>
                  <span class="text"
                    >{`${t('app.snapshot')} · ${historyDay(historySnapshot.entry.at, Date.now(), t).toLowerCase()} ${clock(historySnapshot.entry.at)}${historySnapshot.entry.envName ? ` · ${historySnapshot.entry.envName}` : ''}. ${t('app.snapshot.note')}`}</span
                  >
                  {#if historySnapshot.original}<button
                      type="button"
                      onclick={() => openSavedRequest(historySnapshot!.original!.node)}
                      >{t('app.snapshot.original')}</button
                    >{/if}
                </div>
              {/if}
              <RequestHeader
                tab={active}
                {savedFlash}
                onSwitch={(e) => openMenu('switch', e)}
                onSmartSave={smartSave}
                onOpenSave={openSaveDialog}
                {codeOpen}
                onCode={toggleCodePanel}
              />

              {#if active.protocol === 'grpc'}
                {#key active.id}
                  <GrpcEditor tab={active} bind:methodOpen={grpcMethodOpen} onSwitch={(e) => openMenu('switch', e)} />
                {/key}
              {:else}
                <HttpRequestEditor tab={active} bind:methodOpen={httpMethodOpen} />
              {/if}
              {#if reqStrip}<RequestStrip tab={active} onShow={showRequest} />{/if}
              <!-- Stays mounted while hidden so open/close animates (flex-basis → 0). -->
              <div
                class="bs-resp-host"
                class:closed={respStrip}
                class:no-anim={panelDragging}
                style={responseHeight == null || requestHidden || sideBySide || focusMode.current
                  ? ''
                  : `flex:0 0 ${responseHeight}px`}
              >
                <ResponsePane
                  tab={active}
                  onResize={startSplitDrag}
                  onResetSize={resetResponseSize}
                  onSettings={() =>
                    active.protocol === 'grpc' ? requestGrpcEditorAction(active.id, 'tls') : (settingsOpen = true)}
                />
              </div>
              {#if respStrip}<ResponseStrip tab={active} onShow={showResponse} />{/if}
            {/if}
          {:else}
            <WelcomeView
              onNewRequest={() => newRequestHere()}
              onImport={importFrom}
              onPasteCurl={(text) => {
                newTab();
                applyCurlToActiveTab(text);
              }}
            />
          {/if}
        </main>

        {#if utilityMode}
          <div class="bs-util-host" transition:slide={{ duration: PANEL_ANIM_MS, axis: 'y' }}>
            <UtilityPanel
              mode={utilityMode}
              bind:height={utilityPanelHeight}
              onSelect={(mode) => (utilityMode = mode)}
              onClose={() => (utilityMode = null)}
              onResizeEnd={() => void saveState('utilityPanelHeight', utilityPanelHeight)}
            />
          </div>
        {/if}
      </div>
    </div>
  </div>

  <AppStatusBar
    onRunner={openRunnerTab}
    {utilityMode}
    onTerminal={() => toggleUtilityPanel('terminal')}
    onConsole={() => toggleUtilityPanel('console')}
  />

  <AppPopoverMenu
    {menu}
    {closeMenu}
    tab={active}
    folderName={activeFolderName}
    inHistory={sidebarPanel === 'history'}
    onNewHere={newRequestHere}
    onNewFolderHere={newFolderHere}
    onSwitch={switchTo}
    onAddRequest={addReq}
    onAddFolder={collAddFolder}
    onSaveHere={nodeSaveHere}
    onRename={nodeRename}
    onDuplicate={nodeDuplicate}
    onMove={nodeMove}
    onAuth={nodeAuth}
    onDelete={nodeDelete}
    onCopyCurl={nodeCopyCurl}
    onImportCurl={() => void importCurlFromClipboard()}
    onImport={importFrom}
    onExportOpenApi={exportOpenApi}
    onRenameTab={tabRename}
    onCopyCurlTab={tabCopyCurl}
    onSaveTab={() => void smartSave()}
    onSaveAsTab={() => openSaveDialog(true)}
    onRevealTab={tabReveal}
  />

  <SaveRequestDialog onSaved={flashSaved} />

  <OpenApiImportDialog bind:open={importOpen} />

  <EnvironmentsSheet />

  <ConfirmDialog />

  <ProductionGuard />

  {#if toast}
    <div class="bs-toast" role="status">
      <span class="material-symbols-outlined" aria-hidden="true" style:color={toast.iconColor}
        >{toast.icon ?? 'check_circle'}</span
      >
      <span class="text">{toast.text}</span>
      {#if toast.undo}<button type="button" onclick={undoToast}>{toast.undoLabel ?? t('app.toast.undo')} ⌘Z</button
        >{/if}
    </div>
  {/if}

  <CommandPalette bind:open={paletteOpen} commands={paletteCommands} />

  <MoveDialog bind:open={moveOpen} sourceId={moveSourceId ?? ''} />
  <FolderAuthDialog bind:folderId={authFolderId} />

  <SettingsModal bind:open={settingsOpen} />
  <UpdateBanner />
</div>
