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
import { findVariables } from '$shared/model';

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
}

const okDeco = Decoration.mark({ class: 'cm-var-ok' });
const missingDeco = Decoration.mark({ class: 'cm-var-missing' });

/** Same pattern as `resolveVars` (shared/model/vars.ts) so highlight == resolution. */
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

/** Glyph + name row + source line + «open environments». */
function headDom(
  name: string,
  glyph: string,
  nameExtra: HTMLElement[],
  source: HTMLElement[],
  opts: VariableHighlightOptions,
) {
  const head = el('div', 'cm-var-tip-head');
  const g = el('span', 'cm-var-tip-glyph');
  g.appendChild(icon(glyph));
  const id = el('div', 'cm-var-tip-id');
  const nameRow = el('div', 'cm-var-tip-namerow');
  nameRow.append(el('span', 'cm-var-tip-name', name), ...nameExtra);
  const src = el('div', 'cm-var-tip-src');
  src.append(...source);
  id.append(nameRow, src);
  head.append(g, id, iconButton('open_in_new', tr('code.tip.open_envs'), opts.onOpenEnvs));
  return head;
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

/**
 * Popover for a resolved variable. View mode shows the value read-only (copy,
 * reveal for secrets); clicking it switches to an inline edit with
 * Enter = save, Esc = back to view.
 */
function resolvedDom(view: EditorView, name: string, info: VarScopeInfo, opts: VariableHighlightOptions): HTMLElement {
  const root = el('div', 'cm-var-tip');
  let editing = false;
  let revealed = false;
  const close = () => view.dispatch({ effects: closeHoverTooltips });

  const render = () => {
    root.replaceChildren();
    const dirty = dot(undefined, 'cm-var-tip-dirty');
    dirty.hidden = true;
    const extra: HTMLElement[] = [dirty];
    if (info.secret) {
      const badge = el('span', 'cm-var-tip-badge');
      badge.append(icon('lock'), el('span', '', tr('code.tip.secret')));
      extra.push(badge);
    }
    const source = info.global
      ? [el('span', 'cm-var-tip-env', info.source.name)]
      : [
          dot(info.source.color),
          el('span', 'cm-var-tip-env', info.source.name),
          el('span', '', tr('code.tip.scope_env')),
        ];
    root.appendChild(headDom(name, info.secret ? 'key' : 'data_object', extra, source, opts));

    const box = el('div', 'cm-var-tip-value');
    const foot = el('div', 'cm-var-tip-foot');
    if (editing) {
      box.classList.add('editing');
      const input = valueInput(name, info.value, tr('code.tip.value'));
      const was = el('div', 'cm-var-tip-note');
      was.append(el('span', '', tr('code.tip.was')), el('code', '', info.secret ? mask(info.value) : info.value));
      was.hidden = true;
      input.addEventListener('input', () => {
        dirty.hidden = was.hidden = input.value === info.value;
      });
      const save = () => {
        opts.onUpdate(name, input.value);
        close();
      };
      const cancel = () => {
        editing = false;
        render();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          save();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
      });
      box.appendChild(input);
      foot.appendChild(was);
      root.append(box, foot, actionsDom(tr('code.tip.enter_save'), tr('code.tip.save'), cancel, save));
      queueMicrotask(() => {
        input.focus();
        input.select();
      });
      return;
    }

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
      root.appendChild(el('div', 'cm-var-tip-note wrap', tr('env.secrets_note')));
    } else if (info.shadowed !== undefined) {
      foot.append(el('span', '', tr('code.tip.overrides')), el('code', '', info.shadowed));
      foot.classList.add('cm-var-tip-note');
      root.appendChild(foot);
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

/** Popover for an unresolved variable: value input + where it does exist + Add. */
function unresolvedDom(view: EditorView, name: string, opts: VariableHighlightOptions): HTMLElement {
  const root = el('div', 'cm-var-tip missing');
  const target = opts.addTarget();
  const close = () => view.dispatch({ effects: closeHoverTooltips });
  const add = () => {
    opts.onAdd(name, input.value);
    close();
  };

  root.appendChild(
    headDom(
      name,
      'help',
      [],
      [
        el('span', 'cm-var-tip-lead', tr('code.tip.missing_in')),
        ...(target.color ? [dot(target.color)] : []),
        el('span', 'cm-var-tip-env', target.name),
      ],
      opts,
    ),
  );

  const box = el('div', 'cm-var-tip-value');
  const input = valueInput(
    name,
    '',
    target.color ? tr('code.tip.value_for', { name: target.name }) : tr('code.tip.value'),
  );
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
  box.appendChild(input);
  root.appendChild(box);

  const elsewhere = opts.envsWith(name);
  if (elsewhere.length > 0) {
    const foot = el('div', 'cm-var-tip-note');
    foot.appendChild(el('span', '', tr('code.tip.found_in')));
    for (const env of elsewhere) {
      const chip = el('span', 'cm-var-tip-chip');
      chip.append(dot(env.color), el('span', '', env.name));
      foot.appendChild(chip);
    }
    root.appendChild(foot);
  }
  root.appendChild(actionsDom(tr('code.tip.enter_add'), tr('code.tip.add'), close, add));
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
        create: (v) => ({
          dom: info ? resolvedDom(v, hit.name, info, opts) : unresolvedDom(v, hit.name, opts),
        }),
      };
    },
    // hoverTooltip keeps the tooltip open while the pointer is over its DOM,
    // which is what lets the user reach the input and buttons.
    { hoverTime: 250 },
  );
}

