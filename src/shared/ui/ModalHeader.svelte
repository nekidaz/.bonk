<!-- The dialog title row (was `.bs-modal-h`): a `.t` title and an `.x` close button go inside. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-modal-h', cls]} {...rest}>{@render children?.()}</div>

<style>
  .bs-modal-h :global(.t) {
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .bs-modal-h :global(.x) {
    margin-left: auto;
    width: 26px;
    height: 26px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--t2);
  }

  .bs-modal-h :global(.x:hover) {
    background: var(--hover);
  }

  .bs-modal-h {
    display: flex;
    align-items: center;
    min-height: 44px;
    padding: 10px 13px 6px;
  }
</style>
