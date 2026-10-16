<!-- A small round icon button in tool rows (was `.bs-ric`); `on` when toggled. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  type Props = HTMLButtonAttributes & { ref?: HTMLButtonElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<button bind:this={ref} class={['bs-ric', cls]} {...rest}>{@render children?.()}</button>

<style>
  .bs-ric :global(svg) {
    width: 15px;
    height: 15px;
  }

  .bs-ric:active {
    transform: scale(0.94);
  }

  .bs-ric {
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      background 120ms ease,
      color 120ms ease,
      transform 90ms ease;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: var(--color-panel);
    color: var(--color-text-secondary);
  }

  .bs-ric :global(.material-symbols-outlined) {
    font-size: 16px;
  }

  .bs-ric:hover {
    background: var(--color-selected);
  }

  :global(:root[data-density='compact']) .bs-ric {
    width: 24px;
    height: 24px;
  }
</style>
