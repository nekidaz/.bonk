<!-- The invisible full-window button behind a popup menu; a click outside closes it (was `.bs-backdrop`). -->
<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';

  type Props = HTMLButtonAttributes & { ref?: HTMLButtonElement | null };

  let { class: cls, ref = $bindable(), ...rest }: Props = $props();
</script>

<button bind:this={ref} class={['bs-backdrop', cls]} {...rest}></button>

<style>
  .bs-backdrop {
    position: fixed;
    inset: 0;
    z-index: 79;
  }
</style>
