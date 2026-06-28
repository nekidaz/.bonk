<script lang="ts">
  import { tabs } from '../stores';
  import { GIT_ENABLED } from '../git';

  let {
    leftOpen,
    bottomOpen,
    rightOpen,
    onToggleLeft,
    onToggleBottom,
    onToggleRight,
  }: {
    leftOpen: boolean;
    bottomOpen: boolean;
    rightOpen: boolean;
    onToggleLeft: () => void;
    onToggleBottom: () => void;
    onToggleRight: () => void;
  } = $props();
</script>

<div class="bs-status">
  {#if GIT_ENABLED}<div class="it"><span class="material-symbols-outlined" style="font-size:14px">commit</span>Connect Git</div>{/if}
  <div class="bs-spacer"></div>
  <div class="it">{$tabs.length} tab{$tabs.length === 1 ? '' : 's'}</div>
  <div class="bs-layout bs-layout-sb">
    <button class="bs-lt" class:on={leftOpen} title="Toggle sidebar" aria-pressed={leftOpen} onclick={onToggleLeft}><span class="material-symbols-outlined" style="font-size:14px">left_panel_open</span></button>
    <button class="bs-lt" class:on={bottomOpen} title="Toggle response panel" aria-pressed={bottomOpen} onclick={onToggleBottom}><span class="material-symbols-outlined" style="font-size:14px">bottom_panel_open</span></button>
    <button class="bs-lt" class:on={rightOpen} title="Toggle code panel" aria-pressed={rightOpen} onclick={onToggleRight}><span class="material-symbols-outlined" style="font-size:14px">right_panel_open</span></button>
  </div>
</div>
