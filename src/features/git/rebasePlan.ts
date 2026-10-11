import type { RebaseAction, RebaseVerb } from '$shared/model';

interface PlanStep {
  hash: string;
  short: string;
  action: RebaseVerb;
  /** The commit's own full message. */
  full: string;
  /** What the user typed for it, null while untouched. */
  message: string | null;
}

/** Commits that stay as commits of their own; squash / fixup fold into them, drop vanishes. */
export const isKept = (a: RebaseVerb): boolean => a === 'pick' || a === 'reword' || a === 'edit';

/** The kept commit a squash / fixup at `i` folds into: the nearest kept one above it. */
export function foldTarget<T extends PlanStep>(steps: T[], i: number): T | undefined {
  for (let k = i - 1; k >= 0; k--) if (isKept(steps[k].action)) return steps[k];
  return undefined;
}

/** The squashes folding into the kept commit at `i` (up to the next kept one); fixups drop their message. */
function squashesInto(steps: PlanStep[], i: number): PlanStep[] {
  const out: PlanStep[] = [];
  for (let k = i + 1; k < steps.length && !isKept(steps[k].action); k++)
    if (steps[k].action === 'squash') out.push(steps[k]);
  return out;
}

/** Does the kept commit at `i` get a message of its own: a reword, or one that squashes fold into. */
export function needsMessage(steps: PlanStep[], i: number): boolean {
  const s = steps[i];
  return isKept(s.action) && (s.action === 'reword' || squashesInto(steps, i).length > 0);
}

/** The message the kept commit at `i` ends with: what was typed, else its own plus its squashes', as git does. */
export function messageOf(steps: PlanStep[], i: number): string {
  const s = steps[i];
  return s.message ?? [s, ...squashesInto(steps, i)].map((x) => x.full.trim()).join('\n\n');
}

/** The plan as the backend takes it, oldest first. */
export function toActions(steps: PlanStep[]): RebaseAction[] {
  return steps.map((s, i) => ({
    hash: s.hash,
    action: s.action,
    ...(needsMessage(steps, i) ? { message: messageOf(steps, i).trim() } : {}),
  }));
}

/** Why the plan can't run (an i18n key), or '' when it can. */
export function rebasePlanError(steps: PlanStep[]): string {
  const first = steps.find((s) => s.action !== 'drop');
  if (first && (first.action === 'squash' || first.action === 'fixup')) return 'git.rb.errFirst';
  if (steps.some((_, i) => needsMessage(steps, i) && !messageOf(steps, i).trim())) return 'git.rb.errMessage';
  return '';
}
