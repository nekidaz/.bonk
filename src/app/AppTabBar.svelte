<script lang="ts">
  import { tabs, HTTP_DEFAULT_TITLE } from '$entities/tab';
  import { requestCloseTab, newTab, moveTab, togglePinTab } from '$features/tabs';
  import { dirtyTabIds } from '$entities/request';
  import { methodColor, methodLabel, type Tab } from '$shared/model';
  import { t } from '$shared/i18n';

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
  <button class="bs-backdrop" aria-label={t('nav.menu.closeMenu')} onclick={() => (overflowMenu = null)}></button>
  <div
    class="bs-menu"
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
  </div>
{/if}

<style>
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
