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

export type HintAction = { label: string; kind: 'auth' | 'retry' } | { label: string; kind: 'copy'; value: string };

export interface ResponseHint {
  tone: 'warning' | 'danger';
  icon: string;
  text: string;
  actions: HintAction[];
}

/** 4xx statuses that get a cause hint (validation, routing, content negotiation...). Value: [i18n key, retriable]. */
const CLIENT_HINTS: Record<number, [string, boolean]> = {
  400: ['validation', false],
  422: ['validation', false],
  404: ['notfound', false],
  405: ['method', false],
  408: ['timeout', true],
  409: ['conflict', false],
  413: ['toolarge', false],
  415: ['mediatype', false],
  429: ['ratelimit', true],
};

/** Banner above the response card (S06 / S07): what went wrong and the one next step. */
export function responseHint(tab: Tab, res: HttpResponse, envName: string | undefined, tr: Translate = get(t)): ResponseHint | null {
  const header = (re: RegExp) => Object.entries(res.headers).find(([k]) => re.test(k))?.[1];
  const retry: HintAction = { label: tr('response.hint.retry'), kind: 'retry' };
  if (res.status === 401 || res.status === 403) {
    const tokenVar = (tab.request.auth?.bearerToken ?? tab.request.headers?.Authorization ?? '').match(/\{\{\s*[^{}]+?\s*\}\}/)?.[0];
    const where = envName && tokenVar ? tr('response.hint.auth_env', { env: envName, token: tokenVar }) : '.';
    return { tone: 'warning', icon: 'key', text: tr('response.hint.auth', { where }), actions: [{ label: tr('response.hint.open_auth'), kind: 'auth' }] };
  }
  const client = CLIENT_HINTS[res.status];
  if (client) {
    const [key, retriable] = client;
    const retryAfter = res.status === 429 ? header(/^retry-after$/i) : undefined;
    const text = tr(`response.hint.${key}`, { env: envName ? ` (${envName})` : '' }) + (retryAfter ? tr('response.hint.retry_after', { s: retryAfter }) : '');
    return { tone: 'warning', icon: 'info', text, actions: retriable ? [retry] : [] };
  }
  if (res.status >= 500) {
    const id = header(/^x-(request|correlation|trace)-id$/i);
    const actions: HintAction[] = [retry];
    if (id) actions.push({ label: tr('response.hint.copy_id'), kind: 'copy', value: id });
    return { tone: 'danger', icon: 'error', text: tr('response.hint.server', { support: id ? tr('response.hint.support', { id }) : '' }), actions };
  }
  return null;
}
