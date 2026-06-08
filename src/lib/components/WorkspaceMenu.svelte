<script lang="ts">
  import {
    workspacePath,
    recentWorkspacePaths,
    openWorkspaceFolder,
    switchWorkspace,
  } from '../stores';

  // Two-way bound from the parent so close-on-outside-click (handled by App's
  // window pointerdown listener) keeps working without new logic here.
  let { open = $bindable() }: { open: boolean } = $props();

  function workspaceDisplayName(path: string): string {
    return path.split('/').filter(Boolean).at(-1) ?? 'Local Workspace';
  }

  function recentWorkspaceChoices(paths: string[], current: string): string[] {
    return paths.filter((p) => p && p !== current).slice(0, 8);
  }

  async function chooseWorkspace(path: string): Promise<void> {
    open = false;
    await switchWorkspace(path);
  }

  async function chooseWorkspaceFolder(): Promise<void> {
    open = false;
    await openWorkspaceFolder();
  }
</script>

<div class="bs-work-wrap" role="presentation" onpointerdown={(e) => e.stopPropagation()}>
  <button
    class="bs-work"
    class:open
    title={$workspacePath || 'Local Workspace'}
    onclick={() => (open = !open)}
  >
    <span class="material-symbols-outlined" style="font-size:13px">lock</span>
    <span class="bs-work-title">{$workspacePath ? workspaceDisplayName($workspacePath) : 'Local Workspace'}</span>
    <span class="material-symbols-outlined" style="font-size:13px">expand_more</span>
  </button>
  {#if open}
    <div class="bs-work-menu">
      <div class="bs-work-menu-title">Workspace</div>
      {#if $workspacePath}
        <button class="bs-work-item on" type="button" title={$workspacePath} onclick={() => (open = false)}>
          <span class="material-symbols-outlined" style="font-size:16px">check</span>
          <span class="text">
            <span class="main">{workspaceDisplayName($workspacePath)}</span>
            <span class="sub">{$workspacePath}</span>
          </span>
        </button>
      {:else}
        <div class="bs-work-empty">No workspace folder selected.</div>
      {/if}

      {#if recentWorkspaceChoices($recentWorkspacePaths, $workspacePath).length > 0}
        <div class="bs-work-menu-label">Recent</div>
        {#each recentWorkspaceChoices($recentWorkspacePaths, $workspacePath) as path (path)}
          <button class="bs-work-item" type="button" title={path} onclick={() => chooseWorkspace(path)}>
            <span class="material-symbols-outlined" style="font-size:16px">folder_open</span>
            <span class="text">
              <span class="main">{workspaceDisplayName(path)}</span>
              <span class="sub">{path}</span>
            </span>
          </button>
        {/each}
      {/if}

      <div class="bs-work-menu-sep"></div>
      <button class="bs-work-item action" type="button" onclick={chooseWorkspaceFolder}>
        <span class="material-symbols-outlined" style="font-size:16px">add</span>
        <span class="text">
          <span class="main">Open Workspace Folder...</span>
        </span>
      </button>
    </div>
  {/if}
</div>
