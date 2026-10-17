import { describe, expect, it } from 'vitest';
import { staleSavedCopies } from './savedCopies';
import type { RequestNode, Tab, TreeNode } from '$shared/model';

const node = (id: string, contentHash: string): RequestNode => ({
  kind: 'request',
  id,
  name: id,
  protocol: 'http',
  request: { method: 'GET', url: '/x', headers: {} },
  contentHash,
});
const tree: TreeNode[] = [{ kind: 'folder', id: 'fs:A', name: 'A', expanded: true, children: [node('fs:A/a', 'h2')] }];
const tab = (patch: Partial<Tab>): Tab => ({
  id: 't',
  protocol: 'http',
  title: 'a',
  request: { method: 'GET', url: '/x', headers: {} },
  ...patch,
});

describe('staleSavedCopies', () => {
  it('lists saved tabs whose file hash moved, once per tree hash', () => {
    const reading = new Map<string, string>();
    const behind = tab({ savedPath: 'fs:A/a', saved: node('fs:A/a', 'h1') });
    const fresh = tab({ id: 'u', savedPath: 'fs:A/a', saved: node('fs:A/a', 'h2') });
    const restored = tab({ id: 'v', savedPath: 'fs:A/a' }); // older state.json: no copy yet
    const scratch = tab({ id: 'w' });
    const gone = tab({ id: 'x', savedPath: 'fs:A/zzz', saved: node('fs:A/zzz', 'h1') });
    expect(staleSavedCopies([behind, fresh, restored, scratch, gone], tree, reading)).toEqual([
      { tabId: 't', path: 'fs:A/a', hash: 'h2' },
      { tabId: 'v', path: 'fs:A/a', hash: 'h2' },
    ]);
    reading.set('t', 'h2');
    expect(staleSavedCopies([behind], tree, reading)).toEqual([]);
    reading.set('t', 'h1'); // the tree moved on again: read again
    expect(staleSavedCopies([behind], tree, reading)).toHaveLength(1);
  });
});
