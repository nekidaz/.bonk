<script lang="ts">
  import { activeTabId, closeTab, tabs } from '../stores';
  import { methodColor } from '../domain/method';
  import type { Tab } from '../domain/types';

  let {
    sidebarHidden = $bindable(),
    onNew,
  }: {
    sidebarHidden: boolean;
    onNew: (e: MouseEvent) => void;
  } = $props();

  function tabMethodLabel(t: Tab): string {
    if (t.protocol === 'grpc') return 'gRPC';
    if (t.protocol === 'git') return 'DIFF';
    return t.request.method;
  }

  function tabMethodColor(t: Tab): string {
    if (t.protocol === 'git') return 'var(--accent)';
    return methodColor(t.protocol === 'grpc' ? 'GRPC' : t.request.method);
  }
</script>

<div class="bs-tabbar">
  {#each $tabs as t (t.id)}
    <div class="bs-tab" class:on={t.id === $activeTabId} role="presentation">
      <button class="bs-tab-hit" role="tab" aria-selected={t.id === $activeTabId} type="button" onclick={() => activeTabId.set(t.id)}>
        <span class="m" style="color:{tabMethodColor(t)}">{tabMethodLabel(t)}</span>
        <span class="bs-nm">{t.title}</span>
      </button>
      <button class="x" aria-label="Close" onclick={(e) => { e.stopPropagation(); closeTab(t.id); }}><span class="material-symbols-outlined" style="font-size:13px">close</span></button>
    </div>
  {/each}
  <button class="bs-addt" title="New" onclick={onNew}><span class="material-symbols-outlined" style="font-size:18px">add</span></button>
  <div class="bs-spacer"></div>
  <div class="bs-envsel">No environment <span class="material-symbols-outlined" style="font-size:13px">expand_more</span></div>
  <button class="bs-tbi" title={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'} onclick={() => (sidebarHidden = !sidebarHidden)}><span class="material-symbols-outlined" style="font-size:15px">view_sidebar</span></button>
</div>
