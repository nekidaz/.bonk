import { describe, expect, it } from 'vitest';
import { scriptOutline } from './scriptOutline';

describe('scriptOutline', () => {
  it('groups functions, tests and variables under // ── sections', () => {
    const code = [
      '// ── Helpers ──────────',
      'const data = pm.response.json();',
      'const isoDate = (s) => !Number.isNaN(Date.parse(s));',
      'function assertMoney(v) {',
      '}',
      '// ── Контракт ответа ─────',
      "pm.test('Статус 200', function () {",
      '});',
      '// ── Окружение',
      "pm.environment.set('payment_id', data.items[0].id);",
    ].join('\n');
    expect(scriptOutline(code)).toEqual([
      {
        title: 'Helpers',
        line: 1,
        items: [
          { kind: 'fn', name: 'isoDate', line: 3 },
          { kind: 'fn', name: 'assertMoney', line: 4 },
        ],
      },
      { title: 'Контракт ответа', line: 6, items: [{ kind: 'test', name: 'Статус 200', line: 7 }] },
      { title: 'Окружение', line: 9, items: [{ kind: 'var', name: 'payment_id', line: 10 }] },
    ]);
  });

  it('keeps an untitled head and drops empty untitled groups', () => {
    expect(scriptOutline('pm.test("a", () => {});')).toEqual([
      { title: '', line: 0, items: [{ kind: 'test', name: 'a', line: 1 }] },
    ]);
    expect(scriptOutline('// ── Только раздел')).toEqual([{ title: 'Только раздел', line: 1, items: [] }]);
  });
});
