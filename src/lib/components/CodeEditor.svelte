<script lang="ts" module>
  /** Languages the editor can highlight. `text` = plain, no syntax colors. */
  export type CodeEditorLang = 'javascript' | 'json' | 'text';
</script>

<script lang="ts">
  /**
   * Reusable CodeMirror 6 editor themed with the app's CSS variables, so light
   * and dark mode adapt automatically when `.dark` toggles — no re-mount
   * needed. Used by the request body editor and the pre-request/test script
   * editors.
   *
   * - `value` flows in as a plain prop; edits flow out through `onChange`
   *   (matching the store-driven `updateActiveTab` pattern used everywhere).
   * - `docId` should identify the underlying document (e.g. the tab id): when
   *   it changes the editor state is rebuilt so undo history and cursor never
   *   bleed across tabs. Other external `value` changes are applied as a doc
   *   replacement without recreating the state.
   * - `completions` switches autocomplete to a custom dictionary whose labels
   *   may be dotted paths (`pm.environment.set`), matched against the dotted
   *   identifier before the cursor.
   */
  import { EditorState, Compartment, type Extension } from '@codemirror/state';
  import {
    EditorView,
    keymap,
    lineNumbers,
    drawSelection,
    highlightActiveLine,
    highlightActiveLineGutter,
    placeholder as cmPlaceholder,
  } from '@codemirror/view';
  import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
  import {
    bracketMatching,
    indentOnInput,
    indentUnit,
    syntaxHighlighting,
    HighlightStyle,
  } from '@codemirror/language';
  import {
    autocompletion,
    closeBrackets,
    closeBracketsKeymap,
    completionKeymap,
    type Completion,
    type CompletionContext,
    type CompletionResult,
  } from '@codemirror/autocomplete';
  import { javascript } from '@codemirror/lang-javascript';
  import { json } from '@codemirror/lang-json';
  import { tags } from '@lezer/highlight';

  let {
    value,
    onChange,
    lang = 'text',
    placeholder = '',
    completions,
    minHeight = '96px',
    maxHeight,
    fill = false,
    docId,
    ariaLabel,
  }: {
    value: string;
    onChange: (value: string) => void;
    lang?: CodeEditorLang;
    placeholder?: string;
    completions?: Completion[];
    minHeight?: string;
    /** Cap growth; the editor scrolls internally past this. Ignored with `fill`. */
    maxHeight?: string;
    /** Fill the parent (flex) instead of growing with content. */
    fill?: boolean;
    /** Identity of the document; a change rebuilds state (fresh undo history). */
    docId?: string;
    ariaLabel?: string;
  } = $props();

  let host: HTMLDivElement | undefined = $state();
  let view: EditorView | undefined;
  let lastDocId: string | undefined;
  /** True while an external `value`/`docId` change is being applied. */
  let syncingFromProp = false;

  const langCompartment = new Compartment();
  const placeholderCompartment = new Compartment();

  function langExtension(l: CodeEditorLang): Extension {
    if (l === 'javascript') return javascript();
    if (l === 'json') return json();
    return [];
  }

  /**
   * Completion source over a fixed dictionary whose labels can be dotted
   * paths. Matches the (possibly dotted) identifier before the cursor, so
   * typing `pm.` or a partial ident narrows the list.
   */
  function dictionaryCompletions(options: Completion[]) {
    return (ctx: CompletionContext): CompletionResult | null => {
      const word = ctx.matchBefore(/[\w$][\w$.]*/);
      if (!word && !ctx.explicit) return null;
      return { from: word ? word.from : ctx.pos, options, validFor: /^[\w$.]*$/ };
    };
  }

  /**
   * Syntax colors come from the app's syntax-token CSS variables (see
   * 01-base.css); `HighlightStyle` values are plain CSS, so `var(--sk)` etc.
   * re-resolve when `.dark` toggles.
   */
  const highlight = HighlightStyle.define([
    { tag: [tags.keyword, tags.operatorKeyword, tags.modifier, tags.self], color: 'var(--sk)' },
    { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--ss)' },
    { tag: [tags.number, tags.bool, tags.atom, tags.null], color: 'var(--sn)' },
    {
      tag: [
        tags.propertyName,
        tags.function(tags.variableName),
        tags.function(tags.propertyName),
        tags.definition(tags.variableName),
      ],
      color: 'var(--sb)',
    },
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--sp)', fontStyle: 'italic' },
  ]);

  function themeExtension(): Extension {
    return EditorView.theme({
      '&': {
        fontSize: '12px',
        backgroundColor: 'var(--inset)',
        color: 'var(--text)',
        border: '0.5px solid var(--sep)',
        borderRadius: '7px',
        ...(fill ? { height: '100%' } : maxHeight ? { maxHeight } : {}),
      },
      '&.cm-focused': {
        outline: 'none',
        borderColor: 'color-mix(in srgb, var(--accent) 62%, var(--sep))',
        boxShadow: '0 0 0 2.5px color-mix(in srgb, var(--accent) 15%, transparent)',
      },
      '.cm-scroller': {
        fontFamily: 'var(--mono)',
        lineHeight: '1.6',
        borderRadius: '7px',
        overflow: 'auto',
        ...(fill ? {} : { minHeight }),
      },
      '.cm-content': { padding: '9px 0', caretColor: 'var(--accent)' },
      '.cm-line': { padding: '0 12px' },
      '.cm-gutters': {
        backgroundColor: 'var(--inset)',
        color: 'var(--t3)',
        border: 'none',
        borderRight: '0.5px solid var(--sepsoft)',
        borderTopLeftRadius: '7px',
        borderBottomLeftRadius: '7px',
        fontSize: '11px',
      },
      '.cm-lineNumbers .cm-gutterElement': { padding: '0 7px 0 13px', minWidth: '32px' },
      '.cm-activeLine': { backgroundColor: 'var(--hover2)' },
      '.cm-activeLineGutter': { backgroundColor: 'var(--hover2)', color: 'var(--t2)' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': {
        background: 'color-mix(in srgb, var(--accent) 26%, transparent)',
      },
      '.cm-selectionMatch': { background: 'color-mix(in srgb, var(--accent) 13%, transparent)' },
      '.cm-placeholder': { color: 'var(--t3)' },
      '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': {
        background: 'color-mix(in srgb, var(--accent) 18%, transparent)',
        outline: 'none',
      },
      '.cm-tooltip': {
        backgroundColor: 'var(--surface)',
        color: 'var(--text)',
        border: '0.5px solid var(--sep)',
        borderRadius: '9px',
        overflow: 'hidden',
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.18), 0 0 0 0.5px rgba(0, 0, 0, 0.04)',
      },
      '.cm-tooltip.cm-tooltip-autocomplete > ul': {
        fontFamily: 'var(--mono)',
        fontSize: '11.5px',
        maxHeight: '196px',
      },
      '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
        padding: '3px 9px',
        color: 'var(--t2)',
      },
      '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        background: 'var(--accent)',
        color: '#fff',
      },
      '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail': {
        color: 'rgba(255, 255, 255, 0.78)',
      },
      '.cm-completionLabel': { color: 'inherit' },
      '.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '700', color: 'inherit' },
      '.cm-completionDetail': { color: 'var(--t3)', fontStyle: 'normal', marginLeft: '8px' },
      '.cm-completionIcon': { display: 'none' },
      '.cm-tooltip .cm-completionInfo': {
        fontFamily: 'inherit',
        fontSize: '11.5px',
        color: 'var(--t2)',
        padding: '7px 10px',
        maxWidth: '260px',
      },
      '.cm-panels': { backgroundColor: 'var(--surface)', color: 'var(--text)' },
    });
  }

  function buildExtensions(): Extension[] {
    return [
      lineNumbers(),
      history(),
      drawSelection(),
      indentUnit.of('  '),
      EditorState.tabSize.of(2),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      autocompletion(
        completions && completions.length > 0
          ? { override: [dictionaryCompletions(completions)] }
          : {},
      ),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...completionKeymap,
        indentWithTab,
      ]),
      langCompartment.of(langExtension(lang)),
      placeholderCompartment.of(cmPlaceholder(placeholder)),
      syntaxHighlighting(highlight),
      themeExtension(),
      ...(ariaLabel ? [EditorView.contentAttributes.of({ 'aria-label': ariaLabel })] : []),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || syncingFromProp) return;
        const text = update.state.doc.toString();
        if (text !== value) onChange(text);
      }),
    ];
  }

  function createState(doc: string): EditorState {
    return EditorState.create({ doc, extensions: buildExtensions() });
  }

  // Create/destroy the view when the host element (dis)appears. Everything the
  // initial state reads (value, lang, …) is intentionally captured untracked:
  // later changes are handled by the sync effects below, not by re-creating.
  $effect(() => {
    if (!host) return;
    lastDocId = docId;
    const created = new EditorView({ state: createState(value), parent: host });
    view = created;
    return () => {
      created.destroy();
      if (view === created) view = undefined;
    };
  });

  // External doc sync. A `docId` change (tab switch) rebuilds the state so the
  // new tab gets a fresh cursor + undo history; a plain `value` change (e.g.
  // Beautify) is applied as a document replacement. Both are guarded so the
  // update listener doesn't echo the change back into `onChange`.
  $effect(() => {
    const nextValue = value;
    const nextDocId = docId;
    if (!view) return;
    syncingFromProp = true;
    try {
      if (nextDocId !== lastDocId) {
        lastDocId = nextDocId;
        view.setState(createState(nextValue));
      } else {
        const current = view.state.doc.toString();
        if (nextValue !== current) {
          view.dispatch({ changes: { from: 0, to: current.length, insert: nextValue } });
        }
      }
    } finally {
      syncingFromProp = false;
    }
  });

  // Live-reconfigure language + placeholder (e.g. raw body JSON → Text).
  $effect(() => {
    const l = lang;
    const p = placeholder;
    if (!view) return;
    view.dispatch({
      effects: [
        langCompartment.reconfigure(langExtension(l)),
        placeholderCompartment.reconfigure(cmPlaceholder(p)),
      ],
    });
  });

  /**
   * Insert `text` at the cursor (replacing any selection) and focus the
   * editor. If the cursor sits after other content on its line, the snippet is
   * pushed to a fresh line first. Used by the snippets panel.
   */
  export function insertText(text: string): void {
    if (!view) return;
    const { state } = view;
    const range = state.selection.main;
    const line = state.doc.lineAt(range.from);
    const beforeCursor = state.doc.sliceString(line.from, range.from);
    const prefix = beforeCursor.trim().length > 0 ? '\n' : '';
    const insert = `${prefix}${text}\n`;
    view.dispatch({
      changes: { from: range.from, to: range.to, insert },
      selection: { anchor: range.from + insert.length },
      scrollIntoView: true,
    });
    view.focus();
  }
</script>

<div class="bs-code-editor" class:fill bind:this={host}></div>

<style>
  .bs-code-editor {
    min-width: 0;
  }
  .bs-code-editor.fill {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .bs-code-editor.fill :global(.cm-editor) {
    flex: 1;
    min-height: 0;
  }
</style>
