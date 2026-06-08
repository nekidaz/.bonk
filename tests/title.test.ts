import { describe, expect, it } from 'vitest';
import { HTTP_DEFAULT_TITLE, titleFromUrl } from '../src/lib/stores';

describe('titleFromUrl', () => {
  it('uses fallback for an empty URL', () => {
    expect(titleFromUrl('', HTTP_DEFAULT_TITLE)).toBe('Untitled Request');
  });

  it('uses a scheme-less host as the title', () => {
    expect(titleFromUrl('google.com')).toBe('google.com');
  });

  it('uses hostname when the URL has no path', () => {
    expect(titleFromUrl('https://api-preprod.example.com/')).toBe('api-preprod.example.com');
  });

  it('uses the last path segment when present', () => {
    expect(titleFromUrl('https://api.bonk.io/v1/users/123/profile')).toBe('profile');
  });
});
