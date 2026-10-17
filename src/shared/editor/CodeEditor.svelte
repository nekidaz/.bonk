<script lang="ts" module>
  /** Languages the editor can highlight. `text` = plain, no syntax colors. */
  export type CodeEditorLang = 'javascript' | 'json' | 'json-lite' | 'graphql' | 'text';
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
  import { untrack } from 'svelte';
  import { EditorState, Compartment, type Extension, type Transaction, type TransactionSpec } from '@codemirror/state';
  import {
    EditorView,
    keymap,
    lineNumbers,
    drawSelection,
    highlightActiveLine,
    highlightActiveLineGutter,
    placeholder as cmPlaceholder,
    tooltips,
  } from '@codemirror/view';
  import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
  import { bracketMatching, indentOnInput, indentUnit, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
  import {
    autocompletion,
    closeBrackets,
    closeBracketsKeymap,
    completionKeymap,
    type Completion,
    type CompletionContext,
    type CompletionSource,
    type CompletionResult,
  } from '@codemirror/autocomplete';
  import { javascript } from '@codemirror/lang-javascript';
  import { json } from '@codemirror/lang-json';
  import { graphqlLanguageSupport } from 'cm6-graphql';
  import { foldKeymap } from '@codemirror/language';
  import { search, searchKeymap } from '@codemirror/search';
  import { createFindPanel } from './findPanel';
  import { linter, type Diagnostic } from '@codemirror/lint';
  import { tags } from '@lezer/highlight';
  import { lineHighlight } from './lineHighlight';
  import { foldLargeArrays, largeFolding } from './largeFold';
  import { jsonProblem } from './jsonLint';
  import { jsonErrorMessage } from './jsonEditor';
  import { revealLine } from './scriptMarks';
  import { extraCompletionSource, tooltipHost, trackFocus } from './editorRegistry';

  let {
    value,
    onChange,
    lang = 'text',
    placeholder = '',
    completions,
    completionSource,
    completionFooter,
    minHeight = '96px',
    maxHeight,
    fill = false,
    singleLine = false,
    onEnter,
    onBlur,
    onPaste,
    varHighlight,
    docId,
    ariaLabel,
    readOnly = false,
    bare = false,
    folding,
    autoFold = false,
    lintJson = false,
    wrap = false,
    extensions,
  }: {
    value: string;
    onChange: (value: string) => void;
    lang?: CodeEditorLang;
    placeholder?: string;
    completions?: Completion[];
    /**
     * Context-aware completions (e.g. gRPC message fields). Read on every
     * query, so it may close over reactive state. Options may carry a `doc`
     * line shown under the label; `set: true` dims an option.
     */
    completionSource?: CompletionSource;
    /** Hint line under the `completionSource` list (keys legend). */
    completionFooter?: string;
    minHeight?: string;
    /** Cap growth; the editor scrolls internally past this. Ignored with `fill`. */
    maxHeight?: string;
    /** Fill the parent (flex) instead of growing with content. */
    fill?: boolean;
    /**
     * Behave like a styled `<input>`: no gutter/active-line/autocomplete, a
     * transaction filter collapses pasted newlines to spaces, Enter fires
     * `onEnter` instead of inserting a line, and the chrome goes transparent
     * (the host field supplies background/border/focus ring).
     */
    singleLine?: boolean;
    /** `singleLine` only: called when the user presses Enter. */
    onEnter?: () => void;
    /** Called when the editor's content DOM loses focus. */
    onBlur?: () => void;
    /**
     * Intercept paste: return `true` to swallow the paste (e.g. curl import).
     * Returning `false` lets CodeMirror insert the text normally.
     */
    onPaste?: (text: string) => boolean;
    /**
     * Extra extension slot for `{{var}}` decorations, wired through its own
     * compartment so scope changes live-reconfigure instead of remounting.
     */
    varHighlight?: Extension;
    /** Identity of the document; a change rebuilds state (fresh undo history). */
    docId?: string;
    ariaLabel?: string;
    /** Viewer mode: no editing helpers (autocomplete, brackets), but selection, Find (⌘F) and folding work. */
    readOnly?: boolean;
    /** Drop the card chrome (border, radius, fill): the host supplies it. */
    bare?: boolean;
    /** Fold gutter + «ещё N объектов» chips + fold keys. Default: on for multi-line JSON editors. */
    folding?: boolean;
    /** On every (re)loaded document fold the middle of arrays longer than the Settings threshold. */
    autoFold?: boolean;
    /** Underline the first JSON syntax error while typing (lang 'json' only; `{{vars}}` are allowed). */
    lintJson?: boolean;
    /** Soft-wrap long lines. */
    wrap?: boolean;
    /** Host-specific extensions (script run marks, keys), live-reconfigured like `varHighlight`. */
    extensions?: Extension;
  } = $props();

  let host: HTMLDivElement | undefined = $state();
  let view: EditorView | undefined;
  let lastDocId: string | undefined;
  /** True while an external `value`/`docId` change is being applied. */
  let syncingFromProp = false;

  const langCompartment = new Compartment();
  const placeholderCompartment = new Compartment();
  const varCompartment = new Compartment();
  const wrapCompartment = new Compartment();
  const extraCompartment = new Compartment();
  /** Language the lint source checks against (kept in sync by the reconfigure effect). */
  let currentLang = untrack(() => lang);

  /**
   * `singleLine` guard: rewrite any transaction that would insert a newline so
   * the inserted text has its line breaks collapsed to spaces (a multi-line
   * non-curl paste becomes one line). Keyboard Enter never gets this far — the
   * single-line keymap consumes it first.
   */
  function stripNewlines(tr: Transaction): TransactionSpec | Transaction {
    if (!tr.docChanged) return tr;
    let hasNewline = false;
    tr.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
      if (inserted.lines > 1) hasNewline = true;
    });
    if (!hasNewline) return tr;
    const changes: { from: number; to: number; insert: string }[] = [];
    // `\r\n → space` shrinks the text; the original selection would then point
    // past the end. Only reuse it when every replacement kept its length.
    let sameLength = true;
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      const flat = inserted.toString().replace(/\r\n|\r|\n/g, ' ');
      if (flat.length !== inserted.length) sameLength = false;
      changes.push({ from: fromA, to: toA, insert: flat });
    });
    return {
      changes,
      selection: sameLength ? tr.selection : undefined,
      effects: tr.effects,
      scrollIntoView: true,
    };
  }

  function langExtension(l: CodeEditorLang): Extension {
    if (l === 'javascript') return javascript();
    if (l === 'json') return json();
    if (l === 'graphql') return graphqlLanguageSupport();
    // Big read-only JSON: tokenizer over the visible lines only (no background parse of the whole document).
    if (l === 'json-lite') return lineHighlight();
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
    // Bonk Mono dims JSON punctuation; palettes without --syntax-punct keep the text colour.
    {
      tag: [tags.punctuation, tags.bracket, tags.separator, tags.brace, tags.squareBracket],
      color: 'var(--syntax-punct, inherit)',
    },
  ]);

  function themeExtension(): Extension {
    // Single-line mode drops the editor's own chrome: the host field
    // (.bs-urlfield / .bs-grpc-endpoint-field) supplies background, border and
    // the :focus-within ring, exactly like it did for the old <input>.
    const chrome: Record<string, Record<string, string>> = singleLine
      ? {
          '&': {
            fontSize: '13.5px',
            backgroundColor: 'transparent',
            color: 'var(--text)',
            height: '100%',
          },
          '&.cm-focused': { outline: 'none' },
          '.cm-scroller': {
            fontFamily: 'var(--mono)',
            lineHeight: '1.5',
            overflow: 'auto',
          },
          '.cm-scroller::-webkit-scrollbar': { display: 'none' },
          // CM's base theme pins content to the top: .cm-scroller gets
          // `align-items: flex-start !important` and .cm-content stretches to
          // min-height:100%. Undo the stretch and center with auto margins —
          // in a flex row, auto margins absorb the free space and win over any
          // align-items, important or not.
          '.cm-content': {
            padding: '0',
            caretColor: 'var(--accent)',
            minHeight: 'auto',
            margin: 'auto 0',
          },
          '.cm-line': { padding: '0 14px' },
        }
      : bare
        ? {
            '&': {
              fontSize: 'var(--code-font-size, 12px)',
              backgroundColor: 'transparent',
              color: 'var(--text)',
              height: '100%',
            },
            '&.cm-focused': { outline: 'none' },
            '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.65', overflow: 'auto' },
            '.cm-content': { padding: '8px 0', caretColor: 'var(--accent)' },
            '.cm-line': { padding: '0 16px 0 8px' },
          }
        : {
            '&': {
              fontSize: 'var(--code-font-size, 12px)',
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
          };
    return EditorView.theme({
      ...chrome,
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
      '.bs-tk-key': { color: 'var(--sb)' },
      '.bs-tk-str': { color: 'var(--ss)' },
      '.bs-tk-lit': { color: 'var(--sn)' },
      '.cm-foldGutter .cm-gutterElement': {
        padding: '0 2px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
      },
      '.cm-foldGutter .bs-fold-mark': { fontSize: '14px', color: 'var(--t3)', lineHeight: '1' },
      '.cm-foldPlaceholder': {
        backgroundColor: 'var(--color-selected, var(--hover2))',
        border: 'none',
        borderRadius: '999px',
        color: 'var(--color-text-secondary, var(--t2))',
        padding: '1px 10px',
        margin: '0 6px',
        fontFamily: 'var(--font-ui, inherit)',
        fontSize: 'var(--font-size-caption, 11px)',
        cursor: 'pointer',
      },
      '.cm-foldPlaceholder:hover': { color: 'var(--color-text, var(--text))' },
      '.cm-searchMatch': { backgroundColor: 'var(--color-warning-soft, rgba(232, 163, 61, 0.3))', outline: 'none' },
      '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: 'color-mix(in srgb, var(--accent) 38%, transparent)',
      },
      // E1b: find & replace floats over the editor's top-right instead of pushing the text down.
      // CodeMirror pins the container with an inline `top: 0`, hence the margin.
      '&.cm-editor .cm-panels.cm-panels-top': {
        position: 'absolute',
        marginTop: '8px',
        right: '12px',
        left: 'auto',
        maxWidth: 'calc(100% - 24px)',
        backgroundColor: 'transparent',
        border: 'none',
      },
      '.bs-find': {
        display: 'flex',
        flexDirection: 'column',
        gap: '3px',
        width: '372px',
        maxWidth: '100%',
        padding: '3px',
        boxSizing: 'border-box',
        borderRadius: '12px',
        border: '1px solid var(--color-border, var(--sep))',
        backgroundColor: 'var(--color-raised, var(--surface))',
        boxShadow: 'var(--shadow-panel, 0 10px 28px rgba(0, 0, 0, 0.4))',
        fontFamily: 'var(--font-ui, inherit)',
      },
      // CodeMirror's base search theme gives these a `.2em .6em` margin; E1b spaces them with the row gap only.
      '.cm-panel.cm-search.bs-find :is(button, label, input)': { margin: '0' },
      '.bs-find-row': { display: 'flex', alignItems: 'center', gap: '1px' },
      '.bs-find-row[hidden]': { display: 'none' },
      '.bs-find-indent': { width: '20px', flex: 'none' },
      '.bs-find-field': {
        flex: '1',
        minWidth: '0',
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        height: '22px',
        padding: '0 3px 0 10px',
        boxSizing: 'border-box',
        borderRadius: '999px',
        border: '1px solid var(--color-border-subtle, var(--sepsoft))',
        backgroundColor: 'var(--color-field, var(--inset))',
      },
      '.bs-find-field:focus-within': { borderColor: 'var(--color-text-muted, var(--t3))' },
      '.bs-find-field.bad': { borderColor: 'var(--color-danger, var(--red))' },
      '.bs-find-input': {
        flex: '1',
        minWidth: '0',
        height: '18px',
        padding: '0',
        border: 'none',
        borderRadius: '0',
        outline: 'none',
        boxShadow: 'none',
        background: 'transparent',
        color: 'var(--text)',
        fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
        fontSize: '12px',
      },
      '.bs-find-input:focus, .bs-find-input:focus-visible': { boxShadow: 'none', outline: 'none' },
      '.bs-find-btn': {
        flex: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '20px',
        height: '20px',
        padding: '0',
        border: 'none',
        borderRadius: '999px',
        background: 'transparent',
        color: 'var(--t2)',
        cursor: 'pointer',
      },
      '.bs-find-btn .material-symbols-outlined': { fontSize: '14px' },
      '.bs-find-btn:hover': { backgroundColor: 'var(--hover2)', color: 'var(--text)' },
      '.bs-find-toggle .material-symbols-outlined': { transform: 'rotate(-90deg)', transition: 'transform 0.12s' },
      '.bs-find-toggle.open .material-symbols-outlined': { transform: 'none' },
      '.bs-find-flag': { width: '18px', height: '18px', borderRadius: '5px', color: 'var(--t3)' },
      '.bs-find-flag.on': { backgroundColor: 'var(--color-hover-strong, var(--hover2))', color: 'var(--text)' },
      '.bs-find-count': {
        flex: 'none',
        minWidth: '38px',
        padding: '0 6px',
        color: 'var(--t3)',
        fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
        fontSize: '10.5px',
        textAlign: 'center',
      },
      '.bs-find-count.none': { color: 'var(--color-danger, var(--red))' },
      '.cm-diagnostic': {
        padding: '6px 10px',
        fontFamily: 'var(--font-ui, inherit)',
        fontSize: 'var(--font-size-body, 12px)',
      },
      '.cm-diagnostic-error': { borderLeft: '3px solid var(--color-danger, var(--red))' },
      // G4: field list with the type on the right and the .proto comment below.
      '.cm-tooltip.bs-ac-rich': { minWidth: '340px', padding: '4px 6px', borderRadius: '12px' },
      '.cm-tooltip.bs-ac-rich > ul': { fontSize: '12px', maxHeight: '260px' },
      '.cm-tooltip.bs-ac-rich > ul > completion-section': {
        display: 'block',
        padding: '8px 10px 5px',
        border: 'none',
        color: 'var(--t3)',
        fontSize: '9.5px',
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        opacity: '1',
      },
      '.cm-tooltip.bs-ac-rich > ul > li': {
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        columnGap: '14px',
        alignItems: 'baseline',
        padding: '6px 10px',
        borderRadius: '7px',
        lineHeight: '1.35',
        color: 'var(--sb)',
      },
      '.cm-tooltip.bs-ac-rich > ul > li[aria-selected]': { background: 'var(--hover2)', color: 'var(--sb)' },
      '.cm-tooltip.bs-ac-rich > ul > li[aria-selected] .cm-completionDetail': { color: 'var(--t2)' },
      '.cm-tooltip.bs-ac-rich .cm-completionDetail': {
        gridColumn: '2',
        gridRow: '1',
        margin: '0',
        fontSize: '10.5px',
        color: 'var(--t2)',
      },
      '.cm-tooltip.bs-ac-rich .bs-ac-doc': {
        gridColumn: '1 / -1',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        color: 'var(--t3)',
        fontFamily: 'var(--font-ui, inherit)',
        fontSize: '10.5px',
      },
      '.cm-tooltip.bs-ac-rich > ul > li.bs-ac-set': { opacity: '0.45' },
      // SC2: the selected option's signature + description sit under the list, not beside it.
      '.cm-tooltip.bs-ac-rich > .cm-completionInfo': {
        position: 'static !important',
        maxWidth: 'none',
        padding: '8px 10px 6px',
        borderTop: '0.5px solid var(--sepsoft)',
      },
      '.cm-tooltip.bs-ac-rich .bs-ac-info code': {
        display: 'block',
        color: 'var(--text)',
        fontFamily: 'var(--mono)',
        fontSize: '11px',
        fontWeight: '600',
      },
      '.cm-tooltip.bs-ac-rich .bs-ac-info p': { margin: '3px 0 0', maxWidth: '340px', lineHeight: '1.45' },
      '.cm-tooltip.bs-ac-rich > ul > li.bs-ac-set .cm-completionDetail::after': { content: '"  ✓"' },
      '.cm-tooltip.bs-ac-rich::after': {
        content: completionFooter ? JSON.stringify(completionFooter) : 'none',
        display: 'block',
        padding: '7px 10px 5px',
        borderTop: '0.5px solid var(--sepsoft)',
        color: 'var(--t3)',
        fontSize: '10.5px',
        whiteSpace: 'pre',
      },
    });
  }

  function renderDoc(c: Completion): Node | null {
    const doc = (c as Completion & { doc?: string }).doc;
    if (!doc) return null;
    const el = document.createElement('div');
    el.className = 'bs-ac-doc';
    el.textContent = doc;
    return el;
  }

  function buildExtensions(): Extension[] {
    // Single-line: no gutter/active-line/indentation/autocomplete; Enter is
    // consumed (firing `onEnter`) before defaultKeymap can insert a newline,
    // and the transaction filter flattens whatever else sneaks a "\n" in.
    const modeExtensions: Extension[] = singleLine
      ? [
          keymap.of([
            { key: 'Enter', run: () => (onEnter?.(), true) },
            { key: 'Shift-Enter', run: () => true },
            { key: 'Mod-Enter', run: () => true },
          ]),
          EditorState.transactionFilter.of(stripNewlines),
        ]
      : readOnly
        ? [lineNumbers(), bracketMatching(), EditorState.readOnly.of(true)]
        : [
            lineNumbers(),
            indentUnit.of('  '),
            indentOnInput(),
            bracketMatching(),
            closeBrackets(),
            highlightActiveLine(),
            highlightActiveLineGutter(),
            // Rich completions outgrow the editor; the request pane clips (contain: paint).
            completionSource ? tooltips({ parent: tooltipHost() }) : [],
            autocompletion(
              completionSource
                ? {
                    override: [(ctx) => completionSource?.(ctx) ?? null, extraCompletionSource],
                    icons: false,
                    tooltipClass: () => 'bs-ac-rich',
                    optionClass: (c) => ((c as Completion & { set?: boolean }).set ? 'bs-ac-set' : ''),
                    addToOptions: [{ position: 90, render: renderDoc }],
                  }
                : completions && completions.length > 0
                  ? { override: [dictionaryCompletions(completions), extraCompletionSource] }
                  : {},
            ),
          ];
    const fold = !singleLine && (folding ?? lang === 'json');
    return [
      ...modeExtensions,
      // ⌘F inside any multi-line editor opens the find & replace widget (E1/E4 rule 3, 8; E1b).
      ...(singleLine ? [] : [search({ top: true, createPanel: createFindPanel }), keymap.of(searchKeymap)]),
      ...(fold ? [largeFolding(), keymap.of(foldKeymap)] : []),
      ...(lintJson && !readOnly ? [linter(lintSource, { delay: 400 })] : []),
      wrapCompartment.of(wrap ? EditorView.lineWrapping : []),
      history(),
      drawSelection(),
      EditorState.tabSize.of(2),
      keymap.of([
        ...(singleLine || readOnly ? [] : closeBracketsKeymap),
        ...defaultKeymap,
        ...historyKeymap,
        ...(singleLine || readOnly ? [] : [...completionKeymap, indentWithTab]),
      ]),
      langCompartment.of(langExtension(lang)),
      placeholderCompartment.of(cmPlaceholder(placeholder)),
      varCompartment.of(varHighlight ?? []),
      readOnly ? [] : trackFocus,
      extraCompartment.of(extensions ?? []),
      syntaxHighlighting(highlight),
      themeExtension(),
      ...(ariaLabel ? [EditorView.contentAttributes.of({ 'aria-label': ariaLabel })] : []),
      EditorView.domEventHandlers({
        paste: (event) => {
          if (!onPaste) return false;
          const text = event.clipboardData?.getData('text') ?? '';
          if (!onPaste(text)) return false;
          event.preventDefault();
          return true;
        },
        blur: () => {
          onBlur?.();
          return false;
        },
      }),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || syncingFromProp) return;
        const text = update.state.doc.toString();
        if (text !== value) onChange(text);
      }),
    ];
  }

  function lintSource(v: EditorView): Diagnostic[] {
    if (currentLang !== 'json') return [];
    const text = v.state.doc.toString();
    const problem = jsonProblem(text);
    if (!problem) return [];
    const from = Math.min(problem.pos, text.length);
    return [
      { from, to: Math.min(from + 1, text.length), severity: 'error', message: jsonErrorMessage(text, problem.error) },
    ];
  }

  /** Once per (re)loaded document: fold the middle of long JSON arrays. Never re-run on edits. */
  function applyAutoFold(v: EditorView): void {
    if (autoFold && !singleLine && (lang === 'json' || lang === 'json-lite')) foldLargeArrays(v);
  }

  function createState(doc: string): EditorState {
    return EditorState.create({ doc, extensions: buildExtensions() });
  }

  // Create/destroy the view when the host element (dis)appears. Everything the
  // initial state reads (value, lang, …) is read inside `untrack` so this
  // effect depends ONLY on `host`: later changes are handled by the sync
  // effects below, not by re-creating. (Without untrack, every keystroke's
  // value round-trip would destroy/recreate the view and drop focus.)
  $effect(() => {
    if (!host) return;
    const created = untrack(() => {
      lastDocId = docId;
      const v = new EditorView({ state: createState(value), parent: host });
      applyAutoFold(v);
      return v;
    });
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
        untrack(() => applyAutoFold(view!));
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
    currentLang = l;
    if (!view) return;
    view.dispatch({
      effects: [langCompartment.reconfigure(langExtension(l)), placeholderCompartment.reconfigure(cmPlaceholder(p))],
    });
  });

  // Live-reconfigure the `{{var}}` highlight extension. The host derives a new
  // instance whenever the variable scope changes (env switch, quick-add from
  // the popover), so decorations flip resolved/unresolved without a remount.
  $effect(() => {
    const w = wrap;
    if (!view) return;
    view.dispatch({ effects: wrapCompartment.reconfigure(w ? EditorView.lineWrapping : []) });
  });

  $effect(() => {
    const ext = varHighlight ?? [];
    if (!view) return;
    view.dispatch({ effects: varCompartment.reconfigure(ext) });
  });

  $effect(() => {
    const ext = extensions ?? [];
    if (!view) return;
    view.dispatch({ effects: extraCompartment.reconfigure(ext) });
  });

  /** Caret to `line`, scrolled to the middle, editor focused (a test or error «строка N» link). */
  export function reveal(line: number): void {
    if (view) revealLine(view, line);
  }

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

<div class="bs-code-editor" class:fill class:single={singleLine} bind:this={host}></div>

<style>
  .bs-code-editor {
    min-width: 0;
  }
  /* Single-line: behave like the old <input class="bs-url"> — fill the field
     row; the editor theme centers the one line vertically. */
  .bs-code-editor.single {
    flex: 1;
    height: 100%;
  }
  .bs-code-editor.single :global(.cm-editor) {
    height: 100%;
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
