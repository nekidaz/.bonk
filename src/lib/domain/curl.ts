import type { BodyParam, HttpRequest } from './types';

export function parseCurl(input: string): HttpRequest {
  const args = tokenize(input.replace(/\\\r?\n/g, ' '));
  if (args[0]?.toLowerCase() === 'curl') args.shift();
  let method = '';
  let url = '';
  const headers: Record<string, string> = {};
  const bodies: string[] = [];
  const forms: string[] = [];
  let auth: HttpRequest['auth'];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = () => args[++i] ?? '';
    if (arg === '-X' || arg === '--request') method = next().toUpperCase();
    else if (arg.startsWith('-X') && arg.length > 2) method = arg.slice(2).toUpperCase();
    else if (arg === '-H' || arg === '--header') addHeader(headers, next());
    else if (arg.startsWith('-H') && arg.length > 2) addHeader(headers, arg.slice(2));
    else if (['-d', '--data', '--data-raw', '--data-binary', '--data-urlencode'].includes(arg)) bodies.push(next());
    else if (arg === '--form' || arg === '-F') forms.push(next());
    else if (arg.startsWith('--form=')) forms.push(arg.slice(arg.indexOf('=') + 1));
    else if (arg.startsWith('-F') && arg.length > 2) forms.push(arg.slice(2));
    else if (arg === '-u' || arg === '--user') auth = parseBasicAuth(next());
    else if (arg.startsWith('--user=')) auth = parseBasicAuth(arg.slice(arg.indexOf('=') + 1));
    else if (arg.startsWith('--data=') || arg.startsWith('--data-raw=')) bodies.push(arg.slice(arg.indexOf('=') + 1));
    else if (arg === '--url') url = next();
    else if (arg === '-I' || arg === '--head') method = 'HEAD';
    else if (arg === '-G' || arg.startsWith('--')) continue;
    else if (!arg.startsWith('-') && !url) url = arg;
  }

  if (!url) throw new Error('Could not find URL in cURL command.');
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
