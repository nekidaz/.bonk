// HAR import (IM9): a DevTools recording → requests, with filters for what to take and how to build it.
import { paramsFromUrl, type HttpRequest, type RawBodyFormat, type RequestNode } from '$shared/model';
import type { EnvRow, Plan, PlanFolder, PlanItem, PlanRequest } from './plan';

type Obj = Record<string, unknown>;

/** What kind of traffic an entry is: API calls, page loads, static assets, the rest. */
export type HarKind = 'api' | 'doc' | 'static' | 'other';

export interface HarEntry {
  method: string;
  url: string;
  origin: string;
  host: string;
  /** Pathname, no query. */
  path: string;
  status: number;
  kind: HarKind;
  headers: [string, string][];
  body?: { text: string; mime: string };
}

export interface HarLog {
  title: string;
  entries: HarEntry[];
  /** Cookies seen in the recording, ready for the jar: `Set-Cookie` lines per origin. */
  cookies: { url: string; setCookie: string }[];
}

export interface HarOptions {
  /** Which kinds to take: API calls, page documents, or everything. */
  types: 'api' | 'doc' | 'all';
  /** With «all»: also js, css, fonts, images. */
  statics: boolean;
  /** Skip cancelled (status 0) and 5xx. */
  okOnly: boolean;
  /** Same method + path → one request, ids → `{{id}}`. */
  merge: boolean;
  byDomain: boolean;
  /** The busiest origin → `{{baseUrl}}`. */
  baseUrl: boolean;
  /** Drop Cookie, Host, Content-Length, sec-*. */
  strip: boolean;
}

export const HAR_DEFAULTS: HarOptions = {
  types: 'api',
  statics: false,
  okOnly: true,
  merge: true,
  byDomain: true,
  baseUrl: true,
  strip: true,
};

const obj = (v: unknown): Obj | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string => (v == null ? '' : String(v));
const rows = (v: unknown): Obj[] => (Array.isArray(v) ? v.flatMap((x) => (obj(x) ? [x as Obj] : [])) : []);

const STATIC_EXT = /\.(js|mjs|css|map|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|eot|mp4|webm|mp3)$/i;

/** Chrome's `_resourceType` when present, else the response type, else the extension. */
function kindOf(entry: Obj, path: string, mime: string): HarKind {
  const rt = str(entry._resourceType).toLowerCase();
  if (rt === 'xhr' || rt === 'fetch') return 'api';
  if (rt === 'document') return 'doc';
  if (['script', 'stylesheet', 'image', 'font', 'media', 'manifest'].includes(rt)) return 'static';
  if (rt) return 'other';
  if (STATIC_EXT.test(path) || /^(image|font|video|audio)\/|javascript|css/.test(mime)) return 'static';
  if (/json|xml|grpc|protobuf/.test(mime)) return 'api';
  if (/html/.test(mime)) return 'doc';
  return 'other';
}

/** Read `log` of a HAR 1.2 file. */
export function readHar(log: Obj, fileName = ''): HarLog {
  const entries: HarEntry[] = [];
  const cookies = new Map<string, { url: string; setCookie: string }>();
  for (const entry of rows(log.entries)) {
    const req = obj(entry.request);
    if (!req) continue;
    let u: URL;
    try {
      u = new URL(str(req.url));
    } catch {
      continue;
    }
    const res = obj(entry.response) ?? {};
    const mime = str(obj(res.content)?.mimeType).toLowerCase();
    const headers: [string, string][] = rows(req.headers)
      .map((h): [string, string] => [str(h.name), str(h.value)])
      .filter(([n]) => n.trim() && !n.startsWith(':'));
    const post = obj(req.postData);
    entries.push({
      method: (str(req.method) || 'GET').toUpperCase(),
      url: u.href,
      origin: u.origin,
      host: u.host,
      path: u.pathname,
      status: Number(res.status) || 0,
      kind: kindOf(entry, u.pathname, mime),
      headers,
      ...(post && typeof post.text === 'string' && post.text
        ? { body: { text: post.text, mime: str(post.mimeType).toLowerCase() } }
        : {}),
    });
    // Request cookies say what the browser held; a response Set-Cookie wins (it has the attributes).
    for (const c of rows(req.cookies)) {
      const k = `${u.host} ${str(c.name)}`;
      if (str(c.name) && !cookies.has(k))
        cookies.set(k, { url: u.origin, setCookie: `${str(c.name)}=${str(c.value)}; Path=/` });
    }
    for (const h of rows(res.headers)) {
      if (str(h.name).toLowerCase() !== 'set-cookie') continue;
      const name = str(h.value).split('=')[0].trim();
      if (name) cookies.set(`${u.host} ${name}`, { url: u.origin, setCookie: str(h.value) });
    }
  }
  const page = str(rows(log.pages)[0]?.title).trim();
  return { title: fileName.replace(/\.har$/i, '') || page || 'HAR import', entries, cookies: [...cookies.values()] };
}

