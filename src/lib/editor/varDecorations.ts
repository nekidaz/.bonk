/**
 * CodeMirror 6 extension for Postman-style inline `{{variable}}` highlighting
 * with a hover quick-set popover.
 *
 * Framework-free by design: this module never imports Svelte or the stores.
 * The host component supplies plain callbacks and rebuilds the extension
 * (through a `Compartment.reconfigure`) whenever the variable scope changes,
 * so decorations flip resolved/unresolved reactively without remounting the
 * editor — the CM-idiomatic "reconfigure on external state change" mechanism.
 */
import type { Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  hoverTooltip,
  type DecorationSet,
  type Tooltip,
  type ViewUpdate,
} from '@codemirror/view';
import { findVariables } from '../domain/vars';

/** How a resolved variable presents in the hover tooltip. */
export interface VarScopeInfo {
  value: string;
  /** Human label for the resolving layer, e.g. `Environment 'staging'` or `Globals`. */
  scopeLabel: string;
}

export interface VariableHighlightOptions {
  /** Resolve a (trimmed) variable name in the current scope; `null` = unresolved. */
  getScopeInfo(name: string): VarScopeInfo | null;
  /** Name of the active environment, or `null` when none is active. */
  activeEnvName(): string | null;
  /** Persist a new `{key, value, enabled}` row into the chosen scope. */
  onAdd(name: string, value: string, target: 'env' | 'globals'): void;
}

const okDeco = Decoration.mark({ class: 'cm-var-ok' });
const missingDeco = Decoration.mark({ class: 'cm-var-missing' });

/** Same pattern as `resolveVars` (domain/vars.ts) so highlight == resolution. */
const VAR_PATTERN = /\{\{\s*([^{}]*?)\s*\}\}/g;

function highlightPlugin(opts: VariableHighlightOptions): Extension {
  const decorator = new MatchDecorator({
    regexp: new RegExp(VAR_PATTERN.source, 'g'),
    decoration: (match) => (opts.getScopeInfo(match[1].trim()) ? okDeco : missingDeco),
  });
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = decorator.createDeco(view);
      }
      update(update: ViewUpdate) {
        this.decorations = decorator.updateDeco(update, this.decorations);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const btn = el('button', className, label);
  btn.type = 'button';
  // Keep focus (and the editor's selection) where it is; `click` still fires.
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', onClick);
  return btn;
}

/** Tooltip body for a variable that resolved: name, value, owning scope. */
function resolvedDom(name: string, info: VarScopeInfo): HTMLElement {
  const root = el('div', 'cm-var-tip');
  const head = el('div', 'cm-var-tip-head');
  head.appendChild(el('span', 'cm-var-tip-name', name));
  head.appendChild(el('span', 'cm-var-tip-scope', info.scopeLabel));
  root.appendChild(head);
  root.appendChild(
    el('div', 'cm-var-tip-value' + (info.value === '' ? ' empty' : ''), info.value === '' ? '(empty value)' : info.value),
  );
  return root;
}

/** Tooltip body for an unresolved variable: value input + quick-add buttons. */
function unresolvedDom(name: string, opts: VariableHighlightOptions): HTMLElement {
  const root = el('div', 'cm-var-tip');
  const head = el('div', 'cm-var-tip-head');
  head.appendChild(el('span', 'cm-var-tip-name', name));
  head.appendChild(el('span', 'cm-var-tip-missing', 'Unresolved variable'));
  root.appendChild(head);

  const input = el('input', 'cm-var-tip-input');
  input.type = 'text';
  input.placeholder = 'Value';
  input.setAttribute('aria-label', `Value for ${name}`);
  // Keep keystrokes (and Escape/Enter) inside the popover, away from the editor.
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      opts.onAdd(name, input.value, opts.activeEnvName() !== null ? 'env' : 'globals');
    }
  });
  root.appendChild(input);

  const actions = el('div', 'cm-var-tip-actions');
  const envName = opts.activeEnvName();
  if (envName !== null) {
    actions.appendChild(
      button(`Add to ${envName}`, 'cm-var-tip-btn primary', () => opts.onAdd(name, input.value, 'env')),
    );
  }
  actions.appendChild(
    button('Add to Globals', envName !== null ? 'cm-var-tip-btn' : 'cm-var-tip-btn primary', () =>
      opts.onAdd(name, input.value, 'globals'),
    ),
  );
  root.appendChild(actions);
  return root;
}

