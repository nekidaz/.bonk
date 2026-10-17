import { t } from '$shared/i18n';
import {
  nodeName,
  type RequestNode,
  type Scenario,
  type SessionConfig,
  type SessionPrompt,
  type SessionTrace,
  type TreeNode,
} from '$shared/model';
import { oauthSpan } from './oauthFormat';

// Pure helpers of the session's Authorization tab (Flow · Session SE2–SE5): option lists for the
// settings, and the lines of a send's timeline.

function find(nodes: TreeNode[], id: string): TreeNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = n.kind === 'folder' ? find(n.children, id) : undefined;
    if (hit) return hit;
  }
  return undefined;
}

/** Every request under `nodes`, in tree order. */
export function allRequests(nodes: TreeNode[]): RequestNode[] {
  return nodes.flatMap((n) => (n.kind === 'folder' ? allRequests(n.children) : [n]));
}

/** The requests a scenario runs: its paths are workspace-relative folders or requests. */
export function scenarioRequests(scenario: Scenario | undefined, tree: TreeNode[]): RequestNode[] {
  const out = new Map<string, RequestNode>();
  for (const path of scenario?.paths ?? []) {
    const node = find(tree, `fs:${path}`);
    for (const r of node ? allRequests([node]) : []) out.set(r.id, r);
  }
  return [...out.values()];
}

/** Every folder and request as an «exclude» option: workspace-relative path, and a `Payments API / List payments` label. */
export function nodeOptions(nodes: TreeNode[], prefix = ''): { rel: string; label: string }[] {
  return nodes.flatMap((n) => {
    const label = prefix ? `${prefix} / ${n.name}` : n.name;
    const own = { rel: n.id.startsWith('fs:') ? n.id.slice(3) : n.id, label };
    return n.kind === 'folder' ? [own, ...nodeOptions(n.children, label)] : [own];
  });
}

/** A node's name in the tree, else the one its id spells. */
export const nodeLabel = (tree: TreeNode[], id: string | undefined): string =>
  (id && find(tree, id)?.name) || nodeName(id);

export const nodeMethod = (tree: TreeNode[], id: string | undefined): string => {
  const node = id ? find(tree, id) : undefined;
  return node?.kind === 'request' ? node.request.method : '';
};

/** Is `rel` (workspace-relative) a folder? For “except the Auth · OTP folder”. */
export const isFolder = (tree: TreeNode[], rel: string): boolean => find(tree, `fs:${rel}`)?.kind === 'folder';

/** How many of `requests` ask for typed input (`{{name}}` of an «ask on send» variable). */
export function askedSteps(requests: RequestNode[], asked: string[]): number {
  if (!asked.length) return 0;
  return requests.filter((r) => {
    const text = JSON.stringify(r.request);
    return asked.some((name) => text.includes(`{{${name}}}`));
  }).length;
}

/** What is still missing to sign in (mirrors `sessionConfigured`), as i18n keys. */
export function sessionMissing(config: SessionConfig | undefined): string[] {
  return [
    !config?.login?.trim() && 'session.s.m.login',
    !config?.access?.request?.trim() && 'session.s.m.accessRequest',
    !config?.access?.path?.trim() && 'session.s.m.accessPath',
  ].filter((k): k is string => !!k);
}

/** `13:06:02.110` for unix ms. */
export function clockMs(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** `13:04:11` for unix seconds. */
export const clockSecs = (secs: number): string => clockMs(secs * 1000).slice(0, 8);

export type LineTone = 'warning' | 'var' | 'danger' | 'success' | 'muted' | 'ask';

/** One line of the timeline under the session banner. */
export interface TimelineLine {
  /** `13:06:02.110`, or `—` for what has not happened yet. */
  at: string;
  icon: string;
  tone: LineTone;
  what: string;
  meta: string;
  metaTone: LineTone;
}

/** The trace of a send (renewal, sign-in), then the send itself or what still waits for it. */
export function timelineLines(
  trace: SessionTrace[],
  last?: { sent: { text: string; status: number; ms: number }; at: number } | { pending: string },
  /** The renewal request's method, for «POST Refresh token». */
  renewMethod = '',
): TimelineLine[] {
  const lines = trace.map((e): TimelineLine => {
    const at = clockMs(e.at);
    if (e.kind === 'expired')
      return {
        at,
        icon: 'schedule',
        tone: 'warning',
        what:
          e.why === 'rejected'
            ? t('session.tl.rejected')
            : e.exp === null
              ? t('session.tl.expiredNow')
              : t('session.tl.expired', { n: oauthSpan(e.at / 1000 - e.exp) }),
        meta: e.exp === null ? '' : `exp ${clockSecs(e.exp)}`,
        metaTone: 'muted',
      };
    if (e.kind === 'renew')
      return {
        at,
        icon: 'autorenew',
        tone: e.ok ? 'var' : 'danger',
        what: `${renewMethod ? `${renewMethod} ` : ''}${e.request}  ·  {{session.refresh}}`,
        meta: e.ok ? `${e.status} · ${e.ms} ms` : `${e.status} · ${t('session.tl.refreshDead')}`,
        metaTone: e.ok ? 'muted' : 'danger',
      };
    return {
      at,
      icon: 'play_circle',
      tone: 'muted',
      what: `${e.scenario}:  ${e.steps.map((s) => s.name).join(' → ')}`,
      meta: e.steps.map((s) => s.status).join(' · '),
      metaTone: e.steps.every((s) => s.ok) ? 'success' : 'danger',
    };
  });
  if (last && 'sent' in last)
    lines.push({
      at: clockMs(last.at),
      icon: 'send',
      tone: last.sent.status < 400 ? 'success' : 'danger',
      what: last.sent.text,
      meta: `${last.sent.status} · ${last.sent.ms} ms`,
      metaTone: last.sent.status < 400 ? 'muted' : 'danger',
    });
  else if (last)
    lines.push({
      at: '—',
      icon: 'hourglass_empty',
      tone: 'ask',
      what: last.pending,
      meta: t('session.tl.pending'),
      metaTone: 'ask',
    });
  return lines;
}

/** SE5: what led to the sign-in, the steps that already ran, and the send that waits for it. */
export function promptLines(prompt: SessionPrompt, pending: string, renewMethod = ''): TimelineLine[] {
  const lines = timelineLines(prompt.trace, undefined, renewMethod);
  const done = prompt.steps.filter((s) => s.state === 'done').map((s) => s.name);
  if (done.length)
    lines.push({
      at: '—',
      icon: 'play_circle',
      tone: 'muted',
      what: `${prompt.scenario}:  ${done.join(' → ')}`,
      meta: t('session.tl.waitCode'),
      metaTone: 'ask',
    });
  return [...lines, ...timelineLines([], { pending })];
}

/** “Login and Send OTP” / “Login, Send OTP and Verify OTP”. */
export function joinNames(names: string[]): string {
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')} ${t('session.and')} ${names[names.length - 1]}`;
}
