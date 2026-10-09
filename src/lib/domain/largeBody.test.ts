import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => ({})) }));
vi.hoisted(() => { (globalThis as any).document = { documentElement: { lang: '' } }; });

import { applyBodyKind, beautify, bodyKindLabel, bodyKindOf, isLargeBody, textStats, LARGE_BODY_LINES } from './largeBody';

describe('large body', () => {
  it('counts lines and UTF-8 bytes', () => {
    expect(textStats('')).toEqual({ bytes: 0, lines: 1, approx: false });
    expect(textStats('a\nб\n')).toEqual({ bytes: 5, lines: 3, approx: false });
  });
  it('is large past the char or line threshold', () => {
    expect(isLargeBody('{"a":1}')).toBe(false);
    expect(isLargeBody('x\n'.repeat(LARGE_BODY_LINES))).toBe(true);
    expect(isLargeBody('x'.repeat(20_000))).toBe(true);
  });
  it('beautifies JSON and throws on garbage', () => {
    expect(beautify('{"a":1}', 'JSON')).toBe('{\n  "a": 1\n}');
    expect(() => beautify('{"a":', 'JSON')).toThrow();
    expect(beautify('plain', 'Text')).toBe('plain');
  });
  it('maps body kinds both ways', () => {
    const tab = (request: Record<string, unknown>) => ({ request }) as never;
    expect(bodyKindOf(tab({ bodyMode: 'form-data' }))).toBe('multipart');
    expect(bodyKindOf(tab({ bodyMode: 'raw', rawBodyFormat: 'XML' }))).toBe('xml');
    expect(bodyKindOf(tab({ bodyMode: 'graphql' }))).toBe('graphql');
    expect(applyBodyKind({ bodyMode: 'none', body: 'x' } as never, 'javascript')).toMatchObject({ bodyMode: 'raw', rawBodyFormat: 'JavaScript', body: 'x' });
    expect(applyBodyKind({} as never, 'multipart').bodyMode).toBe('form-data');
    expect(bodyKindLabel(tab({ bodyMode: 'raw', rawBodyFormat: 'JSON' }))).toBe('Raw JSON');
    expect(bodyKindLabel(tab({ bodyMode: 'graphql' }))).toBe('Raw GraphQL');
    expect(bodyKindLabel(tab({ bodyMode: 'binary' }))).toBe('BINARY');
  });
});
