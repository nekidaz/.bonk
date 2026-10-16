<script lang="ts">
  // The left column: the sidebar itself, plus its resize handle (or, while hidden, the grip that pulls it back).
  import { t } from '$shared/i18n';
  import { Sidebar } from '$features/sidebar/components';
  import { commitInlineRename, inlineRenameKeydown, treeKeydown } from './actions';
  import { layout, SIDEBAR_MAX, SIDEBAR_MIN } from './layout.svelte';
  import { shell } from './shell.svelte';
</script>

<!-- Sidebar. Stays mounted while hidden: width animates to 0 and the
     fixed-width clip wrapper keeps the content from reflowing mid-slide. -->
<aside
  class="bs-side"
  class:no-anim={layout.panelDragging}
  style="width:{layout.sidebarShown ? layout.sidebarCssWidth : '0px'}"
>
  <div class="bs-side-clip" style="width:{layout.sidebarCssWidth}">
    <Sidebar
      openMenu={shell.openMenu}
      editingNodeId={shell.editingNodeId}
      bind:editValue={shell.editValue}
      bind:filter={shell.searchTerm}
      bind:panel={shell.sidebarPanel}
      onTreeKey={treeKeydown}
      {commitInlineRename}
      {inlineRenameKeydown}
    />
  </div>
