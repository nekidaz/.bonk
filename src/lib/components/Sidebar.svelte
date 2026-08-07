<script lang="ts">
  /**
   * Inner content of the sidebar (everything inside `.bs-side`):
   *  - the rail row with workspace navigation icons,
   *  - the filter row (Filter box + New (＋) + ⋯ actions),
   *  - the Collections section with the recursive `node` snippet
   *    (folder/request rows, inline-rename input, per-row ⋯ actions),
   *  - the History section (header with count/paused + ⋯, list rows with a
   *    remove button, and the empty state),
   *  - the Postman-style bottom dock (environments, specs, flows, documents,
   *    mocks) and compact workspace strip.
   *
   * The outer `<aside class="bs-side" style="width:…">` wrapper, the column
   * resize handle, and the sidebar width/resize state live in App.svelte
   * (resize state is App-level). This component is presentational: it reads the
   * stores it renders directly and coordinates menus/inline-rename through
   * props so the menu popovers, modals, and editing state stay in App.
   */
  import {
    collections,
    history,
    historyPaused,
    workspacePath,
    toggleFolder,
    openSavedRequest,
    openHistoryEntry,
    removeHistoryEntry,
    openWorkspaceFolder,
    moveNode,
    openRunnerTab,
    flows,
    openFlowTab,
    createFlow,
    environments,
    activeEnvironmentId,
    setActiveEnvironment,
    openEnvironmentsTab,
  } from '../stores';
  import { methodColor } from '../domain/method';
  import type { TreeNode } from '../domain/types';
  import GitPanel from './GitPanel.svelte';
  import { gitStatus, gitStatusMap, gitPrefix, GIT_ENABLED } from '../git';
  import { folderChangeCount, statusColor } from '../domain/gitStatus';
  import { idToRel, parentId, filterTree } from '../domain/tree';

  type MenuKind = 'create' | 'switch' | 'coll' | 'req' | 'history';

  let {
    openMenu,
    editingNodeId,
    editValue = $bindable(),
    commitInlineRename,
    inlineRenameKeydown,
  }: {
    openMenu: (kind: MenuKind, e: MouseEvent, nodeId?: string, isFolder?: boolean) => void;
    editingNodeId: string | undefined;
    editValue: string;
    commitInlineRename: () => void;
    inlineRenameKeydown: (e: KeyboardEvent) => void;
  } = $props();

  const ok = (s: number) => s >= 200 && s < 300;

  // Which rail panel is shown in the body. Collections by default; History has
  // its own tab (the clock rail icon) instead of stacking under Collections.
  let panel = $state<'collections' | 'history' | 'git'>('collections');

  type DockSection = 'environments' | 'specs' | 'flows' | 'documents' | 'mocks';
  // Postman-style secondary sections stay docked to the bottom instead of
  // opening popovers over the collections tree.
  let dockSection = $state<DockSection | null>('environments');

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
  const activeEnvName = $derived(
    $environments.find((e) => e.id === $activeEnvironmentId)?.name ?? 'No environment',
  );

  // Sidebar filter: narrows the Collections tree (name / URL / gRPC endpoint,
  // matching folders keep their subtree, ancestors stay visible + expanded) and
  // the History list (URL substring). Escape or the ✕ button clears it.
  let filter = $state('');
  const filterActive = $derived(filter.trim() !== '');
  const visibleCollections = $derived(filterTree($collections, filter));
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

  // ---- Drag & drop: move a request/folder into a folder, or out to the root ----
  // Reuses the existing moveNode backend; folders and the root area are drop targets.
  let dragId = $state<string | undefined>(undefined);
  let dragOverId = $state<string | undefined>(undefined); // hovered folder id, '' = root zone

  function dropAllowed(src: string | undefined, destFolderId: string | undefined): boolean {
    if (!src) return false;
    // Never drop a folder into itself or one of its own descendants (would orphan it).
    if (destFolderId !== undefined && (destFolderId === src || destFolderId.startsWith(src + '/'))) return false;
    // Dropping into the node's current parent is a no-op.
    if ((parentId(src) ?? undefined) === destFolderId) return false;
    return true;
  }

  function onDragStart(e: DragEvent, id: string): void {
    dragId = id;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
    }
  }
  function onDragEnd(): void {
    dragId = undefined;
    dragOverId = undefined;
  }
  function onFolderDragOver(e: DragEvent, folderId: string): void {
    if (!dropAllowed(dragId, folderId)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    dragOverId = folderId;
  }
  function onFolderDrop(e: DragEvent, folderId: string): void {
    e.preventDefault();
    e.stopPropagation();
    const src = dragId;
    onDragEnd();
    if (src && dropAllowed(src, folderId)) void moveNode(src, folderId);
  }
  function onRootDragOver(e: DragEvent): void {
    if (panel !== 'collections' || !dropAllowed(dragId, undefined)) return;
    e.preventDefault();
    dragOverId = '';
  }
  function onRootDrop(e: DragEvent): void {
    if (panel !== 'collections') return;
    e.preventDefault();
    const src = dragId;
    onDragEnd();
    if (src && dropAllowed(src, undefined)) void moveNode(src, undefined);
  }
</script>

<div class="bs-railrow">
  <div class="bs-railnav">
    <button class="bs-ri" class:on={panel === 'collections'} title="Collections" onclick={() => (panel = 'collections')}><span class="material-symbols-outlined" style="font-size:17px">deployed_code</span></button>
    <button class="bs-ri" title="Collection Runner" onclick={openRunnerTab}><span class="material-symbols-outlined" style="font-size:17px">play_circle</span></button>
    <div class="bs-rdiv"></div>
    <button class="bs-ri" class:on={panel === 'history'} title="History" onclick={() => (panel = 'history')}><span class="material-symbols-outlined" style="font-size:17px">history</span></button>
    {#if GIT_ENABLED}
      <button class="bs-ri" class:on={panel === 'git'} title="Source control" onclick={() => (panel = 'git')}><span class="material-symbols-outlined" style="font-size:17px">folder_open</span></button>
    {/if}
  </div>
</div>
<div class="bs-filterrow">
  <div class="bs-fbox">
    <span class="material-symbols-outlined" style="font-size:13px">filter_list</span>
    <input
      class="bs-fbox-input"
      placeholder="Search"
      aria-label="Filter collections and history"
      bind:value={filter}
      onkeydown={(e) => { if (e.key === 'Escape') { e.preventDefault(); filter = ''; } }}
    />
    {#if filterActive}
      <button class="bs-fbox-clear" title="Clear filter" aria-label="Clear filter" onclick={() => (filter = '')}>
        <span class="material-symbols-outlined" style="font-size:13px">close</span>
      </button>
    {/if}
  </div>
  <button class="bs-fi" title="New" onclick={(e) => openMenu('create', e)}><span class="material-symbols-outlined" style="font-size:15px">add</span></button>
  <button class="bs-fi" title="Open workspace" onclick={openWorkspaceFolder}><span class="material-symbols-outlined" style="font-size:15px">create_new_folder</span></button>
</div>

{#snippet node(n: TreeNode, depth: number)}
  {#if n.kind === 'folder'}
    {@const changed = folderChangeCount(gitPrefixVal + idToRel(n.id), gitFiles)}
    <button class="bs-trow" class:bs-drop={dragOverId === n.id} draggable="true" style="padding-left:{8 + depth * 14}px" onclick={() => { if (editingNodeId !== n.id) toggleFolder(n.id); }} ondragstart={(e) => onDragStart(e, n.id)} ondragend={onDragEnd} ondragover={(e) => onFolderDragOver(e, n.id)} ondragleave={() => { if (dragOverId === n.id) dragOverId = undefined; }} ondrop={(e) => onFolderDrop(e, n.id)}>
      <span class="material-symbols-outlined cv" style="font-size:13px">{n.expanded ? 'expand_more' : 'chevron_right'}</span>
      <span class="material-symbols-outlined fo" style="font-size:15px">{n.expanded ? 'folder_open' : 'folder'}</span>
      {#if editingNodeId === n.id}<!-- svelte-ignore a11y_autofocus --><input class="bs-nm bs-nm-input" bind:value={editValue} autofocus onpointerdown={(e) => e.stopPropagation()} onclick={(e) => e.stopPropagation()} onkeydown={inlineRenameKeydown} onblur={commitInlineRename} />{:else}<span class="bs-nm">{n.name}</span>{/if}
      {#if changed > 0}
        <span class="bs-git-treecount">{changed}</span>
      {/if}
      <span class="bs-act" role="button" tabindex="0" onclick={(e) => { e.stopPropagation(); openMenu('coll', e, n.id, true); }} onkeydown={() => {}}><span class="material-symbols-outlined" style="font-size:15px">more_horiz</span></span>
    </button>
    {#if n.expanded}
      {#if n.children.length === 0}
        <div class="bs-empty" style="padding-left:{38 + depth * 14}px"><p>Empty — add a folder or save a request here from ⋯.</p></div>
      {:else}
        {#each n.children as child (child.id)}
          {@render node(child, depth + 1)}
        {/each}
      {/if}
    {/if}
  {:else}
    {@const st = statusMap.get(gitPrefixVal + idToRel(n.id))}
    <button class="bs-trow" draggable="true" style="padding-left:{8 + depth * 14}px" onclick={() => { if (editingNodeId !== n.id) openSavedRequest(n); }} ondragstart={(e) => onDragStart(e, n.id)} ondragend={onDragEnd}>
      <span class="bs-mp" style="color:{methodColor(n.protocol === 'grpc' ? 'GRPC' : n.request.method)}">{n.protocol === 'grpc' ? 'RPC' : n.request.method}</span>
      {#if editingNodeId === n.id}<!-- svelte-ignore a11y_autofocus --><input class="bs-nm bs-nm-input" bind:value={editValue} autofocus onpointerdown={(e) => e.stopPropagation()} onclick={(e) => e.stopPropagation()} onkeydown={inlineRenameKeydown} onblur={commitInlineRename} />{:else}<span class="bs-nm">{n.name}</span>{/if}
      {#if st}
        <span class="bs-git-treebadge" style="color:{statusColor(st)}">{st}</span>
      {/if}
      <span class="bs-act" role="button" tabindex="0" title="Request actions" onclick={(e) => { e.stopPropagation(); openMenu('req', e, n.id, false); }} onkeydown={() => {}}><span class="material-symbols-outlined" style="font-size:14px">more_horiz</span></span>
    </button>
  {/if}
{/snippet}

{#if panel === 'git'}
  <GitPanel />
{:else}
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="bs-tree" class:bs-droproot={dragOverId === ''} ondragover={onRootDragOver} ondrop={onRootDrop}>
  {#if panel === 'collections'}
    <div class="bs-sech"><span class="material-symbols-outlined cv" style="font-size:12px">expand_more</span>Collections</div>
    {#if visibleCollections.length === 0}
      <div class="bs-empty" style="padding-left:38px"><p>{filterActive ? 'No matches for the current filter.' : $workspacePath ? 'Empty workspace — add a folder or save a request.' : 'Open a workspace folder to see your collections.'}</p></div>
    {:else}
      {#each visibleCollections as n (n.id)}
        {@render node(n, 0)}
      {/each}
    {/if}
  {:else}
    <div class="bs-sech bs-sech-act">
      <span class="material-symbols-outlined cv" style="font-size:12px">expand_more</span>History
      {#if visibleHistory.length}<span style="color:var(--t3);font-weight:600">{visibleHistory.length}</span>{/if}
      {#if $historyPaused}<span class="bs-paused" title="Recording paused"><span class="material-symbols-outlined" style="font-size:13px">pause_circle</span>paused</span>{/if}
      <span class="bs-act" role="button" tabindex="0" title="History options" onclick={(e) => { e.stopPropagation(); openMenu('history', e); }} onkeydown={() => {}}><span class="material-symbols-outlined" style="font-size:16px">more_horiz</span></span>
    </div>
    {#if visibleHistory.length === 0}
      <div class="bs-empty"><p>{filterActive ? 'No matches for the current filter.' : 'No requests yet. Sent requests appear here.'}</p></div>
    {:else}
      {#each visibleHistory.slice(0, 40) as h (h.id)}
        <button class="bs-trow l2" type="button" title="Open in a new tab" onclick={() => openHistoryEntry(h)}>
          <span class="bs-mp" style="color:{methodColor(h.protocol === 'grpc' ? 'GRPC' : h.request.method)}">{h.protocol === 'grpc' ? 'RPC' : h.request.method}</span>
          <span class="bs-nm" style="font-family:var(--mono);font-size:11.5px">{h.request.url || '—'}</span>
          <span class="bs-tm" style="color:{(h.ok ?? ok(h.status)) ? 'var(--green)' : 'var(--red)'}">{h.protocol === 'grpc' ? (h.ok ? 'OK' : 'ERR') : h.status}</span>
          <span class="bs-act" role="button" tabindex="0" title="Remove" onclick={(e) => { e.stopPropagation(); removeHistoryEntry(h.id); }} onkeydown={() => {}}><span class="material-symbols-outlined" style="font-size:14px">close</span></span>
        </button>
      {/each}
    {/if}
  {/if}
</div>
{/if}

<div class="bs-side-dock">
  <section class="bs-dock-section" class:open={dockSection === 'environments'}>
    <div class="bs-dock-head">
      <button class="bs-dock-toggle" type="button" aria-expanded={dockSection === 'environments'} onclick={() => toggleDock('environments')}>
        <span class="material-symbols-outlined" aria-hidden="true" style="font-size:13px">{dockSection === 'environments' ? 'expand_more' : 'chevron_right'}</span>
        <span>Environments</span>
        <span class="bs-dock-summary">{activeEnvName}</span>
      </button>
      <button class="bs-dock-action" type="button" title="Manage environments" onclick={manageEnvs}><span class="material-symbols-outlined" style="font-size:14px">tune</span></button>
    </div>
    {#if dockSection === 'environments'}
      <div class="bs-dock-body">
        <button class="bs-dock-item" class:on={$activeEnvironmentId === null} type="button" onclick={() => chooseEnv(null)}>
          <span class="material-symbols-outlined" aria-hidden="true" style="font-size:14px">{$activeEnvironmentId === null ? 'check' : 'block'}</span>
          <span>No environment</span>
        </button>
        {#each $environments as environment (environment.id)}
          <button class="bs-dock-item" class:on={$activeEnvironmentId === environment.id} type="button" onclick={() => chooseEnv(environment.id)}>
            <span class="material-symbols-outlined" aria-hidden="true" style="font-size:14px">{$activeEnvironmentId === environment.id ? 'check' : 'layers'}</span>
            <span>{environment.name}</span>
          </button>
        {/each}
      </div>
    {/if}
  </section>

  <section class="bs-dock-section" class:open={dockSection === 'specs'}>
    <div class="bs-dock-head">
      <button class="bs-dock-toggle" type="button" aria-expanded={dockSection === 'specs'} onclick={() => toggleDock('specs')}>
        <span class="material-symbols-outlined" aria-hidden="true" style="font-size:13px">{dockSection === 'specs' ? 'expand_more' : 'chevron_right'}</span><span>Specs</span>
      </button>
    </div>
    {#if dockSection === 'specs'}<div class="bs-dock-empty">Service definitions are managed from request tabs.</div>{/if}
  </section>

  <section class="bs-dock-section" class:open={dockSection === 'flows'}>
    <div class="bs-dock-head">
      <button class="bs-dock-toggle" type="button" aria-expanded={dockSection === 'flows'} onclick={() => toggleDock('flows')}>
        <span class="material-symbols-outlined" aria-hidden="true" style="font-size:13px">{dockSection === 'flows' ? 'expand_more' : 'chevron_right'}</span><span>Flows</span>
      </button>
      <button class="bs-dock-action" type="button" title="New flow" onclick={newFlow}><span class="material-symbols-outlined" style="font-size:14px">add</span></button>
    </div>
    {#if dockSection === 'flows'}
      <div class="bs-dock-body">
        {#if $flows.length === 0}
          <div class="bs-dock-empty">No flows yet.</div>
        {:else}
          {#each $flows as flow (flow.id)}
            <button class="bs-dock-item" type="button" onclick={() => chooseFlow(flow.id)}>
              <span class="material-symbols-outlined" aria-hidden="true" style="font-size:14px">account_tree</span><span>{flow.name}</span>
            </button>
          {/each}
        {/if}
      </div>
    {/if}
  </section>

  {#each [{ id: 'documents', label: 'Documents' }, { id: 'mocks', label: 'Mocks' }] as section (section.id)}
    <section class="bs-dock-section" class:open={dockSection === section.id}>
      <div class="bs-dock-head">
        <button class="bs-dock-toggle" type="button" aria-expanded={dockSection === section.id} onclick={() => toggleDock(section.id as DockSection)}>
          <span class="material-symbols-outlined" aria-hidden="true" style="font-size:13px">{dockSection === section.id ? 'expand_more' : 'chevron_right'}</span><span>{section.label}</span>
        </button>
      </div>
      {#if dockSection === section.id}<div class="bs-dock-empty">Nothing here yet.</div>{/if}
    </section>
  {/each}
</div>

<div class="bs-workspace-strip">
  <button title={$workspacePath || 'Choose workspace folder'} onclick={openWorkspaceFolder}>
    <span class="material-symbols-outlined" style="font-size:13px">folder_open</span>
    <span>{$workspacePath ? $workspacePath.split('/').pop() : 'Open Workspace'}</span>
  </button>
  {#if $workspacePath}
    <div title="Changes are written to disk automatically">
      <span class="material-symbols-outlined" style="font-size:13px">cloud_done</span>
    </div>
  {/if}
</div>
