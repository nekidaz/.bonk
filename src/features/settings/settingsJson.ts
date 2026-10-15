import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { SettingSpec } from '$shared/persist';

/** A key of settings.json bonk doesn't know, or a value it ignores (wrong type or out of range). */
export interface SettingsProblem {
  from: number;
  to: number;
  kind: 'unknown' | 'invalid';
  key: string;
}

/** The problems of a settings.json text that parses; a text that doesn't parse has none here
 *  (the editor's JSON lint shows the syntax error). */
export function settingsProblems(text: string, specs: SettingSpec[]): SettingsProblem[] {
  let values: unknown;
  try {
    values = JSON.parse(text);
  } catch {
    return [];
  }
  if (!values || typeof values !== 'object' || Array.isArray(values)) return [];
  const byKey = new Map(specs.map((s) => [s.key, s]));
  const out: SettingsProblem[] = [];
  for (const [key, v] of Object.entries(values)) {
    const spec = byKey.get(key);
    if (spec && spec.valid(v)) continue;
    // ponytail: the first `"key"` in the text; the same string earlier (as a value) would be marked instead.
    const quoted = JSON.stringify(key);
    const at = text.indexOf(quoted);
    if (at < 0) continue;
    out.push({ from: at, to: at + quoted.length, kind: spec ? 'invalid' : 'unknown', key });
  }
  return out;
}

/** Complete a key where a key may stand (after `{` or `,`), inserting `"key": <default>`. */
export function settingsCompletions(specs: SettingSpec[], ctx: CompletionContext): CompletionResult | null {
  const word = ctx.matchBefore(/"?[\w.]*$/);
  if (!word || (word.from === word.to && !ctx.explicit)) return null;
  if (!/[{,]$/.test(ctx.state.sliceDoc(0, word.from).trimEnd())) return null;
  // closeBrackets already typed the closing quote: replace it too.
  const to = word.text.startsWith('"') && ctx.state.sliceDoc(ctx.pos, ctx.pos + 1) === '"' ? ctx.pos + 1 : ctx.pos;
  return {
    from: word.from,
    to,
    options: specs.map((s) => ({
      label: s.key,
      detail: JSON.stringify(s.fallback),
      apply: `"${s.key}": ${JSON.stringify(s.fallback)}`,
    })),
    filter: true,
  };
}
