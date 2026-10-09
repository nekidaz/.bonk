<script lang="ts">
  /**
   * Inner content of the sidebar (everything inside `.bs-side`):
   *  - the rail row with workspace navigation icons,
   *  - the filter row (Filter box + New (＋)),
   *  - the Collections section with the recursive `node` snippet
   *    (folder/request rows, inline-rename input, per-row ⋯ actions),
   *  - the History section (header with count/paused + ⋯, list rows with a
   *    remove button, and the empty state),
   *  - the Postman-style bottom dock (environments, flows).
   *
   * The outer `<aside class="bs-side" style="width:…">` wrapper, the column
   * resize handle, and the sidebar width/resize state live in App.svelte
   * (resize state is App-level). This component is presentational: it reads the
   * stores it renders directly and coordinates menus/inline-rename through
   * props so the menu popovers, modals, and editing state stay in App.
   */
  import { tick, untrack } from 'svelte';
  import {
    collections,
    workspacePath,
    toggleFolder,
    revealNode,
    addFolder,
    dropNode,
    undoDrop,
    idToRel,
    parentId,
    filterTree,
    findNode,
  } from '$entities/workspace';
  import { tabs } from '$entities/tab';
  import { history, historyPaused, openHistoryEntry, removeHistoryEntry } from '$entities/history';
  import { openSavedRequest } from '$entities/request';
  import { flows, openFlowTab, createFlow } from '$entities/flow';
  import {
    environments,
    activeEnvironmentId,
    setActiveEnvironment,
    openEnvironmentsTab,
    clock,
    historyDay,
    historyPath,
  } from '$entities/environment';
  import { methodColor, methodLabel, type TreeNode } from '$shared/model';
  import GitPanel from './GitPanel.svelte';
  import { t } from '$shared/i18n';
  import { gitStatus, gitStatusMap, gitPrefix, GIT_ENABLED, folderChangeCount, statusColor } from '$entities/git';

  type MenuKind = 'create' | 'switch' | 'coll' | 'req' | 'history';

  let {
    openMenu,
    editingNodeId,
    editValue = $bindable(),
    filter = $bindable(),
    panel = $bindable('collections'),
    onTreeKey,
    commitInlineRename,
    inlineRenameKeydown,
  }: {
    openMenu: (kind: MenuKind, e: MouseEvent, nodeId?: string, isFolder?: boolean) => void;
    editingNodeId: string | undefined;
    editValue: string;
    filter: string;
    panel?: 'collections' | 'history' | 'git' | 'flows';
    onTreeKey: (e: KeyboardEvent, id: string, isFolder: boolean) => void;
    commitInlineRename: () => void;
    inlineRenameKeydown: (e: KeyboardEvent) => void;
  } = $props();

  const ok = (s: number) => s >= 200 && s < 300;

  // History «repeat»: open the entry's snapshot and send it, like ⌘↵ on a palette hit.
  async function repeatEntry(h: (typeof $history)[number]): Promise<void> {
    openHistoryEntry(h);
    await tick();
    document.querySelector<HTMLButtonElement>('.bs-send')?.click();
  }
  /** Row actions are spans inside the row button: Enter / Space run them instead of the row. */
  function actKey(e: KeyboardEvent, run: () => void): void {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    run();
  }

  // Selection follows the active tab: open the folders above it and scroll it into view.
  // Derived to a string so editing the request doesn't re-run this (and re-open folders).
  let treeEl = $state<HTMLElement>();
  const activeSavedPath = $derived(tabs.active?.savedPath);
  $effect(() => {
    const id = activeSavedPath;
    if (!id) return;
    untrack(() => revealNode(id));
    void tick().then(() => treeEl?.querySelector('.bs-trow.sel')?.scrollIntoView({ block: 'nearest' }));
  });

  // Tree keyboard: ↑↓ move between rows, ←→ collapse / expand a folder; ↵ is the
  // row button's own click; F2 and the rest go to App's onTreeKey.
  function rowKey(e: KeyboardEvent, n: TreeNode): void {
    if (editingNodeId === n.id) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const rows = [...(treeEl?.querySelectorAll<HTMLElement>('.bs-trow') ?? [])];
      rows[rows.indexOf(e.currentTarget as HTMLElement) + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
    } else if (
      n.kind === 'folder' &&
      (e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
      n.expanded !== (e.key === 'ArrowRight')
    ) {
      toggleFolder(n.id);
    } else {
      onTreeKey(e, n.id, n.kind === 'folder');
      return;
    }
    e.preventDefault();
  }

  // Tree indent: 12px per level, capped so deep nesting doesn't starve the label width.
  // S22b tree: 24px per level; --d draws one guide line per ancestor level.
  const indent = (depth: number) => 8 + Math.min(depth, 4) * 24;

  type DockSection = 'environments' | 'flows';
  // Postman-style secondary sections stay docked to the bottom instead of
  // opening popovers over the collections tree.
  let dockSection = $state<DockSection | null>('environments');

  $effect(() => {
    if (panel === 'flows') dockSection = 'flows';
  });

  function toggleDock(section: DockSection): void {
    dockSection = dockSection === section ? null : section;
  }

  function chooseFlow(id: string): void {
    openFlowTab(id);
  }
  function newFlow(): void {
    createFlow();
  }
  function chooseEnv(id: string | null): void {
    setActiveEnvironment(id);
  }
  function manageEnvs(): void {
    openEnvironmentsTab();
  }
  const activeEnvName = $derived($environments.find((e) => e.id === $activeEnvironmentId)?.name ?? t('sidebar.noEnv'));

  // Sidebar filter: narrows the Collections tree (name / URL / gRPC endpoint,
  // matching folders keep their subtree, ancestors stay visible + expanded) and
  // the History list (URL substring). Escape or the ✕ button clears it.
  const filterActive = $derived(filter.trim() !== '');
  const visibleCollections = $derived(filterTree($collections, filter));
  // S21: newest first, grouped by day.
  const historyGroups = $derived.by(() => {
    const groups: { day: string; entries: typeof $history }[] = [];
    for (const h of [...visibleHistory].sort((a, b) => b.at - a.at).slice(0, 60)) {
      const day = historyDay(h.at);
      if (groups.at(-1)?.day !== day) groups.push({ day, entries: [] });
      groups.at(-1)!.entries.push(h);
    }
    return groups;
  });
  const visibleHistory = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return $history;
    return $history.filter((h) => (h.request.url || '').toLowerCase().includes(q));
  });

  const gitFiles = $derived($gitStatus?.files ?? []);
  const statusMap = $derived($gitStatusMap);
  // Status paths are toplevel-relative; node ids are workspace-relative. When
  // the workspace is a repo subdir, prefix maps one to the other (empty = same).
  const gitPrefixVal = $derived($gitPrefix);

  // ---- Drag & drop (Pencil: «Flow · Drag & drop запросов», D1–D6) ----
  // Drop on a row's top/bottom edge to place before/after it, on a folder's middle to
  // move into it, on empty tree space to move to the root. ⌥ copies, Esc cancels,
  // hovering a collapsed folder for 0.6 s opens it, a toast offers Undo (⌘Z).
  // Plain pointer events, not HTML5 DnD: on macOS Tauri's native file-drop handler
  // swallows the webview's dragover/drop, so HTML5 drop targets never fire there.
  type DropPos = 'before' | 'after' | 'into';
  let dragId = $state<string | undefined>(undefined);
  let dropAt = $state<{ id: string; pos: DropPos } | undefined>(undefined); // id '' = root zone
  let ghostAt = $state({ x: 0, y: 0 });
  let copyDrag = $state(false);
  let droppedId = $state<string | undefined>(undefined);
  let toast = $state<{ text: string; undo: () => void } | undefined>(undefined);
  let press: { id: string; x: number; y: number; moved: boolean; cancelled: boolean } | undefined;
  let expandTimer: ReturnType<typeof setTimeout> | undefined;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const dragNode = $derived(dragId ? findNode($collections, dragId) : undefined);
  $effect(() => {
    document.documentElement.classList.toggle('bs-row-dragging', !!dragId);
  });

  function dropAllowed(src: string | undefined, destFolderId: string | undefined): boolean {
    if (!src) return false;
    // Never drop a folder into itself or one of its own descendants (would orphan it).
    if (destFolderId !== undefined && (destFolderId === src || destFolderId.startsWith(src + '/'))) return false;
    // Dropping into the node's current parent is a no-op.
    if ((parentId(src) ?? undefined) === destFolderId) return false;
    return true;
  }
  /** Where a drop at (x, y) would land; undefined = nowhere valid (outside the tree = cancel). */
  function dropTarget(x: number, y: number): { id: string; pos: DropPos } | undefined {
    const src = dragId;
    const el = document.elementFromPoint(x, y);
    const row = el?.closest<HTMLElement>('[data-node-id]');
    if (!row)
      return src && el?.closest('.bs-tree') && dropAllowed(src, undefined) ? { id: '', pos: 'into' } : undefined;
    const id = row.dataset.nodeId!;
    if (!src || id === src || id.startsWith(src + '/')) return undefined;
    const r = row.getBoundingClientRect();
    const f = (y - r.top) / r.height;
    const folder = row.dataset.folder; // 'open' | 'closed' | undefined (request)
    // An expanded folder's bottom edge sits above its children, so it means "into".
    const pos: DropPos = !folder
      ? f < 0.5
        ? 'before'
        : 'after'
      : f < 0.25
        ? 'before'
        : f > 0.75 && folder === 'closed'
          ? 'after'
          : 'into';
    return pos === 'into' && !dropAllowed(src, id) ? undefined : { id, pos };
  }

  function onRowPointerDown(e: PointerEvent, id: string): void {
    if (e.button !== 0 || panel !== 'collections' || editingNodeId === id) return;
    press = { id, x: e.clientX, y: e.clientY, moved: false, cancelled: false };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragEnd);
    window.addEventListener('keydown', onDragKey, true);
    window.addEventListener('keyup', onDragKey, true);
  }
  function onDragMove(e: PointerEvent): void {
    if (!press || press.cancelled) return;
    if (!press.moved) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < 5) return; // a click, not a drag yet
      press.moved = true;
      dragId = press.id;
    }
    ghostAt = { x: e.clientX, y: e.clientY };
    copyDrag = e.altKey;
    const next = dropTarget(e.clientX, e.clientY);
    if (next?.id !== dropAt?.id || next?.pos !== dropAt?.pos) armExpand(next);
    dropAt = next;
  }
  /** D4: holding over a collapsed folder for 0.6 s opens it. */
  function armExpand(next: { id: string; pos: DropPos } | undefined): void {
    clearTimeout(expandTimer);
    const n = next?.pos === 'into' && next.id ? findNode($collections, next.id) : undefined;
    if (n?.kind !== 'folder' || n.expanded) return;
    expandTimer = setTimeout(() => {
      if (dropAt?.id === n.id && dropAt.pos === 'into') toggleFolder(n.id);
    }, 600);
  }
  function onDragKey(e: KeyboardEvent): void {
    if (!press?.moved || press.cancelled) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      press.cancelled = true;
      resetDrag();
    } else {
      copyDrag = e.altKey;
    }
  }
  function resetDrag(): void {
    clearTimeout(expandTimer);
    dragId = undefined;
    dropAt = undefined;
    copyDrag = false;
  }
  function onDragEnd(e: PointerEvent): void {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragEnd);
    window.removeEventListener('keydown', onDragKey, true);
    window.removeEventListener('keyup', onDragKey, true);
    const p = press;
    const at = dropAt;
    press = undefined;
    resetDrag();
    if (!p?.moved) return;
    // Swallow the click that follows the release so the row under it doesn't open.
    const swallow = (ev: MouseEvent) => ev.stopPropagation();
    window.addEventListener('click', swallow, true);
    setTimeout(() => window.removeEventListener('click', swallow, true));
    if (at && !p.cancelled && e.type === 'pointerup') void commitDrop(p.id, at, e.altKey);
  }

  async function commitDrop(src: string, at: { id: string; pos: DropPos }, copy: boolean): Promise<void> {
    const dest = at.id === '' ? undefined : at.pos === 'into' ? at.id : parentId(at.id);
    const from = parentId(src);
    const fromNode = from ? findNode($collections, from) : undefined;
    const oldIds = (fromNode?.kind === 'folder' ? fromNode.children : $collections).map((n) => n.id);
    const newId = await dropNode(
      src,
      dest,
      at.pos === 'into' ? undefined : { id: at.id, after: at.pos === 'after' },
      copy,
    );
    if (!newId) return;
    revealNode(newId);
    if (!copy && from === dest) return; // a plain reorder needs no toast
    const folder = dest ? (findNode($collections, dest)?.name ?? '') : (($workspacePath ?? '').split('/').pop() ?? '');
    droppedId = newId;
    clearTimeout(toastTimer);
    toast = {
      text: t(copy ? 'sidebar.copiedTo' : 'sidebar.movedTo', { folder }),
      undo: () => void undoDrop(newId, copy, from, oldIds),
    };
    toastTimer = setTimeout(closeToast, 5000);
  }
  function closeToast(): void {
    clearTimeout(toastTimer);
    toast = undefined;
    droppedId = undefined;
  }
  function runUndo(): void {
    const undo = toast?.undo;
    closeToast();
    undo?.();
  }
  function onWindowKey(e: KeyboardEvent): void {
    if (!toast || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
    if ((e.target as HTMLElement | null)?.closest?.('input, textarea, [contenteditable], .cm-editor')) return;
    e.preventDefault();
    runUndo();
  }
</script>

<svelte:window onkeydown={onWindowKey} />

<div class="bs-sidebar-layout">
  <nav class="bs-railrow" aria-label={t('sidebar.navAria')}>
    <div class="bs-railnav">
      <button
        class="bs-ri"
        class:on={panel === 'collections'}
        title={t('sidebar.collections')}
        onclick={() => (panel = 'collections')}
        ><span class="material-symbols-outlined">folder</span><span class="bs-ri-label">{t('sidebar.collections')}</span
        ></button
      >
      <button
        class="bs-ri"
        class:on={panel === 'history'}
        title={t('sidebar.history')}
        onclick={() => (panel = 'history')}
        ><span class="material-symbols-outlined">history</span><span class="bs-ri-label">{t('sidebar.history')}</span
        ></button
      >
      {#if GIT_ENABLED}
        <button
          class="bs-ri"
          class:on={panel === 'git'}
          title={t('sidebar.sourceControl')}
          onclick={() => (panel = 'git')}
          ><span class="material-symbols-outlined">folder_open</span><span class="bs-ri-label">Git</span></button
        >
      {/if}
    </div>
  </nav>
  <div class="bs-sidebar-content">
    {#if dragNode}
      <div class="bs-drag-ghost" style="left:{ghostAt.x}px; top:{ghostAt.y}px" aria-hidden="true">
        {#if dragNode.kind === 'folder'}
          <span class="material-symbols-outlined">folder</span>
        {:else}
          <span class="m" style="color:{methodColor(dragNode.protocol === 'grpc' ? 'GRPC' : dragNode.request.method)}"
            >{dragNode.protocol === 'grpc' ? 'gRPC' : methodLabel(dragNode.request.method)}</span
          >
        {/if}
        <span>{dragNode.name}</span>
        {#if copyDrag}<span class="plus">+</span>{/if}
      </div>
    {/if}
    {#if toast}
      <div class="bs-drop-toast" role="status">
        <span class="material-symbols-outlined ok">check_circle</span>
        <span class="tx">{toast.text}</span>
        <button type="button" class="undo" onclick={runUndo}>{t('sidebar.undo')} ⌘Z</button>
      </div>
    {/if}
    <div class="bs-filterrow">
      <div class="bs-fbox">
        <span class="material-symbols-outlined">search</span>
        <input
          class="bs-fbox-input"
          placeholder={panel === 'history' ? t('sidebar.filterHistory') : t('sidebar.filter')}
          aria-label={t('sidebar.filterAria')}
          bind:value={filter}
          onkeydown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              filter = '';
            }
          }}
        />
        {#if filterActive}
          <button
            class="bs-fbox-clear"
            title={t('sidebar.clearFilter')}
            aria-label={t('sidebar.clearFilter')}
            onclick={() => (filter = '')}
          >
            <span class="material-symbols-outlined" style="font-size:13px">close</span>
          </button>
        {/if}
      </div>
      <button
        class="bs-fi"
        title={t('sidebar.new')}
        aria-label={t('sidebar.new')}
        onclick={(e) => openMenu('create', e)}><span class="material-symbols-outlined">add</span></button
      >
    </div>

    {#snippet node(n: TreeNode, depth: number)}
      {#if n.kind === 'folder'}
        {@const changed = folderChangeCount(gitPrefixVal + idToRel(n.id), gitFiles)}
        <button
          class="bs-trow"
          class:bs-drop={dropAt?.id === n.id && dropAt.pos === 'into'}
          class:bs-drop-before={dropAt?.id === n.id && dropAt.pos === 'before'}
          class:bs-drop-after={dropAt?.id === n.id && dropAt.pos === 'after'}
          class:bs-dragsrc={dragId === n.id}
          class:bs-dropped={droppedId === n.id}
          data-node-id={n.id}
          data-folder={n.expanded ? 'open' : 'closed'}
          style="padding-left:{indent(depth)}px; --d:{Math.min(depth, 4)}"
          onpointerdown={(e) => onRowPointerDown(e, n.id)}
          oncontextmenu={(e) => {
            e.preventDefault();
            openMenu('coll', e, n.id, true);
          }}
          onkeydown={(e) => rowKey(e, n)}
          onclick={() => {
            if (editingNodeId !== n.id) toggleFolder(n.id);
          }}
        >
          <span class="material-symbols-outlined cv">{n.expanded ? 'keyboard_arrow_down' : 'chevron_right'}</span>
          <span class="material-symbols-outlined fo">{n.expanded ? 'folder_open' : 'folder'}</span>
          {#if editingNodeId === n.id}<!-- svelte-ignore a11y_autofocus --><input
              class="bs-nm bs-nm-input"
              bind:value={editValue}
              autofocus
              onpointerdown={(e) => e.stopPropagation()}
              onclick={(e) => e.stopPropagation()}
              onkeydown={inlineRenameKeydown}
              onblur={commitInlineRename}
            />{:else}<span class="bs-nm" title={n.name}>{n.name}</span>{/if}
          {#if dropAt?.id === n.id && dropAt.pos === 'into'}
            <span class="bs-tcount bs-tcount-drop">{n.children.length} → {n.children.length + 1}</span>
          {:else if changed > 0}
            <span class="bs-git-treecount">{changed}</span>
          {:else if n.children.length > 0}
            <span class="bs-tcount">{n.children.length}</span>
          {/if}
          <span
            class="bs-act"
            role="button"
            tabindex="0"
            onclick={(e) => {
              e.stopPropagation();
              openMenu('coll', e, n.id, true);
            }}
            onkeydown={() => {}}><span class="material-symbols-outlined" style="font-size:15px">more_horiz</span></span
          >
        </button>
        {#if n.expanded}
          {#if n.children.length === 0}
            <div class="bs-empty" style="padding-left:{indent(depth + 1)}px"><p>{t('sidebar.folderEmpty')}</p></div>
          {:else}
            {#each n.children as child (child.id)}
              {@render node(child, depth + 1)}
            {/each}
          {/if}
        {/if}
      {:else}
        {@const st = statusMap.get(gitPrefixVal + idToRel(n.id))}
        <button
          class="bs-trow"
          class:sel={activeSavedPath === n.id}
          class:bs-drop-before={dropAt?.id === n.id && dropAt.pos === 'before'}
          class:bs-drop-after={dropAt?.id === n.id && dropAt.pos === 'after'}
          class:bs-dragsrc={dragId === n.id}
          class:bs-dropped={droppedId === n.id}
          data-node-id={n.id}
          style="padding-left:{indent(depth)}px; --d:{Math.min(depth, 4)}"
          onpointerdown={(e) => onRowPointerDown(e, n.id)}
          oncontextmenu={(e) => {
            e.preventDefault();
            openMenu('req', e, n.id, false);
          }}
          onkeydown={(e) => rowKey(e, n)}
          onclick={(e) => {
            if (editingNodeId !== n.id) openSavedRequest(n, e.metaKey || e.ctrlKey);
          }}
        >
          <span class="bs-mp" style="color:{methodColor(n.protocol === 'grpc' ? 'GRPC' : n.request.method)}"
            >{n.protocol === 'grpc' ? 'gRPC' : methodLabel(n.request.method)}</span
          >
          {#if editingNodeId === n.id}<!-- svelte-ignore a11y_autofocus --><input
              class="bs-nm bs-nm-input"
              bind:value={editValue}
              autofocus
              onpointerdown={(e) => e.stopPropagation()}
              onclick={(e) => e.stopPropagation()}
              onkeydown={inlineRenameKeydown}
              onblur={commitInlineRename}
            />{:else}<span
              class="bs-nm"
              title="{n.protocol === 'grpc' ? 'gRPC' : n.request.method.toUpperCase()} {n.name}">{n.name}</span
            >{/if}
          {#if st}
            <span class="bs-git-treebadge" style="color:{statusColor(st)}">{st}</span>
          {/if}
          <span
            class="bs-act"
            role="button"
            tabindex="0"
            title={t('sidebar.requestActions')}
            onclick={(e) => {
              e.stopPropagation();
              openMenu('req', e, n.id, false);
            }}
            onkeydown={() => {}}><span class="material-symbols-outlined" style="font-size:14px">more_horiz</span></span
          >
        </button>
      {/if}
    {/snippet}

    {#if panel === 'git'}
      <GitPanel />
    {:else}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="bs-tree"
        bind:this={treeEl}
        class:bs-flows-selected={panel === 'flows'}
        class:bs-droproot={dropAt?.id === ''}
        class:bs-dragging={!!dragId}
      >
        {#if panel === 'collections'}
          {#if visibleCollections.length === 0}
            <div class="bs-collection-empty">
              <span class="material-symbols-outlined bs-collection-empty-icon" aria-hidden="true">folder</span>
              <strong>{filterActive ? t('sidebar.notFound') : t('sidebar.noCollections')}</strong>
              <p>{filterActive ? t('sidebar.tryOther') : t('sidebar.collectionHint')}</p>
              {#if !filterActive}<button class="bs-empty-action" onclick={() => void addFolder()}
                  >{t('sidebar.newCollection')}</button
                >{/if}
            </div>
          {:else}
            {#each visibleCollections as n (n.id)}
              {@render node(n, 0)}
            {/each}
          {/if}
        {:else if panel === 'history'}
          {#if visibleHistory.length === 0}
            <div class="bs-empty"><p>{filterActive ? t('sidebar.notFoundDot') : t('sidebar.historyEmpty')}</p></div>
            <button
              class="bs-history-options"
              type="button"
              title={t('sidebar.historyOptions')}
              onclick={(e) => openMenu('history', e)}><span class="material-symbols-outlined">more_horiz</span></button
            >
          {:else}
            {#each historyGroups as group, gi (group.day)}
              <div class="bs-history-day">
                <span>{group.day}</span>
                {#if gi === 0}
                  {#if $historyPaused}<span class="bs-paused" title={t('sidebar.recordingPaused')}
                      >{t('sidebar.paused')}</span
                    >{/if}
                  <button
                    class="bs-history-options"
                    type="button"
                    title={t('sidebar.historyOptions')}
                    onclick={(e) => openMenu('history', e)}
                    ><span class="material-symbols-outlined">more_horiz</span></button
                  >
                {/if}
              </div>
              {#each group.entries as h (h.id)}
                {@const good = h.ok ?? ok(h.status)}
                <button
                  class="bs-history-row"
                  class:sel={tabs.active?.historyId === h.id}
                  type="button"
                  title={h.envName ? `${t('sidebar.openInNewTab')} · ${h.envName}` : t('sidebar.openInNewTab')}
                  onclick={() => openHistoryEntry(h)}
                >
                  <span class="m" style="color:{methodColor(h.protocol === 'grpc' ? 'GRPC' : h.request.method)}"
                    >{h.protocol === 'grpc' ? 'gRPC' : methodLabel(h.request.method)}</span
                  >
                  <span class="path">{historyPath(h)}</span>
                  <span
                    class="st"
                    class:warn={!good && h.status >= 400 && h.status < 500}
                    class:err={!good && !(h.status >= 400 && h.status < 500)}
                    >{h.protocol === 'grpc' ? (h.ok ? '0 OK' : 'ERR') : h.status || 'ERR'}</span
                  >
                  <span class="at">{clock(h.at)}</span>
                  {#if h.protocol !== 'grpc'}
                    <span
                      class="bs-act repeat"
                      role="button"
                      tabindex="0"
                      title={t('sidebar.repeat')}
                      aria-label={t('sidebar.repeat')}
                      onclick={(e) => {
                        e.stopPropagation();
                        void repeatEntry(h);
                      }}
                      onkeydown={(e) => actKey(e, () => void repeatEntry(h))}
                      ><span class="material-symbols-outlined" style="font-size:14px">replay</span></span
                    >
                  {/if}
                  <span
                    class="bs-act"
                    role="button"
                    tabindex="0"
                    title={t('sidebar.remove')}
                    aria-label={t('sidebar.remove')}
                    onclick={(e) => {
                      e.stopPropagation();
                      removeHistoryEntry(h.id);
                    }}
                    onkeydown={(e) => actKey(e, () => removeHistoryEntry(h.id))}
                    ><span class="material-symbols-outlined" style="font-size:14px">close</span></span
                  >
                </button>
              {/each}
            {/each}
          {/if}
        {/if}
      </div>
    {/if}

    <div class="bs-side-dock" class:bs-flows-selected={panel === 'flows'}>
      <section class="bs-dock-section" class:open={dockSection === 'environments'}>
        <div class="bs-dock-head">
          <button
            class="bs-dock-toggle"
            type="button"
            aria-expanded={dockSection === 'environments'}
            onclick={() => toggleDock('environments')}
          >
            <span class="material-symbols-outlined" aria-hidden="true" style="font-size:13px"
              >{dockSection === 'environments' ? 'expand_more' : 'chevron_right'}</span
            >
            <span>{t('sidebar.environments')}</span>
            <span class="bs-dock-summary">{activeEnvName}</span>
          </button>
          <button class="bs-dock-action" type="button" title={t('sidebar.manageEnvs')} onclick={manageEnvs}
            ><span class="material-symbols-outlined" style="font-size:14px">tune</span></button
          >
        </div>
        {#if dockSection === 'environments'}
          <div class="bs-dock-body">
            <button
              class="bs-dock-item"
              class:on={$activeEnvironmentId === null}
              type="button"
              onclick={() => chooseEnv(null)}
            >
              <span class="material-symbols-outlined" aria-hidden="true" style="font-size:14px"
                >{$activeEnvironmentId === null ? 'check' : 'block'}</span
              >
              <span>{t('sidebar.noEnv')}</span>
            </button>
            {#each $environments as environment (environment.id)}
              <button
                class="bs-dock-item"
                class:on={$activeEnvironmentId === environment.id}
                type="button"
                onclick={() => chooseEnv(environment.id)}
              >
                <span class="material-symbols-outlined" aria-hidden="true" style="font-size:14px"
                  >{$activeEnvironmentId === environment.id ? 'check' : 'layers'}</span
                >
                <span>{environment.name}</span>
              </button>
            {/each}
          </div>
        {/if}
      </section>

      <section class="bs-dock-section" class:open={dockSection === 'flows'}>
        <div class="bs-dock-head">
          <button
            class="bs-dock-toggle"
            type="button"
            aria-expanded={dockSection === 'flows'}
            onclick={() => toggleDock('flows')}
          >
            <span class="material-symbols-outlined" aria-hidden="true" style="font-size:13px"
              >{dockSection === 'flows' ? 'expand_more' : 'chevron_right'}</span
            ><span>{t('sidebar.flows')}</span>
          </button>
          <button class="bs-dock-action" type="button" title={t('sidebar.newFlow')} onclick={newFlow}
            ><span class="material-symbols-outlined" style="font-size:14px">add</span></button
          >
        </div>
        {#if dockSection === 'flows'}
          <div class="bs-dock-body">
            {#if $flows.length === 0}
              <div class="bs-dock-empty">{t('sidebar.noFlows')}</div>
            {:else}
              {#each $flows as flow (flow.id)}
                <button class="bs-dock-item" type="button" onclick={() => chooseFlow(flow.id)}>
                  <span class="material-symbols-outlined" aria-hidden="true" style="font-size:14px">account_tree</span
                  ><span>{flow.name}</span>
                </button>
              {/each}
            {/if}
          </div>
        {/if}
      </section>
    </div>
  </div>
</div>
