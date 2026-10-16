<!-- The framed code editor of a body panel (was `.bs-body-cm`); `invalid` when the content does not parse. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-body-cm', cls]} {...rest}>{@render children?.()}</div>

<style>
  :global(.bs .bs-http-body) .bs-body-cm {
    flex: 1 1 auto;
    min-height: 0;
    margin: 0;
    padding: 12px 0;
    border: 0;
    outline: 1px solid var(--color-border-subtle);
    outline-offset: -1px;
    border-radius: var(--radius-card);
    background: var(--color-field);
    overflow: auto;
  }

  .bs-body-cm.invalid :global(.cm-editor) {
    border-color: color-mix(in srgb, var(--red) 58%, var(--sep));
  }

  .bs-body-cm.invalid :global(.cm-editor.cm-focused) {
    border-color: color-mix(in srgb, var(--red) 70%, var(--sep));
    box-shadow: 0 0 0 2.5px color-mix(in srgb, var(--red) 14%, transparent);
  }

  /* CodeMirror-backed raw/GraphQL/binary body editor. */
  .bs-body-cm {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 12px 16px 14px;
    border-radius: var(--radius-card);
  }

  :global(.bs .bs-http-body) .bs-body-cm :global(.cm-editor) {
    border: 0;
    outline: none;
    background: transparent;
  }

  :global(.bs .bs-http-body) .bs-body-cm :global(.cm-gutters) {
    outline: none;
    background: transparent;
    border: 0;
    color: var(--color-text-muted);
  }

  :global(.bs .bs-http-body) .bs-body-cm :global(.cm-lineNumbers .cm-gutterElement) {
    box-sizing: border-box;
    min-width: 44px;
    padding: 0 12px 0 0;
    text-align: right;
    font: var(--font-size-body)/20px var(--font-code);
  }

  :global(.bs .bs-http-body) .bs-body-cm :global(.cm-content) {
    padding: 0;
    font: var(--font-size-body)/20px var(--font-code);
  }

  :global(.bs .bs-http-body) .bs-body-cm :global(.cm-line) {
    padding: 0;
  }

  :global(.bs .bs-http-body) .bs-body-cm :global(.cm-activeLine) {
    background: transparent;
  }

  :global(.bs .bs-http-body) .bs-body-cm :global(.cm-activeLineGutter) {
    background: transparent;
  }

  :global(.bs) .bs-body-cm.invalid {
    border-color: var(--color-warning);
    box-shadow: 0 0 0 1px var(--color-warning-soft);
  }
</style>
