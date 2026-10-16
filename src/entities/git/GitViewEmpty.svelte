<!-- The empty / loading message of a Source Control view (was `.bs-gview-empty`). -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-gview-empty', cls]} {...rest}>{@render children?.()}</div>

<style>
  .bs-gview-empty {
    margin: auto;
    color: var(--color-text-muted);
    font-size: var(--font-size-ui);
  }
</style>
