<!-- Token / session time-left pill (was `.bs-oa-pill`): `bad` when expired, `dead`, `none` when there is no token. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLSpanElement> & { ref?: HTMLSpanElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<span bind:this={ref} class={['bs-oa-pill', cls]} {...rest}>{@render children?.()}</span>

<style>
  :global(.bs) .bs-oa-pill.none {
    background: var(--color-selected);
    color: var(--color-text-secondary);
  }

  :global(.bs) .bs-oa-pill {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 8px;
    border-radius: var(--radius-control);
    background: var(--color-success-soft);
    color: var(--color-success);
    font: 600 var(--font-size-caption) var(--font-ui);
    white-space: nowrap;
  }

  :global(.bs) .bs-oa-pill.bad {
    background: var(--color-warning-soft);
    color: var(--color-warning);
  }

  :global(.bs .bs-auth-card .row) .bs-oa-pill + :global(.env) {
    margin-left: 0;
  }
</style>
