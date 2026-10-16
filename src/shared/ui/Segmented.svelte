<!--
  The segmented control box (was the global `.bs-seg` class). The caller renders the <button>s inside,
  with its own role/aria and `class:on` for the picked one, because segments differ (icons, counters).
  `role` and `aria-label` go on the box: `<Segmented role="radiogroup" aria-label=…>`.
  `class` adds a class for the caller's own styles, which must reach it as `:global(.x)`.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLSpanElement> & { children: Snippet };

  let { class: cls, children, ...rest }: Props = $props();
</script>

<span class={['bs-seg', cls]} {...rest}>{@render children()}</span>

<style>
  .bs-seg {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    height: 30px;
    padding: 3px;
    gap: 2px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    background: var(--color-field);
    box-shadow: inset 0 0 0 1px var(--sep);
  }

  /* The doubled class keeps the old `:root .bs .bs-seg button` weight, so the global `.bs button` reset loses. */
  .bs-seg.bs-seg :global(button) {
    height: 100%;
    padding: 0 12px;
    border-radius: var(--radius-control);
    color: var(--color-text-secondary);
    font: 500 var(--font-size-caption) var(--font-ui);
  }

  .bs-seg.bs-seg :global(button.on) {
    background: var(--color-raised);
    color: var(--color-text);
    font-weight: 600;
    box-shadow: 0 1px 2px var(--color-shadow);
  }
</style>
