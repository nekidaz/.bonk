/** Rebindable keyboard shortcuts: registry, binding format and matching. Pure. */

/** Binding = modifiers + key joined by '+': 'Mod+Shift+T', 'Mod+Enter', 'Ctrl+Tab'. Mod = ⌘ on mac, Ctrl elsewhere. */
export type Binding = string;

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** `label` and `group` are i18n keys; translate at render time. */
export type HotkeyCommand = { id: string; label: string; group: string; def: Binding };

const TAB_NEXT = IS_MAC ? 'Ctrl+Tab' : 'Mod+Tab';
const TAB_PREV = IS_MAC ? 'Ctrl+Shift+Tab' : 'Mod+Shift+Tab';

export const HOTKEY_COMMANDS: HotkeyCommand[] = [
  { id: 'send', label: 'hotkeys.cmd.send', group: 'hotkeys.group.request', def: 'Mod+Enter' },
  { id: 'save', label: 'hotkeys.cmd.save', group: 'hotkeys.group.request', def: 'Mod+S' },
  { id: 'codePanel', label: 'hotkeys.cmd.codePanel', group: 'hotkeys.group.request', def: 'Mod+Alt+E' },
  { id: 'newRequest', label: 'hotkeys.cmd.newRequest', group: 'hotkeys.group.request', def: 'Mod+N' },
  { id: 'newGrpc', label: 'hotkeys.cmd.newGrpc', group: 'hotkeys.group.request', def: 'Mod+Alt+N' },
  { id: 'newCollection', label: 'hotkeys.cmd.newCollection', group: 'hotkeys.group.request', def: 'Mod+Shift+N' },
  { id: 'newFolder', label: 'hotkeys.cmd.newFolder', group: 'hotkeys.group.request', def: 'Mod+Shift+F' },
  { id: 'expand', label: 'hotkeys.cmd.expand', group: 'hotkeys.group.request', def: 'Mod+Alt+F' },
  { id: 'toggleResponse', label: 'hotkeys.cmd.toggleResponse', group: 'hotkeys.group.request', def: 'Mod+Shift+R' },
  { id: 'toggleRequest', label: 'hotkeys.cmd.toggleRequest', group: 'hotkeys.group.request', def: 'Mod+Shift+E' },
  { id: 'palette', label: 'hotkeys.cmd.palette', group: 'hotkeys.group.nav', def: 'Mod+K' },
  { id: 'env', label: 'hotkeys.cmd.env', group: 'hotkeys.group.nav', def: 'Mod+E' },
  { id: 'sidebar', label: 'hotkeys.cmd.sidebar', group: 'hotkeys.group.nav', def: 'Mod+\\' },
  { id: 'sidebarAlt', label: 'hotkeys.cmd.sidebarAlt', group: 'hotkeys.group.nav', def: 'Mod+B' },
  { id: 'showCollections', label: 'hotkeys.cmd.showCollections', group: 'hotkeys.group.nav', def: 'Mod+1' },
  { id: 'showHistory', label: 'hotkeys.cmd.showHistory', group: 'hotkeys.group.nav', def: 'Mod+2' },
  { id: 'terminal', label: 'hotkeys.cmd.terminal', group: 'hotkeys.group.nav', def: 'Mod+J' },
  { id: 'workspaceMenu', label: 'hotkeys.cmd.workspaceMenu', group: 'hotkeys.group.nav', def: 'Mod+Shift+O' },
  { id: 'openFolder', label: 'hotkeys.cmd.openFolder', group: 'hotkeys.group.nav', def: 'Mod+O' },
  { id: 'settings', label: 'hotkeys.cmd.settings', group: 'hotkeys.group.nav', def: 'Mod+Comma' },
  { id: 'closeTab', label: 'hotkeys.cmd.closeTab', group: 'hotkeys.group.tabs', def: 'Mod+W' },
  { id: 'closeAllTabs', label: 'hotkeys.cmd.closeAllTabs', group: 'hotkeys.group.tabs', def: 'Mod+Alt+W' },
  { id: 'newTab', label: 'hotkeys.cmd.newTab', group: 'hotkeys.group.tabs', def: 'Mod+T' },
  { id: 'reopenTab', label: 'hotkeys.cmd.reopenTab', group: 'hotkeys.group.tabs', def: 'Mod+Shift+T' },
  { id: 'nextTab', label: 'hotkeys.cmd.nextTab', group: 'hotkeys.group.tabs', def: TAB_NEXT },
  { id: 'prevTab', label: 'hotkeys.cmd.prevTab', group: 'hotkeys.group.tabs', def: TAB_PREV },
];

