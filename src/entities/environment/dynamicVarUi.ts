/**
 * `{{$dynamic}}` variables in CodeMirror (Flow · Dynamic variables): the `{{` completion
 * list (DV1: environment variables, then dynamic ones), the hover card with an example (DV2) and
 * the typo card (DV6). Framework-free like
 * varDecorations.ts, which mounts these next to the `{{var}}` decorations; the host passes callbacks.
 */
import type { Extension } from '@codemirror/state';
import { EditorState } from '@codemirror/state';
import { EditorView, closeHoverTooltips, tooltips } from '@codemirror/view';
import {
  autocompletion,
  type Completion,
  type CompletionResult,
  type CompletionSource,
} from '@codemirror/autocomplete';
import { t } from '$shared/i18n';
import { DYNAMIC_GROUPS, DYNAMIC_VARS, nearestDynamic, searchDynamic } from '$shared/model';
import { completionExtras, tooltipHost } from '$shared/editor';

export interface DynamicUiOptions {
  /** Example value for a known name ('' while none is loaded). */
  sample(name: string): string;
  /** Whether examples have arrived (the first `{{$` list waits for them). */
  samplesLoaded(): boolean;
  /** Fresh examples for every name. */
  refreshSamples(): Promise<void>;
  onOpenCatalog(): void;
  /** Environment + global variables in scope (secret values already masked). */
  variables(): { name: string; value: string }[];
}

type DynCompletion = Completion & { dyn?: true; env?: true };

/** Text after `{{` up to the cursor (`{{ba`, `{{$gu`, `{{ $gu`). */
const TRIGGER = /\{\{\s*[^{}\s]*/;

/** Replace the typed `{{…` with `{{name}}`, swallowing a `}}` already after the cursor. */
function insertVariable(view: EditorView, name: string, from: number, to: number): void {
  const close = /^\s*\}\}/.exec(view.state.sliceDoc(to, to + 8))?.[0].length ?? 0;
  const insert = `{{${name}}}`;
  view.dispatch({ changes: { from, to: to + close, insert }, selection: { anchor: from + insert.length } });
}

