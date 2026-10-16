<!-- The right side of the request tab row (was `.lb-tabrow-tools`): body format, <TabStats>, editor tools. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['lb-tabrow-tools', cls]} {...rest}>{@render children?.()}</div>

<style>
  :global(:root[data-density='compact'] .bs) .lb-tabrow-tools {
    margin: 6px 14px 0 auto;
  }

  .lb-tabrow-tools {
    flex: none;
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    margin: 10px 20px 0 auto;
  }
</style>
