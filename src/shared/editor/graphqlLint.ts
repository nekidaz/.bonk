/**
 * Live GraphQL check for the body editor. `{{var}}` placeholders outside strings are swapped for same-length
 * `null` before parsing, so offsets stay true to the editor document and a placeholder is never underlined.
 * Pure (no DOM).
 */
import { GraphQLError, parse, validate, type GraphQLSchema } from 'graphql';

export interface MaskedQuery {
  text: string;
  /** `[from, to)` ranges of the masked `{{…}}` in the original text. */
  masks: [from: number, to: number][];
}

export interface GqlProblem {
  from: number;
  to: number;
  message: string;
}

const VAR = /^\{\{[^{}\n]*\}\}/;

export function maskTemplateVars(query: string): MaskedQuery {
  const masks: [number, number][] = [];
  let out = '';
  let i = 0;
  while (i < query.length) {
    const c = query[i];
    if (query.startsWith('"""', i)) {
      // Block string: up to the closing """ (an escaped \""" does not close it).
      let j = i + 3;
      while (j < query.length && !query.startsWith('"""', j)) j += query.startsWith('\\"""', j) ? 4 : 1;
      j = Math.min(query.length, j + 3);
      out += query.slice(i, j);
      i = j;
    } else if (c === '"') {
      let j = i + 1;
      while (j < query.length && query[j] !== '"' && query[j] !== '\n') j += query[j] === '\\' ? 2 : 1;
      j = Math.min(query.length, j + 1);
      out += query.slice(i, j);
      i = j;
    } else if (c === '#') {
      // Comment: to the end of the line (a quote inside it must not open a string).
      let j = query.indexOf('\n', i);
      if (j < 0) j = query.length;
      out += query.slice(i, j);
      i = j;
    } else {
      const m = c === '{' ? VAR.exec(query.slice(i)) : null;
      if (m) {
        masks.push([i, i + m[0].length]);
        out += 'null' + ' '.repeat(m[0].length - 4);
        i += m[0].length;
      } else {
        out += c;
        i += 1;
      }
    }
  }
  return { text: out, masks };
}

function toProblem(e: GraphQLError): GqlProblem {
  const node = e.nodes?.[0]?.loc;
  const from = node ? node.start : (e.positions?.[0] ?? 0);
  return { from, to: node ? node.end : from + 1, message: e.message };
}

/** Syntax errors, plus schema validation errors when a schema is given. Empty/blank text has none. */
export function graphqlProblems(query: string, schema?: GraphQLSchema): GqlProblem[] {
  if (!query.trim()) return [];
  const { text, masks } = maskTemplateVars(query);
  let problems: GqlProblem[];
  try {
    const doc = parse(text);
    problems = schema ? validate(schema, doc).map(toProblem) : [];
  } catch (e) {
    if (!(e instanceof GraphQLError)) return [];
    const from = e.positions?.[0] ?? 0;
    problems = [{ from, to: from + 1, message: e.message }];
  }
  // A syntax error at EOF points one past the end; the editor rejects ranges outside the document.
  const clamp = (n: number) => Math.max(0, Math.min(n, query.length));
  return problems
    .map((p) => ({ ...p, from: clamp(p.from), to: clamp(p.to) }))
    .filter((p) => !masks.some(([from, to]) => p.from < to && p.to > from));
}
