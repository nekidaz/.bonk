import { writable } from 'svelte/store';
import type { ProxyMode } from '$shared/model';

/** Request / network / gRPC defaults (Settings → Запросы, Прокси, gRPC). Persisted by app/persistence.ts. */

// Pretty response viewers wrap long lines by default; Raw can still be copied unchanged.
export const responseLineWrap = writable<boolean>(true);
// Global request behavior mirrors Postman-style app settings.
export const requestTimeoutMs = writable<number>(30_000);
export const requestFollowRedirects = writable<boolean>(true);
export const requestValidateTls = writable<boolean>(true);
export const responseBodyLimitMb = writable<number>(25);
// Open JSON responses in Pretty (true) or Raw (false) by default.
export const responsePrettyDefault = writable<boolean>(true);
// Network: proxy (system | none | manual) and TLS files (PEM paths), applied to every HTTP send.
export const proxyMode = writable<ProxyMode>('system');
export const proxyUrl = writable<string>('');
export const proxyBypass = writable<string>('');
export const trustedCaPaths = writable<string[]>([]);
// gRPC defaults (consumed by GrpcEditor): deadline in ms and auto server-reflection on connect.
export const grpcDeadlineMs = writable<number>(30_000);
export const grpcAutoReflect = writable<boolean>(true);

// HMR (dev only): app/persistence.ts hydrate() fills these singletons once at startup.
// A partial hot swap would recreate them EMPTY, so force a full reload instead.
// Stripped from production builds, where import.meta.hot is undefined.
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
