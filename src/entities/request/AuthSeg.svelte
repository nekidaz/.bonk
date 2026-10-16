<!-- A small segmented radio group of the auth editors (was `.bs-auth-seg`): <button>s, `.on` for the picked one. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLSpanElement> & { ref?: HTMLSpanElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<span bind:this={ref} class={['bs-auth-seg', cls]} {...rest}>{@render children?.()}</span>

<style>
  :global(.bs) .bs-auth-seg {
    display: inline-flex;
    height: 30px;
    padding: 2px;
    gap: 2px;
    outline: 1px solid var(--color-border-subtle);
    outline-offset: -1px;
    border-radius: var(--radius-control);
    background: var(--color-field);
  }

  :global(.bs) .bs-auth-seg :global(button) {
    padding: 0 12px;
    border-radius: var(--radius-control);
    color: var(--color-text-secondary);
    font: 500 var(--font-size-caption) var(--font-ui);
  }

  :global(.bs) .bs-auth-seg :global(button.on) {
    background: var(--color-raised);
    color: var(--color-text);
    font-weight: 600;
  }
</style>
