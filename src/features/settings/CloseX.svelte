<!-- The round close button of the settings sheets (was `.st-x`). -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  type Props = HTMLButtonAttributes & { ref?: HTMLButtonElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<button bind:this={ref} class={['st-x', cls]} {...rest}>{@render children?.()}</button>

<style>
  .st-x:focus-visible {
    outline: 2px solid var(--color-text);
    outline-offset: 2px;
  }

  .st-x {
    width: 32px;
    height: 32px;
    margin-top: 6px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
  }

  .st-x:hover {
    background: var(--color-hover);
    color: var(--color-text);
  }
</style>
