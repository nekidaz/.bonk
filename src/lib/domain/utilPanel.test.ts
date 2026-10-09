import { describe, expect, it } from 'vitest';
import { consoleStatus, formatElapsed, matchesConsoleFilter, shortCwd } from './utilPanel';

const e = (p: Partial<Parameters<typeof matchesConsoleFilter>[0]>) => ({
  protocol: 'http' as const,
  method: 'GET',
  url: 'https://api.x/v1/payments',
  status: '200',
  ok: true,
  ...p,
});

describe('consoleStatus', () => {
  it('colours HTTP by class', () => {
    expect(consoleStatus(e({ status: '201' })).tone).toBe('ok');
    expect(consoleStatus(e({ status: '302' })).tone).toBe('info');
    expect(consoleStatus(e({ status: '404' })).tone).toBe('warn');
    expect(consoleStatus(e({ status: '503' })).tone).toBe('err');
    expect(consoleStatus(e({ status: 'SCRIPT ERROR' }))).toEqual({ label: 'SCRIPT ERROR', tone: 'err' });
  });
  it('numbers gRPC codes', () => {
    expect(consoleStatus(e({ protocol: 'grpc', status: 'OK' }))).toEqual({ label: '0 OK', tone: 'ok' });
    expect(consoleStatus(e({ protocol: 'grpc', status: 'UNAVAILABLE' }))).toEqual({
      label: '14 UNAVAILABLE',
      tone: 'err',
    });
    expect(consoleStatus(e({ protocol: 'grpc', status: 'ERROR' })).tone).toBe('err');
  });
});

describe('matchesConsoleFilter', () => {
  it('matches url, status and method; all terms must hit', () => {
    expect(matchesConsoleFilter(e({}), '')).toBe(true);
    expect(matchesConsoleFilter(e({}), 'payments')).toBe(true);
    expect(matchesConsoleFilter(e({}), 'PAYMENTS 200')).toBe(true);
    expect(matchesConsoleFilter(e({}), 'payments 404')).toBe(false);
    expect(matchesConsoleFilter(e({ protocol: 'grpc', status: 'UNAVAILABLE', url: 'svc/Do' }), '14')).toBe(true);
  });
});

describe('format helpers', () => {
  it('elapsed', () => {
    expect(formatElapsed(128)).toBe('128 ms');
    expect(formatElapsed(2000)).toBe('2.0 s');
  });
  it('shortCwd', () => {
    expect(shortCwd('/Users/a', '/Users/a')).toBe('~');
    expect(shortCwd('/Users/a/Documents', '/Users/a')).toBe('~/Documents');
    expect(shortCwd('/Users/a/Documents/bonk/acme-business', '/Users/a')).toBe('~/…/acme-business');
    expect(shortCwd('/tmp', '/Users/a')).toBe('/tmp');
    expect(shortCwd('/var/log/nginx', '/Users/a')).toBe('…/log/nginx');
    expect(shortCwd('', '')).toBe('~');
  });
});
