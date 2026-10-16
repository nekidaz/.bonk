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
  closeHoverTooltips,
  hoverTooltip,
  type DecorationSet,
  type Tooltip,
  type ViewUpdate,
} from '@codemirror/view';
import { t } from '$shared/i18n';
import { findVariables, isDynamicName, isKnownDynamic, nearestDynamic } from '$shared/model';
import {
  type DynamicUiOptions,
  dynamicSuggestionDom,
  dynamicTipDom,
  dynamicVarExtensions,
  unknownDynamicTipDom,
} from './dynamicVarUi';

/** Where a variable lives: an environment (name + CSS colour of its dot) or Globals. */
export interface VarSource {
  name: string;
  /** CSS colour of the source dot; absent for Globals. */
  color?: string;
}

/** How a resolved variable presents in the hover popover. */
export interface VarScopeInfo {
  value: string;
  source: VarSource;
  /** True when it resolved from Globals rather than the active environment. */
  global: boolean;
  secret: boolean;
  /** The Globals value this environment value overrides, if any. */
  shadowed?: string;
}

export interface VariableHighlightOptions {
  /** Resolve a (trimmed) variable name in the current scope; `null` = unresolved. */
  getScopeInfo(name: string): VarScopeInfo | null;
  /** Where a new variable lands: the active environment, else Globals. */
  addTarget(): VarSource;
  /** Inactive environments that do define the name (the «found in» chips). */
  envsWith(name: string): VarSource[];
  /** Persist a new `{key, value, enabled}` row into `addTarget()`. */
  onAdd(name: string, value: string): void;
  /** Overwrite the value of an already-resolved variable in its owning scope. */
  onUpdate(name: string, value: string): void;
  onOpenEnvs(): void;
  /** `{{$dynamic}}`: examples and the reference dialog. */
  dynamic: DynamicUiOptions;
  /** «Ask on send» variables: their chip, the right-click menu and the settings popover. */
  ask: {
    isAsked(name: string): boolean;
    /** Right-click on `{{name}}` at the pointer. */
    onContext(name: string, at: { x: number; y: number }): void;
    /** Open the field settings under `rect` (the chip). */
    onSettings(name: string, rect: { left: number; right: number; top: number; bottom: number }): void;
  };
}

const okDeco = Decoration.mark({ class: 'cm-var-ok' });
const missingDeco = Decoration.mark({ class: 'cm-var-missing' });
const dynDeco = Decoration.mark({ class: 'cm-var-dyn' });
const dynBadDeco = Decoration.mark({ class: 'cm-var-dyn-bad' });
const askDeco = Decoration.mark({ class: 'cm-var-ask' });

/** Same pattern as `resolveVars` (shared/model/vars.ts) so highlight == resolution. */
const VAR_PATTERN = /\{\{\s*([^{}]*?)\s*\}\}/g;

function highlightPlugin(opts: VariableHighlightOptions): Extension {
  const decorator = new MatchDecorator({
    regexp: new RegExp(VAR_PATTERN.source, 'g'),
    decoration: (match) => {
      const name = match[1].trim();
      if (isDynamicName(name)) return isKnownDynamic(name) ? dynDeco : dynBadDeco;
      if (opts.ask.isAsked(name)) return askDeco;
      return opts.getScopeInfo(name) ? okDeco : missingDeco;
    },
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

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name: string): HTMLElement {
  return el('span', 'material-symbols-outlined', name);
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const btn = el('button', className, label);
  btn.type = 'button';
  // Keep focus (and the editor's selection) where it is; `click` still fires.
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', onClick);
  return btn;
}

function iconButton(name: string, title: string, onClick: () => void): HTMLButtonElement {
  const btn = button('', 'cm-var-tip-icon', onClick);
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.appendChild(icon(name));
  return btn;
}

function dot(color: string | undefined, className = 'cm-var-tip-dot'): HTMLElement {
  const d = el('span', className);
  if (color) d.style.background = color;
  return d;
}

const tr = (key: string, vars?: Record<string, string>) => t(key, vars);
const mask = (v: string) => '•'.repeat(Math.min(Math.max(v.length, 8), 16));

/** Name, what it is (scope pill / «not set» tag), «open environments». */
function headDom(name: string, tags: HTMLElement[], opts: VariableHighlightOptions) {
  const head = el('div', 'cm-var-tip-head');
  head.append(
    el('span', 'cm-var-tip-name', name),
    ...tags,
    iconButton('open_in_new', tr('code.tip.open_envs'), opts.onOpenEnvs),
  );
  return head;
}

/** A scope pill: coloured dot + environment name (no dot for Globals). */
function scopePill(source: VarSource): HTMLElement {
  const pill = el('span', 'cm-var-tip-pill');
  if (source.color) pill.appendChild(dot(source.color));
  pill.appendChild(el('span', '', source.name));
  return pill;
}

/** Hint row + Cancel + primary action, under a hairline. */
function actionsDom(hint: string, primary: string, onCancel: () => void, onPrimary: () => void) {
  const row = el('div', 'cm-var-tip-actions');
  row.append(
    el('span', 'cm-var-tip-keys', hint),
    button(tr('code.tip.cancel'), 'cm-var-tip-btn', onCancel),
    button(primary, 'cm-var-tip-btn primary', onPrimary),
  );
  return row;
}

function valueInput(name: string, value: string, placeholder: string): HTMLInputElement {
  const input = el('input', 'cm-var-tip-input');
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  input.spellcheck = false;
  input.setAttribute('aria-label', tr('code.tip.value_for', { name }));
  return input;
}

/** Value field with its button inside (Postman-style): Enter = `onSubmit`, Esc = `onEscape`. */
function inputRow(input: HTMLInputElement, label: string, onSubmit: () => void, onEscape: () => void): HTMLElement {
  const box = el('div', 'cm-var-tip-value editing');
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      onSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onEscape();
    }
  });
  box.append(input, button(label, 'cm-var-tip-btn primary', onSubmit));
  return box;
}

