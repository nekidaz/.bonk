<!-- The full-window click-catcher behind a Source Control popup (was `.bs-gitlayer`). -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-gitlayer', cls]} {...rest}>{@render children?.()}</div>

<style>
  /* Behind a git popover: catches the click outside it that closes it. */
  .bs-gitlayer {
    position: fixed;
    inset: 0;
    z-index: 59;
  }
</style>
