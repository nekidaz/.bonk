<script lang="ts">
  /**
   * Inner content of the sidebar (everything inside `.bs-side`):
   *  - the rail row with workspace navigation icons,
   *  - the filter row (Filter box + New (＋)),
   *  - the Collections section with the recursive `node` snippet
   *    (folder/request rows, inline-rename input, per-row ⋯ actions),
   *  - the History section (header with count/paused + ⋯, list rows with a
   *    remove button, and the empty state),
   *  - the Postman-style bottom dock (environments).
   *
   * The outer `<aside class="bs-side" style="width:…">` wrapper, the column
   * resize handle, and the sidebar width/resize state live in app/ (AppSidebar.svelte,
   * layout.svelte.ts). This component is presentational: it reads the
   * state it renders directly and coordinates menus/inline-rename through
   * props so the menu popovers, modals, and editing state stay in app/.
   */
  import { GitBranchIcon, EmptyState } from '$shared/ui/components';
  import { tick, untrack } from 'svelte';
  import {
    toggleFolder,
    revealNode,
    addFolder,
    dropNode,
    undoDrop,
    idToRel,
    parentId,
    filterTree,
    findNode,
    workspace,
  } from '$entities/workspace';
  import { tabs } from '$entities/tab';
  import { history, openHistoryEntry, removeHistoryEntry } from '$entities/history';
  import { openSavedRequest } from '$entities/request';
  import {
    environments,
    setActiveEnvironment,
    openEnvironmentsTab,
    clock,
    historyDay,
    historyPath,
  } from '$entities/environment';
  import { methodColor, methodLabel, type TreeNode } from '$shared/model';
  import GitPanel from './GitPanel.svelte';
  import { flattenTree, rowOffsets, scrollToShow, visibleRange, type Pitch } from './rows';
  import { t } from '$shared/i18n';
  import { GIT_ENABLED, folderChangeCount, statusColor, git } from '$entities/git';

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
    panel?: 'collections' | 'history' | 'git';
    onTreeKey: (e: KeyboardEvent, id: string, isFolder: boolean) => void;
    commitInlineRename: () => void;
    inlineRenameKeydown: (e: KeyboardEvent) => void;
  } = $props();

  const ok = (s: number) => s >= 200 && s < 300;

  // History «repeat»: open the entry's snapshot and send it, like ⌘↵ on a palette hit.
  async function repeatEntry(h: (typeof history.list)[number]): Promise<void> {
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

  // Selection follows the active tab: open the folders above it; the reveal effect below scrolls to it.
  // Derived to a string so editing the request doesn't re-run this (and re-open folders).
  let treeEl = $state<HTMLElement>();
  const activeSavedPath = $derived(tabs.active?.savedPath);
  $effect(() => {
    const id = activeSavedPath;
    if (!id) return;
    untrack(() => revealNode(id));
  });

  // Sidebar filter: narrows the Collections tree (name / URL / gRPC endpoint,
  // matching folders keep their subtree, ancestors stay visible + expanded) and
  // the History list (URL substring). Escape or the ✕ button clears it.
  const filterActive = $derived(filter.trim() !== '');
  const visibleCollections = $derived(filterTree(workspace.tree, filter));

  // Virtual tree: only the rows inside the scrolled-to band (plus OVERSCAN px each side) are in
  // the DOM, and the row list's padding stands in for the rest, so a 10k-request collection renders
  // a few dozen rows. Row heights are measured from the DOM (they change with density).
  const OVERSCAN = 400;
  let scrollTop = $state(0);
  let viewH = $state(0);
  let pitch = $state.raw<Pitch>({ node: 32, empty: 40 });
  const rows = $derived(flattenTree(visibleCollections));
  const offsets = $derived(rowOffsets(rows, pitch));
  const range = $derived(visibleRange(offsets, scrollTop - OVERSCAN, scrollTop + viewH + OVERSCAN));
  const slice = $derived(rows.slice(range[0], range[1]));
  const padTop = $derived(offsets[range[0]]);
  const padBottom = $derived(offsets[rows.length] - offsets[range[1]]);
  // The real scroll position moves without a scroll event: the tree element is recreated when the
  // Git panel closes, and the browser clamps it when the content gets shorter (an import, a folder
  // collapsed, History). A stale scrollTop renders rows below the view and leaves it blank.
  $effect(() => {
    void panel;
    void offsets;
    scrollTop = treeEl?.scrollTop ?? 0;
  });

  // Rendered rows are the row list's only children, in slice order: the gap between two
  // neighbours' tops is the pitch of the first one's kind.
  let rowsEl = $state<HTMLElement>();
  $effect(() => {
    const shown = slice;
    const els = rowsEl?.children;
    if (!els || els.length !== shown.length) return;
    const next = { ...untrack(() => pitch) };
    for (let i = 0; i + 1 < els.length; i++)
      next[shown[i].kind] = els[i + 1].getBoundingClientRect().top - els[i].getBoundingClientRect().top;
    if (next.node !== untrack(() => pitch).node || next.empty !== untrack(() => pitch).empty) pitch = next;
  });

  /** Scroll the tree just enough to show row `i`; scrollTop updates now, so the row renders on the next tick. */
  function showRow(i: number): void {
    if (!treeEl || i < 0) return;
    treeEl.scrollTop = scrollToShow(offsets, i, treeEl.scrollTop, treeEl.clientHeight);
    scrollTop = treeEl.scrollTop;
  }
  $effect(() => {
    const target = workspace.revealed;
    if (!target || untrack(() => panel) !== 'collections') return;
    untrack(() => showRow(rows.findIndex((r) => r.key === target.id)));
  });

  // Tree keyboard: ↑↓ move between rows, ←→ collapse / expand a folder; ↵ is the
  // row button's own click; F2 and the rest go to App's onTreeKey.
  function rowKey(e: KeyboardEvent, n: TreeNode): void {
    if (editingNodeId === n.id) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const step = e.key === 'ArrowDown' ? 1 : -1;
      let i = rows.findIndex((r) => r.key === n.id) + step;
      while (rows[i]?.kind === 'empty') i += step;
      const next = rows[i];
      if (next) {
        showRow(i);
        void tick().then(() => treeEl?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(next.key)}"]`)?.focus());
      }
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

  // The environment picker stays docked below the collections tree.
  let environmentsOpen = $state(true);

  function toggleEnvironments(): void {
    environmentsOpen = !environmentsOpen;
  }

  function chooseEnv(id: string | null): void {
    setActiveEnvironment(id);
  }
  function manageEnvs(): void {
    openEnvironmentsTab();
  }
  const activeEnvName = $derived(environments.active?.name ?? t('sidebar.noEnv'));

  // S21: newest first, grouped by day.
  const historyGroups = $derived.by(() => {
    const groups: { day: string; entries: typeof history.list }[] = [];
    for (const h of [...visibleHistory].sort((a, b) => b.at - a.at).slice(0, 60)) {
      const day = historyDay(h.at);
      if (groups.at(-1)?.day !== day) groups.push({ day, entries: [] });
      groups.at(-1)!.entries.push(h);
    }
    return groups;
  });
  const visibleHistory = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return history.list;
    return history.list.filter((h) => (h.request.url || '').toLowerCase().includes(q));
  });

  const gitFiles = $derived(git.status?.files ?? []);
  const statusMap = $derived(git.statusMap);
  // Status paths are toplevel-relative; node ids are workspace-relative. When
  // the workspace is a repo subdir, prefix maps one to the other (empty = same).
  const gitPrefixVal = $derived(git.prefix);

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
  const dragNode = $derived(dragId ? findNode(workspace.tree, dragId) : undefined);
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
    const n = next?.pos === 'into' && next.id ? findNode(workspace.tree, next.id) : undefined;
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
    const fromNode = from ? findNode(workspace.tree, from) : undefined;
    const oldIds = (fromNode?.kind === 'folder' ? fromNode.children : workspace.tree).map((n) => n.id);
    const newId = await dropNode(
      src,
      dest,
      at.pos === 'into' ? undefined : { id: at.id, after: at.pos === 'after' },
      copy,
    );
    if (!newId) return;
    revealNode(newId);
    if (!copy && from === dest) return; // a plain reorder needs no toast
    const folder = dest
      ? (findNode(workspace.tree, dest)?.name ?? '')
      : ((workspace.path ?? '').split('/').pop() ?? '');
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
          ><GitBranchIcon size={16} /><span class="bs-ri-label">Git</span>{#if gitFiles.length}<span class="bs-ri-badge"
              >{gitFiles.length > 99 ? '99+' : gitFiles.length}</span
            >{/if}</button
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
    {#if panel !== 'git'}
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
    {/if}

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
          {:else}
            {#if changed > 0}<span class="bs-git-treecount">{changed}</span>{/if}
            {#if n.children.length > 0}<span class="bs-tcount">{n.children.length}</span>{/if}
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
        bind:clientHeight={viewH}
        onscroll={() => (scrollTop = treeEl?.scrollTop ?? 0)}
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
            <!-- Padding, not .bs-tree's: a scroll container can't shrink below its own padding. -->
            <div
              bind:this={rowsEl}
              style="display:flex; flex-direction:column; gap:inherit; flex:none; padding:{padTop}px 0 {padBottom}px"
            >
              {#each slice as row (row.key)}
                {#if row.kind === 'empty'}
                  <EmptyState style="padding-left:{indent(row.depth)}px">
                    <p>{t('sidebar.folderEmpty')}</p>
                  </EmptyState>
                {:else}
                  {@render node(row.node, row.depth)}
                {/if}
              {/each}
            </div>
          {/if}
        {:else if panel === 'history'}
          {#if visibleHistory.length === 0}
            <EmptyState><p>{filterActive ? t('sidebar.notFoundDot') : t('sidebar.historyEmpty')}</p></EmptyState>
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
                  {#if history.paused}<span class="bs-paused" title={t('sidebar.recordingPaused')}
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

    <div class="bs-side-dock">
      <section class="bs-dock-section" class:open={environmentsOpen}>
        <div class="bs-dock-head">
          <button
            class="bs-dock-toggle"
            type="button"
            aria-expanded={environmentsOpen}
            onclick={() => toggleEnvironments()}
          >
            <span class="material-symbols-outlined" aria-hidden="true" style="font-size:13px"
              >{environmentsOpen ? 'expand_more' : 'chevron_right'}</span
            >
            <span>{t('sidebar.environments')}</span>
            <span class="bs-dock-summary">{activeEnvName}</span>
          </button>
          <button class="bs-dock-action" type="button" title={t('sidebar.manageEnvs')} onclick={manageEnvs}
            ><span class="material-symbols-outlined" style="font-size:14px">tune</span></button
          >
        </div>
        {#if environmentsOpen}
          <div class="bs-dock-body">
            <button
              class="bs-dock-item"
              class:on={environments.activeId === null}
              type="button"
              onclick={() => chooseEnv(null)}
            >
              <span class="material-symbols-outlined" aria-hidden="true" style="font-size:14px"
                >{environments.activeId === null ? 'check' : 'block'}</span
              >
              <span>{t('sidebar.noEnv')}</span>
            </button>
            {#each environments.list as environment (environment.id)}
              <button
                class="bs-dock-item"
                class:on={environments.activeId === environment.id}
                type="button"
                onclick={() => chooseEnv(environment.id)}
              >
                <span class="material-symbols-outlined" aria-hidden="true" style="font-size:14px"
                  >{environments.activeId === environment.id ? 'check' : 'layers'}</span
                >
                <span>{environment.name}</span>
              </button>
            {/each}
          </div>
        {/if}
      </section>
    </div>
  </div>
</div>

<style>
  .bs-trow:has(:global(.fo)) {
    gap: 7px;
    font-size: 12.5px;
    color: var(--color-text);
    font-weight: 500;
  }

  .bs-drag-ghost :global(.plus) {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--color-success);
    color: var(--color-raised);
    font: 700 12px/1 var(--font-ui);
  }

  :global(.bs) .bs-history-row:is(:hover, :focus-within) :global(:is(.st, .at)) {
    display: none;
  }

  /* Flow · Git: three rail tabs — only the active one is wide and labelled, the rest are icons. */
  :global(.bs) .bs-ri:not(.on) {
    flex: 0 0 auto;
    min-width: 36px;
    padding: 0 10px;
  }

  /* Drag & drop — Pencil «Flow · Drag & drop запросов» (D1–D5). */
  :global(.bs) .bs-tree .bs-trow {
    cursor: grab;
  }

  .bs-tree :where(.bs-trow).bs-dropped {
    background: var(--color-selected);
  }

  .bs-tree {
    flex: 1;
    overflow-y: auto;
    position: relative;
    contain: layout paint;
    padding: 0;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .bs-trow:hover {
    background: var(--hover);
  }

  /* S22b: a 1px guide per ancestor level, under that folder's chevron. */
  .bs-trow::before {
    content: '';
    position: absolute;
    left: 8px;
    top: -1px;
    bottom: -1px;
    width: calc(var(--d, 0) * 24px);
    background: repeating-linear-gradient(
      to right,
      transparent 0 7px,
      var(--color-border) 7px 8px,
      transparent 8px 24px
    );
    pointer-events: none;
  }

  .bs-trow.sel::before {
    background: repeating-linear-gradient(
      to right,
      transparent 0 7px,
      var(--color-text-secondary) 7px 8px,
      transparent 8px 24px
    );
  }

  .bs-trow {
    display: flex;
    align-items: center;
    width: 100%;
    text-align: left;
    contain: paint;
    padding: 3px 6px;
    height: 30px;
    min-height: 30px;
    margin: 0;
    padding-right: 8px;
    border-radius: var(--radius-control);
    color: var(--color-text-secondary);
    font-size: var(--font-size-body);
    gap: 10px;
    position: relative;
  }

  .bs-trow.sel {
    background: var(--color-selected);
    color: var(--color-text);
    font-weight: 500;
    box-shadow: none;
  }

  :global(:root[data-density='compact']) .bs-trow {
    height: 26px;
    min-height: 26px;
  }

  /* Sidebar: collections tree, history, filter, create/import menus, drag and drop, dock. */
  :global(.bs-send) .cv {
    color: var(--primary-text);
    width: 32px;
    background: transparent;
    border-left: 1px solid rgba(255, 255, 255, 0.25);
    display: none;
  }

  .bs-ri :global(svg) {
    width: 17px;
    height: 17px;
  }

  .bs-fbox :global(svg) {
    width: 13px;
    height: 13px;
  }

  .bs-fbox-input {
    background: transparent;
    border: none;
    outline: none;
  }

  .bs-fbox-clear {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 4px;
    color: var(--t3);
    flex-shrink: 0;
  }

  .bs-fbox-clear:hover {
    background: var(--hover);
    color: var(--text);
  }

  .bs-fi :global(svg) {
    width: 15px;
    height: 15px;
  }

  :where(.bs-trow).bs-drop {
    background: var(--accentsoft);
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .bs-tree.bs-droproot {
    box-shadow: inset 0 0 0 1px var(--accent);
    border-radius: 8px;
  }

  :global(.bs-trow:hover) .bs-act {
    opacity: 1;
    pointer-events: auto;
  }

  .bs-act :global(svg) {
    width: 15px;
    height: 15px;
  }

  /* History "recording paused" indicator. */
  .bs-paused {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    color: var(--orange);
    text-transform: none;
    letter-spacing: 0;
    font-weight: 600;
  }

  .bs-dock-section:first-child {
    border-top: 0;
  }

  .bs-dock-toggle:hover {
    color: var(--text);
    background: var(--hover2);
  }

  .bs-dock-summary {
    min-width: 0;
    margin-left: auto;
    overflow: hidden;
    color: var(--t3);
    font-size: 9.5px;
    font-weight: 500;
    letter-spacing: 0;
    text-overflow: ellipsis;
    text-transform: none;
    white-space: nowrap;
  }

  .bs-dock-action:hover {
    color: var(--text);
    background: var(--hover);
  }

  .bs-dock-item:hover {
    color: var(--text);
    background: var(--hover);
  }

  .bs-dock-item > :global(span:last-child) {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bs-tree.bs-dragging {
    user-select: none;
  }

  .bs-tree.bs-dragging .bs-act {
    visibility: hidden;
  }

  .bs-tree.bs-dragging :global(.bs-trow:hover:not(.sel):not(.bs-drop)) {
    background: transparent;
  }

  :global(.bs-tree) .bs-trow.bs-dragsrc {
    opacity: 0.35;
  }

  .bs-tree.bs-dragging .bs-trow.bs-drop {
    background: var(--color-selected);
    box-shadow: inset 0 0 0 1px var(--color-focus, var(--color-border));
    color: var(--color-text);
  }

  :global(.bs-tree .bs-trow) .bs-tcount-drop {
    display: inline-flex;
    color: var(--color-text);
  }

  /* Tree rows use `contain: paint`, which would clip the line out of the gap; it's one row at a time. */
  :global(.bs-tree) .bs-trow.bs-drop-before {
    contain: none;
  }

  :global(.bs-tree) .bs-trow.bs-drop-after {
    contain: none;
  }

  /* Insertion line: a ring + 2px rule in the gap between rows (muted text colour: the
     design's 15% focus tint is too faint on a dark panel). The ghost sits below the cursor
     so the target row stays readable. */
  :global(.bs-tree) .bs-trow.bs-drop-before::after {
    content: '';
    position: absolute;
    left: 8px;
    right: 8px;
    height: 6px;
    z-index: 1;
    pointer-events: none;
    --c: var(--color-text-muted);
    background:
      radial-gradient(circle at 3px 3px, transparent 1.5px, var(--c) 1.75px 3px, transparent 3.25px),
      linear-gradient(var(--c), var(--c)) 6px 2px / calc(100% - 6px) 2px no-repeat;
    top: -4px;
  }

  :global(.bs-tree) .bs-trow.bs-drop-after::after {
    content: '';
    position: absolute;
    left: 8px;
    right: 8px;
    height: 6px;
    z-index: 1;
    pointer-events: none;
    --c: var(--color-text-muted);
    background:
      radial-gradient(circle at 3px 3px, transparent 1.5px, var(--c) 1.75px 3px, transparent 3.25px),
      linear-gradient(var(--c), var(--c)) 6px 2px / calc(100% - 6px) 2px no-repeat;
    bottom: -4px;
  }

  .bs-drag-ghost {
    position: fixed;
    z-index: 1000;
    pointer-events: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 12px;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    background: var(--color-raised);
    box-shadow: 0 10px 24px #000000aa;
    transform: translate(-18px, 8px) rotate(-2deg);
    white-space: nowrap;
    font: 400 12px var(--font-ui);
    color: var(--color-text);
  }

  .bs-drag-ghost :global(.m) {
    font: 700 9.5px var(--font-code);
  }

  .bs-drag-ghost :global(.material-symbols-outlined) {
    font-size: 15px;
    color: var(--color-text-muted);
  }

  .bs-drop-toast {
    position: absolute;
    left: 12px;
    right: 12px;
    bottom: 12px;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border: 1px solid var(--color-border);
    border-radius: 16px;
    background: var(--color-raised);
    box-shadow: 0 8px 24px #00000088;
    font: 400 12px var(--font-ui);
    color: var(--color-text);
  }

  .bs-drop-toast :global(.ok) {
    font-size: 15px;
    color: var(--color-success);
  }

  .bs-drop-toast .tx {
    flex: 1;
    min-width: 0;
    line-height: 1.35;
  }

  .bs-drop-toast :global(.undo) {
    flex: none;
    font-size: 11px;
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  .bs-drop-toast :global(.undo:hover) {
    color: var(--color-text);
  }

  .bs-ri:active {
    transform: scale(0.94);
  }

  .bs-fi:active {
    transform: scale(0.94);
  }

  .bs-act {
    margin-left: auto;
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--t2);
    opacity: 0;
    pointer-events: none;
    border-radius: 6px;
  }

  .bs-act:hover {
    background: rgba(0, 0, 0, 0.1);
  }

  :global(.dark) .bs-act:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  /* Inline rename input inside a sidebar tree row */
  .bs-nm-input {
    flex: 1;
    min-width: 0;
    background: var(--surface-solid);
    border: 1px solid var(--accent);
    border-radius: 4px;
    padding: 1px 5px;
    margin: -2px 0;
    font: inherit;
    color: var(--text);
    outline: none;
  }

  .bs-git-treebadge {
    margin-left: auto;
    font-size: 10px;
    font-weight: 700;
    font-family: var(--mono);
    padding-right: 4px;
  }

  .bs-git-treecount {
    margin-left: auto;
    font-size: 10px;
    font-weight: 600;
    color: var(--t3);
    padding-right: 4px;
  }

  :global(:where(.bs-trow).sel) .fo {
    color: inherit;
  }

  :global(:where(.bs-trow).sel) .cv {
    color: inherit;
  }

  :global(.bs-trow.sel) .bs-mp {
    color: inherit;
  }

  :global(:where(.bs-send).cancelling) .cv {
    background: transparent;
    color: #fff;
  }

  .bs-fbox:where(:focus-within) {
    box-shadow: var(--focus-ring);
  }

  .bs-dock-section {
    border-top: 1px solid var(--sepsoft);
  }

  .bs-dock-head {
    display: flex;
    align-items: center;
    min-height: 28px;
  }

  .bs-dock-toggle {
    min-width: 0;
    flex: 1;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px;
    color: var(--t2);
    text-align: left;
    font-weight: 700;
    letter-spacing: 0.055em;
    text-transform: uppercase;
    min-height: 28px;
    padding-inline: 7px;
    font-size: 9.5px;
  }

  .bs-dock-action {
    width: 26px;
    height: 24px;
    margin-right: 5px;
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    color: var(--t3);
    border-radius: 3px;
  }

  .bs-dock-body {
    max-height: 132px;
    overflow: auto;
    padding: 2px 5px 6px 18px;
    padding-left: 15px;
  }

  .bs-dock-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 3px 7px;
    overflow: hidden;
    color: var(--t2);
    text-align: left;
    min-height: 24px;
    border-radius: 3px;
    font-size: 11px;
  }

  .bs-dock-item.on {
    color: var(--text);
    background: var(--accentsoft);
    box-shadow: inset 2px 0 var(--accent);
  }

  .bs-ri {
    align-items: center;
    transition:
      background 120ms ease,
      color 120ms ease,
      transform 90ms ease;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 5px;
    width: 100%;
    height: 62px;
    padding: 6px 0;
    border-radius: 4px;
    color: var(--t2);
    font-size: 10px;
    font-weight: 400;
  }

  .bs-ri :global(.material-symbols-outlined) {
    font-size: 22px;
  }

  .bs-ri.on {
    background: var(--hover);
    color: var(--text);
    box-shadow: none;
  }

  .bs-ri:hover {
    background: var(--hover);
  }

  .bs-ri.on::after {
    display: none;
  }

  .bs-side-dock {
    flex: 0 0 auto;
    border-top: 1px solid var(--sepsoft);
    background: var(--side);
    display: none;
  }

  @media (max-width: 480px) {
    :global(.bs-send) .cv {
      width: 28px;
    }
  }

  .bs-sidebar-layout {
    flex: 1;
    min-height: 0;
    min-width: 0;
    grid-template-columns: 80px minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    display: flex;
    flex-direction: column;
    gap: 2px;
    height: 100%;
    padding: 10px;
  }

  .bs-railnav {
    width: 100%;
    display: flex;
    flex-direction: row;
    align-items: stretch;
    gap: 2px;
    height: 100%;
  }

  :global(.bs) .bs-ri {
    flex: 1 1 0;
    width: auto;
    height: 100%;
    min-width: 34px;
    padding: 0 9px;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 7px;
    border-radius: var(--radius-control);
    color: var(--color-text-muted);
    font-size: var(--font-size-body);
    font-weight: 500;
  }

  :global(.bs) .bs-ri :global(.material-symbols-outlined) {
    font-size: 16px;
  }

  :global(.bs) .bs-ri:hover {
    background: var(--hover);
    color: var(--color-text-secondary);
  }

  :global(.bs) .bs-ri.on {
    background: var(--color-raised);
    color: var(--color-text);
    font-weight: 600;
    box-shadow: 0 1px 3px var(--color-shadow);
  }

  :global(.bs) .bs-ri.on::after {
    display: none;
  }

  .bs-sidebar-content {
    position: relative;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    overflow: hidden;
  }

  .bs-filterrow {
    display: flex;
    align-items: center;
    position: relative;
    height: auto;
    padding: 8px 0 10px;
    gap: 6px;
    border: 0;
  }

  .bs-fbox {
    display: flex;
    align-items: center;
    box-shadow: none;
    flex: 1;
    min-width: 0;
    height: 34px;
    padding: 0 13px;
    gap: 8px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    background: var(--color-field);
    color: var(--color-text-muted);
  }

  .bs-fbox :global(.material-symbols-outlined) {
    font-size: 16px;
  }

  .bs-fbox:focus-within {
    background: var(--canvas);
    border-color: var(--color-border);
  }

  .bs-fbox-input {
    flex: 1;
    min-width: 0;
    font: inherit;
    color: var(--text);
    padding: 0;
    font-size: var(--font-size-body);
  }

  .bs-fbox-input::placeholder {
    color: var(--color-text-muted);
  }

  .bs-fi {
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      background 120ms ease,
      color 120ms ease,
      transform 90ms ease;
    flex: 0 0 34px;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: var(--color-field);
    color: var(--color-text-secondary);
  }

  .bs-fi:hover {
    background: var(--color-selected);
    color: var(--color-text);
  }

  .bs-fi :global(.material-symbols-outlined) {
    font-size: 18px;
  }

  :global(.bs .bs-trow) .bs-act {
    position: absolute;
    right: 6px;
    margin: 0;
  }

  :global(.bs-trow) .cv {
    flex: 0 0 16px;
    width: 16px;
    height: 16px;
    display: grid;
    place-items: center;
    font-size: 14px;
    color: var(--color-text-muted);
  }

  :global(.bs-trow) .fo {
    flex: 0 0 16px;
    width: 16px;
    height: 16px;
    display: grid;
    place-items: center;
    font-size: 16px;
    color: var(--color-text-muted);
  }

  .bs-mp {
    width: 24px;
    flex: 0 0 34px;
    min-width: 34px;
    margin-right: 0;
    font: 700 9.5px var(--font-code);
    letter-spacing: 0.3px;
    text-align: left;
  }

  .bs-tcount {
    margin-left: auto;
    color: var(--color-text-muted);
    font: 400 10px var(--font-code);
  }

  :global(.bs-trow:hover) .bs-tcount {
    display: none;
  }

  .bs-collection-empty {
    padding: 24px 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 8px;
  }

  .bs-collection-empty-icon {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border: 0;
    background: var(--color-field);
    border-radius: 50%;
    color: var(--color-text-secondary);
    font-size: 20px;
  }

  .bs-collection-empty :global(strong) {
    font: 600 var(--font-size-ui)/16px var(--font-ui);
    color: var(--color-text);
  }

  .bs-collection-empty :global(p) {
    margin: 0;
    max-width: 240px;
    color: var(--color-text-muted);
    font-size: var(--font-size-body);
    line-height: 1.5;
  }

  :global(.bs) button.bs-empty-action:hover {
    background: var(--color-raised);
  }

  .bs-empty-action :global(.material-symbols-outlined) {
    font-size: 15px;
  }

  :global(:root[data-density='compact']) .bs-sidebar-layout {
    padding: 8px;
  }

  :global(:root[data-density='compact']) .bs-railrow {
    height: 34px;
  }

  :global(:root[data-density='compact']) .bs-filterrow {
    padding: 6px 0 8px;
  }

  :global(:root[data-density='compact']) .bs-fbox {
    height: 28px;
  }

  :global(:root[data-density='compact']) .bs-fi {
    flex-basis: 28px;
    width: 28px;
    height: 28px;
  }

  /* S21: history list and the "snapshot from history" banner. */
  :global(.bs) .bs-history-day {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 27px;
    padding: 10px 10px 4px;
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro)/13px var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
  }

  :global(.bs) .bs-history-day > :global(span:first-child) {
    flex: 1;
  }

  :global(.bs) .bs-history-day .bs-paused {
    color: var(--color-warning);
  }

  :global(.bs) .bs-history-options {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    margin: -4px -4px -4px 0;
    border-radius: 50%;
    color: var(--color-text-muted);
  }

  :global(.bs) .bs-history-options:hover {
    background: var(--hover);
    color: var(--color-text);
  }

  :global(.bs) .bs-history-options :global(.material-symbols-outlined) {
    font-size: 16px;
  }

  /* One 26px line: method · path · status · time; repeat/remove take the status+time slot on hover. */
  :global(.bs) .bs-history-row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 26px;
    padding: 0 10px;
    border-radius: var(--radius-control);
    text-align: left;
  }

  :global(.bs) .bs-history-row + .bs-history-row {
    margin-top: 2px;
  }

  :global(.bs) .bs-history-row:hover {
    background: var(--hover);
  }

  :global(.bs) .bs-history-row.sel {
    background: var(--color-selected);
  }

  :global(.bs) .bs-history-row :global(.m) {
    flex: 0 0 30px;
    font: 700 9.5px var(--font-code);
    letter-spacing: 0.3px;
  }

  :global(.bs) .bs-history-row :global(.path) {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-secondary);
    font: var(--font-size-body)/16px var(--font-code);
  }

  :global(.bs) .bs-history-row.sel :global(.path) {
    color: var(--color-text);
  }

  :global(.bs) .bs-history-row :global(.st) {
    flex: none;
    color: var(--color-success);
    font: 600 var(--font-size-micro) var(--font-code);
  }

  :global(.bs) .bs-history-row :global(.st.warn) {
    color: var(--color-warning);
  }

  :global(.bs) .bs-history-row :global(.st.err) {
    color: var(--color-danger);
  }

  :global(.bs) .bs-history-row :global(.at) {
    flex: none;
    color: var(--color-text-muted);
    font: var(--font-size-micro) var(--font-code);
  }

  :global(.bs) .bs-history-row .bs-act {
    display: none;
    flex: none;
    width: 20px;
    height: 20px;
    margin: 0;
  }

  :global(.bs .bs-history-row:is(:hover, :focus-within)) .bs-act {
    display: flex;
    opacity: 1;
    pointer-events: auto;
  }

  /* Rail becomes the Collections / History mode switch. */
  /* Collections | History switch at the narrow end of the sidebar (220 px): drop the icons, keep the words. */
  .bs-railrow {
    display: flex;
    justify-content: center;
    position: relative;
    gap: 1px;
    min-height: 0;
    align-items: flex-start;
    flex: none;
    width: auto;
    height: 40px;
    padding: 2px;
    background: var(--color-field);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    container: railrow / inline-size;
  }

  .bs-ri-label {
    display: inline;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.bs .bs-ri:not(.on)) .bs-ri-label {
    display: none;
  }

  @container railrow (max-width: 225px) {
    :global(.bs) .bs-ri {
      gap: 0;
      padding: 0 8px;
    }

    :global(.bs) .bs-ri.on :global(.material-symbols-outlined) {
      display: none;
    }
  }

  /* G1 / G2: count of changed files on the rail's Git tab and on folders in the tree. */
  :global(.bs) .bs-ri-badge {
    flex: none;
    min-width: 16px;
    height: 15px;
    padding: 0 5px;
    border-radius: var(--radius-control);
    background: var(--color-warning-soft);
    color: var(--color-warning);
    font: 600 9.5px/15px var(--font-code);
    text-align: center;
  }

  :global(.bs) .bs-git-treecount {
    flex: none;
    min-width: 16px;
    height: 15px;
    padding: 0 5px;
    border-radius: var(--radius-control);
    background: var(--color-warning-soft);
    color: var(--color-warning);
    font: 600 9.5px/15px var(--font-code);
    text-align: center;
  }

  :global(.bs) .bs-ri.on .bs-ri-badge {
    background: var(--color-selected);
    color: var(--color-text-secondary);
  }

  :global(.bs) .bs-git-treecount {
    margin-left: auto;
    margin-right: 6px;
  }

  :global(.bs) .bs-git-treecount + .bs-tcount {
    margin-left: 0;
  }

  :global(.bs) .bs-git-treebadge {
    margin-left: auto;
    padding-right: 6px;
    font: 700 var(--font-size-micro) var(--font-code);
  }

  /* The hover ⋯ sits absolutely over the row's right edge: git marks step left of it instead of under it. */
  :global(.bs .bs-trow:hover) .bs-git-treecount,
  :global(.bs .bs-trow:hover) .bs-git-treebadge {
    margin-right: 26px;
  }
</style>
