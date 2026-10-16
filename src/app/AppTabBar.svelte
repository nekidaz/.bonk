<!--
  The tab strip above the request: one button per open tab (method colour, title, unsaved dot, pin),
  drag to reorder, the overflow menu and «+». Tab actions live in features/tabs; the list is `tabs.list`.
-->
<script lang="ts">
  import { tabs, HTTP_DEFAULT_TITLE } from '$entities/tab';
  import { requestCloseTab, newTab, moveTab, togglePinTab } from '$features/tabs';
  import { dirtyTabIds } from '$entities/request';
  import { methodColor, methodLabel, type Tab } from '$shared/model';
  import { t } from '$shared/i18n';
  import { Menu, Backdrop } from '$shared/ui/components';

  let {
    onNew,
    onContext,
    onTabKey,
  }: {
    onNew: (e: MouseEvent) => void;
    /** S17b: right-click on a tab (the strip's empty space targets the active tab). */
    onContext: (e: MouseEvent, tabId: string) => void;
    /** F2 / ⌘D / ⌥⌘C on a focused tab, like on a focused tree row. */
    onTabKey: (e: KeyboardEvent, tabId: string) => void;
  } = $props();

  // The tab strip scrolls horizontally so many open tabs can never push the
  // Runner / environment / sidebar controls out of the window. Keep the active
  // tab visible when it or the strip changes (new tab, switch, close, reorder).
  let tabsScrollEl = $state<HTMLDivElement | null>(null);
  function revealActive(): void {
    tabsScrollEl
      ?.querySelector(`[data-tab-id="${CSS.escape(tabs.activeId)}"]`)
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }
  $effect(() => {
    void tabs.activeId;
    void tabs.list.length;
    revealActive();
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

  // Mono: a method is text; protocols without one get an icon instead of a caps badge.
  const TAB_ICON: Partial<Record<Tab['protocol'], string>> = {
    git: 'difference',
    env: 'layers',
    runner: 'play_arrow',
    settings: 'settings',
  };
  const GIT_VIEW_ICON: Record<string, string> = {
    stash: 'inventory_2',
    commit: 'commit',
    graph: 'account_tree',
    conflicts: 'warning',
    merge: 'merge',
    history: 'history',
    compare: 'compare_arrows',
    reflog: 'manage_history',
  };
  const tabIcon = (tb: Tab): string | undefined => GIT_VIEW_ICON[tb.git?.view ?? ''] ?? TAB_ICON[tb.protocol];

  function tabMethodLabel(t: Tab): string {
    return t.protocol === 'grpc' ? 'gRPC' : t.request.method;
  }

  // Full name (+ URL) on hover, since long titles are ellipsized.
  function tabTooltip(t: Tab): string {
    const url = t.protocol === 'http' ? t.request.url : t.protocol === 'grpc' ? t.grpc?.endpoint : '';
    return url ? `${t.title}\n${url}` : t.title;
  }

  // Flow · Размеры окна: tabs that don't fit the strip are listed behind «+N».
  let overflowIds = $state.raw<string[]>([]);
  let overflowMenu = $state<{ x: number; y: number } | null>(null);
  const overflowTabs = $derived(tabs.list.filter((tb) => overflowIds.includes(tb.id)));
  // A tab cut by the strip edge fades out instead of ending in a hard cut.
  let fadeL = $state(false);
  let fadeR = $state(false);
  function measureOverflow(): void {
    const el = tabsScrollEl;
    if (!el) return;
    fadeL = el.scrollLeft > 1;
    fadeR = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    const box = el.getBoundingClientRect();
    overflowIds = [...el.querySelectorAll<HTMLElement>('.bs-tab')]
      .filter((tab) => {
        const r = tab.getBoundingClientRect();
        return r.left < box.left - 1 || r.right > box.right + 1;
      })
      .map((tab) => tab.dataset.tabId ?? '');
  }
  $effect(() => {
    const el = tabsScrollEl;
    if (!el) return;
    void tabs.list;
    measureOverflow();
    const ro = new ResizeObserver(() => {
      revealActive();
      measureOverflow();
    });
    ro.observe(el);
    return () => ro.disconnect();
  });
  function openOverflow(e: MouseEvent): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    overflowMenu = { x: Math.min(r.left, window.innerWidth - 248), y: r.bottom + 4 };
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

<div
  class="bs-tabbar"
  role="presentation"
  oncontextmenu={(e) => onContext(e, tabs.activeId)}
  ondblclick={(e) => {
    if (e.target === e.currentTarget || e.target === tabsScrollEl) newTab();
  }}
>
  <div
    class="bs-tabs-scroll"
    class:fade-l={fadeL}
    class:fade-r={fadeR}
    bind:this={tabsScrollEl}
    role="presentation"
    onscroll={measureOverflow}
  >
    {#each tabs.list as tb, i (tb.id)}
      <div
        class="bs-tab"
        class:on={tb.id === tabs.activeId}
        class:wide={tb.protocol === 'runner'}
        class:dragging={dragTabId === tb.id}
        role="presentation"
        data-tab-id={tb.id}
        draggable="true"
        oncontextmenu={(e) => onContext(e, tb.id)}
        onauxclick={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            void requestCloseTab(tb.id);
          }
        }}
        ondragstart={(e) => {
          dragTabId = tb.id;
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        }}
        ondragenter={() => onTabDragEnter(i)}
        ondragover={(e) => {
          if (dragTabId) e.preventDefault();
        }}
        ondragend={() => (dragTabId = null)}
      >
        <button
          class="bs-tab-hit"
          role="tab"
          aria-selected={tb.id === tabs.activeId}
          type="button"
          title={tabTooltip(tb)}
          onclick={() => (tabs.activeId = tb.id)}
          onkeydown={(e) => onTabKey(e, tb.id)}
        >
          {#if tabIcon(tb)}
            <span class="mi material-symbols-outlined" aria-hidden="true">{tabIcon(tb)}</span>
          {:else}
            <span class="m" style="color:{tabMethodColor(tb)}">{tabMethodLabel(tb)}</span>
          {/if}
          <span class="bs-nm">{tb.title === HTTP_DEFAULT_TITLE ? t('tabs.untitled') : tb.title}</span>
        </button>
        {#if tb.pinned}
          <button
            class="x pin"
            aria-label={t('tabs.ctxUnpin')}
            title={t('tabs.ctxUnpin')}
            onclick={(e) => {
              e.stopPropagation();
              togglePinTab(tb.id);
            }}><span class="material-symbols-outlined" style="font-size:13px">keep</span></button
          >
        {:else}
          <button
            class="x"
            class:dirty={dirtyTabIds.current.has(tb.id)}
            aria-label={dirtyTabIds.current.has(tb.id) ? t('tabs.closeTabUnsaved') : t('tabs.closeTab')}
            title={t('tabs.close')}
            onclick={(e) => {
              e.stopPropagation();
              void requestCloseTab(tb.id);
            }}
            ><span class="material-symbols-outlined close" style="font-size:13px">close</span><span
              class="material-symbols-outlined dot"
              aria-hidden="true">fiber_manual_record</span
            ></button
          >
        {/if}
      </div>
    {/each}
  </div>
  {#if overflowTabs.length}
    <button
      class="bs-tabs-more"
      type="button"
      aria-haspopup="menu"
      aria-expanded={!!overflowMenu}
      aria-label={t('tabs.more', { n: overflowTabs.length })}
      onclick={openOverflow}
      >+{overflowTabs.length}<span class="material-symbols-outlined" aria-hidden="true">keyboard_arrow_down</span
      ></button
    >
  {/if}
  <button class="bs-addt" title={t('tabs.newRequestHint')} aria-label={t('tabs.newRequest')} onclick={onNew}
    ><span class="material-symbols-outlined" style="font-size:18px">add</span></button
  >
</div>

{#if overflowMenu}
  <Backdrop aria-label={t('nav.menu.closeMenu')} onclick={() => (overflowMenu = null)} />
  <Menu
    role="menu"
    style="left:{overflowMenu.x}px; top:{overflowMenu.y}px; width:240px; max-height:calc(100vh - {overflowMenu.y}px - 12px); overflow-y:auto"
  >
    {#each overflowTabs as tb (tb.id)}
      <button
        class="mi"
        role="menuitem"
        title={tabTooltip(tb)}
        onclick={() => {
          overflowMenu = null;
          tabs.activeId = tb.id;
        }}
      >
        <span class="tm" style:color={tabIcon(tb) ? undefined : tabMethodColor(tb)}
          >{#if tabIcon(tb)}<span class="material-symbols-outlined" aria-hidden="true">{tabIcon(tb)}</span
            >{:else if tb.protocol === 'grpc'}gRPC{:else}{methodLabel(tb.request.method)}{/if}</span
        >
        <span class="lb">{tb.title === HTTP_DEFAULT_TITLE ? t('tabs.untitled') : tb.title}</span>
      </button>
    {/each}
  </Menu>
{/if}

<style>
  .bs-addt :global(.material-symbols-outlined) {
    font-size: 18px;
  }

  .bs-tabs-scroll::-webkit-scrollbar {
    display: none;
  }

  :global(:where(.dark)) .bs-tab.on {
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.055);
  }

  .bs-tabbar {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }

  .bs-tab:where(:hover) {
    color: var(--t2);
  }

  .bs-tab :global(.x) {
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--t3);
    flex-shrink: 0;
    border-radius: 3px;
    opacity: 0;
  }

  .bs-tab:hover :global(.x) {
    opacity: 1;
  }

  .bs-tab:focus-within :global(.x) {
    opacity: 1;
  }

  .bs-tab.on :global(.x) {
    opacity: 1;
  }

  /* Editor geometry: 40px tabs, 56px title, 40px URL field. */
  /* Tab strip · 52px of capsules */
  .bs-tabbar {
    display: flex;
    align-items: center;
    backdrop-filter: none;
    overflow: visible;
    z-index: 20;
    flex: none;
    height: 52px;
    padding: 0 10px;
    gap: 4px;
    background: transparent;
    border: 0;
    box-shadow: none;
  }

  /* Tabs live in a horizontally-scrolling strip so any number of open tabs can
     never push the Runner / environment / sidebar controls off-screen. */
  .bs-tabs-scroll {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    gap: 4px;
    height: 100%;
  }

  .bs-tab {
    display: flex;
    align-items: center;
    position: relative;
    transition:
      background 120ms ease,
      color 120ms ease;
    contain: paint;
    font-size: 12px;
    flex: 0 1 168px;
    width: 168px;
    min-width: 112px;
    max-width: 168px;
    height: 34px;
    padding: 0 7px 0 11px;
    gap: 8px;
    border: 1px solid transparent;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--color-text-secondary);
    box-shadow: none;
  }

  .bs-tab:hover {
    background: var(--hover);
  }

  .bs-tab.on {
    flex-shrink: 0;
    border-color: transparent;
    background: var(--color-raised);
    color: var(--color-text);
    box-shadow: none;
  }

  .bs-tab.on::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    bottom: auto;
    height: 2px;
    background: var(--accent);
    display: none;
  }

  .bs-tab.on::after {
    display: none;
  }

  .bs-tab.dragging {
    opacity: 0.5;
  }

  .bs-tab :global(.m) {
    flex: none;
    padding: 0;
    border-radius: 0;
    background: none;
    font: 600 var(--font-size-micro) var(--font-code);
    letter-spacing: 0.4px;
  }

  .bs-tab :global(.mi) {
    flex: none;
    font-size: 15px;
    color: var(--color-text-secondary);
  }

  .bs-tab-hit {
    height: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    text-align: left;
    flex: 1;
    min-width: 0;
  }

  .bs-tab :global(.bs-nm) {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-size-caption);
    font-weight: 500;
  }

  :global(.bs) .bs-tab :global(.x) {
    flex: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    color: var(--color-text-muted);
    opacity: 1;
  }

  .bs-tab :global(.x:hover) {
    background: var(--hover-strong);
    color: var(--color-text);
  }

  .bs-addt {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 34px;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: var(--color-field);
    color: var(--color-text-secondary);
  }

  .bs-addt:hover {
    background: var(--color-selected);
    color: var(--color-text);
  }

  :global(:root[data-density='compact']) .bs-tabbar {
    height: 40px;
  }

  :global(:root[data-density='compact']) .bs-tab {
    height: 28px;
  }

  :global(:root[data-density='compact']) .bs-addt {
    flex-basis: 28px;
    width: 28px;
    height: 28px;
  }

  /* S09 / S09b: unsaved changes and the save toast. */
  :global(.bs) .bs-tab :global(.x .dot) {
    display: none;
    font-size: 9px;
    color: var(--color-text-secondary);
  }

  :global(.bs) .bs-tab.on :global(.x .dot) {
    color: var(--color-text);
  }

  :global(.bs) .bs-tab .x.dirty :global(.dot) {
    display: block;
  }

  :global(.bs) .bs-tab .x.dirty :global(.close) {
    display: none;
  }

  :global(.bs) .bs-tab:hover .x.dirty :global(.dot) {
    display: none;
  }

  :global(.bs) .bs-tab:hover .x.dirty :global(.close) {
    display: block;
  }

  /* S36: "Runner · <scope>" gets a wider tab. */
  .bs-tab.wide {
    flex-basis: 200px;
    width: 200px;
    max-width: 200px;
  }
  /* «+N»: the strip hugs its tabs, so «+N» and «+» sit right after the last visible one. */
  .bs-tabs-scroll {
    flex: 0 1 auto;
  }
  .bs-tabs-scroll {
    --fade-l: 0px;
    --fade-r: 0px;
  }
  .bs-tabs-scroll.fade-l {
    --fade-l: 32px;
  }
  .bs-tabs-scroll.fade-r {
    --fade-r: 32px;
  }
  .bs-tabs-scroll:is(.fade-l, .fade-r) {
    -webkit-mask: linear-gradient(90deg, transparent, #000 var(--fade-l), #000 calc(100% - var(--fade-r)), transparent);
    mask: linear-gradient(90deg, transparent, #000 var(--fade-l), #000 calc(100% - var(--fade-r)), transparent);
  }
  .bs-tabs-scroll:not(:has(.bs-tab)) {
    display: none;
  }
  .bs-tabs-more {
    display: flex;
    flex: none;
    align-items: center;
    gap: 2px;
    height: 27px;
    padding: 0 6px 0 10px;
    border-radius: var(--radius-control);
    background: var(--color-field);
    color: var(--color-text-secondary);
    font: 600 var(--font-size-caption) var(--font-code);
  }
  .bs-tabs-more:hover {
    color: var(--color-text);
  }
  .bs-tabs-more .material-symbols-outlined {
    font-size: 14px;
  }
  .tm {
    flex: 0 0 40px;
    font: 600 var(--font-size-micro) var(--font-code);
    letter-spacing: 0.4px;
  }
  .tm .material-symbols-outlined {
    font-size: 14px;
    color: var(--color-text-muted);
  }
  /* S17b: a pinned tab keeps its pin where the close button was. */
  .bs-tab .x.pin {
    color: var(--color-text-secondary);
  }
</style>
