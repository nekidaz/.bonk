/**
 * Autocomplete dictionary + snippet library for the pre-request/test script
 * editors. The entries mirror the *actual* `pm.*` surface implemented by the
 * QuickJS prelude in `crates/bonk-core/src/application/scripts.rs` — keep the
 * two in sync when the sandbox grows.
 */
import { get } from 'svelte/store';
import { t } from '../i18n';
import { snippetCompletion, type Completion } from '@codemirror/autocomplete';

/** Tooltip text resolved when shown, so it follows the UI language. */
const lazyInfo = (key: string) => (): Node => document.createTextNode(get(t)(key));

function method(template: string, label: string, detail: string, info: string): Completion {
  return snippetCompletion(template, { label, detail, info: lazyInfo(info), type: 'method' });
}

function property(label: string, info: string): Completion {
  return { label, info: lazyInfo(info), type: 'property' };
}

/** Everything the sandbox exposes, as completions for the script editors. */
export const PM_COMPLETIONS: Completion[] = [
  { label: 'pm', info: lazyInfo('util.pm.pm'), type: 'namespace' },
  method("pm.environment.get('${key}')", 'pm.environment.get', '(key)', 'util.pm.pm.environment.get'),
  method("pm.environment.set('${key}', '${value}')", 'pm.environment.set', '(key, value)', 'util.pm.pm.environment.set'),
  method("pm.environment.unset('${key}')", 'pm.environment.unset', '(key)', 'util.pm.pm.environment.unset'),
  method("pm.globals.get('${key}')", 'pm.globals.get', '(key)', 'util.pm.pm.globals.get'),
  method("pm.globals.set('${key}', '${value}')", 'pm.globals.set', '(key, value)', 'util.pm.pm.globals.set'),
  method("pm.globals.unset('${key}')", 'pm.globals.unset', '(key)', 'util.pm.pm.globals.unset'),
  method("pm.variables.get('${key}')", 'pm.variables.get', '(key)', 'util.pm.pm.variables.get'),
  property('pm.request.url', 'util.pm.pm.request.url'),
  property('pm.request.method', 'util.pm.pm.request.method'),
  property('pm.request.body', 'util.pm.pm.request.body'),
  method("pm.request.headers.add('${Name}', '${value}')", 'pm.request.headers.add', '(name, value)', 'util.pm.pm.request.headers.add'),
  method("pm.request.headers.get('${Name}')", 'pm.request.headers.get', '(name)', 'util.pm.pm.request.headers.get'),
  property('pm.response.code', 'util.pm.pm.response.code'),
  property('pm.response.responseTime', 'util.pm.pm.response.responseTime'),
  property('pm.response.headers', 'util.pm.pm.response.headers'),
  method('pm.response.json()', 'pm.response.json', '()', 'util.pm.pm.response.json'),
  method('pm.response.text()', 'pm.response.text', '()', 'util.pm.pm.response.text'),
  method("pm.test('${name}', function () {\n  ${}\n});", 'pm.test', '(name, fn)', 'util.pm.pm.test'),
  method('pm.expect(${value})', 'pm.expect', '(value)', 'util.pm.pm.expect'),
  method('to.equal(${expected})', 'to.equal', '(expected)', 'util.pm.to.equal'),
  method('to.eql(${expected})', 'to.eql', '(expected)', 'util.pm.to.eql'),
  property('to.be.ok', 'util.pm.to.be.ok'),
  method('to.have.status(${200})', 'to.have.status', '(code)', 'util.pm.to.have.status'),
  method('console.log(${value})', 'console.log', '(…values)', 'util.pm.console.log'),
];

export interface ScriptSnippet {
  /** i18n key of the label shown in the snippets panel. */
  label: string;
  /** Code inserted at the cursor. */
  code: string;
}

/** Snippets offered next to the pre-request script editor. */
export const PRE_REQUEST_SNIPPETS: ScriptSnippet[] = [
  {
    label: 'util.snippet.set_an_environment_variable',
    code: "pm.environment.set('key', 'value');",
  },
  {
    label: 'util.snippet.get_a_variable',
    code: "pm.variables.get('key');",
  },
  {
    label: 'util.snippet.add_a_header',
    code: "pm.request.headers.add('Key', 'value');",
  },
  {
    label: 'util.snippet.log_to_console',
    code: "console.log('message');",
  },
];

/** Snippets offered next to the test script editor. */
export const TEST_SNIPPETS: ScriptSnippet[] = [
  {
    label: 'util.snippet.status_code_is_200',
    code: "pm.test('Status code is 200', function () {\n  pm.expect(pm.response).to.have.status(200);\n});",
  },
  {
    label: 'util.snippet.response_json_has_field',
    code: "pm.test('Response has field', function () {\n  var data = pm.response.json();\n  pm.expect(data.field).to.be.ok;\n});",
  },
  {
    label: 'util.snippet.save_response_field_to_env',
    code: "var data = pm.response.json();\npm.environment.set('key', data.value);",
  },
  {
    label: 'util.snippet.response_time_check',
    code: "pm.test('Response time is under 500ms', function () {\n  pm.expect(pm.response.responseTime < 500).to.be.ok;\n});",
  },
  {
    label: 'util.snippet.body_contains_string',
    code: "pm.test('Body contains string', function () {\n  pm.expect(pm.response.text().includes('expected')).to.be.ok;\n});",
  },
];
