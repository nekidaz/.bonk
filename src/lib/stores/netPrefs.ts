// Network settings added with the S32 Proxy / Certificates / gRPC sections.
// Self-persisting; passwords live in the OS keychain and only in memory here.
import { get, writable } from 'svelte/store';
import { persisted, loadState, saveState } from '../persist';
import { secretGet, secretSet, secretDelete } from '../api';
import { pickClientCert, endpointHost, type HostCert } from '../domain/proxy';
import type { GrpcPrefs, GrpcTls } from '../domain/types';

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
  if (tls?.clientCert && tls.clientKey) return tls;
  const c = pickClientCert(get(clientCerts).filter((x) => x.certPath && x.keyPath), endpointHost(endpoint));
  return c ? { ...tls, clientCert: c.certPath, clientKey: c.keyPath } : tls;
}

/** Tab proto import paths plus the global `-I` list, de-duplicated. */
export const withGlobalImports = (paths: string[]): string[] => [...new Set([...paths, ...get(grpcImportPaths)])];
