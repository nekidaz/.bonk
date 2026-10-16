<!-- The dialog's action row (was `.bs-modal-f`); a `.grow` spacer pushes the buttons right. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-modal-f', cls]} {...rest}>{@render children?.()}</div>

<style>
  .bs-modal-f :global(.grow) {
    flex: 1;
  }

  .bs-modal-f {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 13px;
    background: var(--side);
    border-top: 1px solid var(--sep);
  }
</style>
