/**
 * Autocomplete + snippet library for the pre-request / post-response editors (SC2). The member tree mirrors
 * the *actual* `pm.*` surface of the QuickJS prelude in `crates/bonk-core/src/application/scripts.rs` —
 * keep the two in sync when the sandbox grows.
 *
 * Completion is member-aware: `pm.environment.` lists that object's members with a signature, a one-word
 * action on the right and a description under the list.
 */
import { t } from '$shared/i18n';
import { snippet, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';

interface Member {
  name: string;
  /** Call signature without the name: `(key, value)`. Absent for properties and namespaces. */
  args?: string;
  /** Snippet inserted for a method call; `${}` fields are tab stops. Defaults to `name(${})`. */
  insert?: string;
  /** Typed signature shown in the description: `key: string, value: string`. */
  sig?: string;
  /** i18n suffix: `script.ac.<doc>` (action word) and `script.ac.<doc>.info` (description). */
  doc: string;
  /** Path of the object this member returns, when it has members of its own. */
  of?: string;
}

const scope = (path: string): Member[] => [
  { name: 'get', args: '(key)', insert: "get('${key}')", sig: 'key: string', doc: `${path}.get` },
  {
    name: 'set',
    args: '(key, value)',
    insert: "set('${key}', ${value})",
    sig: 'key: string, value: string',
    doc: `${path}.set`,
  },
  { name: 'unset', args: '(key)', insert: "unset('${key}')", sig: 'key: string', doc: `${path}.unset` },
  { name: 'has', args: '(key)', insert: "has('${key}')", sig: 'key: string', doc: `${path}.has` },
  { name: 'toObject', args: '()', insert: 'toObject()', doc: `${path}.toObject` },
];

const EXPECT: Member[] = [
  { name: 'to', doc: 'chain', of: 'expect' },
  { name: 'be', doc: 'chain', of: 'expect' },
  { name: 'have', doc: 'chain', of: 'expect' },
  { name: 'not', doc: 'not', of: 'expect' },
  { name: 'equal', args: '(expected)', insert: 'equal(${expected})', doc: 'equal' },
  { name: 'eql', args: '(expected)', insert: 'eql(${expected})', doc: 'eql' },
  { name: 'ok', doc: 'ok' },
  { name: 'true', doc: 'true' },
  { name: 'false', doc: 'false' },
  { name: 'above', args: '(n)', insert: 'above(${n})', doc: 'above' },
  { name: 'below', args: '(n)', insert: 'below(${n})', doc: 'below' },
  { name: 'an', args: '(type)', insert: "an('${array}')", doc: 'an' },
  { name: 'include', args: '(value)', insert: 'include(${value})', doc: 'include' },
  { name: 'match', args: '(re)', insert: 'match(/${re}/)', doc: 'match' },
  { name: 'keys', args: '(...keys)', insert: "keys('${key}')", doc: 'keys' },
  { name: 'property', args: '(name)', insert: "property('${name}')", doc: 'property' },
  { name: 'lengthOf', args: '(n)', insert: 'lengthOf(${n})', doc: 'lengthOf' },
  { name: 'status', args: '(code)', insert: 'status(${200})', doc: 'status' },
];

/** Members by the dotted path of their owner (`''` = globals). */
const TREE: Record<string, Member[]> = {
  '': [
    { name: 'pm', doc: 'pm', of: 'pm' },
    { name: 'console', doc: 'console', of: 'console' },
    { name: 'JSON', doc: 'JSON', of: 'JSON' },
  ],
  pm: [
    { name: 'environment', doc: 'pm.environment', of: 'pm.environment' },
    { name: 'globals', doc: 'pm.globals', of: 'pm.globals' },
    { name: 'variables', doc: 'pm.variables', of: 'pm.variables' },
    { name: 'iterationData', doc: 'pm.iterationData', of: 'pm.iterationData' },
    { name: 'cookies', doc: 'pm.cookies', of: 'pm.cookies' },
    { name: 'request', doc: 'pm.request', of: 'pm.request' },
    { name: 'response', doc: 'pm.response', of: 'pm.response' },
    { name: 'visualizer', doc: 'pm.visualizer', of: 'pm.visualizer' },
    {
      name: 'test',
      args: '(name, fn)',
      insert: "test('${name}', function () {\n  ${}\n});",
      sig: 'name: string, fn: () => void',
      doc: 'pm.test',
    },
    { name: 'expect', args: '(value)', insert: 'expect(${value})', sig: 'value: any', doc: 'pm.expect', of: 'expect' },
  ],
  'pm.environment': scope('pm.environment'),
  'pm.globals': scope('pm.globals'),
  'pm.variables': [
    { name: 'get', args: '(key)', insert: "get('${key}')", sig: 'key: string', doc: 'pm.variables.get' },
    { name: 'set', args: '(key, value)', insert: "set('${key}', ${value})", doc: 'pm.variables.set' },
    { name: 'has', args: '(key)', insert: "has('${key}')", doc: 'pm.variables.has' },
    { name: 'replaceIn', args: '(text)', insert: "replaceIn('${text}')", doc: 'pm.variables.replaceIn' },
    { name: 'toObject', args: '()', insert: 'toObject()', doc: 'pm.variables.toObject' },
  ],
  'pm.iterationData': [
    { name: 'get', args: '(key)', insert: "get('${key}')", doc: 'pm.iterationData.get' },
    { name: 'has', args: '(key)', insert: "has('${key}')", doc: 'pm.iterationData.has' },
    { name: 'toObject', args: '()', insert: 'toObject()', doc: 'pm.iterationData.toObject' },
  ],
  'pm.cookies': [
    { name: 'get', args: '(name)', insert: "get('${name}')", sig: 'name: string', doc: 'pm.cookies.get' },
    { name: 'has', args: '(name)', insert: "has('${name}')", sig: 'name: string', doc: 'pm.cookies.has' },
    { name: 'toObject', args: '()', insert: 'toObject()', doc: 'pm.cookies.toObject' },
    { name: 'jar', args: '()', insert: 'jar()', doc: 'pm.cookies.jar', of: 'pm.cookies.jar' },
  ],
  'pm.cookies.jar': [
    { name: 'clear', args: '(url)', insert: "clear('${url}')", sig: 'url: string', doc: 'pm.cookies.jar.clear' },
  ],
  'pm.visualizer': [
    {
      name: 'set',
      args: '(template, data)',
      insert: 'set(`${template}`, ${data})',
      sig: 'template: string, data: object',
      doc: 'pm.visualizer.set',
    },
    { name: 'clear', args: '()', insert: 'clear()', doc: 'pm.visualizer.clear' },
  ],
  'pm.request': [
    { name: 'url', doc: 'pm.request.url' },
    { name: 'method', doc: 'pm.request.method' },
    { name: 'body', doc: 'pm.request.body' },
    { name: 'headers', doc: 'pm.request.headers', of: 'pm.request.headers' },
  ],
  'pm.request.headers': [
    {
      name: 'add',
      args: '(name, value)',
      insert: "add('${Name}', ${value})",
      sig: 'name: string, value: string',
      doc: 'pm.request.headers.add',
    },
    { name: 'upsert', args: '(name, value)', insert: "upsert('${Name}', ${value})", doc: 'pm.request.headers.add' },
    { name: 'get', args: '(name)', insert: "get('${Name}')", doc: 'pm.request.headers.get' },
    { name: 'remove', args: '(name)', insert: "remove('${Name}')", doc: 'pm.request.headers.remove' },
  ],
  'pm.response': [
    { name: 'json', args: '()', insert: 'json()', doc: 'pm.response.json' },
    { name: 'text', args: '()', insert: 'text()', doc: 'pm.response.text' },
    { name: 'code', doc: 'pm.response.code' },
    { name: 'responseTime', doc: 'pm.response.responseTime' },
    { name: 'headers', doc: 'pm.response.headers', of: 'pm.response.headers' },
    { name: 'to', doc: 'chain', of: 'expect' },
  ],
  'pm.response.headers': [{ name: 'get', args: '(name)', insert: "get('${Name}')", doc: 'pm.response.headers.get' }],
  console: [{ name: 'log', args: '(...values)', insert: 'log(${})', doc: 'console.log' }],
  JSON: [
    { name: 'parse', args: '(text)', insert: 'parse(${text})', doc: 'JSON.parse' },
    { name: 'stringify', args: '(value)', insert: 'stringify(${value})', doc: 'JSON.stringify' },
  ],
  expect: EXPECT,
};

/**
 * Owner path of an expression: `pm.environment` stays as is; anything that went through `pm.expect(…)`
 * or `pm.response.to` becomes `expect`, so `pm.expect(x).to.be.` still completes matchers.
 */
function ownerPath(expr: string): string | undefined {
  const flat = expr.replace(/\([^()]*\)/g, '()');
  if (/(?:^|\.)expect\(\)|^pm\.response\.to(?:\.|$)/.test(flat)) return 'expect';
  const path = flat.replace(/\(\)/g, '');
  return path in TREE ? path : undefined;
}

function option(owner: string, m: Member, i: number): Completion {
  const full = owner && owner !== 'expect' ? `${owner}.${m.name}` : m.name;
  return {
    label: m.name,
    displayLabel: m.args ? `${m.name}${m.args}` : m.name,
    detail: t(`script.ac.${m.doc}`),
    type: m.args ? 'method' : m.of ? 'namespace' : 'property',
    // Keep the tree's order (most used first) instead of CodeMirror's alphabetical tie-break.
    boost: -i,
    apply: m.insert ? snippet(m.insert) : m.name,
    info: () => {
      const el = document.createElement('div');
      el.className = 'bs-ac-info';
      const sig = document.createElement('code');
      sig.textContent = m.args ? `${full}(${m.sig ?? m.args.slice(1, -1)})` : full;
      const text = document.createElement('p');
      text.textContent = t(`script.ac.${m.doc}.info`);
      el.append(sig, text);
      return el;
    },
  };
}

/** Completion source for script editors: members of whatever is left of the dot, or the globals. */
export function scriptCompletionSource(ctx: CompletionContext): CompletionResult | null {
  // The expression before the cursor, allowing one level of call parentheses: `pm.expect(a.b).to.`.
  const before = ctx.matchBefore(/(?:[\w$]+(?:\([^()]*\))?\.)*[\w$]*$/);
  if (!before || (before.from === before.to && !ctx.explicit)) return null;
  const dot = before.text.lastIndexOf('.');
  const owner = dot < 0 ? '' : ownerPath(before.text.slice(0, dot));
  if (owner === undefined) return null;
  const from = dot < 0 ? before.from : before.from + dot + 1;
  if (dot < 0 && from === ctx.pos && !ctx.explicit) return null;
  return { from, options: TREE[owner].map((m, i) => option(owner, m, i)), validFor: /^[\w$]*$/ };
}

export interface ScriptSnippet {
  /** i18n key of the label shown in the snippets panel. */
  label: string;
  /** Code inserted at the cursor. */
  code: string;
}

/** Snippets offered next to the pre-request script editor. */
export const PRE_REQUEST_SNIPPETS: ScriptSnippet[] = [
  { label: 'util.snippet.set_an_environment_variable', code: "pm.environment.set('key', 'value');" },
  { label: 'util.snippet.get_a_variable', code: "pm.variables.get('key');" },
  { label: 'util.snippet.add_a_header', code: "pm.request.headers.add('Key', 'value');" },
  { label: 'util.snippet.log_to_console', code: "console.log('message');" },
];

/** Snippets offered next to the post-response script editor. */
export const TEST_SNIPPETS: ScriptSnippet[] = [
  {
    label: 'util.snippet.status_code_is_200',
    code: "pm.test('Status code is 200', function () {\n  pm.expect(pm.response).to.have.status(200);\n});",
  },
  {
    label: 'util.snippet.response_json_has_field',
    code: "pm.test('Response has field', function () {\n  const data = pm.response.json();\n  pm.expect(data).to.have.property('field');\n});",
  },
  {
    label: 'util.snippet.save_response_field_to_env',
    code: "const data = pm.response.json();\npm.environment.set('key', data.value);",
  },
  {
    label: 'util.snippet.response_time_check',
    code: "pm.test('Response time is under 500ms', function () {\n  pm.expect(pm.response.responseTime).to.be.below(500);\n});",
  },
  {
    label: 'util.snippet.body_contains_string',
    code: "pm.test('Body contains string', function () {\n  pm.expect(pm.response.text()).to.include('expected');\n});",
  },
];
