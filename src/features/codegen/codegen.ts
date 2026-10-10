/**
 * Multi-language request code generation (Postman-style "Code snippet"), built
 * on httpsnippet-lite. Converts a request tab into a HAR entry and renders it in
 * the selected target language. `{{vars}}` are embedded verbatim, so env
 * placeholders survive into the generated code.
 */
import { HTTPSnippet } from 'httpsnippet-lite';
import type { HarRequest, TargetId } from 'httpsnippet-lite';
import { t as tr } from '$shared/i18n';
import {
  type Tab,
  buildUrl,
  buildRequestForSend,
  currentBodyMode,
  enabledBodyParams,
  resolveRequestVars,
  resolveVars,
} from '$shared/model';

export type Language = { id: string; label: string; target: string; client: string };

/** The languages offered in the snippet dropdown (label → httpsnippet target/client). */
export const LANGUAGES: Language[] = [
  { id: 'curl', label: 'cURL', target: 'shell', client: 'curl' },
  { id: 'httpie', label: 'HTTPie', target: 'shell', client: 'httpie' },
  { id: 'http', label: 'HTTP', target: 'http', client: 'http1.1' },
  { id: 'c', label: 'C - libcurl', target: 'c', client: 'libcurl' },
  { id: 'csharp-httpclient', label: 'C# - HttpClient', target: 'csharp', client: 'httpclient' },
  { id: 'csharp-restsharp', label: 'C# - RestSharp', target: 'csharp', client: 'restsharp' },
  { id: 'go', label: 'Go - Native', target: 'go', client: 'native' },
  { id: 'java-okhttp', label: 'Java - OkHttp', target: 'java', client: 'okhttp' },
  { id: 'java-unirest', label: 'Java - Unirest', target: 'java', client: 'unirest' },
  { id: 'js-fetch', label: 'JavaScript - Fetch', target: 'javascript', client: 'fetch' },
  { id: 'js-axios', label: 'JavaScript - Axios', target: 'javascript', client: 'axios' },
  { id: 'js-xhr', label: 'JavaScript - XHR', target: 'javascript', client: 'xhr' },
  { id: 'node-native', label: 'Node.js - Native', target: 'node', client: 'native' },
  { id: 'node-axios', label: 'Node.js - Axios', target: 'node', client: 'axios' },
  { id: 'kotlin', label: 'Kotlin - OkHttp', target: 'kotlin', client: 'okhttp' },
  { id: 'php-curl', label: 'PHP - cURL', target: 'php', client: 'curl' },
  { id: 'php-guzzle', label: 'PHP - Guzzle', target: 'php', client: 'guzzle' },
  { id: 'python', label: 'Python - Requests', target: 'python', client: 'requests' },
  { id: 'ruby', label: 'Ruby - Native', target: 'ruby', client: 'native' },
  { id: 'swift', label: 'Swift - URLSession', target: 'swift', client: 'nsurlsession' },
  { id: 'powershell', label: 'PowerShell - RestMethod', target: 'powershell', client: 'restmethod' },
];

