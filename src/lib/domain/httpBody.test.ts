import { describe, it, expect } from 'vitest';
import { buildUrlEncodedBody } from './httpBody';
import type { BodyParam } from './types';

const bp = (key: string, value: string): BodyParam => ({ key, value, description: '', enabled: true });

describe('buildUrlEncodedBody', () => {
  it('encodes keys and values', () => {
    expect(buildUrlEncodedBody([bp('a', 'b c'), bp('x&y', '1')])).toBe('a=b%20c&x%26y=1');
  });

  it('preserves {{var}} placeholders so the backend can interpolate them', () => {
    expect(buildUrlEncodedBody([bp('token', '{{authToken}}')])).toBe('token={{authToken}}');
    expect(buildUrlEncodedBody([bp('id', 'u-{{userId}}')])).toBe('id=u-{{userId}}');
  });
});
