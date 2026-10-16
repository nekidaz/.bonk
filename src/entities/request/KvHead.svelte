<!-- The key/value panel's control row above the table (was `.bs-qp`). -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-qp', cls]} {...rest}>{@render children?.()}</div>

<style>
  .bs-qp {
    display: flex;
    align-items: center;
    margin-bottom: 10px;
  }
</style>
