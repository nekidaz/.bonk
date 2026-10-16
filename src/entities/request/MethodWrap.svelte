<!-- The method picker slot at the left of the address field (was `.bs-method-wrap`): a <MethodButton> and its menu. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-method-wrap', cls]} {...rest}>{@render children?.()}</div>

<style>
  .bs-method-wrap {
    position: relative;
    flex-shrink: 0;
    height: 36px;
    margin: auto 0;
    border: 0;
  }

  .bs-method-wrap::after {
    content: '';
    position: absolute;
    right: -11px;
    top: 10px;
    width: 1px;
    height: 18px;
    background: var(--color-border);
  }

  :global(:root[data-density='compact']) .bs-method-wrap {
    height: 28px;
  }

  :global(:root[data-density='compact']) .bs-method-wrap::after {
    top: 5px;
  }
</style>
