<!-- A floating toast (was `.bs-toast`): an icon, `.text` and optional buttons. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-toast', cls]} {...rest}>{@render children?.()}</div>

<style>
  :global(.bs) .bs-toast {
    position: fixed;
    z-index: 140;
    left: 50%;
    bottom: 42px;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 10px;
    width: max-content;
    min-width: 360px;
    max-width: calc(100vw - 32px);
    height: 46px;
    padding: 10px 8px 10px 14px;
    outline: 1px solid var(--color-border-subtle);
    outline-offset: -1px;
    border-radius: var(--radius-card);
    background: var(--color-raised);
    box-shadow: 0 12px 32px var(--color-shadow);
    color: var(--color-text);
    font: 500 var(--font-size-body) var(--font-ui);
  }

  :global(.bs) .bs-toast > :global(.material-symbols-outlined) {
    flex: none;
    font-size: 16px;
    color: var(--color-success);
  }

  :global(.bs) .bs-toast :global(.text) {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.bs) .bs-toast :global(button) {
    flex: none;
    height: 26px;
    padding: 0 10px;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--color-text-secondary);
    font: 500 var(--font-size-body) var(--font-ui);
  }

  :global(.bs) .bs-toast :global(button:hover) {
    background: var(--hover);
    color: var(--color-text);
  }
</style>
