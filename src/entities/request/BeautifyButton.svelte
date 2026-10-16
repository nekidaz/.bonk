<!-- The small text button in a body panel head (was `.bs-body-beautify`): Beautify, Load example, …; `icon` for an icon-only one. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  type Props = HTMLButtonAttributes & { ref?: HTMLButtonElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<button bind:this={ref} class={['bs-body-beautify', cls]} {...rest}>{@render children?.()}</button>

<style>
  :global(.bs) .bs-body-beautify {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 12px;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--color-text-secondary);
    font: 500 var(--font-size-body) var(--font-ui);
  }

  :global(.bs) .bs-body-beautify:hover {
    background: var(--hover);
    color: var(--color-text);
  }

  :global(.bs) .bs-body-beautify :global(.material-symbols-outlined) {
    font-size: 16px;
  }

  :global(.bs) .bs-body-beautify.icon {
    width: 30px;
    padding: 0;
    justify-content: center;
  }
</style>
