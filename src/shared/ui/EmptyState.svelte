<!-- An empty-state block (was `.bs-empty`): <b> title and <p> hint. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-empty', cls]} {...rest}>{@render children?.()}</div>

<style>
  .bs-empty :global(b) {
    display: block;
    font-weight: 600;
    margin-bottom: 4px;
    color: var(--text);
    font-size: 11.5px;
  }

  .bs-empty :global(p) {
    margin: 0;
    max-width: none;
    line-height: 1.45;
    color: var(--t3);
    font-size: 11px;
  }

  .bs-empty {
    box-shadow: none;
    margin: 2px 5px;
    padding: 8px 9px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    font-size: 12px;
    line-height: 1.7;
    color: var(--t2);
  }
</style>
