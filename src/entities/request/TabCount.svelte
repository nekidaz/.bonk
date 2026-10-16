<!-- The count next to a tab label (was `.bs-tab-count`); `bad` when something failed. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLSpanElement> & { ref?: HTMLSpanElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<span bind:this={ref} class={['bs-tab-count', cls]} {...rest}>{@render children?.()}</span>

<style>
  .bs-tab-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: var(--mono);
    font-weight: 650;
    min-width: 16px;
    height: 16px;
    border-radius: 3px;
    padding: 0;
    background: transparent;
    color: var(--green);
    font-size: 11px;
  }

  .bs-tab-count::before {
    content: '(';
  }

  .bs-tab-count::after {
    content: ')';
  }

  :global(.bs) .bs-tab-count {
    display: inline-flex;
    align-items: center;
    height: 16px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--color-selected);
    color: var(--color-text-secondary);
    font: 600 var(--font-size-micro) var(--font-ui);
  }

  :global(.bs) .bs-tab-count::before {
    content: none;
  }

  :global(.bs) .bs-tab-count::after {
    content: none;
  }

  :global(.bs .bs-rtab.on) .bs-tab-count {
    color: var(--color-text);
  }

  /* Flow · Скрипты SC6: the Scripts tab's count turns red when a script failed. */
  :global(.bs) .bs-tab-count.bad {
    background: var(--color-danger-soft);
    color: var(--color-danger);
  }

  :global(.bs .bs-rtab.on) .bs-tab-count.bad {
    background: var(--color-danger-soft);
    color: var(--color-danger);
  }
</style>
