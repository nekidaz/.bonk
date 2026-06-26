<script lang="ts">
  import { onMount } from 'svelte';
  import {
    tabs,
    activeTabId,
    collections,
    hydrate,
    newTab,
    setActiveProtocol,
    addFolder,
    removeNode,
    renameNode,
    saveActiveRequest,
    addRequestToFolder,
    duplicateNode,
    requestConfirm,
  } from './lib/stores';
  import { flushPendingSaves, loadState, saveState } from './lib/persist';
  import GrpcEditor from './lib/components/GrpcEditor.svelte';
  import HttpRequestEditor from './lib/components/HttpRequestEditor.svelte';
  import AppPopoverMenu from './lib/components/AppPopoverMenu.svelte';
  import AppStatusBar from './lib/components/AppStatusBar.svelte';
  import AppTabBar from './lib/components/AppTabBar.svelte';
  import AppToolbar from './lib/components/AppToolbar.svelte';
  import RequestHeader from './lib/components/RequestHeader.svelte';
  import ResponsePane from './lib/components/ResponsePane.svelte';
  import CodeSnippetPanel from './lib/components/CodeSnippetPanel.svelte';
  import Sidebar from './lib/components/Sidebar.svelte';
  import GitDiffView from './lib/components/GitDiffView.svelte';
  import ProjectDiffView from './lib/components/ProjectDiffView.svelte';
  import SettingsModal from './lib/components/SettingsModal.svelte';
  import ConfirmDialog from './lib/components/ConfirmDialog.svelte';
  import SaveRequestDialog from './lib/components/SaveRequestDialog.svelte';
  import MoveDialog from './lib/components/MoveDialog.svelte';
  import UpdateBanner from './lib/components/UpdateBanner.svelte';
  import { checkForUpdate } from './lib/updater';
  import { findNode, parentId } from './lib/domain/tree';
  import { appMenuWidth, type AppMenuKind, type AppMenuState, type RequestProtocol } from './lib/domain/appShell';

  const active = $derived($tabs.find((t) => t.id === $activeTabId));

  // The HTTP method-picker open state stays here because App's
  // `<svelte:window onpointerdown>` below resets it on outside-click; it's
  // bound into HttpRequestEditor.
  let httpMethodOpen = $state(false);
  let workspaceMenuOpen = $state(false);
  let sidebarHidden = $state(false);
  // Resizable panels (Postman-style). Persisted across restarts.
  const SIDEBAR_MIN = 200;
  const SIDEBAR_MAX = 600;
  const SIDEBAR_DEFAULT = 292;
  const PANE_MIN = 120; // min height for both the request pane and the response
  let sidebarWidth = $state(SIDEBAR_DEFAULT);
  let responseHeight = $state<number | null>(null); // null = default flex:1

  let menu = $state<AppMenuState>({ kind: null, x: 0, y: 0 });
  function openMenu(kind: Exclude<AppMenuKind, null>, e: MouseEvent, nodeId?: string, isFolder?: boolean): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const w = appMenuWidth(kind);
    menu = { kind, x: Math.min(r.left, window.innerWidth - w - 8), y: r.bottom + 6, nodeId, isFolder };
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
    const n = menu.nodeId ? findNode($collections, menu.nodeId) : undefined;
    if (!n || !menu.nodeId) { closeMenu(); return; }
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
    if (e.key === 'Enter') { e.preventDefault(); commitInlineRename(); }
    else if (e.key === 'Escape') { e.preventDefault(); editingNodeId = undefined; }
  }
  async function nodeDelete(): Promise<void> {
    const id = menu.nodeId;
    const isFolder = menu.isFolder;
    closeMenu();
    if (!id) return;
    const name = findNode($collections, id)?.name ?? 'this item';
    const msg = isFolder
      ? `Delete folder “${name}” and everything inside it? This can’t be undone.`
      : `Delete “${name}”? This can’t be undone.`;
    if (await requestConfirm(msg, 'Delete')) await removeNode(id);
  }
  function nodeSaveHere(): void {
    if (menu.nodeId) void saveActiveRequest(menu.nodeId);
    closeMenu();
  }
  function nodeDuplicate(): void { if (menu.nodeId) void duplicateNode(menu.nodeId); closeMenu(); }
  let moveOpen = $state(false);
  let moveSourceId = $state<string | undefined>(undefined);
  function nodeMove(): void { moveSourceId = menu.nodeId; moveOpen = true; closeMenu(); }
  function addReq(p: RequestProtocol): void { void addRequestToFolder(menu.nodeId, p); closeMenu(); }

  // Inline rename of a tree node (window.prompt is unavailable in the Tauri webview)
  let editingNodeId = $state<string | undefined>(undefined);
  let editValue = $state('');

  // Save Request dialog
  let saveOpen = $state(false);
  let settingsOpen = $state(false);
  let codeOpen = $state(false);
  function openSaveDialog(): void {
    saveOpen = true;
  }

  // Brief "Saved ✓" feedback on the Save button after a successful write.
  let savedFlash = $state(false);
  let savedFlashTimer: ReturnType<typeof setTimeout> | undefined;
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
    if (!active || active.protocol === 'git') return;
    if (active.savedPath) {
      try {
        await saveActiveRequest(parentId(active.savedPath), active.title);
        flashSaved();
      } catch (err) {
        console.error('workspace: smartSave failed', err);
      }
    } else {
      openSaveDialog();
    }
  }

  function globalKeydown(e: KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      void smartSave();
    }
  }

  onMount(async () => {
    await hydrate();
    sidebarWidth = clamp(await loadState('sidebarWidth', SIDEBAR_DEFAULT), SIDEBAR_MIN, SIDEBAR_MAX);
    const savedResponseHeight = await loadState<number | null>('responseHeight', null);
    responseHeight = savedResponseHeight == null ? null : Math.max(PANE_MIN, savedResponseHeight);
  });

  function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  // Keep the request pane's PANE_MIN guarantee when the window shrinks: a fixed
  // response height set earlier could otherwise collapse the request pane to 0.
  function clampResponseToViewport(): void {
    if (responseHeight == null) return;
    const resp = document.querySelector('.bs-resp') as HTMLElement | null;
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

  // Silently check for an update shortly after launch; the banner only appears
  // if one is available (failures stay quiet).
  onMount(() => {
    const t = setTimeout(() => void checkForUpdate(), 2500);
    return () => clearTimeout(t);
  });

  onMount(() => {
    const flush = () => void flushPendingSaves();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  });

  /**
   * Shared pointer-drag plumbing. Listeners live on `window` so the drag keeps
   * tracking even when the cursor leaves the thin handle, and `setPointerCapture`
   * is best-effort (some environments reject it for synthetic pointers).
   */
  function beginDrag(
    e: PointerEvent,
    cursor: string,
    onMove: (ev: PointerEvent) => void,
    onDone: () => void,
  ): void {
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
    function up(): void {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      onDone();
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /** Drag the sidebar's right edge to resize its width. */
  function startSidebarDrag(e: PointerEvent): void {
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    beginDrag(
      e,
      'col-resize',
      (ev) => {
        sidebarWidth = clamp(startWidth + (ev.clientX - startX), SIDEBAR_MIN, SIDEBAR_MAX);
      },
      () => void saveState('sidebarWidth', sidebarWidth),
    );
  }

  /** Drag the response panel's top border to resize the request/response split. */
  function startSplitDrag(e: PointerEvent): void {
    const handle = e.currentTarget as HTMLElement;
    const resp = handle.closest('.bs-resp') as HTMLElement | null;
    const column = resp?.parentElement as HTMLElement | null;
    if (!resp || !column) return;
    const startY = e.clientY;
    // Seed from the live height so the first drag from default (flex:1) is smooth.
    const startHeight = responseHeight ?? resp.getBoundingClientRect().height;
    // Cap so the request pane keeps PANE_MIN: the response can't grow past the
    // combined request+response area minus the request pane's minimum.
    const reqPane = column.querySelector('.bs-reqpane') as HTMLElement | null;
    const maxHeight = reqPane
      ? startHeight + reqPane.getBoundingClientRect().height - PANE_MIN
      : column.getBoundingClientRect().height - PANE_MIN;
    beginDrag(
      e,
      'row-resize',
      (ev) => {
        responseHeight = clamp(startHeight - (ev.clientY - startY), PANE_MIN, Math.max(PANE_MIN, maxHeight));
      },
      () => void saveState('responseHeight', responseHeight),
    );
  }

  // ---- gRPC ----
  // The gRPC method-picker open state stays here because App's
  // `<svelte:window onpointerdown>` below resets it on outside-click; it's
  // bound into GrpcEditor.
  let grpcMethodOpen = $state(false);

  function pick(kind: RequestProtocol): void {
    newTab(kind);
    closeMenu();
  }
  function switchTo(kind: RequestProtocol): void {
    setActiveProtocol(kind);
    closeMenu();
  }
</script>

<svelte:window onpointerdown={() => { grpcMethodOpen = false; httpMethodOpen = false; workspaceMenuOpen = false; }} onkeydown={globalKeydown} />

<div class="bs" class:sidebar-hidden={sidebarHidden}>
  <AppToolbar bind:workspaceMenuOpen onSettings={() => (settingsOpen = true)} />

  <div class="bs-body">
    <!-- Sidebar -->
    <aside class="bs-side" style="width:{sidebarWidth}px">
      <Sidebar
        {openMenu}
        {editingNodeId}
        bind:editValue
        {commitInlineRename}
        {inlineRenameKeydown}
        onHide={() => (sidebarHidden = true)}
      />
    </aside>
    {#if !sidebarHidden}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="bs-resizer-col" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" onpointerdown={startSidebarDrag}></div>
    {/if}

    <!-- Main -->
    <main class="bs-main">
      <AppTabBar bind:sidebarHidden onNew={(e) => openMenu('create', e)} />

      {#if active}
        {#if active.protocol === 'git'}
          {#if active.git?.view === 'project'}
            <ProjectDiffView />
          {:else}
            <GitDiffView tab={active} />
          {/if}
        {:else}
        <RequestHeader tab={active} {savedFlash} onSwitch={(e) => openMenu('switch', e)} onSmartSave={smartSave} onOpenSave={openSaveDialog} onCode={() => (codeOpen = !codeOpen)} />

        {#if active.protocol === 'grpc'}
          {#key active.id}
            <GrpcEditor tab={active} bind:methodOpen={grpcMethodOpen} />
            <ResponsePane tab={active} {responseHeight} onResize={startSplitDrag} />
          {/key}
        {:else}
          <HttpRequestEditor tab={active} bind:methodOpen={httpMethodOpen} />
          <ResponsePane tab={active} {responseHeight} onResize={startSplitDrag} />
        {/if}
        {/if}
      {/if}
      {#if codeOpen && active && active.protocol !== 'grpc' && active.protocol !== 'git'}
        <CodeSnippetPanel tab={active} onClose={() => (codeOpen = false)} />
      {/if}
    </main>
  </div>

  <AppStatusBar />

  <AppPopoverMenu
    {menu}
    {closeMenu}
    onPick={pick}
    onSwitch={switchTo}
    onAddRequest={addReq}
    onAddFolder={collAddFolder}
    onSaveHere={nodeSaveHere}
    onRename={nodeRename}
    onDuplicate={nodeDuplicate}
    onMove={nodeMove}
    onDelete={nodeDelete}
  />

  <SaveRequestDialog bind:open={saveOpen} onSaved={flashSaved} />

  <ConfirmDialog />

  <MoveDialog bind:open={moveOpen} sourceId={moveSourceId ?? ''} />

  <SettingsModal bind:open={settingsOpen} />
  <UpdateBanner />
</div>
