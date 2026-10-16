<!-- The dialog's scrolling content (was `.bs-modal-b`). -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-modal-b', cls]} {...rest}>{@render children?.()}</div>

<style>
  .bs-modal-b {
    padding: 8px 18px 14px;
    overflow: auto;
    flex: 1;
  }
</style>
