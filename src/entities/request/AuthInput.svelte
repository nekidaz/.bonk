<!-- A field of the auth editors (was `.bs-auth-input`): an <input> (or <select>) with optional icon. `var` when it holds a {{variable}}. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLLabelAttributes } from 'svelte/elements';

  type Props = HTMLLabelAttributes & { ref?: HTMLLabelElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<label bind:this={ref} class={['bs-auth-input', cls]} {...rest}>{@render children?.()}</label>

<style>
  :global(.bs) .bs-auth-input {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 14px;
    outline: 1px solid var(--color-border-subtle);
    outline-offset: -1px;
    border-radius: var(--radius-control);
    background: var(--color-field);
  }

  :global(.bs) .bs-auth-input:focus-within {
    outline-color: var(--color-text-muted);
  }

  :global(.bs) .bs-auth-input :global(.material-symbols-outlined) {
    flex: none;
    font-size: 16px;
    color: var(--color-var);
  }

  :global(.bs) .bs-auth-input :global(input) {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: 0;
    outline: none;
    box-shadow: none;
    background: transparent;
    color: var(--color-text);
    font: var(--font-size-body) var(--font-code);
  }

  :global(.bs) .bs-auth-input :global(input:focus) {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: 0;
    outline: none;
    box-shadow: none;
    background: transparent;
    color: var(--color-text);
    font: var(--font-size-body) var(--font-code);
  }

  :global(.bs) .bs-auth-input.var :global(input) {
    color: var(--color-var);
  }
</style>
