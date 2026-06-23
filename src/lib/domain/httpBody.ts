import type { BodyMode, BodyParam, HttpRequest, RawBodyFormat, Tab } from './types';
import { encodeQueryPart } from './http';

/** The active body mode for a tab, defaulting to 'raw' when unset. */
export function currentBodyMode(t: Tab | undefined): BodyMode {
  return t?.request.bodyMode ?? 'raw';
}

/**
 * The raw body format for a tab. Uses the explicit `rawBodyFormat` when set,
 * otherwise sniffs the body text (JSON/HTML/XML) and falls back to 'Text'.
 */
export function currentRawFormat(t: Tab | undefined): RawBodyFormat {
  if (t?.request.rawBodyFormat) return t.request.rawBodyFormat;
  const body = t?.request.body?.trim() ?? '';
  if (!body) return 'JSON';
  if (/^[\[{]/.test(body)) return 'JSON';
  if (/^<(!doctype html|html[\s>])/i.test(body)) return 'HTML';
  if (/^<\?xml/i.test(body)) return 'XML';
  return 'Text';
}

/** Add `name: value` only if no header with that name (case-insensitive) exists. */
export function setHeaderIfMissing(
  headers: Record<string, string>,
  name: string,
  value: string,
): Record<string, string> {
  const exists = Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase());
  return exists ? headers : { ...headers, [name]: value };
}

/** Enabled body-param rows with a non-empty key. */
export function enabledBodyParams(t: Tab): BodyParam[] {
  return (t.request.bodyParams ?? []).filter((row) => row.enabled && row.key.trim() !== '');
}

/**
 * Serialize body-param rows as an `application/x-www-form-urlencoded` string.
 * Uses encodeQueryPart (not URLSearchParams) so `{{var}}` placeholders survive
 * for backend interpolation, matching query-param encoding.
 */
export function buildUrlEncodedBody(rows: BodyParam[]): string {
  return rows.map((row) => `${encodeQueryPart(row.key)}=${encodeQueryPart(row.value)}`).join('&');
}

/** Serialize body-param rows as a multipart/form-data body for `boundary`. */
export function buildMultipartBody(rows: BodyParam[], boundary: string): string {
  return rows
    .map((row) => [
      `--${boundary}`,
      `Content-Disposition: form-data; name="${row.key.replace(/"/g, '%22')}"`,
      '',
      row.value,
    ].join('\r\n'))
    .concat(`--${boundary}--`)
    .join('\r\n');
}

function appendQueryParam(url: string, name: string, value: string): string {
  const hashIndex = url.indexOf('#');
  const beforeHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex);
  const joiner = beforeHash.includes('?')
    ? beforeHash.endsWith('?') || beforeHash.endsWith('&') ? '' : '&'
    : '?';
  return `${beforeHash}${joiner}${encodeQueryPart(name)}=${encodeQueryPart(value)}${hash}`;
}

function basicAuthToken(username: string, password: string): string {
  const value = `${username}:${password}`;
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const fallback = (globalThis as unknown as { Buffer?: { from(input: Uint8Array): { toString(encoding: string): string } } }).Buffer;
  return typeof btoa === 'function' ? btoa(binary) : (fallback?.from(bytes).toString('base64') ?? '');
}

/**
 * Build the HttpRequest to send for a tab: applies the body mode (urlencoded /
 * form-data / raw / binary / graphql) to produce the wire body and any
 * Content-Type header, and stamps the resolved `finalUrl`. Pure: depends only
 * on the tab and url. Multipart file bodies are assembled by the Rust backend
 * so files can be streamed from disk and reqwest can own the boundary header.
 */
export function buildRequestForSend(t: Tab, finalUrl: string): HttpRequest {
  const mode = currentBodyMode(t);
  let headers = { ...t.request.headers };
  let url = finalUrl;
  let body: string | undefined;

  if (mode === 'urlencoded') {
    const encoded = buildUrlEncodedBody(enabledBodyParams(t));
    if (encoded) {
      body = encoded;
      headers = setHeaderIfMissing(headers, 'Content-Type', 'application/x-www-form-urlencoded');
    }
  } else if (mode === 'form-data') {
    const rows = enabledBodyParams(t);
    if (rows.length > 0) {
      body = undefined;
    }
  } else if (mode === 'graphql') {
    const rawBody = t.request.body ?? '';
    if (rawBody.length > 0) {
      body = rawBody;
      headers = setHeaderIfMissing(headers, 'Content-Type', 'application/json');
    }
  } else if (mode !== 'none') {
    const rawBody = t.request.body ?? '';
    if (rawBody.length > 0) {
      body = rawBody;
      if (mode === 'raw' && currentRawFormat(t) === 'JSON') {
        headers = setHeaderIfMissing(headers, 'Content-Type', 'application/json');
      }
    }
  }

  const auth = t.request.auth;
  if (auth?.type === 'bearer' && auth.bearerToken?.trim()) {
    headers = setHeaderIfMissing(headers, 'Authorization', `Bearer ${auth.bearerToken.trim()}`);
  } else if (auth?.type === 'basic') {
    const username = auth.basicUsername ?? '';
    const password = auth.basicPassword ?? '';
    if (username || password) {
      headers = setHeaderIfMissing(headers, 'Authorization', `Basic ${basicAuthToken(username, password)}`);
    }
  } else if (auth?.type === 'apiKey' && auth.apiKeyName?.trim() && auth.apiKeyValue != null) {
    const name = auth.apiKeyName.trim();
    if ((auth.apiKeyIn ?? 'header') === 'query') {
      url = appendQueryParam(url, name, auth.apiKeyValue);
    } else {
      headers = setHeaderIfMissing(headers, name, auth.apiKeyValue);
    }
  }

  return { ...t.request, url, headers, body };
}
