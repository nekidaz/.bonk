import { describe, it, expect } from 'vitest';
import { parentId } from '../src/lib/domain/tree';

describe('parentId', () => {
  it('returns the parent folder id of a nested node', () => {
    expect(parentId('fs:API/Sub/Foo.bonk.json')).toBe('fs:API/Sub');
    expect(parentId('fs:A/B')).toBe('fs:A');
  });

  it('returns undefined for a top-level folder (no slash in rel path)', () => {
    expect(parentId('fs:API')).toBeUndefined();
  });

  it('returns undefined for a request at the workspace root', () => {
    expect(parentId('fs:Foo.bonk.json')).toBeUndefined();
  });
});
