import { describe, it, expect } from 'vitest';
import { mergeScope, resolveVars, resolveRequestVars, findVariables, lookupVar } from './vars';
import type { Environment, HttpRequest, VarRow } from './types';

function v(key: string, value: string, enabled = true): VarRow {
  return { key, value, enabled };
}

function env(name: string, vars: VarRow[]): Environment {
  return { id: `env-${name}`, name, vars };
}

describe('mergeScope', () => {
  it('includes only enabled rows with a non-empty key', () => {
    const globals: VarRow[] = [
      v('host', 'api.example.com'),
      v('disabled', 'nope', false),
      v('', 'no-key'),
      v('   ', 'blank-key'),
    ];
    expect(mergeScope(globals, undefined)).toEqual({ host: 'api.example.com' });
  });

  it('lets the active environment override globals on key collisions', () => {
    const globals: VarRow[] = [v('host', 'global.example.com'), v('token', 'g-tok')];
    const active = env('staging', [v('host', 'staging.example.com')]);
    expect(mergeScope(globals, active)).toEqual({
      host: 'staging.example.com',
      token: 'g-tok',
    });
  });

  it('trims keys when building the scope map', () => {
    expect(mergeScope([v('  host  ', 'x')], undefined)).toEqual({ host: 'x' });
  });

  it('ignores disabled env rows so globals show through', () => {
    const globals: VarRow[] = [v('host', 'global')];
    const active = env('staging', [v('host', 'staging', false)]);
    expect(mergeScope(globals, active)).toEqual({ host: 'global' });
  });
});

describe('resolveVars', () => {
  const scope = { host: 'api.example.com', token: 'abc123' };

  it('replaces a known variable', () => {
    expect(resolveVars('https://{{host}}/v1', scope)).toBe('https://api.example.com/v1');
  });

  it('leaves an unknown variable untouched', () => {
    expect(resolveVars('{{missing}}/x', scope)).toBe('{{missing}}/x');
  });

  it('allows and trims surrounding whitespace inside the braces', () => {
    expect(resolveVars('{{ host }}', scope)).toBe('api.example.com');
    expect(resolveVars('{{\thost\t}}', scope)).toBe('api.example.com');
  });

  it('replaces multiple occurrences, mixing known and unknown', () => {
    expect(resolveVars('{{host}}/{{missing}}/{{token}}', scope)).toBe('api.example.com/{{missing}}/abc123');
  });

  it('returns text unchanged when there are no variables', () => {
    expect(resolveVars('https://static.example.com/path', scope)).toBe('https://static.example.com/path');
  });

  it('resolves to an empty string when the mapped value is empty', () => {
    expect(resolveVars('a{{blank}}b', { blank: '' })).toBe('ab');
  });
});

describe('findVariables', () => {
  it('returns every placeholder with trimmed names and brace-inclusive offsets', () => {
    const text = 'https://{{host}}/v1?t={{ token }}';
    expect(findVariables(text)).toEqual([
      { name: 'host', from: 8, to: 16 },
      { name: 'token', from: 22, to: 33 },
    ]);
  });

  it('matches exactly what resolveVars would replace', () => {
    const text = 'a {{x}} b {{ y }} c {{}} d {not} {{a{b}}';
    const names = findVariables(text).map((m) => m.name);
    expect(names).toEqual(['x', 'y', '']);
  });

  it('returns an empty array when there are no placeholders', () => {
    expect(findVariables('https://plain.example.com')).toEqual([]);
  });
});

describe('lookupVar', () => {
  const globals: VarRow[] = [v('host', 'global.example.com'), v('token', 'g-tok')];

  it('resolves from the active environment first', () => {
    const active = env('staging', [v('host', 'staging.example.com')]);
    expect(lookupVar('host', globals, active)).toEqual({
      value: 'staging.example.com',
      source: 'env',
    });
  });

  it('falls back to globals and reports the source', () => {
    const active = env('staging', [v('other', 'x')]);
    expect(lookupVar('token', globals, active)).toEqual({ value: 'g-tok', source: 'globals' });
    expect(lookupVar('token', globals, undefined)).toEqual({ value: 'g-tok', source: 'globals' });
  });

  it('returns null for unknown, blank, and disabled-only names', () => {
    expect(lookupVar('missing', globals, undefined)).toBeNull();
    expect(lookupVar('', globals, undefined)).toBeNull();
    expect(lookupVar('  ', globals, undefined)).toBeNull();
    expect(lookupVar('off', [v('off', 'x', false)], undefined)).toBeNull();
  });

  it('ignores disabled env rows so globals show through (matching mergeScope)', () => {
    const active = env('staging', [v('host', 'staging', false)]);
    expect(lookupVar('host', globals, active)).toEqual({
      value: 'global.example.com',
      source: 'globals',
    });
  });

  it('trims the name and row keys, and last enabled duplicate wins (matching mergeScope)', () => {
    const rows = [v('  host  ', 'first'), v('host', 'second')];
    expect(lookupVar(' host ', rows, undefined)).toEqual({ value: 'second', source: 'globals' });
    expect(mergeScope(rows, undefined)).toEqual({ host: 'second' });
  });
});

describe('resolveRequestVars', () => {
  it('resolves url, header keys and values, and body without mutating the input', () => {
    const scope = { host: 'api.example.com', token: 'abc123', hk: 'X-Trace', body: 'world' };
    const req: HttpRequest = {
      method: 'POST',
      url: 'https://{{host}}/users',
      headers: { Authorization: 'Bearer {{token}}', '{{hk}}': '{{token}}' },
      body: 'hello {{body}}',
    };
    const out = resolveRequestVars(req, scope);
    expect(out).toEqual({
      method: 'POST',
      url: 'https://api.example.com/users',
      headers: { Authorization: 'Bearer abc123', 'X-Trace': 'abc123' },
      body: 'hello world',
    });
    // Input is untouched (new object returned).
    expect(req.url).toBe('https://{{host}}/users');
    expect(req.headers).toEqual({ Authorization: 'Bearer {{token}}', '{{hk}}': '{{token}}' });
    expect(out).not.toBe(req);
  });

  it('leaves body undefined when the request has none', () => {
    const req: HttpRequest = { method: 'GET', url: '{{host}}', headers: {} };
    const out = resolveRequestVars(req, { host: 'api.example.com' });
    expect(out.body).toBeUndefined();
    expect(out.url).toBe('api.example.com');
  });
});
