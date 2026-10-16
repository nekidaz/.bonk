<!--
  The dimmed full-window layer behind a dialog (was the global `.bs-overlay` class). Put a <Modal> inside.
  `portal` moves it to <body>, out of any transformed or clipping ancestor. role/aria/handlers pass through.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { portal as toBody } from './portal';

  type Props = HTMLAttributes<HTMLDivElement> & { portal?: boolean; ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, portal = false, ref = $bindable(), children, ...rest }: Props = $props();
</script>

{#if portal}
  <div use:toBody bind:this={ref} class={['bs-overlay', cls]} {...rest}>{@render children?.()}</div>
{:else}
  <div bind:this={ref} class={['bs-overlay', cls]} {...rest}>{@render children?.()}</div>
{/if}

<style>
  /* Modal (Save Request, etc.) */
  .bs-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(13, 15, 18, 0.56);
  }
</style>
