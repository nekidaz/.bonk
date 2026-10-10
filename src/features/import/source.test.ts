import { describe, expect, it } from 'vitest';
import { formatSize, guessFormat, loadSource, SourceError, sourceStats } from './source';

const origin = { kind: 'paste' as const, location: '', name: 'pasted', size: 0 };

const yamlSpec = `openapi: 3.1.0
info:
  title: Payments API
  version: 1.4.2
servers:
  - url: https://api.x.test/v1
paths:
  /payments:
    get:
      tags: [Payments]
      summary: List payments
`;

describe('loadSource', () => {
  it('sniffs OpenAPI from YAML content and reads its card details', () => {
    const s = loadSource(yamlSpec, origin);
    expect(s.format).toBe('openapi');
    expect([s.title, s.label, s.version, s.syntax]).toEqual(['Payments API', 'OpenAPI 3.1', '1.4.2', 'YAML']);
    expect(sourceStats(s).slice(0, 3)).toEqual(['1 операция', '1 тег', '1 сервер']);
  });

  it('sniffs Postman, Insomnia, HAR and cURL', () => {
    const postman = JSON.stringify({
      info: { name: 'P', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [{ name: 'A', request: { method: 'GET', url: 'https://x.test/a' } }],
    });
    const insomnia = JSON.stringify({
      _type: 'export',
      __export_format: 4,
      resources: [{ _id: 'w', _type: 'workspace', name: 'I' }],
    });
    const har = JSON.stringify({ log: { entries: [] } });
    expect(loadSource(postman, origin).label).toBe('Postman v2.1');
    expect(loadSource(insomnia, origin).label).toBe('Insomnia v4');
    expect(loadSource(har, { ...origin, name: 'app.har' }).label).toBe('HAR');
    expect(loadSource('curl https://x.test/a', origin).format).toBe('curl');
  });

  it('points at the broken line of a YAML document and says what it looks like', () => {
    const broken = yamlSpec.replace('      summary: List payments', '     summary: List payments');
    let err: unknown;
    try {
      loadSource(broken, origin);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SourceError);
    const e = err as SourceError;
    expect(e.syntax).toBe('YAML');
    expect(e.line).toBe(11);
    expect(e.col).toBeGreaterThan(0);
    expect(e.guess).toBe('OpenAPI 3.1');
  });

  it('locates a JSON syntax error too', () => {
    const e = (() => {
      try {
        loadSource('{\n  "openapi": "3.0.0",\n  "info": {\n}', origin);
      } catch (err) {
        return err as SourceError;
      }
    })();
    expect(e?.syntax).toBe('JSON');
    expect(e?.line).toBeGreaterThan(0);
  });

  it('refuses a document of no known format', () => {
    expect(() => loadSource('{"hello": 1}', origin)).toThrow(SourceError);
  });
});

describe('helpers', () => {
  it('formats sizes and guesses formats', () => {
    expect([formatSize(512), formatSize(219_000), formatSize(3_500_000)]).toEqual(['512 B', '214 KB', '3.3 MB']);
    expect(guessFormat('swagger: "2.0"')).toBe('Swagger 2.0');
    expect(guessFormat('hello')).toBe('');
  });
});
