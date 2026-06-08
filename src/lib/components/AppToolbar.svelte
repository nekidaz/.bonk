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

<div class="bs-tb" data-tauri-drag-region style="padding-left:78px">
  <div class="bs-nav">
    <button class="b"><span class="material-symbols-outlined" style="font-size:18px">chevron_left</span></button>
    <button class="b dim"><span class="material-symbols-outlined" style="font-size:18px">chevron_right</span></button>
    <button class="b bs-home"><span class="material-symbols-outlined" style="font-size:18px">home</span><span class="material-symbols-outlined" style="font-size:12px;color:var(--t3)">expand_more</span></button>
  </div>
  <WorkspaceMenu bind:open={workspaceMenuOpen} />
  <div class="bs-search"><span class="material-symbols-outlined" style="font-size:14px">search</span>Search Workspace</div>
  <button class="bs-ti" title="Toggle theme" onclick={toggleTheme}><span class="material-symbols-outlined" style="font-size:17px">{$theme === 'dark' ? 'light_mode' : 'dark_mode'}</span></button>
  <button class="bs-ti" title="Settings" onclick={onSettings}><span class="material-symbols-outlined" style="font-size:17px">settings</span></button>
</div>
