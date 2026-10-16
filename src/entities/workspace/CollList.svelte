<!-- The scrolling folder list of the folder dialogs (was `.bs-colllist`). -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-colllist', cls]} {...rest}>{@render children?.()}</div>

<style>
  .bs-colllist {
    max-height: 300px;
    overflow: auto;
    padding: 4px;
    background: color-mix(in srgb, var(--surface) 42%, transparent);
  }
</style>
