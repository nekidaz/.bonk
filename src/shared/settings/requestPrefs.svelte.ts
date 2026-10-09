import type { ProxyMode } from '$shared/model';

/** Request / network / gRPC defaults (Settings → Запросы, Прокси, gRPC). Loaded and saved by app/persistence. */
class RequestPrefs {
  // Pretty response viewers wrap long lines by default; Raw can still be copied unchanged.
  responseLineWrap = $state(true);
  // Global request behavior mirrors Postman-style app settings.
  requestTimeoutMs = $state(30_000);
  requestFollowRedirects = $state(true);
  requestValidateTls = $state(true);
  responseBodyLimitMb = $state(25);
  // Open JSON responses in Pretty (true) or Raw (false) by default.
  responsePrettyDefault = $state(true);
  // Network: proxy (system | none | manual) and TLS files (PEM paths), applied to every HTTP send.
  proxyMode = $state<ProxyMode>('system');
  proxyUrl = $state('');
  proxyBypass = $state('');
  trustedCaPaths = $state.raw<string[]>([]);
  // gRPC defaults (consumed by GrpcEditor): deadline in ms and auto server-reflection on connect.
  grpcDeadlineMs = $state(30_000);
  grpcAutoReflect = $state(true);
}
export const requestPrefs = new RequestPrefs();

// HMR (dev only): app/persistence hydrate() fills this singleton once at startup.
// A partial hot swap would recreate it EMPTY, so force a full reload instead.
// Stripped from production builds, where import.meta.hot is undefined.
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
