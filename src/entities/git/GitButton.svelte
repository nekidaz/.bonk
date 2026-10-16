<!-- A Source Control pill button (was `.bs-gbtn`): icon, label, optional <kbd>; `inv` primary, `danger`, `sm`. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  type Props = HTMLButtonAttributes & { ref?: HTMLButtonElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<button bind:this={ref} class={['bs-gbtn', cls]} {...rest}>{@render children?.()}</button>

<style>
  .bs-gbtn:where(:hover):not(:disabled) {
    background: var(--color-hover);
  }

  .bs-gbtn.inv:hover:not(:disabled) {
    background: var(--color-inverse);
    opacity: 0.9;
  }

  .bs-gbtn.danger:hover:not(:disabled) {
    background: var(--color-danger-soft);
    opacity: 0.85;
  }

  /* Flow · Git: pill buttons, segmented toggles and tags shared by the Source Control views. */
  .bs-gbtn {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 30px;
    padding: 0 14px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    background: var(--color-field);
    color: var(--color-text);
    font: 600 var(--font-size-body) var(--font-ui);
    white-space: nowrap;
    cursor: pointer;
  }

  .bs-gbtn:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .bs-gbtn :global(.material-symbols-outlined) {
    font-size: 15px;
  }

  .bs-gbtn :global(kbd) {
    font: var(--font-size-micro) var(--font-ui);
    opacity: 0.55;
  }

  :where(.bs-gbtn).inv {
    border-color: transparent;
    background: var(--color-inverse);
    color: var(--color-on-inverse);
  }

  :where(.bs-gbtn).danger {
    border-color: transparent;
    background: var(--color-danger-soft);
    color: var(--color-danger);
  }
</style>
