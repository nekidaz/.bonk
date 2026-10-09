import { describe, expect, it } from 'vitest';
import { isTimeout, responseHint, responseTone } from './responseHint';
import type { HttpResponse, Tab } from './types';

const res = (status: number, body = '', headers: Record<string, string> = {}): HttpResponse => ({ status, headers, body, final_url: '', elapsed_ms: 0, size_bytes: 0 });
const tab = { id: 't', protocol: 'http', title: 't', request: { method: 'GET', url: '', headers: { Authorization: 'Bearer {{token}}' } } } as Tab;

describe('responseHint', () => {
  it('maps statuses to tones', () => {
    expect([res(200), res(302), res(404), res(503), res(0, 'error sending request'), res(0, 'Request cancelled')].map(responseTone)).toEqual(['success', 'success', 'warning', 'danger', 'danger', 'neutral']);
    expect(isTimeout(res(0, 'operation timed out'))).toBe(true);
  });
  it('points 401 at Authorization and 5xx at retry', () => {
    expect(responseHint(tab, res(401), 'Production')?.text).toBe('Сервер не принял токен. Проверьте вкладку Authorization — для окружения Production используется {{token}}.');
    const h = responseHint(tab, res(500, '', { 'X-Request-Id': 'req_7Hc2x9' }), undefined);
    expect([h?.tone, h?.action.kind, h?.text.endsWith('Request-ID req_7Hc2x9.')]).toEqual(['danger', 'retry', true]);
    expect(responseHint(tab, res(404), 'Production')).toBeNull();
  });
});
