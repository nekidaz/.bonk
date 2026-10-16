<!-- The OAuth / Session auth panel body (was `.bs-oa`): cards, `.chips`, `.link`s. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-oa', cls]} {...rest}>{@render children?.()}</div>

<style>
  :global(.bs) .bs-oa :global(.bs-btn .material-symbols-outlined) {
    font-size: 16px;
  }

  /* Flow · OAuth 2.0 (OA2–OA9): token card, settings, details, “OAuth tokens”. */
  :global(.bs) .bs-oa {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 10px;
  }

  :global(.bs) .bs-oa :global(.link) {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    border-radius: var(--radius-control);
    color: var(--color-text-secondary);
    font: 500 var(--font-size-body) var(--font-ui);
  }

  :global(.bs) .bs-oa :global(.link) {
    padding: 0 6px;
    margin-left: -6px;
  }

  :global(.bs) .bs-oa :global(.link:hover) {
    background: var(--color-hover);
    color: var(--color-text);
  }

  :global(.bs) .bs-oa :global(.link .material-symbols-outlined) {
    font-size: 16px;
  }

  :global(.bs) .bs-oa :global(.chips) {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  :global(.bs) .bs-oa :global(.chip) {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    height: 24px;
    padding: 0 8px;
    border-radius: var(--radius-control);
    background: var(--color-selected);
    color: var(--color-text);
    font: var(--font-size-caption) var(--font-code);
  }

  :global(.bs) .bs-oa :global(.chip button) {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    margin-right: -4px;
    border-radius: 50%;
    color: var(--color-text-muted);
  }

  :global(.bs) .bs-oa :global(.chip button:hover) {
    background: var(--color-hover-strong);
    color: var(--color-text);
  }

  :global(.bs) .bs-oa :global(.chip button .material-symbols-outlined) {
    font-size: 12px;
  }

  :global(.bs) .bs-oa :global(.icon) {
    flex: none;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    color: var(--color-text-secondary);
  }

  :global(.bs) .bs-oa :global(.icon:hover) {
    background: var(--color-hover);
    color: var(--color-text);
  }

  :global(.bs) .bs-oa :global(.icon .material-symbols-outlined) {
    font-size: 15px;
  }
</style>
