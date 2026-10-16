import { describe, expect, it } from 'vitest';
import { consoleStatus, curlForShell, formatElapsed, maskSecret, matchesConsoleFilter } from './utilPanel';

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
});

describe('curlForShell', () => {
  it('moves secret header values into BONK_* variables', () => {
    const { command, env } = curlForShell({
      method: 'GET',
      url: "https://api.x/v1?q=it's",
      request: { headers: { Accept: 'application/json', Authorization: 'Bearer s3cr3t', 'X-Api-Key': 'k1' } },
    });
    expect(env).toEqual({ BONK_TOKEN: 's3cr3t', BONK_X_API_KEY: 'k1' });
    expect(command).not.toContain('s3cr3t');
    expect(command).toBe(
      [
        `curl -X GET 'https://api.x/v1?q=it'\\''s'`,
        `-H 'Accept: application/json'`,
        `-H "Authorization: Bearer $BONK_TOKEN"`,
        `-H "X-Api-Key: $BONK_X_API_KEY"`,
      ].join(' \\\n  '),
    );
  });

  it('quotes a custom method', () => {
    expect(curlForShell({ method: 'GET;rm -rf ~', url: 'https://x' }).command).toBe(
      `curl -X 'GET;rm -rf ~' 'https://x'`,
    );
  });

  it('masks secrets for display', () => {
    expect(maskSecret('Bearer abcdefgh4f2a')).toBe('Bearer ••••4f2a');
    expect(maskSecret('short')).toBe('••••');
  });
});
