<!-- A body/message editor panel (was `.bs-http-body`): head row and a <BodyCode>. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-http-body', cls]} {...rest}>{@render children?.()}</div>

<style>
  .bs-http-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: color-mix(in srgb, var(--surface) 20%, transparent);
  }

  /* S10: body editor. */
  :global(.bs) .bs-http-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
    padding: 10px 20px 12px;
  }
</style>
