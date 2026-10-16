<!-- A key/value row (was `.bs-pr`): <KvCell>s. `h` header, `disabled`, `ph` (the empty last row), `auto` (auto-added header). -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-pr', cls]} {...rest}>{@render children?.()}</div>

<style>
  .bs-pr:where(:not(.h)):hover {
    background: var(--hover2);
  }

  :global(:where(.bs-headers)) .bs-pr {
    min-height: 38px;
  }

  .bs-pr {
    display: flex;
    contain: paint;
    min-height: 34px;
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .bs-pr:last-child {
    border-bottom: 0;
  }

  .bs-pr.h {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--t2);
    min-height: 32px;
    background: transparent;
  }

  :global(.bs) .bs-pr.ph :global(input[type='checkbox']) {
    border-color: var(--color-border);
    background: transparent;
  }

  :global(.bs) .bs-pr.ph :global(input[type='checkbox']::after) {
    content: none;
  }

  :global(:root[data-density='compact']) .bs-pr {
    min-height: 28px;
  }

  :global(:root[data-density='compact']) .bs-pr.h {
    min-height: 26px;
  }
</style>
