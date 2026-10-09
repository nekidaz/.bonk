<script lang="ts">
  import { activeTabId, requestCloseTab, newTab, moveTab, togglePinTab, tabs, dirtyTabIds } from '../stores';
  import { methodColor } from '../domain/method';
  import { HTTP_DEFAULT_TITLE } from '../domain/tab';
  import type { Tab } from '../domain/types';
  import { t } from '../i18n';

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

  // Mono: a method is text; protocols without one get an icon instead of a caps badge.
  const TAB_ICON: Partial<Record<Tab['protocol'], string>> = {
    git: 'difference',
    env: 'layers',
    runner: 'play_arrow',
    flow: 'account_tree',
  };

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

<div class="bs-tabbar">
  <div
    class="bs-tabs-scroll"
    bind:this={tabsScrollEl}
    role="presentation"
    oncontextmenu={(e) => onContext(e, $activeTabId)}
    ondblclick={(e) => {
      if (e.target === e.currentTarget) newTab();
    }}
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
          aria-selected={tb.id === $activeTabId}
          type="button"
          title={tabTooltip(tb)}
          onclick={() => activeTabId.set(tb.id)}
          onkeydown={(e) => onTabKey(e, tb.id)}
        >
          {#if TAB_ICON[tb.protocol]}
            <span class="mi material-symbols-outlined" aria-hidden="true">{TAB_ICON[tb.protocol]}</span>
          {:else}
            <span class="m" style="color:{tabMethodColor(tb)}">{tabMethodLabel(tb)}</span>
          {/if}
          <span class="bs-nm">{tb.title === HTTP_DEFAULT_TITLE ? $t('tabs.untitled') : tb.title}</span>
        </button>
        {#if tb.pinned}
          <button
            class="x pin"
            aria-label={$t('tabs.ctxUnpin')}
            title={$t('tabs.ctxUnpin')}
            onclick={(e) => {
              e.stopPropagation();
              togglePinTab(tb.id);
            }}><span class="material-symbols-outlined" style="font-size:13px">keep</span></button
          >
        {:else}
          <button
            class="x"
            class:dirty={$dirtyTabIds.has(tb.id)}
            aria-label={$dirtyTabIds.has(tb.id) ? $t('tabs.closeTabUnsaved') : $t('tabs.closeTab')}
            title={$t('tabs.close')}
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
    <button class="bs-addt" title={$t('tabs.newRequestHint')} aria-label={$t('tabs.newRequest')} onclick={onNew}
      ><span class="material-symbols-outlined" style="font-size:18px">add</span></button
    >
  </div>
</div>

<style>
  /* S36: "Runner · <scope>" gets a wider tab. */
  .bs-tab.wide {
    flex-basis: 200px;
    width: 200px;
    max-width: 200px;
  }
  /* S17b: a pinned tab keeps its pin where the close button was. */
  .bs-tab .x.pin {
    color: var(--color-text-secondary);
  }
</style>
