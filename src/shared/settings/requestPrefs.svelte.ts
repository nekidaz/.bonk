import { isArrayOf, setting } from '$shared/persist';
import type { ProxyMode } from '$shared/model';

const isProxyMode = (v: unknown): v is ProxyMode => v === 'system' || v === 'none' || v === 'manual';
const isString = (v: unknown): v is string => typeof v === 'string';

/** Request / network / gRPC defaults (Settings → Запросы, Прокси, Сертификаты, gRPC). Self-persisting. */
export const requestPrefs = {
  // Pretty response viewers wrap long lines by default; Raw can still be copied unchanged.
  responseLineWrap: setting('response.lineWrap', 'responseLineWrap', true),
  // Global request behavior mirrors Postman-style app settings.
  requestTimeoutMs: setting('http.timeoutMs', 'requestTimeoutMs', 30_000),
  requestFollowRedirects: setting('http.followRedirects', 'requestFollowRedirects', true),
  requestValidateTls: setting('http.validateTls', 'requestValidateTls', true),
  responseBodyLimitMb: setting('response.bodyLimitMb', 'responseBodyLimitMb', 25),
  // Open JSON responses in Pretty (true) or Raw (false) by default.
  responsePrettyDefault: setting('response.prettyByDefault', 'responsePrettyDefault', true),
  // Network: proxy (system | none | manual) and TLS files (PEM paths), applied to every HTTP send.
  proxyMode: setting<ProxyMode>('proxy.mode', 'proxyMode', 'system', isProxyMode),
  proxyUrl: setting('proxy.url', 'proxyUrl', ''),
  proxyBypass: setting('proxy.bypass', 'proxyBypass', ''),
  trustedCaPaths: setting<string[]>('tls.caFiles', 'trustedCaPaths', [], isArrayOf(isString)),
  // gRPC defaults (consumed by GrpcEditor): deadline in ms and auto server-reflection on connect.
  grpcDeadlineMs: setting('grpc.deadlineMs', 'grpcDeadlineMs', 30_000),
  grpcAutoReflect: setting('grpc.autoReflect', 'grpcAutoReflect', true),
};
