import { describe, expect, it } from 'vitest';
import { diffEnvRows, envFromJson, envToJson, lineCol, mergeEnvRows } from './envJson';
import { maskSecret } from './vars';
import type { VarRow } from './types';

const ok = (src: string) => {
  const r = envFromJson(src);
  if (!r.ok) throw new Error(`parse failed: ${r.error.code}`);
  return r.env;
};
const kv = (rows: VarRow[]) => rows.map((r) => [r.key, r.value]);

describe('envFromJson', () => {
  it('reads a flat object: numbers, booleans and null become strings', () => {
    const env = ok('{"baseUrl":"https://x","port":8080,"debug":true,"empty":null,"n":1.50}');
    expect(env.format).toBe('flat');
    expect(kv(env.rows)).toEqual([
      ['baseUrl', 'https://x'],
      ['port', '8080'],
      ['debug', 'true'],
      ['empty', ''],
      ['n', '1.50'],
    ]);
  });

  it('joins nested keys with a dot and keeps arrays as JSON text', () => {
    const env = ok('{"auth":{"token":"t","deep":{"id":7}},"hosts":["a","b"],"none":{}}');
    expect(env.format).toBe('nested');
    expect(kv(env.rows)).toEqual([
      ['auth.token', 't'],
      ['auth.deep.id', '7'],
      ['hosts', '["a","b"]'],
    ]);
  });

  it('hides credential-looking keys at once', () => {
    const env = ok('{"apiKey":"k","token":"t","password":"p","baseUrl":"u","WEBHOOK_SECRET":"s"}');
    expect(env.rows.map((r) => !!r.secret)).toEqual([true, true, true, false, true]);
  });

  it('reads a Postman environment: name, secret type, disabled', () => {
    const env = ok(
      '{"name":"Sandbox","values":[{"key":"a","value":"1","enabled":true},{"key":"t","value":"x","type":"secret"},{"key":"d","value":"true","enabled":false}],"_postman_variable_scope":"environment"}',
    );
    expect(env.format).toBe('postman');
    expect(env.name).toBe('Sandbox');
    expect(env.rows).toEqual([
      { key: 'a', value: '1', enabled: true },
      { key: 't', value: 'x', enabled: true, secret: true },
      { key: 'd', value: 'true', enabled: false },
    ]);
  });

  it('reads an Insomnia export', () => {
    const env = ok(
      '{"resources":[{"_type":"workspace","name":"W"},{"_type":"environment","name":"Base","data":{}},{"_type":"environment","name":"Dev","data":{"host":"h","a":{"b":2}}}]}',
    );
    expect(env.format).toBe('insomnia');
    expect(env.name).toBe('Dev');
    expect(kv(env.rows)).toEqual([
      ['host', 'h'],
      ['a.b', '2'],
    ]);
  });

  it('can be forced to read an object whose key is called "values"', () => {
    const r = envFromJson('{"values":[1,2]}', 'flat');
    expect(r.ok && kv(r.env.rows)).toEqual([['values', '[1,2]']]);
  });

  it('decodes string escapes', () => {
    expect(kv(ok('{"a":"x\\ny\\u00e9\\"q"}').rows)).toEqual([['a', 'x\nyé"q']]);
  });

  it('points at the next token when a comma is missing, and where it goes', () => {
    const src = '{\n  "a": "mrc_7731"\n  "b": 5000\n}';
    const r = envFromJson(src);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('comma');
    expect(r.error.detail).toBe('"mrc_7731"');
    expect(lineCol(src, r.error.pos)).toEqual({ line: 3, col: 3 });
    expect(src.slice(0, r.error.fixAt) + ',' + src.slice(r.error.fixAt)).toContain('"mrc_7731",\n');
    expect(envFromJson(src.slice(0, r.error.fixAt) + ',' + src.slice(r.error.fixAt)).ok).toBe(true);
  });

  it.each([
    ['{"a":1', 'eof'],
    ['{"a" 1}', 'colon'],
    ['{a:1}', 'key'],
    ['{"a":1,}', 'key'],
    ['{"a":}', 'unexpected'],
    ['{"a":1} x', 'unexpected'],
    ['{"a":"\\q"}', 'unexpected'],
    ['[1,2]', 'shape'],
    ['"x"', 'shape'],
    ['   ', 'empty'],
  ])('rejects %s as %s', (src, code) => {
    const r = envFromJson(src);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe(code);
  });

  it('agrees with JSON.parse on what is valid', () => {
    for (const src of [
      '{}',
      '{"a":[1,[2,{"b":null}]],"c":-1.5e3}',
      '{ "a" : "b" }\n',
      '{"a":01}',
      '{"a":.5}',
      '{"a":tru}',
    ]) {
      let valid = true;
      try {
        JSON.parse(src);
      } catch {
        valid = false;
      }
      expect(envFromJson(src).ok).toBe(valid);
    }
  });
});

