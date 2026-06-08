import { titleFromUrl, HTTP_DEFAULT_TITLE } from '../stores';
import { currentBodyMode, currentRawFormat } from './httpBody';
import type { AuthConfig, BodyParam, Param, Tab } from './types';

export type HeaderPreview = { key: string; value: string; source: string };

export function titleFor(t: Tab, url: string): string {
  return t.manualTitle ? t.title : titleFromUrl(url, HTTP_DEFAULT_TITLE);
}
export function emptyParam(): Param {
  return { key: '', value: '', description: '', enabled: true };
}
export function emptyBodyParam(): BodyParam {
  return { key: '', value: '', description: '', enabled: true, kind: 'text' };
}
export function normalizeBodyParam(row: BodyParam): BodyParam {
  return { ...row, kind: row.kind ?? 'text' };
}
export function authFor(t: Tab | undefined): AuthConfig {
  return t?.request.auth ?? { type: 'none', apiKeyIn: 'header' };
}
export function hostFromUrl(url: string): string {
  const clean = url.trim();
  if (!clean) return '';
  try {
    const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(clean) ? clean : `https://${clean}`;
    return new URL(withScheme).host;
  } catch {
    return '';
  }
}
export function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase());
}
export function autoContentType(t: Tab): string {
  const mode = currentBodyMode(t);
  const hasRows = (t.request.bodyParams ?? []).some((row) => row.enabled && row.key.trim() !== '');
  if (mode === 'urlencoded' && hasRows) return 'application/x-www-form-urlencoded';
  if (mode === 'form-data' && hasRows) return 'multipart/form-data; boundary=<auto>';
  if (mode === 'raw' && currentRawFormat(t) === 'JSON' && (t.request.body ?? '').length > 0) return 'application/json';
  return '';
}
export function generatedAuthHeaders(t: Tab): HeaderPreview[] {
  const auth = authFor(t);
  if (auth.type === 'bearer' && auth.bearerToken?.trim()) {
    return [{ key: 'Authorization', value: `Bearer ${auth.bearerToken.trim()}`, source: 'Auth' }];
  }
  if (auth.type === 'basic' && ((auth.basicUsername ?? '') || (auth.basicPassword ?? ''))) {
    return [{ key: 'Authorization', value: 'Basic <generated>', source: 'Auth' }];
  }
  if (auth.type === 'apiKey' && (auth.apiKeyIn ?? 'header') === 'header' && auth.apiKeyName?.trim() && auth.apiKeyValue != null) {
    return [{ key: auth.apiKeyName.trim(), value: auth.apiKeyValue, source: 'Auth' }];
  }
  return [];
}
export function autoHeaderRows(t: Tab | undefined): HeaderPreview[] {
  if (!t) return [];
  const headers = t.request.headers ?? {};
  const host = hostFromUrl(t.request.url);
  const rows: HeaderPreview[] = [
    ...(host ? [{ key: 'Host', value: host, source: 'Auto' }] : []),
    { key: 'User-Agent', value: 'Bonk/0.1', source: 'Default' },
    { key: 'Accept', value: '*/*', source: 'Default' },
    ...(autoContentType(t) ? [{ key: 'Content-Type', value: autoContentType(t), source: 'Auto' }] : []),
    ...generatedAuthHeaders(t),
  ];
  return rows.filter((row) => !hasHeader(headers, row.key));
}
export function headerRows(t: Tab | undefined): HeaderPreview[] {
  return [...Object.entries(t?.request.headers ?? {}).map(([key, value]) => ({ key, value, source: 'Manual' })), { key: '', value: '', source: '' }];
}
export function fileName(path: string | undefined): string {
  if (!path) return 'Choose file...';
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}
export function paramRows(t: Tab | undefined): Param[] {
  return [...(t?.params ?? []), emptyParam()];
}
export function bodyParamRows(t: Tab | undefined): BodyParam[] {
  return [...(t?.request.bodyParams ?? []).map(normalizeBodyParam), emptyBodyParam()];
}
