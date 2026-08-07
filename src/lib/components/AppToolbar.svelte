<script lang="ts">
  import WorkspaceMenu from './WorkspaceMenu.svelte';

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
  <div class="bs-toolbar-title">Bonk</div>
  <div class="bs-tb-right">
    <button class="bs-ti" title="Settings" onclick={onSettings}><span class="material-symbols-outlined" style="font-size:17px">settings</span></button>
  </div>
</div>
