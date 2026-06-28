<script lang="ts">
  import WorkspaceMenu from './WorkspaceMenu.svelte';
  import { theme, toggleTheme } from '../theme';

  let {
    workspaceMenuOpen = $bindable(),
    onSettings,
  }: {
    workspaceMenuOpen: boolean;
    onSettings: () => void;
  } = $props();
</script>

<div class="bs-tb" data-tauri-drag-region style="padding-left:92px">
  <div class="bs-tb-left">
    <WorkspaceMenu bind:open={workspaceMenuOpen} />
  </div>
  <div class="bs-search"><span class="material-symbols-outlined" style="font-size:14px">search</span>Search Workspace</div>
  <div class="bs-tb-right">
    <button class="bs-ti" title="Toggle theme" onclick={toggleTheme}><span class="material-symbols-outlined" style="font-size:17px">{$theme === 'dark' ? 'light_mode' : 'dark_mode'}</span></button>
    <button class="bs-ti" title="Settings" onclick={onSettings}><span class="material-symbols-outlined" style="font-size:17px">settings</span></button>
  </div>
</div>
