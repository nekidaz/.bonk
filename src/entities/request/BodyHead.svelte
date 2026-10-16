<!-- The head row of a body panel (was `.bs-body-head`): body type chips and <BeautifyButton>s. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-body-head', cls]} {...rest}>{@render children?.()}</div>

<style>
  :global(.bs) .bs-body-head {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 28px;
  }
</style>