/**
 * Popover for a resolved variable: name + scope, then the value. Clicking the
 * value edits it in place (Enter = save, Esc = back).
 */
function resolvedDom(view: EditorView, name: string, info: VarScopeInfo, opts: VariableHighlightOptions): HTMLElement {
  const root = el('div', 'cm-var-tip');
  let editing = false;
  let revealed = false;
  const close = () => view.dispatch({ effects: closeHoverTooltips });

  const render = () => {
    root.replaceChildren();
    const tags = [scopePill(info.source)];
    if (info.secret) {
      const lock = icon('lock');
      lock.classList.add('cm-var-tip-lock');
      lock.title = tr('code.tip.secret');
      tags.unshift(lock);
    }
    root.appendChild(headDom(name, tags, opts));

    if (editing) {
      const input = valueInput(name, info.value, tr('code.tip.value'));
      const save = () => {
        opts.onUpdate(name, input.value);
        close();
      };
      root.appendChild(
        inputRow(input, tr('code.tip.save'), save, () => {
          editing = false;
          render();
        }),
      );
      queueMicrotask(() => {
        input.focus();
        input.select();
      });
      return;
    }

    const box = el('div', 'cm-var-tip-value');
    const text = el('span', 'cm-var-tip-text', info.secret && !revealed ? mask(info.value) : info.value);
    text.title = tr('code.tip.edit');
    text.addEventListener('click', () => {
      editing = true;
      render();
    });
    box.appendChild(text);
    if (info.secret) {
      box.appendChild(
        iconButton(revealed ? 'visibility_off' : 'visibility', tr('code.tip.reveal'), () => {
          revealed = !revealed;
          render();
        }),
      );
    }
    const copy = iconButton('content_copy', tr('code.tip.copy'), () => {
      void navigator.clipboard?.writeText(info.value);
      copy.firstElementChild!.textContent = 'check';
    });
    box.appendChild(copy);
    root.appendChild(box);

    if (info.secret) {
      root.appendChild(el('div', 'cm-var-tip-note', tr('env.secrets_note')));
    } else if (info.shadowed !== undefined) {
      const note = el('div', 'cm-var-tip-note');
      note.append(el('span', '', tr('code.tip.overrides')), el('code', '', info.shadowed));
      root.appendChild(note);
    }
  };

  root.addEventListener('keydown', (e) => {
    // Keep keystrokes inside the popover, away from the editor.
    e.stopPropagation();
    if (e.key === 'Escape' && !editing) close();
  });
  render();
  return root;
}

