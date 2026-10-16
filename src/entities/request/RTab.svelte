<!-- A request editor tab (was `.bs-rtab`): label and an optional <TabCount>; `on` for the open one. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  type Props = HTMLButtonAttributes & { ref?: HTMLButtonElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<button bind:this={ref} class={['bs-rtab', cls]} {...rest}>{@render children?.()}</button>

<style>
  /* Belongs to request.css, but the cascade needs it before `:root .bs :is(.bs-menu,.bs-method-menu,.bs-work-menu,.bs-tab-ctx,.bs-grpc-menu) button` (same elements, same specificity), so it lives here. */
  :global(.bs) button.bs-rtab {
    flex: none;
    height: 30px;
    margin: 0;
    padding: 0 14px;
    gap: 6px;
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: var(--font-size-body);
    font-weight: 500;
    white-space: nowrap;
  }

  .bs-rtab {
    border-bottom: 2px solid transparent;
  }

  .bs-rtab:where(:hover) {
    color: var(--text);
  }

  .bs-rtab.on {
    color: var(--text);
    border-bottom-color: var(--accent);
    font-weight: 600;
  }

  .bs-rtab {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: -0.5px;
    flex-shrink: 0;
    height: 100%;
    font-size: 12px;
    color: var(--t2);
  }

  :global(.bs) button.bs-rtab:hover {
    color: var(--color-text);
    background: var(--hover);
  }

  :global(.bs) button.bs-rtab.on {
    border-bottom-color: var(--accent);
    color: var(--color-text);
    font-weight: 600;
    background: var(--color-raised);
    box-shadow: 0 1px 3px var(--color-shadow);
  }

  .bs-rtab.on::after {
    height: 2px;
    background: var(--accent);
    display: none;
  }

  .bs-rtab::before {
    display: none;
  }

  :global(:root[data-density='compact'] .bs) button.bs-rtab {
    height: 26px;
  }
</style>
