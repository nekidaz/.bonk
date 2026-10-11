import { describe, it, expect } from 'vitest';
import { blockPatch, changeBlocks, fileLines } from './diff';

// A full-context diff (-U100000): lines 1 and 8 changed, 2..7 the same.
const DIFF = [
  'diff --git a/a.txt b/a.txt',
  '--- a/a.txt',
  '+++ b/a.txt',
  '@@ -1,8 +1,9 @@',
  '-1',
  '+1 changed',
  ' 2',
  ' 3',
  ' 4',
  ' 5',
  ' 6',
  ' 7',
  '-8',
  '+8a',
  '+8b',
  '\\ No newline at end of file',
].join('\n');

const head = (h: string) => `diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n${h}\n`;

describe('block patches', () => {
  const lines = fileLines(DIFF);
  const blocks = changeBlocks(lines);

  it('finds each run of changed lines', () => {
    expect(blocks).toEqual([
      { start: 0, end: 2 },
      { start: 8, end: 11 },
    ]);
    expect(lines.at(-1)?.noEol).toBe(true);
  });

  it('patches one block with three lines of context', () => {
    expect(blockPatch('a.txt', lines, blocks[0])).toBe(head('@@ -1,4 +1,4 @@') + '-1\n+1 changed\n 2\n 3\n 4\n');
    expect(blockPatch('a.txt', lines, blocks[1])).toBe(
      head('@@ -5,4 +5,5 @@') + ' 5\n 6\n 7\n-8\n+8a\n+8b\n\\ No newline at end of file\n',
    );
  });

  it('stages chosen lines: a removal left out stays, an addition left out is dropped', () => {
    // Only «+8a» of the second block: «-8» stays as context, «+8b» isn't added.
    expect(blockPatch('a.txt', lines, blocks[1], new Set([9]))).toBe(head('@@ -5,4 +5,5 @@') + ' 5\n 6\n 7\n 8\n+8a\n');
  });

  it('builds the reverse (unstage / discard) the other way round', () => {
    // Undo only «-8»: the new side has «8a» and «8b»; «8b» left out stays there as context.
    expect(blockPatch('a.txt', lines, blocks[1], new Set([8]), true)).toBe(
      head('@@ -5,6 +5,5 @@') + ' 5\n 6\n 7\n-8\n 8a\n 8b\n\\ No newline at end of file\n',
    );
  });
});
