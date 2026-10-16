<!-- A text field of the settings sheets (was `.st-text`). -->
<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  type Props = HTMLInputAttributes & { ref?: HTMLInputElement | null };

  let { class: cls, value = $bindable(), ref = $bindable(), ...rest }: Props = $props();
</script>

<input bind:value bind:this={ref} class={['st-text', cls]} {...rest} />

<style>
  .st-text {
    width: 100%;
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    background: var(--color-panel);
    color: inherit;
    font: var(--font-size-body) var(--font-code);
    box-sizing: border-box;
  }

  .st-text:focus {
    outline: 0;
    border-color: var(--color-text-muted);
  }

  .st-text[aria-invalid='true'] {
    border-color: var(--red);
  }
</style>
