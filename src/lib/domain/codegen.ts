/**
 * Multi-language request code generation (Postman-style "Code snippet"), built
 * on httpsnippet-lite. Converts a request tab into a HAR entry and renders it in
 * the selected target language. `{{vars}}` are embedded verbatim, so env
 * placeholders survive into the generated code.
 */
import { HTTPSnippet } from 'httpsnippet-lite';
import type { Tab } from './types';
import { buildUrl } from './http';
import { buildRequestForSend, currentBodyMode, enabledBodyParams } from './httpBody';

export type Language = { id: string; label: string; target: string; client: string };

/** The languages offered in the snippet dropdown (label → httpsnippet target/client). */
export const LANGUAGES: Language[] = [
  { id: 'curl', label: 'cURL', target: 'shell', client: 'curl' },
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

/** Build a HAR request from a tab, resolving the same URL/headers/body a send would. */
function toHar(tab: Tab): Record<string, unknown> {
  const finalUrl = buildUrl(tab.request.url, tab.params);
  const req = buildRequestForSend(tab, finalUrl);
  const headers = Object.entries(req.headers ?? {}).map(([name, value]) => ({ name, value }));
  const har: Record<string, unknown> = {
    method: req.method || 'GET',
    url: req.url,
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
          ? { name: row.key, fileName: row.filePath }
          : { name: row.key, value: row.value },
      ),
    };
  } else if (req.body) {
    const contentType =
      headers.find((h) => h.name.toLowerCase() === 'content-type')?.value ?? 'text/plain';
    har.postData = { mimeType: contentType, text: req.body };
  }
  return har;
}

/** Generate the request as code in the given language. Never throws. */
export async function generateSnippet(tab: Tab, langId: string): Promise<string> {
  const lang = LANGUAGES.find((l) => l.id === langId) ?? LANGUAGES[0];
  try {
    const snippet = new HTTPSnippet(toHar(tab) as never);
    const out = await snippet.convert(lang.target as never, lang.client as never);
    if (Array.isArray(out)) return out.join('\n');
    return typeof out === 'string' ? out : `// No ${lang.label} output.`;
  } catch (e) {
    return `// Could not generate ${lang.label}: ${e instanceof Error ? e.message : String(e)}`;
  }
}