/** Popover for an unresolved variable: name + «not set», value + Add, where it lands. */
function unresolvedDom(
  view: EditorView,
  name: string,
  range: { from: number; to: number },
  opts: VariableHighlightOptions,
): HTMLElement {
  const root = el('div', 'cm-var-tip missing');
  const target = opts.addTarget();
  const close = () => view.dispatch({ effects: closeHoverTooltips });
  const input = valueInput(name, '', tr('code.tip.value'));
  const add = () => {
    opts.onAdd(name, input.value);
    close();
  };

  root.append(
    headDom(name, [el('span', 'cm-var-tip-tag', tr('code.tip.not_set'))], opts),
    inputRow(input, tr('code.tip.add'), add, close),
  );

  const note = el('div', 'cm-var-tip-note');
  note.append(el('span', '', tr('code.tip.adds_to')), scopePill(target));
  const elsewhere = opts.envsWith(name);
  if (elsewhere.length > 0) {
    note.appendChild(el('span', '', tr('code.tip.also_in')));
    for (const env of elsewhere) note.appendChild(scopePill(env));
  }
  root.appendChild(note);
  // `{{guid}}` typed without the `$`: offer the dynamic variable.
  const dynamic = nearestDynamic(`$${name}`);
  if (dynamic) {
    root.append(
      el('div', 'cm-var-tip-note', tr('dyn.tip.maybe_dynamic')),
      dynamicSuggestionDom(view, dynamic, range.from, range.to),
    );
  }
  return root;
}

/** Popover of an «ask on send» variable: what it is and the way to its field settings. */
function askedDom(view: EditorView, name: string, hit: { from: number; to: number }, opts: VariableHighlightOptions) {
  const root = el('div', 'cm-var-tip');
  root.style.setProperty('--tip-tone', 'var(--color-ask)');
  root.appendChild(headDom(name, [el('span', 'cm-var-tip-tag', tr('input.set.titleVar'))], opts));
  const settings = () => {
    const rect = view.coordsAtPos(hit.from) ?? { left: 0, right: 0, top: 0, bottom: 0 };
    view.dispatch({ effects: closeHoverTooltips });
    opts.ask.onSettings(name, rect);
  };
  root.appendChild(
    actionsDom(
      tr('input.set.note'),
      tr('input.menu.settings'),
      () => view.dispatch({ effects: closeHoverTooltips }),
      settings,
    ),
  );
  return root;
}

/** Right-click on a `{{var}}` opens the «Спрашивать при отправке» menu. */
function askContext(opts: VariableHighlightOptions): Extension {
  return EditorView.domEventHandlers({
    contextmenu(event, view) {
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;
      const line = view.state.doc.lineAt(pos);
      const hit = findVariables(line.text).find((m) => m.from + line.from <= pos && pos <= m.to + line.from);
      if (!hit || isDynamicName(hit.name)) return false;
      event.preventDefault();
      opts.ask.onContext(hit.name, { x: event.clientX, y: event.clientY });
      return true;
    },
  });
}

function varHover(opts: VariableHighlightOptions): Extension {
  return hoverTooltip(
    (view, pos): Tooltip | null => {
      const line = view.state.doc.lineAt(pos);
      const hit = findVariables(line.text)
        .map((m) => ({ name: m.name, from: m.from + line.from, to: m.to + line.from }))
        .find((m) => m.from <= pos && pos <= m.to);
      if (!hit) return null;
      if (isDynamicName(hit.name)) {
        const known = isKnownDynamic(hit.name);
        return {
          pos: hit.from,
          end: hit.to,
          create: (v) => ({
            dom: known ? dynamicTipDom(v, hit.name, opts.dynamic) : unknownDynamicTipDom(v, hit.name, hit.from, hit.to),
          }),
        };
      }
      if (opts.ask.isAsked(hit.name)) {
        return { pos: hit.from, end: hit.to, create: (v) => ({ dom: askedDom(v, hit.name, hit, opts) }) };
      }
      const info = opts.getScopeInfo(hit.name);
      return {
        pos: hit.from,
        end: hit.to,
        create: (v) => ({
          dom: info ? resolvedDom(v, hit.name, info, opts) : unresolvedDom(v, hit.name, hit, opts),
        }),
      };
    },
    // hoverTooltip keeps the tooltip open while the pointer is over its DOM,
    // which is what lets the user reach the input and buttons.
    { hoverTime: 250 },
  );
}

/**
 * Colors ride on the design-system tokens (src/styles/tokens.css) so palettes and
 * `.dark` re-theme without touching the editor. Geometry follows the Pencil
 * design «V1 · Поповер переменной {{var}}», made compact like Postman's.
 */
