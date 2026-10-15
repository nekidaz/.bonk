import { describe, expect, it } from 'vitest';
import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import type { SettingSpec } from '$shared/persist';
import { settingsCompletions, settingsProblems } from './settingsJson';

const specs: SettingSpec[] = [
  { key: 'ui.fontSize', fallback: 13, valid: (v) => v === 12 || v === 13 || v === 14, legacy: 'uiFontSize' },
  { key: 'proxy.url', fallback: '', valid: (v) => typeof v === 'string', legacy: 'proxyUrl' },
];

describe('settingsProblems', () => {
  it('flags unknown keys and values the app would ignore', () => {
    const text = '{\n  "ui.fontSize": 40,\n  "proxy.url": "http://x",\n  "nope": 1\n}';
    expect(settingsProblems(text, specs)).toEqual([
      { from: 4, to: 17, kind: 'invalid', key: 'ui.fontSize' },
      { from: 52, to: 58, kind: 'unknown', key: 'nope' },
    ]);
    expect(settingsProblems('{ "ui.fontSize": ', specs)).toEqual([]);
  });
});

describe('settingsCompletions', () => {
  const complete = (doc: string, explicit = false) => {
    const pos = doc.indexOf('|');
    const state = EditorState.create({ doc: doc.replace('|', '') });
    return settingsCompletions(specs, new CompletionContext(state, pos, explicit));
  };

  it('completes a key in key position, replacing an auto-closed quote', () => {
    const r = complete('{\n  "ui.f|"\n}');
    expect(r).toMatchObject({ from: 4, to: 10 });
    expect(r?.options[0].apply).toBe('"ui.fontSize": 13');
    expect(complete('{ "a": 1, |', true)).not.toBeNull();
  });

  it('stays out of values', () => {
    expect(complete('{ "proxy.url": "ht|')).toBeNull();
    expect(complete('{ "proxy.url": |', true)).toBeNull();
  });
});
