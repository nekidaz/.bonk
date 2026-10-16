<!-- The request editor tab row (was `.lb-tabrow`): <RTabs> on the left, <TabRowTools> on the right. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['lb-tabrow', cls]} {...rest}>{@render children?.()}</div>

<style>
  /* E1 rule 2 · the request tabs capsule with the body tools on the right */
  .lb-tabrow {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    min-width: 0;
  }
</style>
