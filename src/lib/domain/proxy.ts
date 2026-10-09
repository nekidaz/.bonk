import { get } from 'svelte/store';
import { t, type Translate } from '../i18n';

const SCHEMES = ['http:', 'https:', 'socks5:', 'socks5h:'];

/** Localized error for a manual proxy URL, or '' when it is acceptable. Pass `$t` from a component so it re-runs on language change. */
export function proxyUrlError(raw: string, tr: Translate = get(t)): string {
  let v = raw.trim();
  if (!v) return tr('settings.proxy.err.empty');
  if (!v.includes('://')) v = `http://${v}`; // bare host:port means http://
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return tr('settings.proxy.err.invalid');
  }
  if (!SCHEMES.includes(u.protocol)) return tr('settings.proxy.err.scheme');
  if (!u.hostname) return tr('settings.proxy.err.host');
  return '';
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export interface HostCert { host: string; certPath: string; keyPath: string }

/** First client identity whose host matches (exact, `*.wildcard`, or empty = any). Mirrors bonk-core `pick_client_cert`. */
export function pickClientCert<T extends { host: string }>(certs: T[], host: string): T | undefined {
  const h = host.toLowerCase();
  return certs.find((c) => {
    const p = c.host.trim().toLowerCase();
    if (!p) return true;
    if (p.startsWith('*.')) return h.length > p.length - 1 && h.endsWith(p.slice(1));
    return p === h;
  });
}

/** Host of a gRPC endpoint (`host:port`, optional scheme, `[v6]:port`). */
export function endpointHost(endpoint: string): string {
  const rest = endpoint.trim().replace(/^https?:\/\//, '').split('/')[0];
  const v6 = rest.match(/^\[([^\]]+)\]/);
  return v6 ? v6[1] : rest.split(':')[0];
}
