<!--
  A key/value cell's text field that knows `{{variables}}`: the same one-line CodeMirror as the URL bar,
  with the coloured chip and the hover popover that sets or edits the variable's value.
-->
<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { tooltips } from '@codemirror/view';
  import { CodeEditor } from '$shared/editor/components';
  import { tooltipHost } from '$shared/editor';
  import { environments, requestVariableHighlight } from '$entities/environment';

  type Props = Omit<HTMLAttributes<HTMLDivElement>, 'onchange'> & {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    /** Identity of the field (tab + row): a change gives it a fresh undo history. */
    docId: string;
    ariaLabel?: string;
    onEnter?: () => void;
  };

  let { value, onChange, placeholder = '', docId, ariaLabel, onEnter, class: cls, ...rest }: Props = $props();

  // The row clips (`contain: paint`), so the popover lives in the app-wide tooltip layer.
  const varHighlight = $derived([
    requestVariableHighlight(environments.globals, environments.list, environments.activeId),
    tooltips({ parent: tooltipHost() }),
  ]);
</script>

<div class={['kv-var', cls]} {...rest}>
  <CodeEditor {value} {onChange} singleLine {placeholder} {onEnter} {varHighlight} {docId} {ariaLabel} />
</div>

<style>
  .kv-var {
    flex: 1;
    min-width: 0;
    align-self: stretch;
    display: flex;
  }

  /* Look like the cell's plain <input>: its font, no inner padding. */
  .kv-var :global(.cm-editor) {
    font: inherit;
    color: inherit;
  }

  .kv-var :global(.cm-scroller) {
    font-family: inherit;
    line-height: inherit;
  }

  .kv-var :global(.cm-line) {
    padding: 0;
  }

  .kv-var :global(.cm-placeholder) {
    color: var(--color-text-muted);
  }
</style>
