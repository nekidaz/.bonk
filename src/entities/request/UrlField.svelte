<!-- The address field (was `.bs-urlfield`): a <MethodWrap> and the URL editor. `long`/`expanded` for a huge URL. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-urlfield', cls]} {...rest}>{@render children?.()}</div>

<style>
  :global(.bs) .bs-urlfield.long:not(.expanded) :global(.cm-scroller) {
    -webkit-mask: linear-gradient(90deg, #000 calc(100% - 72px), transparent);
    mask: linear-gradient(90deg, #000 calc(100% - 72px), transparent);
  }

  .bs-urlfield:where(:hover) {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--sep));
  }

  .bs-urlfield :global(.cm-scroller) {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
    font-size: 13px;
  }

  .bs-urlfield:focus-within {
    border-color: var(--color-text-muted);
    box-shadow: none;
  }

  .bs-urlfield {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    overflow: visible;
    transition:
      border-color 130ms ease,
      box-shadow 130ms ease,
      background 130ms ease;
    height: 48px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    background: var(--color-field);
    box-shadow: none;
    padding: 0 18px 0 5px;
    gap: 21px;
  }

  .bs-urlfield :global(.cm-content) {
    font: var(--font-size-ui) var(--font-code);
  }

  :global(.bs) .bs-urlfield :global(.cm-line) {
    padding: 0;
  }

  :global(:root[data-density='compact']) .bs-urlfield {
    height: 34px;
  }
</style>
