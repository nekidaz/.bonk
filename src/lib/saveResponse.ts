import { openapiExportSave } from './api';

const EXT: Record<string, string> = { JSON: 'json', HTML: 'html', XML: 'xml' };

/** `<request title>-response.<ext>`, safe as a save-dialog default name. */
export function responseFileName(title: string, format: string): string {
  const base =
    title
      .replace(/[^\p{L}\p{N}._-]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'response';
  return `${base}-response.${EXT[format] ?? 'txt'}`;
}

/**
 * Save the in-memory response body through the native save dialog (E4 rule 8). Returns the written path,
 * or null when cancelled. A body the backend cut at the size cap is saved as the copy it is.
 */
export function saveResponseBody(body: string, fileName: string, title: string): Promise<string | null> {
  return openapiExportSave(fileName, body, title);
}
