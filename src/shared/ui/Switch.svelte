<!--
  The app's on/off toggle (was the global `.mono-switch` class): a <button role="switch">.
  Toggling is the caller's job: `<Switch checked={x} aria-label=… onclick={() => setX(!x)} />`.
  Any other <button> attribute passes through.
-->
<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';

  type Props = Omit<HTMLButtonAttributes, 'children'> & { checked: boolean };

  let { checked, ...rest }: Props = $props();
</script>

<button type="button" role="switch" aria-checked={checked} class="mono-switch" {...rest}></button>

<style>
  .mono-switch {
    flex: none;
    position: relative;
    width: 30px;
    height: 18px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-control);
    background: var(--color-hover-strong);
    cursor: pointer;
    transition: background-color var(--duration-hover) var(--ease-soft);
  }

  .mono-switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--color-text-secondary);
    transition: transform var(--duration-press) var(--ease-soft);
  }

  .mono-switch[aria-checked='true'] {
    background: var(--color-action);
  }

  .mono-switch[aria-checked='true']::after {
    transform: translateX(12px);
    background: var(--color-on-action);
  }

  .mono-switch:disabled {
    cursor: default;
  }

  .mono-switch:focus-visible {
    outline: 2px solid var(--color-text);
    outline-offset: 2px;
    box-shadow: var(--focus-ring);
  }

  @media (prefers-reduced-motion: reduce) {
    .mono-switch,
    .mono-switch::after {
      transition: none;
    }
  }
</style>
