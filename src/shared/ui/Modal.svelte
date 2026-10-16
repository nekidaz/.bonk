<!-- The dialog card (was the global `.bs-modal` class): <ModalHeader>, <ModalBody>, <ModalFooter> inside. A `class` adds a variant whose styles live in the component that passes it. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-modal', cls]} {...rest}>{@render children?.()}</div>

<style>
  :global(.dark) .bs-modal {
    background: var(--surface-solid);
  }

  .bs-modal {
    width: 580px;
    max-width: 92vw;
    max-height: 82vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--sep);
    background: var(--surface-solid);
    box-shadow: var(--shadow-panel);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    border-radius: 7px;
  }

  :global(.bs) .bs-modal {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-dialog);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
  }
</style>
