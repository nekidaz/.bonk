import type { AppConsoleEntry } from '$entities/request';
import { t, tp } from '$shared/i18n';
import { consoleStatus } from './utilPanel';

/**
 * Flow · Issues: failed console entries folded into problems «by cause, not by line» (CT7–CT12).
 * Pure: the panel and the footer chip derive everything from `appConsole.entries`.
 */

export type IssueKind = 'network' | '4xx' | '5xx' | 'test' | 'script';
export type IssueGroupBy = 'cause' | 'request' | 'host';
export type IssueSort = 'count' | 'recent';
export const ISSUE_KINDS: IssueKind[] = ['network', '4xx', '5xx', 'test', 'script'];

/** One failure: a failed entry, or one failed test of an entry. */
export interface Issue {
  entry: AppConsoleEntry;
  kind: IssueKind;
  /** Same cause = same key («Сервер недоступен» on one host, one test name, 404 on one route…). */
  cause: string;
  /** i18n key of the cause title; `arg` fills `{name}`. */
  title: string;
  arg?: string;
  /** Status chip: `404`, `14 UNAVAILABLE`, `timeout`, `ReferenceError`. */
  code: string;
  /** Error text of this occurrence. */
  detail: string;
  /** Material icon of the kind. */
  icon: string;
  host: string;
  /** `GET /v1/payments/{id}` or the gRPC method. */
  target: string;
  /** Saved node id, or protocol + method + url: what «the same request» means. */
  request: string;
}

export interface IssueGroup {
  key: string;
  kind: IssueKind;
  icon: string;
  title: string;
  arg?: string;
  /** Distinct codes, newest first. */
  codes: string[];
  /** Second line: what failed and where. */
  detail: string;
  /** Newest first. */
  issues: Issue[];
  count: number;
  lastAt: number;
  /** Per request (host grouping, CT11), most frequent first. */
  children: { key: string; label: string; count: number }[];
}

const GRPC_NETWORK = new Set(['UNAVAILABLE', 'DEADLINE_EXCEEDED']);
const GRPC_CLIENT = new Set([
  'INVALID_ARGUMENT',
  'NOT_FOUND',
  'ALREADY_EXISTS',
  'PERMISSION_DENIED',
  'UNAUTHENTICATED',
  'FAILED_PRECONDITION',
  'OUT_OF_RANGE',
  'RESOURCE_EXHAUSTED',
]);
/** HTTP status / gRPC code → cause title key (`issues.title.*`). */
const TITLES: Record<string, string> = {
  '400': 'badRequest',
  '401': 'unauthorized',
  '403': 'forbidden',
  '404': 'notFound',
  '408': 'timeout',
  '409': 'conflict',
  '422': 'badRequest',
  '429': 'tooMany',
  '502': 'badGateway',
  '503': 'unavailable',
  '504': 'timeout',
  UNAVAILABLE: 'unavailable',
  DEADLINE_EXCEEDED: 'timeout',
  INVALID_ARGUMENT: 'badRequest',
  UNAUTHENTICATED: 'unauthorized',
  PERMISSION_DENIED: 'forbidden',
  NOT_FOUND: 'notFound',
  ALREADY_EXISTS: 'conflict',
  RESOURCE_EXHAUSTED: 'tooMany',
};
const ICONS: Record<IssueKind, string> = {
  network: 'wifi_off',
  '4xx': 'error',
  '5xx': 'cancel',
  test: 'fact_check',
  script: 'code_off',
};

const counted =
  (ru: [string, string, string], en: [string, string]) =>
  (n: number): string =>
    `${n} ${tp(n, ru, en)}`;
/** «38 запросов», «6 методов»… in the UI language. */
export const nOf = {
  requests: counted(['запрос', 'запроса', 'запросов'], ['request', 'requests']),
  methods: counted(['метод', 'метода', 'методов'], ['method', 'methods']),
  envs: counted(['окружение', 'окружения', 'окружений'], ['environment', 'environments']),
  causes: counted(['причина', 'причины', 'причин'], ['cause', 'causes']),
  groups: counted(['группа', 'группы', 'групп'], ['group', 'groups']),
  minutes: counted(['минуту', 'минуты', 'минут'], ['minute', 'minutes']),
};

const isTimeout = (text: string) => /time[ds]? ?out|timeout|deadline/i.test(text);

