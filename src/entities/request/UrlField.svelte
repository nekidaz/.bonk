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

  /* S13: a long address — one fading line at rest, a wrapping card on focus (HTTP and gRPC). */
  :global(:root :root[data-density='compact'] .bs .bs-urlfield.expanded) {
    min-height: 34px;
  }

  :global(.bs) .bs-urlfield :global(.bs-url-main) {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-self: stretch;
    justify-content: center;
  }

  :global(:root .bs .bs-urlfield.expanded) {
    height: auto;
    min-height: 48px;
    padding: 6px 18px 10px 5px;
    align-items: flex-start;
    border-radius: var(--radius-card);
    border-color: var(--color-text-muted);
    gap: 10px;
  }

  :global(:root .bs .bs-urlfield.expanded .bs-method-wrap) {
    margin: 0;
  }

  :global(:root .bs .bs-urlfield.expanded .bs-method-wrap::after) {
    display: none;
  }

  :global(:root .bs .bs-urlfield.expanded .bs-url-main) {
    justify-content: flex-start;
    padding-top: 7px;
  }

  /* S13: the card wraps at ~67 columns, so lines break at «&» like the mock. */
  :global(:root .bs .bs-urlfield.expanded .cm-content) {
    max-width: 67ch;
    line-height: 22px;
    overflow-wrap: anywhere;
    word-break: normal;
  }

  /* A huge URL scrolls inside the card (~10 lines) instead of pushing the request pane off-screen. */
  :global(:root .bs .bs-urlfield.expanded .cm-scroller) {
    max-height: 220px;
    overflow-y: auto;
  }

  /* The single-line editor theme hides its scrollbar; bring the global one back here. */
  :global(:root .bs .bs-urlfield.expanded .cm-scroller::-webkit-scrollbar) {
    display: block;
  }

  :global(.bs) .bs-urlfield :global(.bs-url-meta) {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding-top: 8px;
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro) var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
    white-space: pre;
  }

  :global(.bs) .bs-urlfield :global(.bs-url-meta .hint) {
    font: var(--font-size-caption) var(--font-ui);
    letter-spacing: 0;
    text-transform: none;
  }
</style>
