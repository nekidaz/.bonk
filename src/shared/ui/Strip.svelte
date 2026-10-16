<!-- A collapsed panel shown as a thin strip (was `.lb-strip`): `.label`, `.preview`, `.chip`s and `.act` buttons. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['lb-strip', cls]} {...rest}>{@render children?.()}</div>

<style>
  .lb-strip :global(.preview) {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-code);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lb-strip :global(.act) {
    flex: none;
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 12px 0 8px;
    outline: 1px solid var(--color-border);
    outline-offset: -1px;
    border-radius: var(--radius-control);
    background: var(--color-panel);
    color: var(--color-text);
    font: 500 var(--font-size-body) var(--font-ui);
  }

  .lb-strip :global(.act:hover) {
    background: var(--color-selected);
  }

  /* Rules 1 and 7 · a pane folded into a 44 px strip */
  .lb-strip {
    flex: none;
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    height: 44px;
    margin: 0 10px 10px;
    padding: 0 7px 0 16px;
    outline: 1px solid var(--color-border-subtle);
    outline-offset: -1px;
    border-radius: var(--radius-card);
    background: var(--color-sidebar);
  }

  .lb-strip :global(.label) {
    flex: none;
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro) var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
  }

  .lb-strip :global(.chip) {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 10px;
    border-radius: var(--radius-control);
    background: var(--color-selected);
    color: var(--color-text-secondary);
    font: 500 var(--font-size-caption) var(--font-ui);
  }

  .lb-strip :global(.chip b) {
    color: var(--color-text);
    font: 500 var(--font-size-caption) var(--font-code);
  }

  .lb-strip :global(.chip:hover) {
    background: var(--color-hover-strong, var(--color-selected));
    color: var(--color-text);
  }

  .lb-strip :global(.meta) {
    flex: none;
    color: var(--color-text-secondary);
    font: var(--font-size-caption) var(--font-code);
    white-space: pre;
  }

  .lb-strip :global(.act .material-symbols-outlined) {
    font-size: 16px;
    color: var(--color-text-secondary);
  }

  /* Flow · Window sizes: at the minimum window only ⌄ is left of “Show body”. */
  .lb-strip :global(:is(.chip, .act):focus-visible) {
    outline: 2px solid var(--color-text);
    outline-offset: 2px;
  }
</style>
