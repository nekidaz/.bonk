import { describe, expect, it } from 'vitest';
import {
  duplicateGrpcMetadataKeys,
  grpcMetadataRecord,
  grpcMetadataRows,
  parseGrpcMetadataRows,
  withTrailingGrpcMetadataRow,
} from './grpcMetadata';

describe('gRPC metadata rows', () => {
  it('creates editable rows with a trailing blank row', () => {
    expect(grpcMetadataRows({ authorization: 'Bearer token' })).toEqual([
      { key: 'authorization', value: 'Bearer token' },
      { key: '', value: '' },
    ]);
  });

  it('keeps incomplete drafts instead of deleting the first typed character', () => {
    expect(withTrailingGrpcMetadataRow([{ key: 'x', value: '' }])).toEqual([
      { key: 'x', value: '' },
      { key: '', value: '' },
    ]);
  });

  it('persists only rows with keys and preserves their values', () => {
    expect(
      grpcMetadataRecord([
        { key: ' authorization ', value: 'Bearer token' },
        { key: '', value: 'draft' },
        { key: 'x-note', value: ' a value ' },
      ]),
    ).toEqual({ authorization: 'Bearer token', 'x-note': ' a value ' });
  });

  it('parses bulk-pasted metadata and keeps colons inside values', () => {
    expect(parseGrpcMetadataRows('authorization: Bearer token\nx-url: https://example.com:443\nbad')).toEqual([
      { key: 'authorization', value: 'Bearer token' },
      { key: 'x-url', value: 'https://example.com:443' },
    ]);
  });

  it('finds case-insensitive duplicates', () => {
    expect([
      ...duplicateGrpcMetadataKeys([
        { key: 'Authorization', value: 'a' },
        { key: 'authorization', value: 'b' },
      ]),
    ]).toEqual(['authorization']);
  });
});
