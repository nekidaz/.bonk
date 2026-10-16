<!-- The scrolling body of a Source Control view (was `.bs-gview-body`). -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-gview-body', cls]} {...rest}>{@render children?.()}</div>

<style>
  .bs-gview-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 0 20px 20px;
    overflow: auto;
  }
</style>
