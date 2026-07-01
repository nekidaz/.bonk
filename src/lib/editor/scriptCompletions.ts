/**
 * Autocomplete dictionary + snippet library for the pre-request/test script
 * editors. The entries mirror the *actual* `pm.*` surface implemented by the
 * QuickJS prelude in `crates/bonk-core/src/application/scripts.rs` — keep the
 * two in sync when the sandbox grows.
 */
import { snippetCompletion, type Completion } from '@codemirror/autocomplete';

function method(template: string, label: string, detail: string, info: string): Completion {
  return snippetCompletion(template, { label, detail, info, type: 'method' });
}

function property(label: string, info: string): Completion {
  return { label, info, type: 'property' };
}

/** Everything the sandbox exposes, as completions for the script editors. */
export const PM_COMPLETIONS: Completion[] = [
  { label: 'pm', info: 'Postman-style scripting API (sandboxed; no network or file access).', type: 'namespace' },
  method("pm.environment.get('${key}')", 'pm.environment.get', '(key)', 'Read a variable from the active environment.'),
  method("pm.environment.set('${key}', '${value}')", 'pm.environment.set', '(key, value)', 'Set a variable on the active environment.'),
  method("pm.environment.unset('${key}')", 'pm.environment.unset', '(key)', 'Remove a variable from the active environment.'),
  method("pm.globals.get('${key}')", 'pm.globals.get', '(key)', 'Read a global variable.'),
  method("pm.globals.set('${key}', '${value}')", 'pm.globals.set', '(key, value)', 'Set a global variable.'),
  method("pm.globals.unset('${key}')", 'pm.globals.unset', '(key)', 'Remove a global variable.'),
  method("pm.variables.get('${key}')", 'pm.variables.get', '(key)', 'Resolve a variable: environment first, then globals.'),
  property('pm.request.url', 'The request URL. Assignable in pre-request scripts.'),
  property('pm.request.method', 'The HTTP method (read-only).'),
  property('pm.request.body', 'The raw request body. Assignable in pre-request scripts.'),
  method("pm.request.headers.add('${Name}', '${value}')", 'pm.request.headers.add', '(name, value)', 'Add or overwrite a request header.'),
  method("pm.request.headers.get('${Name}')", 'pm.request.headers.get', '(name)', 'Read a request header by exact name.'),
  property('pm.response.code', 'HTTP status code of the response (test scripts only).'),
  property('pm.response.responseTime', 'Response time in milliseconds.'),
  property('pm.response.headers', 'Response headers as a name → value map.'),
  method('pm.response.json()', 'pm.response.json', '()', 'Parse the response body as JSON.'),
  method('pm.response.text()', 'pm.response.text', '()', 'The raw response body as a string.'),
  method("pm.test('${name}', function () {\n  ${}\n});", 'pm.test', '(name, fn)', 'Define a test; results show under the response.'),
  method('pm.expect(${value})', 'pm.expect', '(value)', 'Start an assertion: .to.equal / .to.eql / .to.be.ok / .to.have.status(n).'),
  method('to.equal(${expected})', 'to.equal', '(expected)', 'Assert strict equality (===).'),
  method('to.eql(${expected})', 'to.eql', '(expected)', 'Assert deep (JSON) equality.'),
  property('to.be.ok', 'Assert the value is truthy.'),
  method('to.have.status(${200})', 'to.have.status', '(code)', 'Assert pm.response has the given status code.'),
  method('console.log(${value})', 'console.log', '(…values)', 'Log to the script console (shown with the response).'),
];

export interface ScriptSnippet {
  /** Short label shown in the snippets panel. */
  label: string;
  /** Code inserted at the cursor. */
  code: string;
}

/** Snippets offered next to the pre-request script editor. */
export const PRE_REQUEST_SNIPPETS: ScriptSnippet[] = [
  {
    label: 'Set an environment variable',
    code: "pm.environment.set('key', 'value');",
  },
  {
    label: 'Get a variable',
    code: "pm.variables.get('key');",
  },
  {
    label: 'Add a header',
    code: "pm.request.headers.add('Key', 'value');",
  },
  {
    label: 'Log to console',
    code: "console.log('message');",
  },
];

/** Snippets offered next to the test script editor. */
export const TEST_SNIPPETS: ScriptSnippet[] = [
  {
    label: 'Status code is 200',
    code: "pm.test('Status code is 200', function () {\n  pm.expect(pm.response).to.have.status(200);\n});",
  },
  {
    label: 'Response JSON has field',
    code: "pm.test('Response has field', function () {\n  var data = pm.response.json();\n  pm.expect(data.field).to.be.ok;\n});",
  },
  {
    label: 'Save response field to env',
    code: "var data = pm.response.json();\npm.environment.set('key', data.value);",
  },
  {
    label: 'Response time check',
    code: "pm.test('Response time is under 500ms', function () {\n  pm.expect(pm.response.responseTime < 500).to.be.ok;\n});",
  },
  {
    label: 'Body contains string',
    code: "pm.test('Body contains string', function () {\n  pm.expect(pm.response.text().includes('expected')).to.be.ok;\n});",
  },
];
