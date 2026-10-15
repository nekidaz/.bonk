<!--
  The app's text button (was the global `.bs-btn` class). Any other <button> attribute passes through.
  `ref` is the element, for focus: `<Button bind:ref={el}>`. The root keeps the `bs-btn` class so
  area styles like `.bs-oa .bs-btn` still apply.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  type Props = HTMLButtonAttributes & {
    /** No variant = a plain text button with no fill. */
    variant?: 'primary' | 'ghost' | 'ghost-danger' | 'danger' | 'danger-soft' | 'link';
    /** `lg` = the 34px sheet-footer button (Environments, Cookie jar). */
    size?: 'md' | 'lg';
    ref?: HTMLButtonElement;
    children: Snippet;
  };

  let { variant, size = 'md', ref = $bindable(), type = 'button', children, ...rest }: Props = $props();
</script>

<button bind:this={ref} {type} class={['bs-btn', variant, size === 'lg' && 'lg']} {...rest}>{@render children()}</button
>

<style>
  .bs-btn {
    height: 28px;
    padding: 0 16px;
    border: none;
    border-radius: var(--radius-control);
    background: none;
    color: inherit;
    font: inherit;
    letter-spacing: 0;
    cursor: pointer;
  }

  .bs-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .bs-btn:focus-visible {
    outline: 2px solid var(--color-text);
    outline-offset: 2px;
    box-shadow: var(--focus-ring);
  }

  .primary {
    background: var(--color-action);
    color: var(--color-on-action);
  }

  .ghost,
  .ghost-danger {
    height: 26px;
    border: 1px solid var(--sep);
    background: var(--surface);
  }

  .ghost:hover:not(:disabled) {
    background: var(--hover);
  }

  .ghost-danger {
    color: var(--red);
  }

  .ghost-danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--red) 12%, transparent);
  }

  .danger {
    background: var(--color-danger);
    color: var(--color-on-action);
    font-weight: 600;
  }

  .danger-soft {
    background: var(--color-danger-soft);
    color: var(--color-danger);
  }

  .link {
    color: var(--accent);
  }

  .lg {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    border: 0;
    font: 500 var(--font-size-body) var(--font-ui);
  }

  .lg.ghost {
    background: var(--color-panel);
    color: var(--color-text);
  }

  .lg:is(.primary, .danger) {
    font-weight: 600;
  }

  .lg :global(.material-symbols-outlined) {
    font-size: 16px;
  }
</style>
