import { describe, expect, it } from 'vitest';
import { endpointHost, fileName, pickClientCert, proxyUrlError } from './proxy';

describe('proxyUrlError', () => {
  it('accepts http and socks5 urls', () => {
    expect(proxyUrlError('http://127.0.0.1:8080')).toBe('');
    expect(proxyUrlError(' socks5://proxy.local:1080 ')).toBe('');
    expect(proxyUrlError('proxy.corp.local:3128')).toBe('');
  });
  it('rejects empty, malformed and unsupported', () => {
    expect(proxyUrlError('')).not.toBe('');
    expect(proxyUrlError('host:8080x y')).not.toBe('');
    expect(proxyUrlError('ftp://h:21')).not.toBe('');
  });
});

describe('fileName', () => {
  it('takes the last path segment', () => {
    expect(fileName('/a/b/ca.pem')).toBe('ca.pem');
    expect(fileName('C:\\x\\c.crt')).toBe('c.crt');
  });
});

describe('pickClientCert', () => {
  const certs = [{ host: 'api.a.kz' }, { host: '*.b.kz' }];
  it('matches exact and wildcard hosts', () => {
    expect(pickClientCert(certs, 'API.a.kz')).toBe(certs[0]);
    expect(pickClientCert(certs, 'x.b.kz')).toBe(certs[1]);
    expect(pickClientCert(certs, 'b.kz')).toBeUndefined();
  });
  it('empty host matches anything', () => {
    expect(pickClientCert([{ host: '' }], 'z.com')).toBeDefined();
  });
});

describe('endpointHost', () => {
  it('strips scheme, port and v6 brackets', () => {
    expect(endpointHost('grpc.a.kz:443')).toBe('grpc.a.kz');
    expect(endpointHost('https://h:1/')).toBe('h');
    expect(endpointHost('[::1]:50051')).toBe('::1');
  });
});