export const HOTKEY_GROUPS = ['hotkeys.group.request', 'hotkeys.group.nav', 'hotkeys.group.tabs'];

/** Key part of a binding from KeyboardEvent.code (layout-independent). */
function keyOf(code: string): string {
  return code.replace(/^Key|^Digit/, '').replace('Backslash', '\\');
}

/** Binding for a keydown, or null for a bare modifier press / a chord with no Mod/Ctrl/Alt. */
export function eventToBinding(e: Pick<KeyboardEvent, 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>, mac = IS_MAC): Binding | null {
  if (!e.code || /^(Meta|Control|Shift|Alt)(Left|Right)$/.test(e.code)) return null;
  const parts: string[] = [];
  if (mac ? e.metaKey : e.ctrlKey || e.metaKey) parts.push('Mod');
  if (mac && e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (!parts.some((p) => p !== 'Shift')) return null;
  return [...parts, keyOf(e.code)].join('+');
}

export function matches(e: Parameters<typeof eventToBinding>[0], binding: Binding, mac = IS_MAC): boolean {
  return !!binding && eventToBinding(e, mac) === binding;
}

const MAC_MOD: Record<string, string> = { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' };
const KEY_LABEL: Record<string, string> = { Enter: '↵', Backspace: '⌫', Delete: '⌦', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: '␣', Comma: ',' };

/** Key caps, e.g. 'Mod+Shift+T' → ['⇧','⌘','T'] on mac, ['Ctrl','Shift','T'] elsewhere. */
export function formatBinding(binding: Binding, mac = IS_MAC): string[] {
  if (!binding) return [];
  const parts = binding.split('+');
  // 'Mod+\\' splits fine; a literal '+' key is never produced (code is Equal/NumpadAdd).
  const key = parts.pop()!;
  const mods = ['Ctrl', 'Alt', 'Shift', 'Mod'].filter((m) => parts.includes(m));
  const cap = KEY_LABEL[key] ?? key;
  return mac ? [...mods.map((m) => MAC_MOD[m]), cap] : [...['Mod', 'Ctrl', 'Alt', 'Shift'].filter((m) => parts.includes(m)).map((m) => (m === 'Mod' ? 'Ctrl' : m)), cap];
}

/** command id → binding. Merges user overrides over defaults ('' = cleared). */
export function effectiveBindings(overrides: Record<string, string>): Record<string, Binding> {
  const out: Record<string, Binding> = {};
  for (const c of HOTKEY_COMMANDS) out[c.id] = c.id in overrides ? overrides[c.id] : c.def;
  return out;
}

/** command id → ids sharing its binding (only conflicting entries). */
export function findConflicts(bindings: Record<string, Binding>): Record<string, string[]> {
  const byKey = new Map<Binding, string[]>();
  for (const [id, b] of Object.entries(bindings)) if (b) byKey.set(b, [...(byKey.get(b) ?? []), id]);
  const out: Record<string, string[]> = {};
  for (const ids of byKey.values()) if (ids.length > 1) for (const id of ids) out[id] = ids.filter((x) => x !== id);
  return out;
}

/** First command whose binding matches the event. */
export function commandFor(e: Parameters<typeof eventToBinding>[0], bindings: Record<string, Binding>, mac = IS_MAC): string | undefined {
  const b = eventToBinding(e, mac);
  return b ? Object.keys(bindings).find((id) => bindings[id] === b) : undefined;
}

export const isOverrides = (v: unknown): v is Record<string, string> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'string');
