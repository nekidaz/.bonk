import { describe, expect, it } from 'vitest';
import { commandFor, effectiveBindings, eventToBinding, findConflicts, formatBinding, HOTKEY_COMMANDS } from './hotkeys';

const ev = (code: string, o: Partial<KeyboardEvent> = {}) => ({ code, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...o });

describe('eventToBinding', () => {
  it('uses e.code so layouts do not matter, and orders modifiers', () => {
    expect(eventToBinding(ev('KeyT', { metaKey: true, shiftKey: true }), true)).toBe('Mod+Shift+T');
    expect(eventToBinding(ev('Backslash', { metaKey: true }), true)).toBe('Mod+\\');
    expect(eventToBinding(ev('Digit1', { metaKey: true, altKey: true }), true)).toBe('Mod+Alt+1');
  });
  it('maps ctrl to Mod off mac and to Ctrl on mac', () => {
    expect(eventToBinding(ev('KeyS', { ctrlKey: true }), false)).toBe('Mod+S');
    expect(eventToBinding(ev('Tab', { ctrlKey: true }), true)).toBe('Ctrl+Tab');
  });
  it('rejects bare keys and lone modifiers', () => {
    expect(eventToBinding(ev('KeyA'), true)).toBeNull();
    expect(eventToBinding(ev('KeyA', { shiftKey: true }), true)).toBeNull();
    expect(eventToBinding(ev('MetaLeft', { metaKey: true }), true)).toBeNull();
  });
});

describe('formatBinding', () => {
  it('renders mac key caps', () => {
    expect(formatBinding('Mod+Enter', true)).toEqual(['⌘', '↵']);
    expect(formatBinding('Mod+Alt+E', true)).toEqual(['⌥', '⌘', 'E']);
    expect(formatBinding('Ctrl+Shift+Tab', true)).toEqual(['⌃', '⇧', 'Tab']);
  });
  it('renders words elsewhere and nothing when cleared', () => {
    expect(formatBinding('Mod+Shift+T', false)).toEqual(['Ctrl', 'Shift', 'T']);
    expect(formatBinding('')).toEqual([]);
  });
});

describe('bindings', () => {
  it('defaults have no conflicts', () => {
    expect(findConflicts(effectiveBindings({}))).toEqual({});
  });
  it('overrides win, are flagged as conflicts, and dispatch', () => {
    const b = effectiveBindings({ save: 'Mod+K', send: '' });
    expect(findConflicts(b)).toEqual({ save: ['palette'], palette: ['save'] });
    expect(commandFor(ev('KeyK', { metaKey: true }), b, true)).toBe('save');
    expect(commandFor(ev('Enter', { metaKey: true }), b, true)).toBeUndefined();
  });
  it('registry ids are unique', () => {
    expect(new Set(HOTKEY_COMMANDS.map((c) => c.id)).size).toBe(HOTKEY_COMMANDS.length);
  });
});
