import { describe, expect, it } from 'vitest';
import { nodeName, sessionCanRenew, sessionConfigured, sessionTone } from './session';
import type { SessionInfo } from './types';

const info = (patch: Partial<SessionInfo>): SessionInfo => ({
  accessPreview: 'eyJ…',
  hasRefresh: true,
  accessExp: 1000,
  refreshExp: 5000,
  who: null,
  obtainedAt: 0,
  ...patch,
});

describe('sessionTone', () => {
  it('is none without a session', () => {
    expect(sessionTone(null, 0)).toBe('none');
  });
  it('is ok while the access token lives, or has no end', () => {
    expect(sessionTone(info({}), 999)).toBe('ok');
    expect(sessionTone(info({ accessExp: null }), 9e9)).toBe('ok');
  });
  it('renews by itself when only the access token is gone', () => {
    expect(sessionTone(info({}), 1000)).toBe('renew');
    expect(sessionTone(info({ refreshExp: null }), 9e9)).toBe('renew');
  });
  it('is dead when the refresh token is gone too, or never was', () => {
    expect(sessionTone(info({}), 5000)).toBe('dead');
    expect(sessionTone(info({ hasRefresh: false }), 1000)).toBe('dead');
  });
});

describe('session config', () => {
  it('needs a scenario and an access source to sign in', () => {
    expect(sessionConfigured({})).toBe(false);
    expect(sessionConfigured({ login: 'Auth', access: { request: 'fs:a', path: 'body.t' } })).toBe(true);
    expect(sessionConfigured({ login: 'Auth', access: { request: 'fs:a' } })).toBe(false);
  });
  it('renews only with a request and a refresh token source', () => {
    expect(sessionCanRenew({ renewRequest: 'fs:r', refresh: { request: 'fs:a', path: 'x' } })).toBe(true);
    expect(sessionCanRenew({ renewRequest: 'fs:r' })).toBe(false);
  });
  it('names a request by its file', () => {
    expect(nodeName('fs:api/Auth/Verify OTP.bonk.json')).toBe('Verify OTP');
    expect(nodeName(undefined)).toBe('');
  });
});
