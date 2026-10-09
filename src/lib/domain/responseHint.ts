import { get } from 'svelte/store';
import { t, type Translate } from '../i18n';
import type { HttpResponse, Tab } from './types';

export type ResponseTone = 'success' | 'warning' | 'danger' | 'neutral';

/** Colour role of a response status: 2xx/3xx success, 4xx warning, 5xx and network failures danger. */
export function responseTone(res: HttpResponse): ResponseTone {
  if (res.status === 0) return isCancelled(res) ? 'neutral' : 'danger';
  if (res.status >= 500) return 'danger';
  if (res.status >= 400) return 'warning';
  return 'success';
}

export function isCancelled(res: HttpResponse): boolean {
  return res.status === 0 && /cancel/i.test(res.body);
}

export function isTimeout(res: HttpResponse): boolean {
  return res.status === 0 && /timed? ?out|timeout|ETIMEDOUT/i.test(res.body);
}

export interface ResponseHint {
  tone: 'warning' | 'danger';
  icon: string;
  text: string;
  action: { label: string; kind: 'auth' | 'retry' };
}

/** Banner above the response card (S06 / S07): what went wrong and the one next step. */
export function responseHint(tab: Tab, res: HttpResponse, envName: string | undefined, tr: Translate = get(t)): ResponseHint | null {
  if (res.status === 401 || res.status === 403) {
    const tokenVar = (tab.request.auth?.bearerToken ?? tab.request.headers?.Authorization ?? '').match(/\{\{\s*[^{}]+?\s*\}\}/)?.[0];
    const where = envName && tokenVar ? tr('response.hint.auth_env', { env: envName, token: tokenVar }) : '.';
    return { tone: 'warning', icon: 'key', text: tr('response.hint.auth', { where }), action: { label: tr('response.hint.open_auth'), kind: 'auth' } };
  }
  if (res.status >= 500) {
    const id = Object.entries(res.headers).find(([k]) => /^x-(request|correlation|trace)-id$/i.test(k))?.[1];
    return { tone: 'danger', icon: 'error', text: tr('response.hint.server', { support: id ? tr('response.hint.support', { id }) : '' }), action: { label: tr('response.hint.retry'), kind: 'retry' } };
  }
  return null;
}
