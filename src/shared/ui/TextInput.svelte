<!-- A plain text field of dialogs (was `.bs-input`); `aria-invalid` shows the error look. -->
<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  type Props = HTMLInputAttributes & { ref?: HTMLInputElement | null };

  let { class: cls, value = $bindable(), ref = $bindable(), ...rest }: Props = $props();
</script>

<input bind:value bind:this={ref} class={['bs-input', cls]} {...rest} />

<style>
  /* Controls shared by several areas: buttons, segmented controls, switches, pills, tooltips, key-value cells. */
  .bs-input {
    width: 100%;
    height: 40px;
    padding: 0 12px;
    font-size: 14px;
    color: var(--text);
    outline: none;
    box-shadow: none;
    border: 1px solid var(--sep);
    border-radius: 5px;
    background: var(--inset);
  }

  .bs-input[aria-invalid='true'] {
    border-style: dashed;
    border-color: var(--text);
  }

  .bs-input:focus {
    border-color: var(--accent);
    box-shadow: var(--focus-ring);
  }
</style>
