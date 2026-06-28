<script lang="ts">
  import WorkspaceMenu from './WorkspaceMenu.svelte';
  import { theme, toggleTheme } from '../theme';

  let {
    workspaceMenuOpen = $bindable(),
    onSettings,
    leftOpen,
    bottomOpen,
    rightOpen,
    onToggleLeft,
    onToggleBottom,
    onToggleRight,
  }: {
    workspaceMenuOpen: boolean;
    onSettings: () => void;
    leftOpen: boolean;
    bottomOpen: boolean;
    rightOpen: boolean;
    onToggleLeft: () => void;
    onToggleBottom: () => void;
    onToggleRight: () => void;
  } = $props();
</script>

<div class="bs-tb" data-tauri-drag-region style="padding-left:92px">
  <div class="bs-tb-left">
    <WorkspaceMenu bind:open={workspaceMenuOpen} />
  </div>
  <div class="bs-search"><span class="material-symbols-outlined" style="font-size:14px">search</span>Search Workspace</div>
  <div class="bs-tb-right">
    <div class="bs-layout">
      <button class="bs-lt" class:on={leftOpen} title="Toggle sidebar" aria-pressed={leftOpen} onclick={onToggleLeft}><span class="material-symbols-outlined" style="font-size:16px">left_panel_open</span></button>
      <button class="bs-lt" class:on={bottomOpen} title="Toggle response panel" aria-pressed={bottomOpen} onclick={onToggleBottom}><span class="material-symbols-outlined" style="font-size:16px">bottom_panel_open</span></button>
      <button class="bs-lt" class:on={rightOpen} title="Toggle code panel" aria-pressed={rightOpen} onclick={onToggleRight}><span class="material-symbols-outlined" style="font-size:16px">right_panel_open</span></button>
    </div>
    <button class="bs-ti" title="Toggle theme" onclick={toggleTheme}><span class="material-symbols-outlined" style="font-size:17px">{$theme === 'dark' ? 'light_mode' : 'dark_mode'}</span></button>
    <button class="bs-ti" title="Settings" onclick={onSettings}><span class="material-symbols-outlined" style="font-size:17px">settings</span></button>
  </div>
</div>
