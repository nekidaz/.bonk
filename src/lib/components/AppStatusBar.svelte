<script lang="ts">
  import { openEnvironmentsTab } from '../stores';
  import type { UtilityMode } from '../domain/appShell';

  let {
    leftOpen,
    bottomOpen,
    rightOpen,
    rightEnabled,
    onToggleLeft,
    onToggleBottom,
    onToggleRight,
    onSettings,
    utilityMode,
    onTerminal,
    onConsole,
  }: {
    leftOpen: boolean;
    bottomOpen: boolean;
    rightOpen: boolean;
    rightEnabled: boolean;
    onToggleLeft: () => void;
    onToggleBottom: () => void;
    onToggleRight: () => void;
    onSettings: () => void;
    utilityMode: UtilityMode | null;
    onTerminal: () => void;
    onConsole: () => void;
  } = $props();
</script>

<div class="bs-status">
  <div class="bs-status-leading">
    <span class="bs-status-mark" title="Workspace tools">
      <span class="material-symbols-outlined" style="font-size:13px">terminal</span>
    </span>
    <button class="bs-status-link" class:on={utilityMode === 'terminal'} type="button" aria-pressed={utilityMode === 'terminal'} onclick={onTerminal}>Terminal</button>
    <button class="bs-status-link" class:on={utilityMode === 'console' || utilityMode === 'issues'} type="button" aria-pressed={utilityMode === 'console' || utilityMode === 'issues'} onclick={onConsole}>Console</button>
  </div>
  <div class="bs-spacer"></div>
  <div class="bs-status-actions">
    <button class="bs-status-link" type="button" title="Manage globals and environments" onclick={openEnvironmentsTab}>Globals</button>
    <button class="bs-status-link" type="button" title="Open settings" onclick={onSettings}>Tools</button>
    <button class="bs-status-icon" type="button" title="Open settings" aria-label="Open settings" onclick={onSettings}>
      <span class="material-symbols-outlined" style="font-size:13px">tune</span>
    </button>
    <div class="bs-layout bs-layout-sb">
      <button class="bs-lt" class:on={leftOpen} title="Toggle sidebar" aria-label="Toggle sidebar" aria-pressed={leftOpen} onclick={onToggleLeft}><span class="material-symbols-outlined" style="font-size:14px">left_panel_open</span></button>
      <button class="bs-lt" class:on={bottomOpen} title="Toggle response panel" aria-label="Toggle response panel" aria-pressed={bottomOpen} onclick={onToggleBottom}><span class="material-symbols-outlined" style="font-size:14px">bottom_panel_open</span></button>
      <button
        class="bs-lt"
        class:on={rightOpen}
        title={rightEnabled ? 'Toggle code panel' : 'Code snippets are available for request tabs'}
        aria-label="Toggle code panel"
        aria-pressed={rightOpen}
        disabled={!rightEnabled}
        onclick={onToggleRight}
      ><span class="material-symbols-outlined" style="font-size:14px">right_panel_open</span></button>
    </div>
  </div>
</div>
