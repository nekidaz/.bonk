<!-- A key/value editor panel (was `.bs-pwrap`): a <KvHead> then a <KvTable>. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-pwrap', cls]} {...rest}>{@render children?.()}</div>

<style>
  /* Params / key-value tables: a field-coloured card */
  .bs-pwrap {
    flex: 1;
    min-height: 0;
    overflow: auto;
    contain: layout paint;
    padding: 14px 20px 16px;
  }

  :global(.bs .bs-reqpane) > .bs-pwrap {
    flex: 0 1 auto;
  }

  :global(:root[data-density='compact']) .bs-pwrap {
    padding: 10px 14px;
  }

  @media (max-width: 760px) {
    .bs-pwrap {
      padding-left: 12px;
      padding-right: 12px;
    }
  }
</style>
