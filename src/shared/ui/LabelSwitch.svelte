<!--
  A switch drawn from a hidden checkbox (was the global `.bs-switch` class): the caller puts the
  `<input type="checkbox" role="switch">`, a `.track` span and the label text inside. `as` picks the tag.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLElement> & { as?: 'label' | 'span'; children?: Snippet };

  let { as = 'label', class: cls, children, ...rest }: Props = $props();
</script>

<svelte:element this={as} class={['bs-switch', cls]} {...rest}>{@render children?.()}</svelte:element>

<style>
  :global(.bs) .bs-switch {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--color-text-secondary);
    font: var(--font-size-body) var(--font-ui);
    text-transform: none;
    letter-spacing: 0;
    cursor: pointer;
  }

  :global(.bs) .bs-switch :global(input) {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  :global(.bs) .bs-switch :global(.track::after) {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--color-text-secondary);
    transition: transform var(--duration-press) var(--ease-soft);
  }

  :global(.bs) .bs-switch :global(input:checked + .track) {
    background: var(--color-action);
  }

  :global(.bs) .bs-switch :global(input:checked + .track::after) {
    transform: translateX(12px);
    background: var(--color-on-action);
  }

  :global(.bs) .bs-switch :global(input:focus-visible + .track) {
    outline: 2px solid var(--color-text);
    outline-offset: 2px;
  }

  :global(.bs) .bs-switch :global(.track) {
    position: relative;
    width: 28px;
    height: 16px;
    border-radius: var(--radius-control);
    transition: background-color var(--duration-hover);
    background: var(--color-hover-strong);
  }
</style>
