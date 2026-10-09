<script lang="ts">
  import {
    activeTabId,
    requestCloseTab,
    newTab,
    duplicateTab,
    closeOtherTabs,
    closeAllTabs,
    moveTab,
    tabs,
    dirtyTabIds,
  } from '../stores';
  import { methodColor } from '../domain/method';
  import { HTTP_DEFAULT_TITLE } from '../domain/tab';
  import type { Tab } from '../domain/types';
  import { t } from '../i18n';

  let {
    onNew,
  }: {
    onNew: (e: MouseEvent) => void;
  } = $props();

  // The tab strip scrolls horizontally so many open tabs can never push the
  // Runner / environment / sidebar controls out of the window. Keep the active
  // tab visible when it or the strip changes (new tab, switch, close, reorder).
  let tabsScrollEl = $state<HTMLDivElement | null>(null);
  $effect(() => {
    const id = $activeTabId;
    void $tabs.length;
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

  // Mono: a method is text; protocols without one get an icon instead of a caps badge.
  const TAB_ICON: Partial<Record<Tab['protocol'], string>> = { git: 'difference', env: 'layers', runner: 'play_arrow', flow: 'account_tree' };

  function tabMethodLabel(t: Tab): string {
    return t.protocol === 'grpc' ? 'gRPC' : t.request.method;
  }

  // Full name (+ URL) on hover, since long titles are ellipsized.
  function tabTooltip(t: Tab): string {
    const url = t.protocol === 'http' ? t.request.url : t.protocol === 'grpc' ? t.grpc?.endpoint : '';
    return url ? `${t.title}\n${url}` : t.title;
  }

  // Drag-reorder: tabs move live under the pointer, like browser tabs.
  let dragTabId = $state<string | null>(null);
  function onTabDragEnter(index: number): void {
    if (dragTabId) moveTab(dragTabId, index);
  }

  function tabMethodColor(t: Tab): string {
    return methodColor(t.protocol === 'grpc' ? 'GRPC' : t.request.method);
  }
</script>

<svelte:window
  onpointerdown={() => { ctxMenu = null; }}
  onkeydown={(e) => { if (e.key === 'Escape' && ctxMenu) { e.preventDefault(); ctxMenu = null; } }}
/>

<div class="bs-tabbar">
  <div
    class="bs-tabs-scroll"
    bind:this={tabsScrollEl}
    role="presentation"
    oncontextmenu={(e) => openTabContext(e, $activeTabId)}
    ondblclick={(e) => { if (e.target === e.currentTarget) newTab(); }}
  >
    {#each $tabs as tb, i (tb.id)}
      <div
        class="bs-tab"
        class:on={tb.id === $activeTabId}
        class:wide={tb.protocol === 'runner'}
        class:dragging={dragTabId === tb.id}
        role="presentation"
        data-tab-id={tb.id}
        draggable="true"
        oncontextmenu={(e) => openTabContext(e, tb.id)}
        onauxclick={(e) => { if (e.button === 1) { e.preventDefault(); void requestCloseTab(tb.id); } }}
        ondragstart={(e) => { dragTabId = tb.id; if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; }}
        ondragenter={() => onTabDragEnter(i)}
        ondragover={(e) => { if (dragTabId) e.preventDefault(); }}
        ondragend={() => (dragTabId = null)}
      >
        <button class="bs-tab-hit" role="tab" aria-selected={tb.id === $activeTabId} type="button" title={tabTooltip(tb)} onclick={() => activeTabId.set(tb.id)}>
          {#if TAB_ICON[tb.protocol]}
            <span class="mi material-symbols-outlined" aria-hidden="true">{TAB_ICON[tb.protocol]}</span>
          {:else}
            <span class="m" style="color:{tabMethodColor(tb)}">{tabMethodLabel(tb)}</span>
          {/if}
          <span class="bs-nm">{tb.title === HTTP_DEFAULT_TITLE ? $t('tabs.untitled') : tb.title}</span>
        </button>
        <button class="x" class:dirty={$dirtyTabIds.has(tb.id)} aria-label={$dirtyTabIds.has(tb.id) ? $t('tabs.closeTabUnsaved') : $t('tabs.closeTab')} title={$t('tabs.close')} onclick={(e) => { e.stopPropagation(); void requestCloseTab(tb.id); }}><span class="material-symbols-outlined close" style="font-size:13px">close</span><span class="material-symbols-outlined dot" aria-hidden="true">fiber_manual_record</span></button>
      </div>
    {/each}
    <button class="bs-addt" title={$t('tabs.newRequestHint')} aria-label={$t('tabs.newRequest')} onclick={onNew}><span class="material-symbols-outlined" style="font-size:18px">add</span></button>
  </div>
</div>

{#if ctxMenu}
  <div class="bs-tab-ctx" style="left:{ctxMenu.x}px;top:{ctxMenu.y}px" role="presentation" onpointerdown={(e) => e.stopPropagation()}>
    <button class="bs-tab-ctx-item" type="button" onclick={() => ctxAction(() => newTab())}>
      <span class="text">{$t('tabs.ctxNew')}</span><span class="sc">⌘T</span>
    </button>
    <button class="bs-tab-ctx-item" type="button" onclick={() => ctxAction((id) => duplicateTab(id))}>
      <span class="text">{$t('tabs.ctxDuplicate')}</span>
    </button>
    <div class="bs-tab-ctx-sep"></div>
    <button class="bs-tab-ctx-item" type="button" onclick={() => ctxAction((id) => void requestCloseTab(id))}>
      <span class="text">{$t('tabs.ctxClose')}</span><span class="sc">⌘W</span>
    </button>
    <button class="bs-tab-ctx-item" type="button" onclick={() => ctxAction((id) => closeOtherTabs(id))}>
      <span class="text">{$t('tabs.ctxCloseOthers')}</span>
    </button>
    <button class="bs-tab-ctx-item" type="button" onclick={() => ctxAction(() => closeAllTabs())}>
      <span class="text">{$t('tabs.ctxCloseAll')}</span>
    </button>
  </div>
{/if}

<style>
  /* S36: "Runner · <scope>" gets a wider tab. */
  .bs-tab.wide { flex-basis: 200px; width: 200px; max-width: 200px; }
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
