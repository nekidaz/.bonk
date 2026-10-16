<!-- A Source Control segmented toggle (was `.bs-gseg`): <button>s, `.on` for the picked one. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-gseg', cls]} {...rest}>{@render children?.()}</div>

<style>
  .bs-gseg {
    flex: none;
    display: inline-flex;
    gap: 2px;
    height: 34px;
    padding: 2px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    background: var(--color-field);
  }

  .bs-gseg :global(button) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 34px;
    padding: 0 12px;
    border-radius: var(--radius-control);
    color: var(--color-text-secondary);
    font: 500 var(--font-size-body) var(--font-ui);
  }

  .bs-gseg :global(button.icon) {
    padding: 0;
  }

  .bs-gseg :global(button.on) {
    background: var(--color-raised);
    color: var(--color-text);
    font-weight: 600;
  }

  .bs-gseg :global(.material-symbols-outlined) {
    font-size: 17px;
  }
</style>
