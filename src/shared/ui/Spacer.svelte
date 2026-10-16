<!-- Flexible space that pushes the following items of a flex row to the end (was `.bs-spacer`). -->
<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null };

  let { class: cls, ref = $bindable(), ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-spacer', cls]} {...rest}></div>

<style>
  .bs-spacer {
    flex: 1;
  }
</style>
