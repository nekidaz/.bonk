<!-- A compact native select in the settings look (was `.st-select`). -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLSelectAttributes } from 'svelte/elements';

  type Props = HTMLSelectAttributes & { ref?: HTMLSelectElement | null; children?: Snippet };

  let { class: cls, value = $bindable(), ref = $bindable(), children, ...rest }: Props = $props();
</script>

<select bind:value bind:this={ref} class={['st-select', cls]} {...rest}>{@render children?.()}</select>

<style>
  *:where(.st-select) {
    flex: 0 0 auto;
    min-width: 160px;
    height: 32px;
    padding: 0 28px 0 12px;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23888' stroke-width='1.5'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 11px center;
    background-size: auto;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    background-color: var(--color-panel);
    color: inherit;
    font: var(--font-size-body) var(--font-ui);
  }

  .st-select:focus {
    outline: 0;
    border-color: var(--color-text-muted);
  }
</style>
