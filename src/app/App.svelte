<script lang="ts">
  // The composition root: lays out the shell pieces and starts the app lifecycle.
  // State: shell.svelte.ts (menus, dialogs, toast) · layout.svelte.ts (panes) · actions.ts (what they do)
  // · hotkeys.ts (keyboard) · lifecycle.svelte.ts (startup, persistence, appearance).
  import { focusMode } from '$shared/ui';
  import AppToolbar from './AppToolbar.svelte';
  import AppSidebar from './AppSidebar.svelte';
  import AppMain from './AppMain.svelte';
  import AppStatusBar from './AppStatusBar.svelte';
  import AppOverlays from './AppOverlays.svelte';
  import { openTerminal, toggleUtilityPanel } from './actions';
  import { globalKeydown } from './hotkeys';
  import { layout } from './layout.svelte';
  import { startApp } from './lifecycle.svelte';
  import { shell } from './shell.svelte';
  import { openRunnerTab } from '$features/runner';

  startApp();
</script>

<svelte:window
  bind:innerWidth={layout.innerWidth}
  onpointerdown={() => {
    shell.grpcMethodOpen = false;
    shell.httpMethodOpen = false;
    shell.workspaceMenuOpen = false;
  }}
  onkeydown={globalKeydown}
/>

<div
  class="bs"
  class:sidebar-hidden={!layout.sidebarShown}
  data-focus={layout.requestTab && focusMode.current ? focusMode.current : undefined}
>
  <AppToolbar
    bind:workspaceMenuOpen={shell.workspaceMenuOpen}
    onSearch={() => (shell.paletteOpen = true)}
    onSettings={() => (shell.settingsOpen = true)}
  />

  <div class="bs-body">
    <AppSidebar />
    <AppMain />
  </div>

  <AppStatusBar
    onRunner={openRunnerTab}
    utilityMode={shell.utilityMode}
    onTerminal={() => openTerminal()}
    onConsole={() => toggleUtilityPanel('console')}
    onIssues={() => toggleUtilityPanel('issues')}
  />

  <AppOverlays />
</div>

<style>
  .bs-body {
    flex: 1;
    display: flex;
    min-height: 0;
    margin: 10px 0;
    padding: 0;
    gap: 0;
    background: transparent;
  }

  :global(:root[data-density='compact']) .bs-body {
    margin: 8px 0;
  }

  :global(.bs) .bs-body {
    position: relative;
  }
</style>
