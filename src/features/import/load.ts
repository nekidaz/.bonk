// Getting the text of a source: a picked or dropped file (read in Rust), or a link (fetched with the
// user's proxy/TLS settings, once).
import { currentRequestSettings } from '$entities/request';
import { httpSend, importReadFile, openapiImportPick, type ImportFile } from '$shared/ipc';
import { t } from '$shared/i18n';
import type { Origin } from './source';

export interface Fetched {
  text: string;
  origin: Origin;
}

export const fromFile = (f: ImportFile): Fetched => ({
  text: f.text,
  origin: { kind: 'file', location: f.path, name: f.name, size: f.size },
});

/** Native file picker; null when cancelled. */
export async function pickFile(): Promise<Fetched | null> {
  const f = await openapiImportPick();
  return f ? fromFile(f) : null;
}

export const readFile = async (path: string): Promise<Fetched> => fromFile(await importReadFile(path));

export async function fetchUrl(url: string): Promise<Fetched> {
  const res = await httpSend(
    { method: 'GET', url, headers: { Accept: 'application/json, application/yaml, text/yaml, */*' } },
    undefined,
    currentRequestSettings(),
  );
  if (res.status < 200 || res.status >= 300) throw new Error(t('import.err.http', { status: res.status }));
  if (res.body_truncated) throw new Error(t('import.err.truncated'));
  const name = decodeURIComponent(new URL(res.final_url || url).pathname.split('/').pop() || '') || url;
  return { text: res.body, origin: { kind: 'url', location: url, name, size: res.size_bytes } };
}
