<!-- The request editor panel under the tabs (was `.bs-reqpane`). -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-reqpane', cls]} {...rest}>{@render children?.()}</div>

<style>
  :global(.bs .bs-main:has(.bs-grpc-message)) .bs-reqpane {
    flex-grow: 1;
  }

  /* Flexible request pane between the request tabs and the response. */
  .bs-reqpane {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    contain: layout paint;
    background: var(--canvas);
  }

  /* The request pane takes its content height; the response card fills the rest until resized. */
  :global(.bs) .bs-reqpane {
    flex: 0 1 auto;
  }

  :global(.bs .bs-main:has(> .bs-resp-host:is(.closed, [style*='flex']))) .bs-reqpane {
    flex-grow: 1;
  }
</style>