/** gRPC snippets currently use grpcurl, the closest CLI equivalent to cURL. */
export const GRPC_LANGUAGES: Language[] = [{ id: 'grpcurl', label: 'grpcurl', target: 'grpcurl', client: 'grpcurl' }];

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function grpcurlTarget(endpoint: string): string {
  return endpoint
    .trim()
    .replace(/^(?:https?|grpcs?):\/\//i, '')
    .replace(/\/.*$/, '');
}

function grpcurlMethod(symbol: string): string {
  const split = symbol.lastIndexOf('.');
  return split === -1 ? symbol : `${symbol.slice(0, split)}/${symbol.slice(split + 1)}`;
}

/** Build a runnable grpcurl command from the same gRPC draft the app invokes. */
export function generateGrpcurl(tab: Tab, scope: Record<string, string> = {}): string {
  const grpc = tab.grpc;
  const endpoint = grpcurlTarget(resolveVars(grpc?.endpoint ?? '', scope)) || '<host:port>';
  const method = grpcurlMethod(grpc?.method ?? '') || '<package.Service/Method>';
  const message = resolveVars(grpc?.message ?? '', scope).trim() || '{}';
  const parts = ['grpcurl'];
  if (grpc?.plaintext ?? true) parts.push('-plaintext');
  for (const [key, value] of Object.entries(grpc?.metadata ?? {})) {
    const resolvedKey = resolveVars(key, scope).trim();
    if (!resolvedKey) continue;
    parts.push('-H', shellQuote(`${resolvedKey}: ${resolveVars(value, scope)}`));
  }
  parts.push('-d', shellQuote(message), endpoint, method);
  return parts.map((part, index) => (index === 0 ? part : `  ${part}`)).join(' \\\n');
}

/**
 * Build a HAR request from a tab, resolving the same URL/headers/body a send
 * would. When `scope` is non-empty, `{{var}}` placeholders are interpolated so
 * the generated code shows real values; otherwise they survive verbatim.
 */
/**
 * httpsnippet needs a parseable URL, so `{{vars}}` left unresolved (Resolve variables off) are swapped
 * for inert tokens before conversion and put back into the generated code afterwards.
 */
function protectVars(har: HarRequest): { har: HarRequest; restore: (code: string) => string } {
  const tokens: [string, string][] = [];
  const swap = (text: string, urlStart = false): string =>
    text.replace(/\{\{[^{}]+\}\}/g, (match, offset: number) => {
      const token = urlStart && offset === 0 ? `https://bonkvar${tokens.length}.invalid` : `bonkvar${tokens.length}x`;
      tokens.push([token, match]);
      return token;
    });
  const out: HarRequest = {
    ...har,
    url: swap(har.url, true),
    headers: har.headers.map((h) => ({ name: swap(h.name), value: swap(h.value) })),
    ...(har.postData
      ? {
          postData: {
            ...har.postData,
            ...(har.postData.text !== undefined ? { text: swap(har.postData.text) } : {}),
            ...(har.postData.params
              ? {
                  params: har.postData.params.map((p) => ({
                    ...p,
                    name: swap(p.name),
                    ...(p.value !== undefined ? { value: swap(p.value) } : {}),
                  })),
                }
              : {}),
          },
        }
      : {}),
  };
  const restore = (code: string): string =>
    tokens.reduceRight((acc, [token, original]) => acc.split(token).join(original), code);
  return { har: out, restore };
}

/**
 * Mirror of bonk-core's `normalize_url`: a send prepends a scheme to `host/path`, so the snippet must
 * too (httpsnippet rejects scheme-less URLs). A leading `{{var}}` is left alone — it may carry the scheme.
 */
function withScheme(url: string): string {
  const u = url.trim();
  if (!u || u.includes('://') || u.startsWith('{{')) return u;
  const host = u.split(/[/:?#]/)[0];
  const local = ['localhost', '127.0.0.1', '0.0.0.0'].includes(host) || u.startsWith('[::1]');
  return `${local ? 'http' : 'https'}://${u}`;
}

function toHar(tab: Tab, scope: Record<string, string>): HarRequest {
  const finalUrl = buildUrl(tab.request.url, tab.params);
  const built = buildRequestForSend(tab, finalUrl);
  const req = resolveRequestVars(built, scope);
  const headers = Object.entries(req.headers ?? {}).map(([name, value]) => ({ name, value }));
  const har: HarRequest = {
    method: req.method || 'GET',
    url: withScheme(req.url),
    httpVersion: 'HTTP/1.1',
    // The query string already lives in `url`; leaving this empty avoids dupes.
    queryString: [],
    headers,
    cookies: [],
    headersSize: -1,
    bodySize: -1,
  };
  if (currentBodyMode(tab) === 'form-data') {
    har.postData = {
      mimeType: 'multipart/form-data',
      params: enabledBodyParams(tab).map((row) =>
        row.kind === 'file' && row.filePath
          ? { name: resolveVars(row.key, scope), fileName: row.filePath }
          : { name: resolveVars(row.key, scope), value: resolveVars(row.value, scope) },
      ),
    };
  } else if (req.body) {
    const contentType = headers.find((h) => h.name.toLowerCase() === 'content-type')?.value ?? 'text/plain';
    har.postData = { mimeType: contentType, text: req.body };
  }
  return har;
}

/**
 * Generate the request as code in the given language. Never throws. Pass
 * `scope` (e.g. `currentVarScope()`) to interpolate `{{var}}` placeholders into
 * the snippet; omit it to keep them verbatim.
 */
export async function generateSnippet(tab: Tab, langId: string, scope: Record<string, string> = {}): Promise<string> {
  if (tab.protocol === 'grpc') return generateGrpcurl(tab, scope);
  const lang = LANGUAGES.find((l) => l.id === langId) ?? LANGUAGES[0];
  try {
    const { har, restore } = protectVars(toHar(tab, scope));
    const snippet = new HTTPSnippet(har);
    // `target` is validated against httpsnippet's set via LANGUAGES; the single
    // cast narrows our string to the library's TargetId union. `client` is a
    // plain string in the library's types (ClientId), so it needs no cast.
    const out = await snippet.convert(lang.target as TargetId, lang.client);
    if (Array.isArray(out)) return restore(out.join('\n'));
    return typeof out === 'string' ? restore(out) : `// No ${lang.label} output.`;
  } catch (e) {
    return tr('code.codegen_failed', { lang: lang.label, error: e instanceof Error ? e.message : String(e) });
  }
}
