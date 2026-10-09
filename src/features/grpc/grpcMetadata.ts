export interface GrpcMetadataRow {
  key: string;
  value: string;
}

export function emptyGrpcMetadataRow(): GrpcMetadataRow {
  return { key: '', value: '' };
}

/** Convert persisted metadata into editable rows with exactly one blank row. */
export function grpcMetadataRows(metadata: Record<string, string> | undefined): GrpcMetadataRow[] {
  return [...Object.entries(metadata ?? {}).map(([key, value]) => ({ key, value })), emptyGrpcMetadataRow()];
}

/** Keep incomplete edits locally while ensuring the table always has a new row. */
export function withTrailingGrpcMetadataRow(rows: GrpcMetadataRow[]): GrpcMetadataRow[] {
  const populated = rows.filter((row) => row.key !== '' || row.value !== '');
  return [...populated, emptyGrpcMetadataRow()];
}

/** Build the wire/persisted record. Blank keys are drafts and are not sent. */
export function grpcMetadataRecord(rows: GrpcMetadataRow[]): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key) metadata[key] = row.value;
  }
  return metadata;
}

/** Parse pasted `key: value` lines. Values may contain additional colons. */
export function parseGrpcMetadataRows(text: string): GrpcMetadataRow[] {
  const rows: GrpcMetadataRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    if (!key) continue;
    rows.push({ key, value: line.slice(separator + 1).replace(/^\s+/, '') });
  }
  return rows;
}

export function isGrpcMetadataKeyValid(key: string): boolean {
  return key === '' || /^[0-9A-Za-z_.-]+$/.test(key.trim());
}

/** Duplicate metadata keys are case-insensitive on the wire. */
export function duplicateGrpcMetadataKeys(rows: GrpcMetadataRow[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const row of rows) {
    const key = row.key.trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return duplicates;
}