const muted = 'var(--color-text-muted)';
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
  '.cm-tooltip.cm-tooltip-hover:has(.cm-var-tip)': {
    marginTop: '6px',
    background: 'var(--color-panel)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-card)',
    boxShadow: '0 14px 36px var(--color-shadow)',
  },
  // Postman-style: name + scope on one line, the value field with its button below, one muted note.
  '.cm-var-tip': {
    '--tip-tone': 'var(--color-var)',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    width: '280px',
    padding: '10px 10px 10px 12px',
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--font-size-caption)',
    color: muted,
  },
  '.cm-var-tip.missing': { '--tip-tone': 'var(--color-warning)' },
  '.cm-var-tip .material-symbols-outlined': { fontSize: '15px', fontWeight: '300', lineHeight: '1' },
  '.cm-var-tip-head': { display: 'flex', alignItems: 'center', gap: '6px', minWidth: '0' },
  '.cm-var-tip-name': {
    flex: '1',
    minWidth: '0',
    fontFamily: 'var(--font-code)',
    fontSize: 'var(--font-size-ui)',
    fontWeight: '600',
    color: 'var(--color-text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  '.cm-var-tip-lock': { flex: 'none', color: muted },
  '.cm-var-tip .cm-var-tip-lock': { fontSize: '13px' },
  '.cm-var-tip-pill, .cm-var-tip-tag': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    flexShrink: '1',
    minWidth: '0',
    maxWidth: '140px',
    padding: '2px 8px',
    borderRadius: 'var(--radius-control)',
    background: 'var(--color-hover)',
    color: 'var(--color-text-secondary)',
    fontSize: 'var(--font-size-caption)',
    fontWeight: '500',
    whiteSpace: 'nowrap',
  },
  '.cm-var-tip-pill > span:last-child': { overflow: 'hidden', textOverflow: 'ellipsis' },
  '.cm-var-tip-tag': {
    flexShrink: '0',
    color: 'var(--tip-tone)',
    background: 'color-mix(in srgb, var(--tip-tone) 12%, transparent)',
  },
  '.cm-var-tip-dot': { flex: '0 0 6px', height: '6px', borderRadius: '50%', background: muted },
  '.cm-var-tip-icon': {
    flex: '0 0 24px',
    height: '24px',
    display: 'grid',
    placeItems: 'center',
    padding: '0',
    border: 'none',
    borderRadius: 'var(--radius-control)',
    background: 'transparent',
    color: muted,
  },
  '.cm-var-tip-icon:hover': { background: 'var(--color-hover)', color: 'var(--color-text)' },
  '.cm-var-tip-value': {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    minHeight: '34px',
    padding: '0 4px 0 10px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border-subtle)',
    background: 'var(--color-hover)',
  },
  '.cm-var-tip-value.editing': { background: 'var(--color-field)', border: '1px solid var(--color-border)' },
  '.cm-var-tip-value.editing:focus-within': { borderColor: muted },
  '.cm-var-tip-text, .cm-var-tip-input': {
    flex: '1',
    minWidth: '0',
    fontFamily: 'var(--font-code)',
    fontSize: 'var(--font-size-ui)',
    color: 'var(--color-text)',
  },
  '.cm-var-tip-text': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'text' },
  '.cm-var-tip-input': {
    height: '32px',
    padding: '0',
    border: 'none',
    outline: 'none',
    background: 'transparent',
  },
  '.cm-var-tip-input::placeholder': { color: muted },
  '.cm-var-tip-note': { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '5px', lineHeight: '1.45' },
  '.cm-var-tip-note code': {
    fontFamily: 'var(--font-code)',
    fontSize: 'var(--font-size-caption)',
    wordBreak: 'break-all',
  },
  '.cm-var-tip-actions': {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    paddingTop: '8px',
    borderTop: '1px solid var(--color-border-subtle)',
  },
  '.cm-var-tip-keys': { flex: '1', whiteSpace: 'pre' },
  '.cm-var-tip-btn': {
    flex: 'none',
    padding: '5px 12px',
    border: 'none',
    borderRadius: 'var(--radius-control)',
    background: 'transparent',
    color: 'var(--color-text-secondary)',
    font: '500 var(--font-size-caption)/1.3333 var(--font-ui)',
  },
  '.cm-var-tip-btn:hover': { background: 'var(--color-hover)' },
  '.cm-var-tip-btn.primary': { background: 'var(--color-inverse)', color: 'var(--color-on-inverse)' },
  '.cm-var-tip-btn.primary:hover': { background: 'var(--color-inverse)', opacity: '.88' },
});

/**
 * Inline `{{var}}` decorations (`.cm-var-ok` / `.cm-var-missing`) + the hover
 * quick-set popover. Rebuild (via a compartment) whenever the scope changes.
 */
export function variableHighlight(opts: VariableHighlightOptions): Extension[] {
  return [highlightPlugin(opts), varHover(opts), askContext(opts), varTheme, dynamicVarExtensions(opts.dynamic)];
}
