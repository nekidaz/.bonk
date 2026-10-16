<!--
  The scrolling strip of request editor tabs (was the global `.bs-rtabs` class): <RTab>s inside.
  `tablist` adds arrow-key navigation between the tabs (the `tablist` action).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { tablist as tablistAction } from '$shared/ui';

  type Props = HTMLAttributes<HTMLDivElement> & { tablist?: boolean; ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, tablist = false, ref = $bindable(), children, ...rest }: Props = $props();
</script>

{#if tablist}
  <div use:tablistAction bind:this={ref} class={['bs-rtabs', cls]} {...rest}>{@render children?.()}</div>
{:else}
  <div bind:this={ref} class={['bs-rtabs', cls]} {...rest}>{@render children?.()}</div>
{/if}

<style>
  .bs-rtabs {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }

  .bs-rtabs {
    display: flex;
    backdrop-filter: none;
    box-shadow: none;
    flex: none;
    height: auto;
    align-items: center;
    width: max-content;
    max-width: calc(100% - 40px);
    margin: 10px 20px 0;
    padding: 3px;
    gap: 2px;
    overflow-x: auto;
    scrollbar-width: none;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    background: var(--color-field);
  }

  .bs-rtabs::-webkit-scrollbar {
    display: none;
  }

  :global(:root[data-density='compact']) .bs-rtabs {
    margin: 6px 14px 0;
  }

  @media (max-width: 760px) {
    .bs-rtabs {
      margin-left: 12px;
      margin-right: 12px;
    }
  }

  :global(.lb-tabrow) > .bs-rtabs {
    flex: none;
  }
</style>
