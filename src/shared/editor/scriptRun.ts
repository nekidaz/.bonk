/** Presentation of a script run (SC4/SC5/SC7): console rows, clock stamps and which lines passed or failed. */
import type { ScriptEvent, ScriptStage, ScriptTestResult, TabTestResults } from '$shared/model';

/** One console row: a script event, or every `pm.test` of a stage folded into one summary. */
export type ConsoleRow =
  | (ScriptEvent & { kind: Exclude<ScriptEvent['kind'], 'test'> })
  | { t: number; stage: ScriptStage; kind: 'test'; total: number; failed: number };

/** SC5: the feed in run order, with each stage's tests summarised once, where its last test ran. */
export function consoleRows(events: ScriptEvent[]): ConsoleRow[] {
  const last = new Map<string, number>();
  events.forEach((e, i) => e.kind === 'test' && last.set(e.stage, i));
  const rows: ConsoleRow[] = [];
  events.forEach((e, i) => {
    if (e.kind !== 'test') {
      rows.push(e as ConsoleRow);
      return;
    }
    if (last.get(e.stage) !== i) return;
    const tests = events.filter((x) => x.kind === 'test' && x.stage === e.stage);
    rows.push({
      t: e.t,
      stage: e.stage as ScriptStage,
      kind: 'test',
      total: tests.length,
      failed: tests.filter((x) => !x.passed).length,
    });
  });
  return rows;
}

/** `12:04:31.208` in local time. */
export function clockMs(t: number): string {
  const d = new Date(t);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** Tests of one stage, from the last run. */
export function stageTests(results: TabTestResults | undefined, stage: ScriptStage): ScriptTestResult[] {
  return (results?.tests ?? []).filter((t) => (t.stage ?? 'post') === stage);
}

/** The last run's outcome of the `pm.test` on `line` (matched by line, then by name). */
export function testAt(tests: ScriptTestResult[], line: number, name?: string): ScriptTestResult | undefined {
  return tests.find((t) => t.line === line) ?? (name ? tests.find((t) => t.name === name) : undefined);
}
