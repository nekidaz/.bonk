import type { BodyParam, HttpRequest, Tab } from './types';
import { buildUrl } from './http';
import { buildRequestForSend, currentBodyMode, enabledBodyParams } from './httpBody';

/** Single-quote a value for a POSIX shell, escaping embedded single quotes. */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Serialize a request tab as a copy-pasteable `curl` command. Resolves the same
 * final URL, headers (auth + content-type), and body that a real send would
 * produce; form-data becomes `--form` parts (files as `@path`).
 */
export function toCurl(tab: Tab): string {
  const finalUrl = buildUrl(tab.request.url, tab.params);
  const req = buildRequestForSend(tab, finalUrl);
  const lines: string[] = [`curl ${shellQuote(req.url || '')}`];
  if (req.method && req.method !== 'GET') lines.push(`--request ${req.method}`);
  for (const [key, value] of Object.entries(req.headers ?? {})) {
    lines.push(`--header ${shellQuote(`${key}: ${value}`)}`);
  }
  if (currentBodyMode(tab) === 'form-data') {
    for (const row of enabledBodyParams(tab)) {
      const value = row.kind === 'file' && row.filePath ? `@${row.filePath}` : row.value;
      lines.push(`--form ${shellQuote(`${row.key}=${value}`)}`);
    }
  } else if (req.body) {
    lines.push(`--data ${shellQuote(req.body)}`);
  }
  return lines.join(' \\\n  ');
}

export function parseCurl(input: string): HttpRequest {
  const args = tokenize(input.replace(/\\\r?\n/g, ' '));
  if (args[0]?.toLowerCase() === 'curl') args.shift();
  let method = '';
  let url = '';
  const headers: Record<string, string> = {};
  const bodies: string[] = [];
  const forms: string[] = [];
  let auth: HttpRequest['auth'];
  let getMode = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = () => args[++i] ?? '';
    if (arg === '-X' || arg === '--request') method = next().toUpperCase();
    else if (arg.startsWith('-X') && arg.length > 2) method = arg.slice(2).toUpperCase();
    else if (arg === '-H' || arg === '--header') addHeader(headers, next());
    else if (arg.startsWith('-H') && arg.length > 2) addHeader(headers, arg.slice(2));
    else if (arg === '--data-urlencode') bodies.push(encodeDataUrlencode(next()));
    else if (['-d', '--data', '--data-raw', '--data-binary'].includes(arg)) bodies.push(next());
    else if (arg === '--form' || arg === '-F') forms.push(next());
    else if (arg.startsWith('--form=')) forms.push(arg.slice(arg.indexOf('=') + 1));
    else if (arg.startsWith('-F') && arg.length > 2) forms.push(arg.slice(2));
    else if (arg === '-u' || arg === '--user') auth = parseBasicAuth(next());
    else if (arg.startsWith('--user=')) auth = parseBasicAuth(arg.slice(arg.indexOf('=') + 1));
    else if (arg.startsWith('--data=') || arg.startsWith('--data-raw=')) bodies.push(arg.slice(arg.indexOf('=') + 1));
    else if (arg === '--url') url = next();
    else if (arg === '-I' || arg === '--head') method = 'HEAD';
    else if (arg === '-G' || arg === '--get') getMode = true;
    else if (arg.startsWith('--')) continue;
    else if (!arg.startsWith('-') && !url) url = arg;
  }

  if (!url) throw new Error('Could not find URL in cURL command.');
  // -G/--get sends the collected -d/--data as the GET query string, not a body.
  if (getMode && bodies.length > 0) {
    url += (url.includes('?') ? '&' : '?') + bodies.join('&');
    bodies.length = 0;
  }
  if (!method) method = bodies.length > 0 || forms.length > 0 ? 'POST' : 'GET';
  if (forms.length > 0) {
    return {
      method,
      url,
      headers,
      bodyMode: 'form-data',
      bodyParams: forms.map(parseFormPart),
      auth,
    };
  }
  const body = bodies.join('&');
  return {
    method,
    url,
    headers,
    body: bodies.length > 0 ? body : undefined,
    bodyMode: bodies.length > 0 ? 'raw' : 'none',
    rawBodyFormat: inferRawFormat(headers, body),
    auth,
  };
}

/**
 * Encode a curl `--data-urlencode` argument. Forms: `content` (encode all),
 * `=content` (encode, no name), `name=content` (keep name, encode content).
 */
function encodeDataUrlencode(arg: string): string {
  const eq = arg.indexOf('=');
  if (eq === -1) return encodeURIComponent(arg);
  const name = arg.slice(0, eq);
  const content = encodeURIComponent(arg.slice(eq + 1));
  return name ? `${name}=${content}` : content;
}

function parseBasicAuth(value: string): HttpRequest['auth'] {
  const i = value.indexOf(':');
  return {
    type: 'basic',
    basicUsername: i === -1 ? value : value.slice(0, i),
    basicPassword: i === -1 ? '' : value.slice(i + 1),
  };
}

function parseFormPart(raw: string): BodyParam {
  const i = raw.indexOf('=');
  const key = (i === -1 ? raw : raw.slice(0, i)).trim();
  const value = i === -1 ? '' : raw.slice(i + 1);
  if (value.startsWith('@')) {
    const path = value.slice(1).split(';')[0];
    return {
      key,
      value: fileName(path),
      description: '',
      enabled: true,
      kind: 'file',
      filePath: path,
    };
  }
  return { key, value, description: '', enabled: true, kind: 'text' };
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function inferRawFormat(headers: Record<string, string>, body: string): HttpRequest['rawBodyFormat'] {
  const contentType = Object.entries(headers)
    .find(([key]) => key.toLowerCase() === 'content-type')?.[1]
    ?.toLowerCase() ?? '';
  if (contentType.includes('json') || /^[\[{]/.test(body.trim())) return 'JSON';
  if (contentType.includes('html')) return 'HTML';
  if (contentType.includes('xml')) return 'XML';
  if (contentType.includes('javascript')) return 'JavaScript';
  return 'Text';
}

function addHeader(headers: Record<string, string>, raw: string): void {
  const i = raw.indexOf(':');
  if (i <= 0) return;
  const key = raw.slice(0, i).trim();
  const value = raw.slice(i + 1).trim();
  if (key) headers[key] = value;
}

function tokenize(input: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | '' = '';
  let escaped = false;
  for (const ch of input.trim()) {
    if (escaped) {
      cur += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }
    if ((ch === '"' || ch === "'") && (!quote || quote === ch)) {
      quote = quote ? '' : ch;
      continue;
    }
    if (/\s/.test(ch) && !quote) {
      if (cur) out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
