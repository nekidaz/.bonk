import type { RebaseVerb } from '$shared/model';

interface PlanStep {
  short: string;
  action: RebaseVerb;
  message: string;
}

/** The kept commit a squash / fixup at `i` folds into: the nearest pick or reword above it. */
export function foldTarget<T extends PlanStep>(steps: T[], i: number): T | undefined {
  for (let k = i - 1; k >= 0; k--) if (steps[k].action === 'pick' || steps[k].action === 'reword') return steps[k];
  return undefined;
}

/** Why the plan can't run (an i18n key), or '' when it can. */
export function rebasePlanError(steps: PlanStep[]): string {
  const first = steps.find((s) => s.action !== 'drop');
  if (first && (first.action === 'squash' || first.action === 'fixup')) return 'git.rb.errFirst';
  if (steps.some((s) => s.action === 'reword' && !s.message.trim())) return 'git.rb.errMessage';
  return '';
}
