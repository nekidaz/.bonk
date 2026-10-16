<!-- The key/value panel title row (was `.bs-qp`): a `.t` title with the count. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-qp', cls]} {...rest}>{@render children?.()}</div>

<style>
  .bs-qp {
    display: flex;
    align-items: center;
    margin-bottom: 10px;
  }

  .bs-qp :global(.t) {
    font: 500 var(--font-size-micro) var(--font-code);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: var(--tracking-eyebrow);
  }

  :global(.bs) .bs-qp.manual {
    display: none;
  }

  .bs-qp :global(.be) {
    font-size: 12px;
    color: var(--t2);
    margin-left: auto;
  }
</style>
