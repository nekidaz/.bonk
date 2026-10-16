<!-- A key/value cell (was `.bs-pc`): `c` checkbox, `k` key, `v` value, `d` description, `m` more. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-pc', cls]} {...rest}>{@render children?.()}</div>

<style>
  .bs-pc.d {
    width: 28%;
    font-family: var(--font-ui);
    color: var(--color-text-muted);
  }

  .bs-pc:last-child {
    border-right: 0;
  }

  .bs-pc.v {
    flex: 1;
    border-right: 0;
  }

  .bs-pc.k {
    width: 34%;
    border-right: 0;
  }

  .bs-pc:is(.k, .v, .d) {
    flex: 1 1 0;
    width: auto;
  }

  :global(.bs .bs-pr.disabled:not(.ph)) .bs-pc:is(.k, .v) :global(input) {
    color: var(--color-text-muted);
  }

  :where(.bs-pc).k {
    font-family: var(--mono);
    color: var(--accent);
  }

  :where(.bs-pc).v {
    font-family: var(--mono);
  }

  :where(.bs-pc).c {
    display: flex;
    align-items: center;
    border-right: 0.5px solid var(--sepsoft);
  }

  .bs-pc :global(input) {
    background: transparent;
    border: none;
  }

  .bs-pc.c :global(input[type='checkbox']) {
    width: 15px;
    height: 15px;
    border-radius: 4px;
    accent-color: var(--accent);
    cursor: pointer;
  }

  :global(.bs-pr.disabled) .bs-pc.k {
    opacity: 0.45;
  }

  :global(.bs-pr.disabled) .bs-pc.v {
    opacity: 0.45;
  }

  :global(.bs-pr.disabled) .bs-pc.d {
    opacity: 0.45;
  }

  :global(:where(.bs-headers)) .bs-pc.d {
    display: flex;
    align-items: center;
  }

  .bs-pc :global(input[type='checkbox']) {
    appearance: auto;
    accent-color: var(--primary);
    border-radius: 3px;
  }

  @media (max-width: 480px) {
    .bs-pc.d {
      display: none;
    }
  }

  .bs-pc {
    display: flex;
    align-items: center;
    min-width: 0;
    padding: 0 10px;
    border-right: 0;
    border-left: 1px solid var(--color-border-subtle);
    font: var(--font-size-body) var(--font-code);
    color: var(--color-text);
  }

  .bs-pc.m {
    flex: 0 0 32px;
    width: 32px;
    padding: 0;
    border-left: 0;
  }

  .bs-pc.c {
    flex: 0 0 36px;
    width: 36px;
    padding: 0;
    justify-content: center;
    border-left: 0;
  }

  .bs-pc.d :global(input) {
    font-family: var(--font-ui);
    color: var(--color-text-muted);
  }

  :global(.bs-pr.h) .bs-pc {
    font: 500 var(--font-size-caption) var(--font-ui);
    color: var(--color-text-muted);
    letter-spacing: 0;
    text-transform: none;
  }

  .bs-pc :global(input::placeholder) {
    color: var(--color-text-muted);
  }

  @media (max-width: 1099px) {
    .bs-pc.d {
      display: none;
    }
  }

  :global(.bs) .bs-pc :global(input[type='checkbox']:disabled) {
    cursor: default;
  }
</style>