function completionSource(opts: DynamicUiOptions): CompletionSource {
  return (ctx) => {
    const typed = ctx.matchBefore(TRIGGER);
    if (!typed) return null;
    const query = typed.text.replace(/^\{\{\s*/, '');
    const result = () => completions(opts, query, typed.from);
    return opts.samplesLoaded() ? result() : opts.refreshSamples().then(result);
  };
}

function completions(opts: DynamicUiOptions, query: string, from: number): CompletionResult {
  // `{{$…` asks for dynamic ones only; plain `{{…` lists the scope's variables first.
  const q = query.toLowerCase();
  const vars = q.startsWith('$') ? [] : opts.variables().filter((v) => v.name.toLowerCase().includes(q));
  const options: DynCompletion[] = vars.map((v, i) => ({
    label: v.name,
    detail: v.value,
    env: true,
    boost: -Math.min(i, 99),
    section: { name: t('dyn.group.vars'), rank: -1 },
    apply: (view, _c, from, to) => insertVariable(view, v.name, from, to),
  }));
  const rows = searchDynamic(query, (name) => t(`dyn.${name}`));
  options.push(
    ...rows.map((v, i): DynCompletion => ({
      label: v.name,
      detail: opts.sample(v.name),
      dyn: true,
      // Catalog order inside a group (the list is not re-sorted by name).
      boost: -Math.min(i, 99),
      section: { name: t(`dyn.group.${v.group}`), rank: DYNAMIC_GROUPS.indexOf(v.group) },
      apply: (view, _c, from, to) => insertVariable(view, v.name, from, to),
    })),
  );
  options.push({
    label: t('dyn.ac.all', { n: DYNAMIC_VARS.length }),
    section: { name: t('dyn.ac.footer'), rank: 99 },
    // The typed `{{$…` goes away: “Insert” in the dialog puts the whole `{{$name}}` there.
    apply: (view, _c, from, to) => {
      view.dispatch({ changes: { from, to } });
      opts.onOpenCatalog();
    },
  });
  return { from, options, filter: false };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name: string, className = ''): HTMLElement {
  return el('span', `material-symbols-outlined ${className}`.trim(), name);
}

function iconButton(name: string, title: string, onClick: () => void): HTMLButtonElement {
  const btn = el('button', 'cm-dyn-tip-icon');
  btn.type = 'button';
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.appendChild(icon(name));
  // Keep focus (and the editor's selection) where it is; `click` still fires.
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', onClick);
  return btn;
}

const badge = () => el('span', 'cm-dyn-badge', '$');

/** «Did you mean `{{$guid}}`?» under an unresolved `{{guid}}`: badge, name, “Replace”. */
export function dynamicSuggestionDom(view: EditorView, suggestion: string, from: number, to: number): HTMLElement {
  const row = el('div', 'cm-dyn-tip-example');
  const replace = el('button', 'cm-dyn-tip-btn', t('dyn.tip.replace'));
  replace.type = 'button';
  replace.addEventListener('mousedown', (e) => e.preventDefault());
  replace.addEventListener('click', () =>
    view.dispatch({ changes: { from, to, insert: `{{${suggestion}}}` }, effects: closeHoverTooltips }),
  );
  row.append(badge(), el('span', 'cm-dyn-tip-value strong', suggestion), replace);
  return row;
}

/** DV2: what the variable is, an example (refreshable), «a new value on every send». */
export function dynamicTipDom(view: EditorView, name: string, opts: DynamicUiOptions): HTMLElement {
  const root = el('div', 'cm-dyn-tip');
  const head = el('div', 'cm-dyn-tip-head');
  head.append(
    badge(),
    el('span', 'cm-dyn-tip-title', `${t('dyn.kind')} · ${t(`dyn.${name}`)}`),
    iconButton('menu_book', t('dyn.tip.catalog'), () => {
      view.dispatch({ effects: closeHoverTooltips });
      opts.onOpenCatalog();
    }),
  );
  const example = el('div', 'cm-dyn-tip-example');
  const value = el('span', 'cm-dyn-tip-value', opts.sample(name) || '…');
  example.append(
    value,
    iconButton('refresh', t('dyn.tip.refresh'), () => {
      void opts.refreshSamples().then(() => (value.textContent = opts.sample(name) || '…'));
    }),
  );
  const note = el('div', 'cm-dyn-tip-note');
  note.append(icon('autorenew', 'cm-dyn-tone'), el('span', '', t('dyn.tip.example')));
  root.append(head, example, note);
  return root;
}

/** DV6: an unknown `{{$name}}` goes out as text; offer the closest real name. */
export function unknownDynamicTipDom(view: EditorView, name: string, from: number, to: number): HTMLElement {
  const root = el('div', 'cm-dyn-tip');
  const head = el('div', 'cm-dyn-tip-head');
  head.append(icon('error', 'cm-dyn-danger'), el('span', 'cm-dyn-tip-title', t('dyn.tip.unknown')));
  const suggestion = nearestDynamic(name);
  const text = t('dyn.tip.unknown_text', { name: `{{${name}}}` });
  root.append(head, el('div', 'cm-dyn-tip-text', suggestion ? `${text} ${t('dyn.tip.maybe')}` : text));
  if (suggestion) root.appendChild(dynamicSuggestionDom(view, suggestion, from, to));
  return root;
}

/** Design «DV · Dynamic popover»: 280 card, 8 padding, 6 gap; the purple tone is `--method-patch`. */
const dynTheme = EditorView.baseTheme({
  '.cm-var-dyn': {
    color: 'var(--method-patch)',
    background: 'color-mix(in srgb, var(--method-patch) 14%, transparent)',
    borderRadius: '5px',
  },
  '.cm-var-dyn-bad': {
    color: 'var(--color-danger)',
    background: 'var(--color-danger-soft)',
    borderRadius: '5px',
    textDecoration: 'underline wavy var(--color-danger)',
    textUnderlineOffset: '3px',
  },
  '.cm-tooltip.cm-tooltip-hover:has(.cm-dyn-tip)': {
    marginTop: '6px',
    background: 'var(--color-raised)',
    border: '1px solid var(--color-border)',
    borderRadius: '10px',
    boxShadow: '0 12px 32px var(--color-shadow)',
  },
  '.cm-dyn-tip': {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    width: '280px',
    padding: '8px',
    boxSizing: 'border-box',
    fontFamily: 'var(--font-ui)',
    fontSize: '12px',
    color: 'var(--color-text-muted)',
  },
  '.cm-dyn-tip .material-symbols-outlined': { fontSize: '13px', fontWeight: '300', lineHeight: '1' },
  '.cm-dyn-tip-head, .cm-dyn-tip-note': { display: 'flex', alignItems: 'center', gap: '6px', padding: '0 2px' },
  '.cm-dyn-tip-title': { flex: '1', minWidth: '0', color: 'var(--color-text)', fontWeight: '500' },
  '.cm-dyn-badge': {
    flex: '0 0 16px',
    height: '16px',
    display: 'grid',
    placeItems: 'center',
    borderRadius: '4px',
    background: 'color-mix(in srgb, var(--method-patch) 14%, transparent)',
    color: 'var(--method-patch)',
    fontFamily: 'var(--font-code)',
    fontSize: '10px',
    fontWeight: '700',
  },
  '.cm-dyn-badge.env': {
    color: 'var(--orange)',
    background: 'color-mix(in srgb, var(--orange) 12%, transparent)',
    fontSize: '9px',
  },
  '.cm-dyn-tip-example': {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    minHeight: '25px',
    padding: '3px 4px 3px 8px',
    borderRadius: '6px',
    border: '1px solid var(--color-border-subtle)',
    background: 'var(--color-field)',
  },
  '.cm-dyn-tip-value': {
    flex: '1',
    minWidth: '0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: 'var(--font-code)',
    fontSize: '11px',
    color: 'var(--color-text-secondary)',
  },
  '.cm-dyn-tip-value.strong': { fontSize: '12px', fontWeight: '500', color: 'var(--color-text)' },
  '.cm-dyn-tip-note': { fontSize: '10.5px' },
  '.cm-dyn-tip-text': { padding: '0 2px', lineHeight: '1.45' },
  '.cm-dyn-tone': { color: 'var(--method-patch)' },
  '.cm-dyn-danger': { color: 'var(--color-danger)' },
  '.cm-dyn-tip-icon': {
    flex: '0 0 20px',
    height: '20px',
    display: 'grid',
    placeItems: 'center',
    padding: '0',
    border: 'none',
    borderRadius: '5px',
    background: 'transparent',
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
  },
  '.cm-dyn-tip-icon:hover': { background: 'var(--color-hover)', color: 'var(--color-text)' },
  '.cm-dyn-tip-btn': {
    padding: '3px 10px',
    border: '1px solid var(--color-border)',
    borderRadius: '999px',
    background: 'transparent',
    color: 'var(--color-text)',
    font: '500 11px/1.4 var(--font-ui)',
    cursor: 'pointer',
  },
  '.cm-dyn-tip-btn:hover': { background: 'var(--color-hover)' },
  // DV1: the `{{$` list — $ badge, name, example on the right, group headers.
  '.cm-tooltip.cm-tooltip-autocomplete:has(li.bs-ac-dyn)': {
    minWidth: '400px',
    padding: '4px',
    background: 'var(--color-raised)',
    borderRadius: '12px',
  },
  '.cm-tooltip.cm-tooltip-autocomplete:has(li.bs-ac-dyn) > ul': { maxHeight: '300px', fontSize: '12px' },
  '.cm-tooltip.cm-tooltip-autocomplete:has(li.bs-ac-dyn) > ul > completion-section': {
    display: 'block',
    padding: '7px 10px 4px',
    border: 'none',
    color: 'var(--color-text-muted)',
    fontFamily: 'var(--font-ui)',
    fontSize: '9.5px',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    opacity: '1',
  },
  '.cm-tooltip.cm-tooltip-autocomplete:has(li.bs-ac-dyn) > ul > li': {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '5px 10px',
    borderRadius: '9px',
    color: 'var(--color-text)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete:has(li.bs-ac-dyn) > ul > li[aria-selected]': {
    background: 'var(--color-hover)',
    color: 'var(--color-text)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete:has(li.bs-ac-dyn) > ul > li .cm-completionLabel': { fontWeight: '500' },
  '.cm-tooltip.cm-tooltip-autocomplete:has(li.bs-ac-dyn) .cm-completionDetail, .cm-tooltip.cm-tooltip-autocomplete:has(li.bs-ac-dyn) > ul > li[aria-selected] .cm-completionDetail':
    {
      flex: '1',
      minWidth: '0',
      maxWidth: '210px',
      marginLeft: 'auto',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      textAlign: 'right',
      fontSize: '11px',
      color: 'var(--color-text-muted)',
    },
  '.cm-tooltip.cm-tooltip-autocomplete:has(li.bs-ac-dyn) > ul > li:not(.bs-ac-dyn)': {
    justifyContent: 'flex-end',
    fontFamily: 'var(--font-ui)',
    fontSize: '11px',
    color: 'var(--color-text-secondary)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete:has(li.bs-ac-dyn) > ul > li:not(.bs-ac-dyn) .cm-completionLabel': {
    fontWeight: '400',
  },
});

/** Completion list + theme; decorations and hover live in varDecorations.ts. */
export function dynamicVarExtensions(opts: DynamicUiOptions): Extension[] {
  const source = completionSource(opts);
  return [
    // Plain editors read `languageData`; editors with their own list (`override`) read the facet.
    EditorState.languageData.of(() => [{ autocomplete: source }]),
    completionExtras.of(source),
    autocompletion({
      optionClass: (c) => ((c as DynCompletion).dyn || (c as DynCompletion).env ? 'bs-ac-dyn' : ''),
      addToOptions: [
        {
          position: 20,
          render: (c) => {
            if ((c as DynCompletion).dyn) return badge();
            return (c as DynCompletion).env ? el('span', 'cm-dyn-badge env', '{}') : null;
          },
        },
      ],
    }),
    dynTheme,
    // Variable cards and the `{{$` list outgrow the editor; the request pane clips (contain: paint).
    tooltips({ parent: tooltipHost() }),
  ];
}
