<!-- A settings row (was `.st-row`): `.st-copy` (name + description) and a control. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['st-row', cls]} {...rest}>{@render children?.()}</div>

<style>
  .st-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 11px 0;
    min-height: 53px;
  }

  :global(.st-row) + .st-row {
    border-top: 1px solid var(--color-border-subtle);
  }

  .st-col {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }
</style>