/**
 * Colors ride on the design-system tokens (design-system.css) so palettes and
 * `.dark` re-theme without touching the editor. Geometry follows the Pencil
 * design «V1 · Поповер переменной {{var}}»: card 20 → value box 14 → pills.
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
  '.cm-var-tip': {
    '--tip-tone': 'var(--color-var)',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    width: '300px',
    padding: '14px 14px 12px',
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--font-size-caption)',
    color: muted,
  },
  '.cm-var-tip.missing': { '--tip-tone': 'var(--color-warning)' },
  '.cm-var-tip .material-symbols-outlined': { fontSize: '15px', fontWeight: '300', lineHeight: '1' },
  '.cm-var-tip-head': { display: 'flex', alignItems: 'center', gap: '10px' },
  '.cm-var-tip-glyph': {
    flex: '0 0 30px',
    height: '30px',
    display: 'grid',
    placeItems: 'center',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--tip-tone)',
    background: 'color-mix(in srgb, var(--tip-tone) 10%, transparent)',
  },
  '.cm-var-tip-glyph .material-symbols-outlined': { fontSize: '16px' },
  '.cm-var-tip-id': { flex: '1', minWidth: '0', display: 'flex', flexDirection: 'column', gap: '3px' },
  '.cm-var-tip-namerow, .cm-var-tip-src, .cm-var-tip-note': {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    minWidth: '0',
  },
  '.cm-var-tip-name': {
    fontFamily: 'var(--font-code)',
    fontSize: 'var(--font-size-ui)',
    fontWeight: '600',
    color: 'var(--color-text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  '.cm-var-tip-dot': { flex: '0 0 6px', height: '6px', borderRadius: '50%', background: muted },
  '.cm-var-tip-dirty': { flex: '0 0 6px', height: '6px', borderRadius: '50%', background: 'var(--color-warning)' },
  '.cm-var-tip-dirty[hidden]': { display: 'none' },
  '.cm-var-tip-badge, .cm-var-tip-chip': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '3px',
    padding: '1px 7px',
    borderRadius: 'var(--radius-control)',
    background: 'var(--color-hover)',
    color: 'var(--color-text-secondary)',
    fontSize: 'var(--font-size-micro)',
    fontWeight: '500',
  },
  '.cm-var-tip-badge .material-symbols-outlined': { fontSize: '11px', color: muted },
  '.cm-var-tip-chip': { gap: '5px', padding: '2px 8px', fontSize: 'var(--font-size-caption)', fontWeight: '400' },
  '.cm-var-tip-chip .cm-var-tip-dot': { flexBasis: '5px', height: '5px' },
  '.cm-var-tip-src > span': { flexShrink: '0', whiteSpace: 'nowrap' },
  '.cm-var-tip-src > .cm-var-tip-env': { flexShrink: '1', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis' },
  '.cm-var-tip-env': { color: 'var(--color-text-secondary)', fontWeight: '500', whiteSpace: 'nowrap' },
  '.cm-var-tip-lead': { color: 'var(--tip-tone)', whiteSpace: 'nowrap' },
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
  '.cm-var-tip-head .cm-var-tip-icon': { flexBasis: '26px', height: '26px' },
  '.cm-var-tip-icon:hover': { background: 'var(--color-hover)', color: 'var(--color-text)' },
  '.cm-var-tip-value': {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    minHeight: '38px',
    padding: '0 8px 0 12px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border-subtle)',
    background: 'var(--color-hover)',
  },
  '.cm-var-tip-value.editing, .cm-var-tip.missing .cm-var-tip-value:focus-within': {
    background: 'var(--color-panel)',
    border: `1.5px solid ${muted}`,
  },
  '.cm-var-tip-text, .cm-var-tip-input': {
    flex: '1',
    minWidth: '0',
    fontFamily: 'var(--font-code)',
    fontSize: 'var(--font-size-ui)',
    color: 'var(--color-text)',
  },
  '.cm-var-tip-text': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'text' },
  '.cm-var-tip-input': {
    height: '36px',
    padding: '0',
    border: 'none',
    outline: 'none',
    background: 'transparent',
  },
  '.cm-var-tip-input::placeholder': { color: muted },
  '.cm-var-tip-note': { flexWrap: 'wrap', gap: '5px' },
  '.cm-var-tip-note[hidden]': { display: 'none' },
  '.cm-var-tip-note code': {
    fontFamily: 'var(--font-code)',
    fontSize: 'var(--font-size-caption)',
    wordBreak: 'break-all',
  },
  '.cm-var-tip-note.wrap': { display: 'block', lineHeight: '1.45' },
  '.cm-var-tip-actions': {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    paddingTop: '8px',
    borderTop: '1px solid var(--color-border-subtle)',
  },
  '.cm-var-tip-keys': { flex: '1', whiteSpace: 'pre' },
  '.cm-var-tip-btn': {
    padding: '6px 14px',
    border: 'none',
    borderRadius: 'var(--radius-control)',
    background: 'transparent',
    color: 'var(--color-text-secondary)',
    font: '500 var(--font-size-body)/1.3333 var(--font-ui)',
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
  return [highlightPlugin(opts), varHover(opts), varTheme];
}
