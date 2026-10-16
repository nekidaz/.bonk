<!-- The coloured method button (was `.bs-method`): name + chevron; `open` while its menu shows. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  type Props = HTMLButtonAttributes & { ref?: HTMLButtonElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<button bind:this={ref} class={['bs-method', cls]} {...rest}>{@render children?.()}</button>

<style>
  /* Belongs to request.css, but the cascade needs it before `:root .bs :is(.bs-menu,.bs-method-menu,.bs-work-menu,.bs-tab-ctx,.bs-grpc-menu) button` (same elements, same specificity), so it lives here. */
  :global(.bs) button.bs-method {
    color: var(--green);
    min-width: 0;
    height: 36px;
    padding: 0 8px 0 14px;
    gap: 4px;
    border-radius: var(--radius-control);
    background: var(--color-raised);
    font: 600 var(--font-size-caption) var(--font-code);
    letter-spacing: 0.4px;
  }

  .bs-method {
    color: var(--green);
  }

  .bs-method :global(svg) {
    width: 13px;
    height: 13px;
    color: var(--t3);
  }

  .bs-method {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 100%;
    position: relative;
    min-width: 108px;
    padding: 0 12px;
    justify-content: space-between;
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
  }

  @media (max-width: 480px) {
    .bs-method {
      min-width: 80px;
    }
  }

  :global(.bs) button.bs-method:hover {
    background: var(--color-selected);
  }

  :global(.bs) button.bs-method :global(.material-symbols-outlined) {
    font-size: 14px;
    color: var(--color-text-muted);
  }

  :global(:root[data-density='compact'] .bs) button.bs-method {
    height: 28px;
  }
</style>
