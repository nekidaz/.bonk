<!-- A small Source Control tag (was `.bs-gtag`): a status letter in <b> and a word. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLSpanElement> & { ref?: HTMLSpanElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<span bind:this={ref} class={['bs-gtag', cls]} {...rest}>{@render children?.()}</span>

<style>
  .bs-gtag {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 22px;
    padding: 0 9px;
    border-radius: var(--radius-control);
    background: var(--color-selected);
    color: var(--color-text-secondary);
    font: 500 var(--font-size-caption) var(--font-code);
    white-space: nowrap;
  }
</style>
