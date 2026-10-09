// Network settings added with the S32 Proxy / Certificates / gRPC sections.
// Self-persisting; passwords live in the OS keychain and only in memory here.
import { persisted, loadState, saveState } from '$shared/persist';
import { secretGet, secretSet, secretDelete } from '$shared/ipc';
import { pickClientCert, endpointHost, hasIdentity, type HostCert } from './proxy';
import type { GrpcPrefs, GrpcTls, RequestSettings } from '$shared/model';

const isCerts = (v: unknown): v is HostCert[] =>
  Array.isArray(v) &&
  v.every((c) => c && typeof c.host === 'string' && typeof c.certPath === 'string' && typeof c.keyPath === 'string');

// --- Proxy ---
export const proxyAuth = persisted('proxyAuth', false);
export const proxyUser = persisted('proxyUser', '');

const PROXY_PW = 'net:proxy-password';

/** The proxy password: held here, written to the OS keychain 500 ms after the last change. */
class ProxyPassword {
  #value = $state('');
  // Save only after the keychain read, so the initial '' can't wipe the entry.
  #loaded = false;
  #timer: ReturnType<typeof setTimeout> | undefined;

  get current(): string {
    return this.#value;
  }

  set current(pw: string) {
    this.#value = pw;
    if (this.#loaded) this.#save(pw);
  }

  async load(): Promise<void> {
    try {
      this.#value = (await secretGet(PROXY_PW)) ?? '';
      this.#loaded = true;
      this.#save(this.#value);
    } catch (e) {
      console.warn('keychain: proxy password not read', e);
    }
  }

  #save(pw: string): void {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(
      () =>
        void (pw ? secretSet(PROXY_PW, pw) : secretDelete(PROXY_PW)).catch((e) =>
          console.warn('keychain: proxy password not stored', e),
        ),
      500,
    );
  }
}
export const proxyPassword = new ProxyPassword();
void proxyPassword.load();

// --- Certificates ---
export const trustSystemCas = persisted('trustSystemCas', true);
export const clientCerts = persisted<HostCert[]>('clientCerts', [], isCerts);

/**
 * PKCS#12 passwords (.p12 path → password). They live in the OS keychain (one per path); this is
 * the in-memory mirror so request settings can be built synchronously.
 */
class P12Passwords {
  current = $state.raw<Record<string, string>>({});
}
export const p12Passwords = new P12Passwords();
const p12Key = (path: string) => `net:p12:${path}`;

export async function setP12Password(path: string, password: string): Promise<void> {
  p12Passwords.current = { ...p12Passwords.current, [path]: password };
  try {
    await (password ? secretSet(p12Key(path), password) : secretDelete(p12Key(path)));
  } catch (e) {
    console.warn('keychain: .p12 password not stored', e);
  }
}

/** Drop the keychain entry of a .p12 no remaining certificate uses. */
export function forgetP12Password(path: string): void {
  if (clientCerts.current.some((c) => c.p12Path === path)) return;
  const { [path]: _, ...rest } = p12Passwords.current;
  p12Passwords.current = rest;
  void secretDelete(p12Key(path)).catch(() => {});
}

void clientCerts.ready.then(async () => {
  for (const path of new Set(clientCerts.current.flatMap((c) => (c.p12Path ? [c.p12Path] : [])))) {
    try {
      const pw = await secretGet(p12Key(path));
      if (pw) p12Passwords.current = { ...p12Passwords.current, [path]: pw };
    } catch (e) {
      console.warn('keychain: .p12 password not read', e);
    }
  }
});

/** Client identities as sent to the backend (passwords attached for .p12 entries). */
export function activeClientCerts(): RequestSettings['clientCerts'] {
  const pw = p12Passwords.current;
  return clientCerts.current
    .filter(hasIdentity)
    .map((c) => (c.p12Path ? { ...c, p12Password: pw[c.p12Path] ?? '' } : c));
}

// One-time move of the old single global client cert/key into the per-host list (host '' = any).
void clientCerts.ready.then(async () => {
  const [cert, key] = [await loadState('clientCertPath', ''), await loadState('clientKeyPath', '')];
  if (!cert || !key) return;
  if (!clientCerts.current.length) clientCerts.current = [{ host: '', certPath: cert, keyPath: key }];
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
    maxMessageMb: grpcMaxMessageMb.current,
    keepaliveSecs: grpcKeepaliveSecs.current,
    emitDefaults: grpcEmitDefaults.current,
    int64AsNumber: grpcInt64AsNumber.current,
  };
}

/** Per-tab gRPC TLS, falling back to the Settings client cert for the endpoint's host. */
export function grpcTlsFor(endpoint: string, tls?: GrpcTls): GrpcTls | undefined {
  if ((tls?.clientCert && tls.clientKey) || tls?.clientP12) return tls;
  const c = pickClientCert(activeClientCerts(), endpointHost(endpoint));
  if (!c) return tls;
  return c.p12Path
    ? { ...tls, clientP12: c.p12Path, clientP12Password: c.p12Password }
    : { ...tls, clientCert: c.certPath, clientKey: c.keyPath };
}

/** Tab proto import paths plus the global `-I` list, de-duplicated. */
export const withGlobalImports = (paths: string[]): string[] => [...new Set([...paths, ...grpcImportPaths.current])];
