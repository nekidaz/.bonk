<!-- A Source Control error block (was `.bs-git-diff-error`): monospace, keeps line breaks. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-git-diff-error', cls]} {...rest}>{@render children?.()}</div>

<style>
  .bs-git-diff-error {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 10px;
    background: var(--inset);
    font-size: 13px;
    padding: 18px;
    justify-content: flex-start;
    align-items: flex-start;
    color: var(--red);
    font-family: var(--mono);
    white-space: pre-wrap;
  }
</style>
