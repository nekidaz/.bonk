<script lang="ts">
  import {
    activeTabId,
    closeTab,
    newTab,
    duplicateTab,
    closeOtherTabs,
    closeAllTabs,
    tabs,
  } from '../stores';
  import { methodColor } from '../domain/method';
  import type { Tab } from '../domain/types';

  let {
    onNew,
  }: {
    onNew: (e: MouseEvent) => void;
  } = $props();

  // The tab strip scrolls horizontally so many open tabs can never push the
  // Runner / environment / sidebar controls out of the window. Keep the active
  // tab visible when it changes (new tab, tab switch).
  let tabsScrollEl = $state<HTMLDivElement | null>(null);
  $effect(() => {
    const id = $activeTabId;
    tabsScrollEl
      ?.querySelector(`[data-tab-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  });

  // Vertical mouse-wheel over the strip scrolls it horizontally (trackpads
  // already produce deltaX natively). Attached manually because Svelte wheel
  // attributes are passive — preventDefault would be ignored, and without it
  // the page behind would rubber-band.
  $effect(() => {
    const el = tabsScrollEl;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  // Right-click context menu on a tab (Postman-style). Position is clamped to
  // the viewport; App's window pointerdown closes it (the menu itself stops
  // pointer-down propagation), Escape closes it too.
  const CTX_MENU_WIDTH = 240;
  let ctxMenu = $state<{ x: number; y: number; tabId: string } | null>(null);
  function openTabContext(e: MouseEvent, tabId: string): void {
    e.preventDefault();
    e.stopPropagation();
    ctxMenu = {
      x: Math.min(e.clientX, window.innerWidth - CTX_MENU_WIDTH - 8),
      y: e.clientY,
      tabId,
    };
  }
  // Snapshot the target tab id BEFORE nulling ctxMenu: the menu template must
  // never read ctxMenu after it's cleared (a {@const ctxMenu.tabId} would be
  // re-evaluated against null during the teardown flush and throw).
  function ctxAction(fn: (tabId: string) => void): void {
    if (!ctxMenu) return;
    const id = ctxMenu.tabId;
    ctxMenu = null;
    fn(id);
  }

  function tabMethodLabel(t: Tab): string {
    if (t.protocol === 'grpc') return 'gRPC';
    if (t.protocol === 'git') return 'DIFF';
    if (t.protocol === 'env') return 'ENV';
    if (t.protocol === 'runner') return 'RUN';
    if (t.protocol === 'flow') return 'FLOW';
    return t.request.method;
  }

  function tabMethodColor(t: Tab): string {
    if (t.protocol !== 'http' && t.protocol !== 'grpc') return 'var(--accent)';
    return methodColor(t.protocol === 'grpc' ? 'GRPC' : t.request.method);
  }
</script>

<svelte:window
  onpointerdown={() => { ctxMenu = null; }}
  onkeydown={(e) => { if (e.key === 'Escape' && ctxMenu) { e.preventDefault(); ctxMenu = null; } }}
/>

<div class="bs-tabbar">
  <div class="bs-tabs-scroll" bind:this={tabsScrollEl} role="presentation" oncontextmenu={(e) => openTabContext(e, $activeTabId)}>
    {#each $tabs as t (t.id)}
      <div class="bs-tab" class:on={t.id === $activeTabId} role="presentation" data-tab-id={t.id} oncontextmenu={(e) => openTabContext(e, t.id)}>
        <button class="bs-tab-hit" role="tab" aria-selected={t.id === $activeTabId} type="button" onclick={() => activeTabId.set(t.id)}>
          <span class="m" style="color:{tabMethodColor(t)}">{tabMethodLabel(t)}</span>
          <span class="bs-nm">{t.title}</span>
        </button>
        <button class="x" aria-label="Close" onclick={(e) => { e.stopPropagation(); closeTab(t.id); }}><span class="material-symbols-outlined" style="font-size:13px">close</span></button>
      </div>
    {/each}
    <button class="bs-addt" title="New" onclick={onNew}><span class="material-symbols-outlined" style="font-size:18px">add</span></button>
  </div>
</div>

{#if ctxMenu}
  <div class="bs-tab-ctx" style="left:{ctxMenu.x}px;top:{ctxMenu.y}px" role="presentation" onpointerdown={(e) => e.stopPropagation()}>
    <button class="bs-tab-ctx-item" type="button" onclick={() => ctxAction(() => newTab())}>
      <span class="text">New Request</span><span class="sc">⌘T</span>
    </button>
    <button class="bs-tab-ctx-item" type="button" onclick={() => ctxAction((id) => duplicateTab(id))}>
      <span class="text">Duplicate Tab</span>
    </button>
    <div class="bs-tab-ctx-sep"></div>
    <button class="bs-tab-ctx-item" type="button" onclick={() => ctxAction((id) => closeTab(id))}>
      <span class="text">Close Tab</span><span class="sc">⌘W</span>
    </button>
    <button class="bs-tab-ctx-item" type="button" onclick={() => ctxAction((id) => closeOtherTabs(id))}>
      <span class="text">Close Other Tabs</span>
    </button>
    <button class="bs-tab-ctx-item" type="button" onclick={() => ctxAction(() => closeAllTabs())}>
      <span class="text">Close All Tabs</span>
    </button>
  </div>
{/if}

<style>
  .bs-tab-ctx {
    position: fixed;
    min-width: 240px;
    background: var(--surface);
    border: 0.5px solid var(--sep);
    border-radius: 10px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
    padding: 5px;
    z-index: 60;
  }
  .bs-tab-ctx-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 9px;
    border-radius: 7px;
    font-size: 13px;
    color: var(--text);
    text-align: left;
  }
  .bs-tab-ctx-item:hover { background: var(--hover); }
  .bs-tab-ctx-item .text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bs-tab-ctx-item .sc { color: var(--t3); font-size: 12px; letter-spacing: 0.08em; }
  .bs-tab-ctx-sep { height: 0.5px; background: var(--sepsoft); margin: 5px 4px; }
</style>
