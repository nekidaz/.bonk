<!-- The scrolling response body area (was `.bs-rbody`); `pretty` for highlighted JSON. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-rbody', cls]} {...rest}>{@render children?.()}</div>

<style>
  .bs-rbody:has(:global(.bs-response-gutter)) {
    padding-left: 0;
  }

  :where(.bs-rbody).pretty {
    padding: 0;
    background: var(--canvas);
  }

  .bs-rbody {
    flex: 1;
    min-height: 0;
    overflow: auto;
    contain: layout paint;
    padding: 12px 16px;
    border-radius: 0;
    background: transparent;
  }
</style>
