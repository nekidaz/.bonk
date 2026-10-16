<!-- A Source Control view in the main area (was `.bs-gview`): <GitHead>, then <GitViewBody> or <GitViewEmpty>. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-gview', cls]} {...rest}>{@render children?.()}</div>

<style>
  .bs-gview {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
</style>
