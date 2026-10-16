<!-- The «Save to / Move to» line of the folder dialogs (was `.bs-saveto`). -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-saveto', cls]} {...rest}>{@render children?.()}</div>

<style>
  .bs-saveto {
    font-size: 13px;
    font-weight: 600;
    margin: 16px 0 8px;
  }

  .bs-saveto :global(span) {
    color: var(--t3);
    font-weight: 400;
  }
</style>
