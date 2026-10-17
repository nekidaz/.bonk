import { describe, expect, it } from 'vitest';
import { effectiveScripts, scriptFoldersFor } from './scriptInherit';
import type { TreeNode } from '$shared/model';

const req = (id: string): TreeNode => ({
  kind: 'request',
  id,
  name: 'r',
  protocol: 'http',
  request: { method: 'GET', url: '', headers: {} },
});
const tree: TreeNode[] = [
  {
    kind: 'folder',
    id: 'fs:a',
    name: 'a',
    expanded: true,
    preRequestScript: "const who = 'collection';",
    children: [
      req('fs:a/r'),
      {
        kind: 'folder',
        id: 'fs:a/b',
        name: 'b',
        expanded: true,
        preRequestScript: "const who = 'folder';",
        testScript: "pm.test('f');",
        children: [req('fs:a/b/r')],
      },
      { kind: 'folder', id: 'fs:a/c', name: 'c', expanded: true, children: [req('fs:a/c/r')] },
    ],
  },
  req('fs:root'),
];

describe('scriptInherit', () => {
  it('lists the folders with scripts, root first', () => {
    expect(scriptFoldersFor(tree, 'fs:a/b/r').map((f) => f.id)).toEqual(['fs:a', 'fs:a/b']);
    expect(scriptFoldersFor(tree, 'fs:a/c/r').map((f) => f.id)).toEqual(['fs:a']);
    expect(scriptFoldersFor(tree, 'fs:root')).toEqual([]);
    expect(scriptFoldersFor(tree, undefined)).toEqual([]);
  });

  it('runs outer folders first, then the request, each in its own scope', () => {
    const { preRequestScript, testScript } = effectiveScripts(tree, 'fs:a/b/r', {
      preRequestScript: "const who = 'request';",
    });
    expect(preRequestScript).toBe(
      [
        "(function () {\nconst who = 'collection';\n})();",
        "(function () {\nconst who = 'folder';\n})();",
        "(function () {\nconst who = 'request';\n})();",
      ].join('\n'),
    );
    // One part stays as it is; blanks are skipped.
    expect(testScript).toBe("pm.test('f');");
    expect(effectiveScripts(tree, 'fs:a/r', { preRequestScript: '  ' })).toEqual({
      preRequestScript: "const who = 'collection';",
      testScript: '',
    });
    expect(effectiveScripts(tree, undefined, { testScript: 'x' })).toEqual({ preRequestScript: '', testScript: 'x' });
  });

  it('a wrapped part cannot return out of the next one', () => {
    const calls: string[] = [];
    const code = effectiveScripts(tree, 'fs:a/b/r', { preRequestScript: "calls.push('request');" }).preRequestScript;
    const withCalls = code.replace(/const who = '(\w+)';/g, "calls.push('$1'); return;");
    // scripts.rs runs user code as a function body, exactly like `new Function`.
    new Function('calls', withCalls)(calls);
    expect(calls).toEqual(['collection', 'folder', 'request']);
  });
});
