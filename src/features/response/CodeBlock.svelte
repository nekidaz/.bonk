<!-- Highlighted code text (was `.bs-code`): token spans `.s2` `.n2` `.b2` `.pu` …; keeps whitespace. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-code', cls]} {...rest}>{@render children?.()}</div>

<style>
  .bs-code :global(:where(.k)) {
    color: var(--sk);
  }

  .bs-code {
    font-family: var(--mono);
    white-space: pre;
    word-break: normal;
    overflow-wrap: normal;
    font-size: 12px;
    line-height: 1.65;
  }

  :global(.bs-rbody) .bs-code {
    font: var(--font-size-body)/20px var(--font-code);
  }
</style>
