// Network settings added with the S32 Proxy / Certificates / gRPC sections.
// Self-persisting; passwords live in the OS keychain and only in memory here.
import { get, writable } from 'svelte/store';
import { persisted, loadState, saveState } from '../persist';
import { secretGet, secretSet, secretDelete } from '../api';
import { pickClientCert, endpointHost, hasIdentity, type HostCert } from '../domain/proxy';
import type { GrpcPrefs, GrpcTls, RequestSettings } from '../domain/types';

const isCerts = (v: unknown): v is HostCert[] =>
  Array.isArray(v) && v.every((c) => c && typeof c.host === 'string' && typeof c.certPath === 'string' && typeof c.keyPath === 'string');

// --- Proxy ---
export const proxyAuth = persisted('proxyAuth', false);
export const proxyUser = persisted('proxyUser', '');
export const proxyPassword = writable('');

const PROXY_PW = 'net:proxy-password';
let pwTimer: ReturnType<typeof setTimeout> | undefined;
// Subscribe only after the keychain read so the initial '' can't wipe the entry.
async function loadProxyPassword(): Promise<void> {
  try {
    proxyPassword.set((await secretGet(PROXY_PW)) ?? '');
    proxyPassword.subscribe((pw) => {
      clearTimeout(pwTimer);
      pwTimer = setTimeout(() => void (pw ? secretSet(PROXY_PW, pw) : secretDelete(PROXY_PW)).catch((e) => console.warn('keychain: proxy password not stored', e)), 500);
    });
  } catch (e) {
    console.warn('keychain: proxy password not read', e);
  }
}
void loadProxyPassword();

// --- Certificates ---
export const trustSystemCas = persisted('trustSystemCas', true);
export const clientCerts = persisted<HostCert[]>('clientCerts', [], isCerts);

// PKCS#12 passwords live in the OS keychain (one per .p12 path); this is the in-memory mirror so
// request settings can be built synchronously.
export const p12Passwords = writable<Record<string, string>>({});
const p12Key = (path: string) => `net:p12:${path}`;

export async function setP12Password(path: string, password: string): Promise<void> {
  p12Passwords.update((m) => ({ ...m, [path]: password }));
  try {
    await (password ? secretSet(p12Key(path), password) : secretDelete(p12Key(path)));
  } catch (e) {
    console.warn('keychain: .p12 password not stored', e);
  }
}

/** Drop the keychain entry of a .p12 no remaining certificate uses. */
export function forgetP12Password(path: string): void {
  if (get(clientCerts).some((c) => c.p12Path === path)) return;
  p12Passwords.update(({ [path]: _, ...rest }) => rest);
  void secretDelete(p12Key(path)).catch(() => {});
}

void clientCerts.ready.then(async () => {
  for (const path of new Set(get(clientCerts).flatMap((c) => (c.p12Path ? [c.p12Path] : [])))) {
    try {
      const pw = await secretGet(p12Key(path));
      if (pw) p12Passwords.update((m) => ({ ...m, [path]: pw }));
    } catch (e) {
      console.warn('keychain: .p12 password not read', e);
    }
  }
});

/** Client identities as sent to the backend (passwords attached for .p12 entries). */
export function activeClientCerts(): RequestSettings['clientCerts'] {
  const pw = get(p12Passwords);
  return get(clientCerts).filter(hasIdentity).map((c) => (c.p12Path ? { ...c, p12Password: pw[c.p12Path] ?? '' } : c));
}

// One-time move of the old single global client cert/key into the per-host list (host '' = any).
void clientCerts.ready.then(async () => {
  const [cert, key] = [await loadState('clientCertPath', ''), await loadState('clientKeyPath', '')];
  if (!cert || !key) return;
  if (!get(clientCerts).length) clientCerts.set([{ host: '', certPath: cert, keyPath: key }]);
  await saveState('clientCertPath', '');
  await saveState('clientKeyPath', '');
});

// --- gRPC ---
export const grpcImportPaths = persisted<string[]>('grpcImportPaths', []);
// 250 MB = the fixed cap bonk used before this was configurable.
export const grpcMaxMessageMb = persisted('grpcMaxMessageMb', 250);
export const grpcKeepaliveSecs = persisted('grpcKeepaliveSecs', 30);
export const grpcEmitDefaults = persisted('grpcEmitDefaults', false);
export const grpcInt64AsNumber = persisted('grpcInt64AsNumber', false);

export function currentGrpcPrefs(): GrpcPrefs {
  return {
    maxMessageMb: get(grpcMaxMessageMb),
    keepaliveSecs: get(grpcKeepaliveSecs),
    emitDefaults: get(grpcEmitDefaults),
    int64AsNumber: get(grpcInt64AsNumber),
  };
}

/** Per-tab gRPC TLS, falling back to the Settings client cert for the endpoint's host. */
export function grpcTlsFor(endpoint: string, tls?: GrpcTls): GrpcTls | undefined {
  if ((tls?.clientCert && tls.clientKey) || tls?.clientP12) return tls;
  const c = pickClientCert(activeClientCerts(), endpointHost(endpoint));
  if (!c) return tls;
  return c.p12Path ? { ...tls, clientP12: c.p12Path, clientP12Password: c.p12Password } : { ...tls, clientCert: c.certPath, clientKey: c.keyPath };
}

/** Tab proto import paths plus the global `-I` list, de-duplicated. */
export const withGlobalImports = (paths: string[]): string[] => [...new Set([...paths, ...get(grpcImportPaths)])];
