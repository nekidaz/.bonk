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