/** `api.example.com`, `grpc.example.com:443`; gRPC targets may carry no scheme or a ` · method` tail. */
export function hostOf(url: string): string {
  const raw = url.split(' · ')[0].trim();
  try {
    return new URL(/^[a-z][\w+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`).host || raw;
  } catch {
    return raw.replace(/^[a-z]+:\/\//i, '').split('/')[0];
  }
}

/** Path with ids folded: `/v1/payments/pay_8f2k1` → `/v1/payments/{id}` (`v1` stays). */
export function routeOf(url: string): string {
  let path = url.split(/[?#]/)[0];
  try {
    path = new URL(path).pathname;
  } catch {
    path = path.replace(/^[a-z]+:\/\/[^/]*/i, '');
  }
  return path
    .split('/')
    .map((s) => (/^\d+$/.test(s) || (s.length >= 6 && /\d/.test(s)) ? '{id}' : s))
    .join('/');
}

/** Saved node id, else protocol + method + url without the query. */
export const requestKey = (e: AppConsoleEntry): string =>
  e.nodeId || `${e.protocol}|${e.method}|${e.url.split(/[?#]/)[0]}`;

function targetOf(e: AppConsoleEntry): string {
  if (e.protocol === 'grpc') return e.url.split(' · ')[1] ?? e.title ?? e.method;
  return `${e.method} ${routeOf(e.url)}`;
}

/** The failures in one failed entry (a failed test each; otherwise the entry itself). */
export function issuesOf(e: AppConsoleEntry): Issue[] {
  if (e.ok) return [];
  const host = hostOf(e.url);
  const base = { entry: e, host, target: targetOf(e), request: requestKey(e) };
  const make = (kind: IssueKind, key: string, title: string, code: string, detail: string, arg?: string): Issue => ({
    ...base,
    kind,
    cause: `${kind}|${key}`,
    title: `issues.title.${title}`,
    arg,
    code,
    detail,
    icon: title === 'timeout' ? 'timer_off' : ICONS[kind],
  });
  const message = (e.message ?? '').trim();
  const raw = e.status.trim().toUpperCase().replace(/[ -]/g, '_');

  if (raw === 'SCRIPT_ERROR') {
    const cls = /\b(\w*Error)\b/.exec(message)?.[1] ?? 'Error';
    return [make('script', `pre|${base.request}|${cls}`, 'scriptPre', cls, message)];
  }
  const http = e.protocol !== 'grpc' && /^\d{3}$/.test(raw);
  // The call itself succeeded: tests or the test script failed it.
  if ((http && Number(raw) < 400) || (e.protocol === 'grpc' && raw === 'OK')) {
    const failed = (e.tests ?? []).filter((x) => !x.passed);
    if (failed.length === 0) {
      const cls = /\b(\w*Error)\b/.exec(message)?.[1] ?? 'Error';
      return [make('script', `post|${base.request}|${cls}`, 'script', cls, message)];
    }
    const total = e.tests?.length ?? failed.length;
    return failed.map((x) =>
      make('test', x.name, 'test', t('issues.code.testsOf', { n: failed.length, m: total }), x.error || x.name, x.name),
    );
  }
  if (http) {
    const kind = Number(raw) >= 500 ? '5xx' : '4xx';
    const title = TITLES[raw] ?? (kind === '5xx' ? 'server' : 'client');
    // No error text for a plain 4xx/5xx: the start of the response body says more than the code.
    const body = e.response?.body.replace(/\s+/g, ' ').trim().slice(0, 200);
    return [make(kind, `${raw}|${base.target}`, title, raw, message || body || consoleStatus(e).label)];
  }
  // A known gRPC code other than the transport ones (consoleStatus labels them `5 NOT_FOUND`).
  if (e.protocol === 'grpc' && !GRPC_NETWORK.has(raw) && /^\d+ /.test(consoleStatus(e).label)) {
    const kind = GRPC_CLIENT.has(raw) ? '4xx' : '5xx';
    const code = consoleStatus(e).label;
    return [
      make(kind, `${raw}|${host}|${base.target}`, TITLES[raw] ?? (kind === '5xx' ? 'server' : 'client'), code, message),
    ];
  }
  // Transport: refused, DNS, TLS, timeout — or gRPC UNAVAILABLE / DEADLINE_EXCEEDED.
  const timeout = raw === 'DEADLINE_EXCEEDED' || isTimeout(message);
  const code =
    e.protocol === 'grpc' && GRPC_NETWORK.has(raw)
      ? consoleStatus(e).label
      : timeout
        ? 'timeout'
        : (/\b(E[A-Z]{3,})\b/.exec(message)?.[1] ?? 'ERROR');
  return [
    make(
      'network',
      `${timeout ? 'timeout' : code}|${host}`,
      timeout ? 'timeout' : 'unavailable',
      code,
      message || e.status,
    ),
  ];
}

/**
 * Open failures, oldest first: a request's failures drop out once a later send of the same
 * request succeeds («Исправили — группа уходит после следующей успешной отправки»).
 */
export function openIssues(entries: AppConsoleEntry[], since = 0, muted: ReadonlySet<string> = new Set()): Issue[] {
  const fixed = new Set<string>();
  const out: Issue[] = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.at < since) break;
    const key = requestKey(e);
    if (e.ok) fixed.add(key);
    else if (!fixed.has(key)) for (const x of issuesOf(e)) if (!muted.has(x.cause)) out.push(x);
  }
  return out.reverse();
}

export const countByKind = (issues: Issue[]): Record<IssueKind, number> => {
  const out = { network: 0, '4xx': 0, '5xx': 0, test: 0, script: 0 };
  for (const x of issues) out[x.kind]++;
  return out;
};

const requestLabel = (x: Issue) => x.entry.title || x.target;

/** Fold issues into groups; `count` sorts by frequency, `recent` by the last occurrence. */
export function groupIssues(issues: Issue[], by: IssueGroupBy, sort: IssueSort = 'count'): IssueGroup[] {
  const map = new Map<string, Issue[]>();
  for (let i = issues.length - 1; i >= 0; i--) {
    const x = issues[i];
    const key = by === 'cause' ? x.cause : by === 'host' ? x.host : x.request;
    map.set(key, [...(map.get(key) ?? []), x]);
  }
  const groups = [...map].map(([key, list]): IssueGroup => {
    const last = list[0];
    const requests = new Map<string, { label: string; count: number }>();
    for (const x of list) {
      const r = requests.get(x.request);
      requests.set(x.request, { label: requestLabel(x), count: (r?.count ?? 0) + 1 });
    }
    const envs = new Set(list.map((x) => x.entry.env).filter(Boolean));
    const causes = new Set(list.map((x) => x.cause));
    let detail: string;
    if (by === 'host')
      detail =
        causes.size > 1
          ? `${nOf.requests(list.length)} · ${nOf.causes(causes.size)}`
          : `${(last.entry.protocol === 'grpc' ? nOf.methods : nOf.requests)(requests.size)} · ${nOf.envs(Math.max(envs.size, 1))}`;
    else if (by === 'request') detail = last.host;
    else if (requests.size > 1)
      detail = `${last.host} · ${(last.entry.protocol === 'grpc' ? nOf.methods : nOf.requests)(requests.size)}`;
    else if (last.kind === 'network') detail = `${last.target} · ${last.host}`;
    else if (last.kind === 'test' || last.kind === 'script') detail = `${requestLabel(last)} · ${last.detail}`;
    else detail = last.entry.env ? `${last.target} · ${last.entry.env}` : last.target;
    const head = by === 'cause' ? last : undefined;
    return {
      key,
      kind: last.kind,
      icon: last.icon,
      title: head ? head.title : by === 'host' ? key : requestLabel(last),
      arg: head?.arg,
      codes:
        head?.kind === 'test' && requests.size > 1
          ? [nOf.requests(requests.size)]
          : [...new Set(list.map((x) => x.code))].slice(0, 4),
      detail,
      issues: list,
      count: list.length,
      lastAt: last.entry.at,
      children: [...requests].map(([k, r]) => ({ key: k, ...r })).sort((a, b) => b.count - a.count),
    };
  });
  return groups.sort((a, b) => (sort === 'count' ? b.count - a.count || b.lastAt - a.lastAt : b.lastAt - a.lastAt));
}

/** Twelve 5-minute buckets of the last hour, oldest first (CT10 mini chart). */
export function sparkline(issues: Issue[], now = Date.now()): number[] {
  const out = Array<number>(12).fill(0);
  for (const x of issues) {
    const slot = Math.floor((now - x.entry.at) / 300_000);
    if (slot >= 0 && slot < 12) out[11 - slot]++;
  }
  return out;
}

/**
 * CT11: one host behind many failed requests is one problem. The busiest unreachable host
 * with ≥ 5 failures over ≥ 2 requests, with when it last answered.
 */
export function outage(
  issues: Issue[],
  entries: AppConsoleEntry[],
): { host: string; count: number; minutes: number; lastOkAt?: number } | undefined {
  const byHost = new Map<string, Issue[]>();
  for (const x of issues) if (x.kind === 'network') byHost.set(x.host, [...(byHost.get(x.host) ?? []), x]);
  const [host, list] = [...byHost].sort((a, b) => b[1].length - a[1].length)[0] ?? [];
  if (!host || !list || list.length < 5 || new Set(list.map((x) => x.request)).size < 2) return undefined;
  const ats = list.map((x) => x.entry.at);
  const lastOk = entries.findLast((e) => e.ok && hostOf(e.url) === host);
  return {
    host,
    count: list.length,
    minutes: Math.max(1, Math.round((Math.max(...ats) - Math.min(...ats)) / 60_000)),
    lastOkAt: lastOk?.at,
  };
}

const PRIVATE_HOST = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|localhost)/;

/** CT8: what probably went wrong and what to check — i18n keys and their params. */
export function issueHint(x: Issue): { title: string; text: string; params?: Record<string, string> } {
  const ip = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/.exec(x.detail)?.[1] ?? x.host;
  switch (x.kind) {
    case 'network':
      if (x.code === 'timeout') return { title: 'issues.hint.timeout', text: 'issues.hint.timeoutText' };
      if (/ENOTFOUND|EAI_AGAIN|dns|resolve/i.test(x.detail))
        return { title: 'issues.hint.dns', text: 'issues.hint.dnsText' };
      if (/tls|ssl|certificate/i.test(x.detail)) return { title: 'issues.hint.tls', text: 'issues.hint.tlsText' };
      return PRIVATE_HOST.test(ip)
        ? { title: 'issues.hint.refused', text: 'issues.hint.vpn', params: { ip } }
        : { title: 'issues.hint.refused', text: 'issues.hint.refusedText' };
    case '4xx':
      if (/^(401|403)$|UNAUTH|PERMISSION/.test(x.code))
        return { title: 'issues.hint.auth', text: 'issues.hint.authText', params: { env: x.entry.env ?? '—' } };
      if (/404|NOT_FOUND/.test(x.code)) return { title: 'issues.hint.notFound', text: 'issues.hint.notFoundText' };
      if (/429|EXHAUSTED/.test(x.code)) return { title: 'issues.hint.tooMany', text: 'issues.hint.tooManyText' };
      return { title: 'issues.hint.badRequest', text: 'issues.hint.badRequestText' };
    case '5xx':
      return { title: 'issues.hint.server', text: 'issues.hint.serverText' };
    case 'test':
      return { title: 'issues.hint.test', text: 'issues.hint.testText' };
    case 'script':
      return { title: 'issues.hint.script', text: 'issues.hint.scriptText' };
  }
}

/** Collection = the first folder of the saved request (`fs:Payments API/…` → `Payments API`). */
export const collectionOf = (x: Issue): string =>
  x.entry.nodeId?.startsWith('fs:') && x.entry.nodeId.includes('/') ? x.entry.nodeId.slice(3).split('/')[0] : '';

export type IssueFacet = 'host' | 'env' | 'collection' | 'time';
export type IssueFacets = Partial<Record<IssueFacet, string>>;

function facetValue(x: Issue, f: IssueFacet, now: number): string[] {
  if (f === 'host') return [x.host];
  if (f === 'env') return x.entry.env ? [x.entry.env] : [];
  if (f === 'collection') return collectionOf(x) ? [collectionOf(x)] : [];
  const today = new Date(now).setHours(0, 0, 0, 0);
  return [...(now - x.entry.at < 3_600_000 ? ['hour'] : []), ...(x.entry.at >= today ? ['today'] : [])];
}

/** CT12: each facet's values with counts (over the issues the other facets let through). */
export function facetCounts(
  issues: Issue[],
  selected: IssueFacets,
  now = Date.now(),
): Record<IssueFacet, { value: string; count: number }[]> {
  const out = {} as Record<IssueFacet, { value: string; count: number }[]>;
  for (const f of ['host', 'env', 'collection', 'time'] as IssueFacet[]) {
    const others = { ...selected, [f]: undefined };
    const counts = new Map<string, number>();
    for (const x of filterFacets(issues, others, now))
      for (const v of facetValue(x, f, now)) counts.set(v, (counts.get(v) ?? 0) + 1);
    out[f] = [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
    if (f === 'time') out[f].sort((a) => (a.value === 'hour' ? -1 : 1));
  }
  return out;
}

export function filterFacets(issues: Issue[], selected: IssueFacets, now = Date.now()): Issue[] {
  const active = (Object.entries(selected) as [IssueFacet, string | undefined][]).filter(([, v]) => v);
  return active.length ? issues.filter((x) => active.every(([f, v]) => facetValue(x, f, now).includes(v!))) : issues;
}

/** Filter text: every term must appear in the title, code, target, host or error. */
export function matchesIssueFilter(x: Issue, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay =
    `${t(x.title, { name: x.arg ?? '' })} ${x.code} ${x.target} ${x.host} ${x.detail} ${x.entry.title ?? ''}`.toLowerCase();
  return terms.every((term) => hay.includes(term));
}

/** «Скопировать отчёт»: plain text for a ticket or chat. */
export function issueReport(g: IssueGroup): string {
  const time = (at: number) => new Date(at).toISOString().replace('T', ' ').slice(0, 19);
  return [
    `${t(g.title, { name: g.arg ?? '' })} · ${g.codes.join(' · ')} · ×${g.count}`,
    g.detail,
    '',
    ...g.issues.map(
      (x) =>
        `${time(x.entry.at)}  ${x.entry.method} ${x.entry.url}  ${x.entry.status}  ${x.entry.elapsedMs} ms${x.entry.env ? `  ${x.entry.env}` : ''}${x.detail ? `\n  ${x.detail}` : ''}`,
    ),
  ].join('\n');
}
