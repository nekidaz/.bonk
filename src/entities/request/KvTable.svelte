<!-- The key/value grid (was `.bs-pt`): <KvRow>s; the first one has class `h` (column titles). -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-pt', cls]} {...rest}>{@render children?.()}</div>

<style>
  .bs-pt {
    box-shadow: none;
    border: 0;
    outline: 1px solid var(--color-border-subtle);
    outline-offset: -1px;
    border-radius: var(--radius-card);
    background: var(--color-field);
    overflow: hidden;
  }
</style>