describe('envToJson', () => {
  const rows: VarRow[] = [
    { key: 'baseUrl', value: 'https://x', enabled: true },
    { key: 'timeoutMs', value: '5000', enabled: true },
    { key: 'id', value: '007', enabled: true },
    { key: 'debug', value: 'true', enabled: true },
    { key: 'token', value: 'sk_live_abcdefghijkl4f2a', enabled: true, secret: true },
  ];

  it('types numbers and booleans back, masks secrets', () => {
    expect(JSON.parse(envToJson(rows, 'mask'))).toEqual({
      baseUrl: 'https://x',
      timeoutMs: 5000,
      id: '007',
      debug: true,
      token: maskSecret('sk_live_abcdefghijkl4f2a'),
    });
  });

  it('blanks secrets for the clipboard', () => {
    expect(JSON.parse(envToJson(rows, 'blank')).token).toBe('');
  });

  it('round-trips through envFromJson', () => {
    const back = ok(envToJson(rows.slice(0, 4), 'mask'));
    expect(kv(back.rows)).toEqual(kv(rows.slice(0, 4)));
  });

  it('an empty environment is {}', () => {
    expect(envToJson([], 'mask')).toBe('{}');
  });
});

describe('mergeEnvRows', () => {
  const token = 'sk_live_abcdefghijkl4f2a';
  const cur: VarRow[] = [
    { key: 'a', value: '1', enabled: true },
    { key: 't', value: token, enabled: true, secret: true },
    { key: 'off', value: 'x', enabled: false },
  ];

  it('a masked secret keeps its real value; a typed one replaces it', () => {
    const kept = mergeEnvRows(cur, [{ key: 't', value: maskSecret(token), enabled: true }], 'replace');
    expect(kept).toEqual([{ key: 't', value: token, enabled: true, secret: true }]);
    const changed = mergeEnvRows(cur, [{ key: 't', value: 'new', enabled: true }], 'replace');
    expect(changed[0]).toEqual({ key: 't', value: 'new', enabled: true, secret: true });
  });

  it('replace drops what is missing, keeps flags of existing keys, follows incoming order', () => {
    const next = mergeEnvRows(
      cur,
      [
        { key: 'off', value: 'y', enabled: true },
        { key: 'a', value: '1', enabled: true },
      ],
      'replace',
    );
    expect(next).toEqual([
      { key: 'off', value: 'y', enabled: false },
      { key: 'a', value: '1', enabled: true },
    ]);
  });

  it('merge keeps what is missing and appends new keys', () => {
    const next = mergeEnvRows(
      cur,
      [
        { key: 'a', value: '2', enabled: true },
        { key: 'n', value: '3', enabled: true },
      ],
      'merge',
    );
    expect(kv(next)).toEqual([
      ['a', '2'],
      ['t', token],
      ['off', 'x'],
      ['n', '3'],
    ]);
  });
});

describe('diffEnvRows', () => {
  it('splits added / changed / removed / same', () => {
    const base: VarRow[] = [
      { key: 'a', value: '1', enabled: true },
      { key: 'b', value: '2', enabled: true },
      { key: 'c', value: '3', enabled: true },
    ];
    const next: VarRow[] = [
      { key: 'a', value: '1', enabled: true },
      { key: 'b', value: '9', enabled: true },
      { key: 'd', value: '4', enabled: true },
    ];
    expect(diffEnvRows(base, next)).toEqual({ added: ['d'], changed: ['b'], removed: ['c'], same: 1 });
  });
});
