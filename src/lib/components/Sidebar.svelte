<script lang="ts">
  /**
   * Inner content of the sidebar (everything inside `.bs-side`):
   *  - the rail row (icons + the "hide sidebar" button),
   *  - the filter row (Filter box + New (＋) + ⋯ actions),
   *  - the Collections section with the recursive `node` snippet
   *    (folder/request rows, inline-rename input, per-row ⋯ actions),
   *  - the History section (header with count/paused + ⋯, list rows with a
   *    remove button, and the empty state),
   *  - the footer (workspace folder button / "Open Workspace" + the static rows).
   *
   * The outer `<aside class="bs-side" style="width:…">` wrapper, the column
   * resize handle, and the sidebar width/resize state live in App.svelte
   * (resize state is App-level). This component is presentational: it reads the
   * stores it renders directly and coordinates menus/inline-rename/hide through
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
  } from '../stores';
  import { methodColor } from '../domain/method';
  import type { TreeNode } from '../domain/types';
  import GitPanel from './GitPanel.svelte';
  import { gitStatus, gitStatusMap, gitPrefix, GIT_ENABLED } from '../git';
  import { folderChangeCount, statusColor } from '../domain/gitStatus';
  import { idToRel } from '../domain/tree';

  type MenuKind = 'create' | 'switch' | 'coll' | 'req' | 'history';

  let {
    openMenu,
    editingNodeId,
    editValue = $bindable(),
    commitInlineRename,
    inlineRenameKeydown,
    onHide,
  }: {
    openMenu: (kind: MenuKind, e: MouseEvent, nodeId?: string, isFolder?: boolean) => void;
    editingNodeId: string | undefined;
    editValue: string;
    commitInlineRename: () => void;
    inlineRenameKeydown: (e: KeyboardEvent) => void;
    onHide: () => void;
  } = $props();

  const ok = (s: number) => s >= 200 && s < 300;

  // Which rail panel is shown in the body. Collections by default; History has
  // its own tab (the clock rail icon) instead of stacking under Collections.
  let panel = $state<'collections' | 'history' | 'git'>('collections');

  const gitFiles = $derived($gitStatus?.files ?? []);
  const statusMap = $derived($gitStatusMap);
  // Status paths are toplevel-relative; node ids are workspace-relative. When
  // the workspace is a repo subdir, prefix maps one to the other (empty = same).
  const gitPrefixVal = $derived($gitPrefix);
</script>

<div class="bs-railrow">
  <button class="bs-ri" class:on={panel === 'collections'} title="Collections" onclick={() => (panel = 'collections')}><span class="material-symbols-outlined" style="font-size:17px">deployed_code</span></button>
  <button class="bs-ri"><span class="material-symbols-outlined" style="font-size:17px">terminal</span></button>
  <button class="bs-ri" class:on={panel === 'history'} title="History" onclick={() => (panel = 'history')}><span class="material-symbols-outlined" style="font-size:17px">history</span></button>
  {#if GIT_ENABLED}
    <button class="bs-ri" class:on={panel === 'git'} title="Source control" onclick={() => (panel = 'git')}><span class="material-symbols-outlined" style="font-size:17px">account_tree</span></button>
  {/if}
  <div class="bs-rdiv"></div>
  <div class="bs-spacer"></div>
  <button class="bs-ri" title="Hide sidebar" onclick={onHide}><span class="material-symbols-outlined" style="font-size:17px">view_sidebar</span></button>
</div>
<div class="bs-filterrow">
  <div class="bs-fbox"><span class="material-symbols-outlined" style="font-size:13px">filter_alt</span>Filter</div>
  <button class="bs-fi" title="New" onclick={(e) => openMenu('create', e)}><span class="material-symbols-outlined" style="font-size:15px">add</span></button>
  <button class="bs-fi"><span class="material-symbols-outlined" style="font-size:15px">edit_square</span></button>
  <button class="bs-fi" onclick={(e) => openMenu('coll', e)}><span class="material-symbols-outlined" style="font-size:15px">more_horiz</span></button>
</div>

{#snippet node(n: TreeNode, depth: number)}
  {#if n.kind === 'folder'}
    {@const changed = folderChangeCount(gitPrefixVal + idToRel(n.id), gitFiles)}
    <button class="bs-trow" style="padding-left:{8 + depth * 14}px" onclick={() => { if (editingNodeId !== n.id) toggleFolder(n.id); }}>
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
    <button class="bs-trow" style="padding-left:{8 + depth * 14}px" onclick={() => { if (editingNodeId !== n.id) openSavedRequest(n); }}>
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
<div class="bs-tree">
  {#if panel === 'collections'}
    <div class="bs-sech"><span class="material-symbols-outlined cv" style="font-size:12px">expand_more</span>Collections</div>
    {#if $collections.length === 0}
      <div class="bs-empty" style="padding-left:38px"><p>{$workspacePath ? 'Empty workspace — add a folder or save a request.' : 'Open a workspace folder to see your collections.'}</p></div>
    {:else}
      {#each $collections as n (n.id)}
        {@render node(n, 0)}
      {/each}
    {/if}
  {:else}
    <div class="bs-sech bs-sech-act">
      <span class="material-symbols-outlined cv" style="font-size:12px">expand_more</span>History
      {#if $history.length}<span style="color:var(--t3);font-weight:600">{$history.length}</span>{/if}
      {#if $historyPaused}<span class="bs-paused" title="Recording paused"><span class="material-symbols-outlined" style="font-size:13px">pause_circle</span>paused</span>{/if}
      <span class="bs-act" role="button" tabindex="0" title="History options" onclick={(e) => { e.stopPropagation(); openMenu('history', e); }} onkeydown={() => {}}><span class="material-symbols-outlined" style="font-size:16px">more_horiz</span></span>
    </div>
    {#if $history.length === 0}
      <div class="bs-empty"><p>No requests yet. Sent requests appear here.</p></div>
    {:else}
      {#each $history.slice(0, 40) as h (h.id)}
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

<div class="bs-sfoot">
  <button class="bs-ffold workspace" title={$workspacePath || 'Choose workspace folder'} onclick={openWorkspaceFolder}>
    <span class="material-symbols-outlined" style="font-size:13px">folder_open</span>
    {$workspacePath ? $workspacePath.split('/').pop() : 'Open Workspace'}
  </button>
  {#if $workspacePath}
    <div class="bs-ffold workspace muted" title="Changes are written to disk automatically">
      <span class="material-symbols-outlined" style="font-size:13px">cloud_done</span>Saved as files
    </div>
  {/if}
  <button class="bs-ffold"><span class="material-symbols-outlined" style="font-size:12px">chevron_right</span>Environments</button>
  <button class="bs-ffold"><span class="material-symbols-outlined" style="font-size:12px">chevron_right</span>Specs</button>
  <button class="bs-ffold"><span class="material-symbols-outlined" style="font-size:12px">chevron_right</span>Flows</button>
</div>