function varHover(opts: VariableHighlightOptions): Extension {
  return hoverTooltip(
    (view, pos): Tooltip | null => {
      const line = view.state.doc.lineAt(pos);
      const hit = findVariables(line.text)
        .map((m) => ({ name: m.name, from: m.from + line.from, to: m.to + line.from }))
        .find((m) => m.from <= pos && pos <= m.to);
      if (!hit) return null;
      const info = opts.getScopeInfo(hit.name);
      return {
        pos: hit.from,
        end: hit.to,
        create: () => ({
          dom: info ? resolvedDom(hit.name, info) : unresolvedDom(hit.name, opts),
        }),
      };
    },
    // hoverTooltip keeps the tooltip open while the pointer is over its DOM,
    // which is what lets the user reach the input and buttons.
    { hoverTime: 250 },
  );
}

/**
 * Colors ride on the app's CSS variables (01-base.css) so `.dark` re-themes
 * without touching the editor. `baseTheme` merges under the host's
 * `EditorView.theme`, so the tooltip chrome (surface, border) still comes from
 * the shared CodeEditor theme.
 */
const varTheme = EditorView.baseTheme({
  '.cm-var-ok': {
    color: 'var(--orange)',
    background: 'color-mix(in srgb, var(--orange) 12%, transparent)',
    borderRadius: '3px',
  },
  '.cm-var-missing': {
    color: 'var(--red)',
    background: 'color-mix(in srgb, var(--red) 10%, transparent)',
    borderRadius: '3px',
  },
  '.cm-var-tip': {
    display: 'flex',
    flexDirection: 'column',
    gap: '7px',
    padding: '9px 11px',
    minWidth: '190px',
    maxWidth: '300px',
    fontSize: '12px',
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif",
  },
  '.cm-var-tip-head': {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: '14px',
  },
  '.cm-var-tip-name': {
    fontFamily: 'var(--mono)',
    fontWeight: '700',
    color: 'var(--text)',
    wordBreak: 'break-all',
  },
  '.cm-var-tip-scope': { color: 'var(--t3)', fontSize: '11px', whiteSpace: 'nowrap' },
  '.cm-var-tip-missing': { color: 'var(--red)', fontSize: '11px', whiteSpace: 'nowrap' },
  '.cm-var-tip-value': {
    fontFamily: 'var(--mono)',
    color: 'var(--t2)',
    wordBreak: 'break-all',
  },
  '.cm-var-tip-value.empty': { color: 'var(--t3)', fontStyle: 'italic' },
  '.cm-var-tip-input': {
    font: 'inherit',
    fontFamily: 'var(--mono)',
    color: 'var(--text)',
    background: 'var(--inset)',
    border: '0.5px solid var(--sep)',
    borderRadius: '6px',
    padding: '4px 8px',
    outline: 'none',
  },
  '.cm-var-tip-input:focus': {
    borderColor: 'color-mix(in srgb, var(--accent) 62%, var(--sep))',
  },
  '.cm-var-tip-actions': { display: 'flex', gap: '6px', justifyContent: 'flex-end' },
  '.cm-var-tip-btn': {
    font: 'inherit',
    fontSize: '11.5px',
    fontWeight: '600',
    color: 'var(--text)',
    background: 'var(--hover)',
    border: 'none',
    borderRadius: '6px',
    padding: '4px 9px',
  },
  '.cm-var-tip-btn.primary': { color: '#fff', background: 'var(--accent)' },
});

/**
 * Inline `{{var}}` decorations (`.cm-var-ok` / `.cm-var-missing`) + the hover
 * quick-set popover. Rebuild (via a compartment) whenever the scope changes.
 */
export function variableHighlight(opts: VariableHighlightOptions): Extension[] {
  return [highlightPlugin(opts), varHover(opts), varTheme];
}
