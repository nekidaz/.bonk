<!-- Body size and line count in the tab row (was `.lb-stats`); a `.bad` part for invalid JSON. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLSpanElement> & { ref?: HTMLSpanElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<span bind:this={ref} class={['lb-stats', cls]} {...rest}>{@render children?.()}</span>

<style>
  .lb-stats {
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-code);
    white-space: pre;
  }

  .lb-stats :global(.bad) {
    color: var(--color-danger);
    font-weight: 500;
  }
</style>
