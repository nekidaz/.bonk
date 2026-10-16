/**
 * G5: lay a commit list (newest first, `git log --topo-order`) out in lanes, like `git log --graph`.
 * Each commit gets a lane (column) and the row's line segments: the top half brings lanes into the
 * row (a lane that expects this commit bends into its node), the bottom half leaves the node toward
 * each parent's lane. Lanes keep their column for as long as they live, so lines stay straight.
 */

import type { ResetMode } from '$shared/model';

/** What the G6 commit menu (or the detail panel's buttons) asks the graph to do. */
export type CommitAction =
  | { kind: 'cherry-pick' | 'revert' | 'patch' | 'checkout' | 'tag' | 'branch' | 'copy' | 'compare' }
  | { kind: 'merge' | 'rebase' | 'interactive'; branch: string }
  | { kind: 'push-tag' | 'delete-tag'; tag: string }
  | { kind: 'reset'; mode: ResetMode };

export interface GraphNodeInput {
  hash: string;
  parents: string[];
}

/** One line in a row, in lane units: `top` runs from the row's top to its middle, `bottom` from the middle down, `full` through. */
export interface Segment {
  from: number;
  to: number;
  half: 'top' | 'bottom' | 'full';
  color: number;
}

export interface LaneRow {
  lane: number;
  color: number;
  segments: Segment[];
  /** Lanes this row spans, for the width of the graph column. */
  width: number;
}

export function layoutGraph(commits: GraphNodeInput[]): LaneRow[] {
  let lanes: (string | null)[] = [];
  let colors: number[] = [];
  let nextColor = 0;
  const free = () => {
    const i = lanes.indexOf(null);
    return i === -1 ? lanes.length : i;
  };

  return commits.map((c) => {
    const before = lanes.slice();
    const beforeColors = colors.slice();
    const segments: Segment[] = [];

    let lane = before.indexOf(c.hash);
    if (lane === -1) {
      // A branch tip nobody pointed at yet: open a lane for it.
      lane = free();
      colors[lane] = nextColor++;
    }
    const color = colors[lane];

    before.forEach((h, i) => {
      if (h === null) return;
      if (h === c.hash) segments.push({ from: i, to: lane, half: 'top', color: beforeColors[i] });
      else segments.push({ from: i, to: i, half: 'full', color: beforeColors[i] });
    });

    // Every lane that waited for this commit ends in its node.
    lanes = before.map((h) => (h === c.hash ? null : h));
    if (lane >= lanes.length) lanes[lane] = null;

    const [first, ...rest] = c.parents;
    if (first !== undefined) {
      // Our lane goes on to the first parent even if another lane waits for it too: the two
      // meet in the parent's node, which takes the leftmost of them.
      lanes[lane] = first;
      colors[lane] = color;
      segments.push({ from: lane, to: lane, half: 'bottom', color });
    }
    for (const p of rest) {
      let j = lanes.indexOf(p);
      if (j === -1) {
        j = free();
        lanes[j] = p;
        colors[j] = nextColor++;
      }
      segments.push({ from: lane, to: j, half: 'bottom', color: colors[j] });
    }

    const width = Math.max(before.length, lanes.length, lane + 1);
    while (lanes.length && lanes[lanes.length - 1] === null) {
      lanes.pop();
      colors.pop();
    }
    return { lane, color, segments, width };
  });
}

/** Initials for the author avatar: «Дилмурат З.» → «ДЗ», «aru» → «A». */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

/** Subjects of several commits as one title: a shared «Area: » prefix is said once. */
export function joinSubjects(subjects: string[]): string {
  const prefix = subjects[0]?.match(/^[^:]{1,40}:\s/)?.[0];
  if (prefix && subjects.every((s) => s.startsWith(prefix)))
    return prefix + subjects.map((s) => s.slice(prefix.length)).join(', ');
  return subjects.join(', ');
}

/** The date column: «2 hr. ago» today, «yesterday» / «3 days ago» this week, «Sep 12» before. */
export function commitDate(timeSec: number, nowMs: number): string {
  const s = Math.max(0, nowMs / 1000 - timeSec);
  if (s < 3600) return new Intl.RelativeTimeFormat('en', { style: 'short' }).format(-Math.floor(s / 60), 'minute');
  if (s < 86400) return new Intl.RelativeTimeFormat('en', { style: 'short' }).format(-Math.floor(s / 3600), 'hour');
  const days = Math.floor(s / 86400);
  if (days < 7) return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(-days, 'day');
  return new Date(timeSec * 1000).toLocaleDateString('en', { day: 'numeric', month: 'short' });
}

/** The detail panel's date: the day as above plus the time, «yesterday, 06:42 PM». */
export function commitDateTime(timeSec: number, nowMs: number): string {
  const d = new Date(timeSec * 1000);
  const time = d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((startOfDay(nowMs) - startOfDay(d.getTime())) / 86400000);
  const day =
    days < 7
      ? new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(-days, 'day')
      : d.toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${day}, ${time}`;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * ⇧-click range: the first-parent chain from the newer commit down to the older one — the commits
 * of one branch, even where other branches' commits sit between them in the list. Undefined when
 * the older one isn't on that chain (then the caller selects the rows in between instead).
 */
export function firstParentChain(commits: GraphNodeInput[], a: string, b: string): string[] | undefined {
  const byHash = new Map(commits.map((c) => [c.hash, c]));
  const ia = commits.findIndex((c) => c.hash === a);
  const ib = commits.findIndex((c) => c.hash === b);
  if (ia === -1 || ib === -1) return undefined;
  const [newer, older] = ia < ib ? [a, b] : [b, a];
  const chain: string[] = [];
  for (let c = byHash.get(newer); c; c = byHash.get(c.parents[0])) {
    chain.push(c.hash);
    if (c.hash === older) return chain;
  }
  return undefined;
}
