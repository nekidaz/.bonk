/**
 * Pure parsers for Collection Runner data files (CSV / JSON). Each returns a
 * list of `name → value` rows the runner feeds one-per-iteration into the script
 * context (`pm.iterationData`) and the `{{var}}` resolution scope.
 *
 * This module is a leaf: it imports nothing (no stores, no api), so the stores
 * import graph stays acyclic. All values are coerced to strings because the
 * resolution scope and the QuickJS context are `Record<string, string>`.
 */
import { t } from '$shared/i18n';

/**
 * Parse RFC-4180-ish CSV. The first row is the header; each later row becomes a
 * `header → cell` object. Double-quoted fields may contain commas, newlines, and
 * escaped quotes (`""` → `"`). Both CRLF and LF line endings are accepted and a
 * single trailing empty line (a file that ends in a newline) is ignored.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const records = splitCsvRecords(text);
  if (records.length === 0) return [];
  const headers = records[0];
  const rows: Record<string, string>[] = [];
  for (let r = 1; r < records.length; r++) {
    const cells = records[r];
    const row: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      row[headers[c]] = cells[c] ?? '';
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Split CSV text into records (arrays of fields), honouring quoted fields. A
 * quoted field runs until the next unescaped quote; `""` inside a quoted field
 * is a literal quote. Unquoted fields end at a comma or a line break. A trailing
 * blank record (from a file ending in a newline) is dropped.
 */
function splitCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let sawAny = false;
  const pushField = (): void => {
    record.push(field);
    field = '';
  };
  const pushRecord = (): void => {
    pushField();
    records.push(record);
    record = [];
    sawAny = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++; // skip the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      sawAny = true;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      sawAny = true;
    } else if (ch === ',') {
      pushField();
      sawAny = true;
    } else if (ch === '\r') {
      // Swallow CR; a following LF still triggers a single record break.
      if (text[i + 1] === '\n') i++;
      pushRecord();
    } else if (ch === '\n') {
      pushRecord();
    } else {
      field += ch;
      sawAny = true;
    }
  }
  // Flush a final record that wasn't terminated by a newline. If the file ended
  // exactly on a line break the pending record is empty (sawAny false) — that's
  // the trailing blank line, which we drop.
  if (sawAny || field !== '' || record.length > 0) pushRecord();
  return records;
}

/**
 * Parse a JSON array of objects into string rows. Each object's values are
 * coerced to strings: primitives via `String(v)` (null → "null"), objects and
 * arrays via `JSON.stringify`. Throws a clear Error when the top level isn't an
 * array or a row isn't a plain object.
 */
export function parseJson(text: string): Record<string, string>[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(t('runner.err.badJson', { msg: e instanceof Error ? e.message : String(e) }));
  }
  if (!Array.isArray(data)) {
    throw new Error(t('runner.err.jsonArray'));
  }
  return data.map((entry, i) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(t('runner.err.jsonRow', { n: i + 1 }));
    }
    const row: Record<string, string> = {};
    for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
      row[key] = coerce(value);
    }
    return row;
  });
}

/** Coerce a single JSON value to the string form used in the run scope. */
function coerce(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Dispatch a data file to the right parser by its extension (.csv / .json). */
export function parseDataFile(name: string, text: string): Record<string, string>[] {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  if (ext === '.csv') return parseCsv(text);
  if (ext === '.json') return parseJson(text);
  throw new Error(t('runner.err.unsupported', { ext: ext || name }));
}