</aside>
{#if layout.sidebarShown}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="bs-resizer-col"
    class:dragging={layout.sidebarDragWidth !== null}
    role="separator"
    aria-orientation="vertical"
    aria-label={t('app.sidebar.resize')}
    aria-valuenow={layout.sidebarWidth}
    aria-valuemin={SIDEBAR_MIN}
    aria-valuemax={SIDEBAR_MAX}
    onpointerdown={layout.startSidebarDrag}
    ondblclick={layout.resetSidebarWidth}
  >
    <span class="grip" aria-hidden="true"></span>
  </div>
{:else}
  <!-- S34: no toggle button — the hidden sidebar leaves a grip to pull it back open. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="bs-side-grip"
    role="separator"
    aria-orientation="vertical"
    aria-label={t('app.sidebar.open')}
    onpointerdown={layout.startSidebarDrag}
  >
    <span class="mono-tip" role="tooltip">{t('app.sidebar.pull')}<kbd>⌘\</kbd></span>
  </div>
{/if}

<style>
  /* Panel open/close animation. Panels stay mounted; width/flex-basis animate to
     0 and `overflow: hidden` clips the content. `.no-anim` (set while a resize
     drag is live) keeps drags tracking the pointer 1:1. The `!important`s win
     over the app-wide `transition: none !important` hover-perf rule above. */
  :global(.bs) .bs-side {
    overflow: hidden;
    transition:
      width 180ms cubic-bezier(0.33, 1, 0.68, 1),
      border-right-width 180ms cubic-bezier(0.33, 1, 0.68, 1),
      visibility 0s !important;
  }

  :global(.bs) .bs-resizer-col :global(.grip) {
    width: 4px;
    height: 48px;
    border-radius: var(--radius-control);
    background: var(--color-text-secondary);
    opacity: 0;
    transition: opacity var(--duration-hover);
  }

  /* Resizers (Postman-style draggable panel handles). The hit area is 8px wide;
     hover paints a thin 2px accent line centered on the panel border rather than
     filling the whole handle. Double-click resets the panel to its default size. */
  .bs-resizer-col {
    z-index: 5;
    cursor: col-resize;
    background: transparent;
    transition: background 120ms ease;
    flex: 0 0 10px;
    width: 10px;
    margin: 0;
  }

  .bs-side {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    width: 292px;
    position: relative;
    box-shadow: none;
    backdrop-filter: none;
    background: var(--color-panel);
    border: 0;
    outline: 1px solid var(--color-border);
    outline-offset: -1px;
    border-radius: var(--radius-panel);
  }

  /* `visibility: hidden` keeps the collapsed panel out of the a11y tree and tab
     order. The hidden state re-declares the transition with a 180ms visibility
     delay so hiding waits for the width animation, while reopening (which uses
     the base rule's 0s visibility) shows the content immediately. */
  :global(.bs.sidebar-hidden) .bs-side {
    border-right-width: 0;
    transition:
      width 180ms cubic-bezier(0.33, 1, 0.68, 1),
      border-right-width 180ms cubic-bezier(0.33, 1, 0.68, 1),
      visibility 0s linear 180ms !important;
  }

  :global(.bs) .bs-side.no-anim {
    transition: none !important;
  }

  /* Fixed-width inner wrapper: content keeps its layout and gets clipped while
     the sidebar's width animates, instead of reflowing every frame. */
  .bs-side-clip {
    flex: 1;
    min-height: 0;
    align-self: flex-start;
    display: flex;
    flex-direction: column;
  }

  .bs-resizer-col:hover {
    background: linear-gradient(
      to right,
      transparent calc(50% - 1px),
      var(--accent) calc(50% - 1px) calc(50% + 1px),
      transparent calc(50% + 1px)
    );
  }

  :global(.dark) .bs-side::before {
    background:
      radial-gradient(420px 240px at 18% -8%, rgba(10, 132, 255, 0.1), transparent 70%),
      linear-gradient(90deg, rgba(255, 255, 255, 0.04), transparent 44%);
    opacity: 0.55;
  }

  *:where(.bs-side) {
    overflow: hidden;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }

  .bs-side::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      radial-gradient(420px 240px at 20% -8%, rgba(10, 132, 255, 0.11), transparent 70%),
      linear-gradient(90deg, rgba(255, 255, 255, 0.18), transparent 38%);
    opacity: 0.42;
    display: none;
  }

  @media (max-width: 480px) {
    .bs-side {
      display: none;
    }
  }

  .mono-tip {
    position: absolute;
    z-index: 200;
    display: none;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding: 0 12px;
    border-radius: var(--radius-control);
    background: var(--color-inverse);
    color: var(--color-on-inverse);
    font: 500 var(--font-size-caption) var(--font-ui);
    white-space: nowrap;
    pointer-events: none;
    box-shadow: 0 6px 18px var(--color-shadow, rgba(0, 0, 0, 0.2));
  }

  .mono-tip :global(b + *) {
    opacity: 0.7;
  }

  .mono-tip :global(b) {
    font: 600 var(--font-size-caption) var(--font-code);
  }

  :global(:hover) > .mono-tip {
    display: inline-flex;
  }

  :global(:focus-visible) > .mono-tip {
    display: inline-flex;
  }

  :global(.bs.sidebar-hidden) .bs-side {
    visibility: hidden;
    outline-width: 0;
  }

  :global(:root[data-density='compact']) .bs-resizer-col {
    flex-basis: 8px;
    width: 8px;
  }

  :global(.bs) .bs-resizer-col:hover :global(.grip) {
    opacity: 1;
  }

  :global(.bs) .bs-resizer-col.dragging :global(.grip) {
    opacity: 1;
  }

  :global(.bs) .bs-resizer-col {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: col-resize;
    background: none;
  }

  :global(.bs) .bs-resizer-col:hover {
    background: none;
  }

  :global(.bs) .bs-side-grip {
    position: absolute;
    z-index: 5;
    left: 0;
    top: calc(50% - 24px);
    display: flex;
    width: 10px;
    height: 48px;
    cursor: col-resize;
  }

  :global(.bs) .bs-side-grip::before {
    content: '';
    width: 4px;
    height: 48px;
    border-radius: var(--radius-control);
    background: var(--color-text-secondary);
    opacity: 0.4;
    transition: opacity var(--duration-hover);
  }

  :global(.bs) .bs-side-grip:hover::before {
    opacity: 1;
  }

  :global(.bs) .bs-side-grip .mono-tip {
    top: 10px;
    left: 12px;
  }
</style>
