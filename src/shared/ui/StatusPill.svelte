<!-- A response status pill (was `.bs-stpill`): `.g` dot and text; `ok`/`err`/`warning`/`sending`. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLSpanElement> & { ref?: HTMLSpanElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<span bind:this={ref} class={['bs-stpill', cls]} {...rest}>{@render children?.()}</span>

<style>
  :global(.bs) .bs-stpill.sending {
    background: var(--color-selected);
    color: var(--color-text-secondary);
  }

  :global(.bs) .bs-stpill.warning {
    background: var(--color-warning-soft);
    color: var(--color-warning);
  }

  /* Belongs to response.css, but the cascade needs it before `:root .lb-strip .label` (same elements, same specificity), so it lives here. */
  :global(.bs) .bs-stpill {
    height: 24px;
    gap: 6px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--radius-control);
    background: var(--color-success-soft);
    color: var(--color-success);
    font: 600 var(--font-size-caption) var(--font-code);
    white-space: nowrap;
  }

  .bs-stpill.err {
    color: var(--red);
  }

  .bs-stpill :global(.g) {
    font-family: var(--font-ui, inherit);
    font-weight: 700;
  }

  .bs-stpill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--mono);
    font-weight: 700;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: var(--green);
    font-size: 12px;
  }

  :global(.bs) .bs-stpill.neutral {
    background: var(--color-selected);
    color: var(--color-text-secondary);
  }

  :global(.bs) .bs-stpill :global(.g) {
    font: 600 var(--font-size-body) var(--font-code);
  }
</style>