/** Path segments that look like ids: numbers, uuids, long hex, long letter+digit tokens, `pay_8f2k1x`. */
const ID_SEGMENT =
  /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|(?=.*\d)(?=.*[a-z])[a-z0-9]{12,}|[a-z]{2,8}_(?=.*\d)[a-z0-9]{6,})$/i;

/** `/payments/123/capture` → `/payments/{{id}}/capture`. */
export function templateIds(path: string): string {
  return path
    .split('/')
    .map((s) => (ID_SEGMENT.test(s) ? '{{id}}' : s))
    .join('/');
}

const SERVICE_HEADER = /^(cookie|host|content-length|sec-.*)$/i;

function bodyFormat(mime: string): RawBodyFormat {
  if (mime.includes('json')) return 'JSON';
  if (mime.includes('xml')) return 'XML';
  if (mime.includes('html')) return 'HTML';
  return 'Text';
}

function passes(e: HarEntry, o: HarOptions): boolean {
  if (o.okOnly && (e.status < 200 || e.status >= 500)) return false;
  if (e.kind === 'static' && !o.statics) return false;
  if (o.types === 'api') return e.kind === 'api';
  if (o.types === 'doc') return e.kind === 'doc';
  return true;
}

/** The preview plan of a HAR log under `o`: requests grouped by domain, with counts for the summary. */
export function harPlan(log: HarLog, o: HarOptions): Plan & { kept: number; skipped: number } {
  const kept = log.entries.filter((e) => passes(e, o));
  const byOrigin = new Map<string, number>();
  for (const e of kept) byOrigin.set(e.origin, (byOrigin.get(e.origin) ?? 0) + 1);
  const base = o.baseUrl ? [...byOrigin].sort((a, b) => b[1] - a[1])[0]?.[0] : undefined;

  // One request per key; the first recorded entry is the example, later ones only count.
  const groups = new Map<string, { e: HarEntry; n: number }>();
  kept.forEach((e, i) => {
    const key = o.merge ? `${e.method} ${e.origin}${templateIds(e.path)}` : `${i} ${e.method} ${e.url}`;
    const g = groups.get(key);
    if (g) g.n++;
    else groups.set(key, { e, n: 1 });
  });

  const requests: { host: string; req: PlanRequest }[] = [];
  for (const [key, { e, n }] of groups) {
    const path = o.merge ? templateIds(e.path) : e.path;
    const query = e.url.slice(e.origin.length + e.path.length);
    const url = (e.origin === base ? '{{baseUrl}}' : e.origin) + path + query;
    const headers: Record<string, string> = {};
    for (const [name, value] of e.headers) if (!o.strip || !SERVICE_HEADER.test(name)) headers[name] = value;
    const request: HttpRequest = { method: e.method, url, headers };
    if (e.body) {
      request.bodyMode = 'raw';
      request.body = e.body.text;
      request.rawBodyFormat = bodyFormat(e.body.mime);
    }
    const params = paramsFromUrl(url);
    const name = path.replace(/^\//, '') || e.host;
    const node: RequestNode = {
      kind: 'request',
      id: '',
      name,
      protocol: 'http',
      request,
      ...(params.length ? { params } : {}),
    };
    const hint =
      n > 1 ? `×${n} → 1` : query ? (query.length > 24 ? query.slice(0, 23) + '…' : query) : (e.body?.mime ?? '');
    requests.push({ host: e.host, req: { kind: 'request', key, link: `${e.method} ${path}`, node, hint } });
  }

  let items: PlanItem[];
  if (o.byDomain) {
    // Every recorded host is listed; one the filters emptied stays as a greyed row with its total.
    const totals = new Map<string, number>();
    for (const e of log.entries) totals.set(e.host, (totals.get(e.host) ?? 0) + 1);
    const folders: PlanFolder[] = [...totals].map(([host, total]) => ({
      kind: 'folder',
      key: `host:${host}`,
      name: host,
      domain: true,
      total,
      items: requests.filter((r) => r.host === host).map((r) => r.req),
    }));
    items = folders.sort((a, b) => b.items.length - a.items.length);
  } else items = requests.map((r) => r.req);

  const envRows: EnvRow[] = base
    ? [
        {
          key: base,
          label: base,
          vars: [{ key: 'baseUrl', value: base, enabled: true }],
          suggest: log.title,
          active: true,
        },
      ]
    : [];
  return {
    title: log.title,
    items,
    envRows,
    kept: requests.length,
    skipped: log.entries.length - kept.length,
  };
}
