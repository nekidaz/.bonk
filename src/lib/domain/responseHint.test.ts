import { describe, expect, it } from 'vitest';
import { isTimeout, responseTone } from './responseHint';
import type { HttpResponse } from './types';

const res = (status: number, body = '', headers: Record<string, string> = {}): HttpResponse => ({ status, headers, body, final_url: '', elapsed_ms: 0, size_bytes: 0 });

describe('responseHint', () => {
  it('maps statuses to tones', () => {
    expect([res(200), res(302), res(404), res(503), res(0, 'error sending request'), res(0, 'Request cancelled')].map(responseTone)).toEqual(['success', 'success', 'warning', 'danger', 'danger', 'neutral']);
    expect(isTimeout(res(0, 'operation timed out'))).toBe(true);
  });
});
