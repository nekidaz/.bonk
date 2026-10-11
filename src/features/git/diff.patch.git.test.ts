import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blockPatch, changeBlocks, fileLines } from './diff';

const sh = (cwd: string, cmd: string, input?: string) => execSync(cmd, { cwd, input, encoding: 'utf8' });

// The patches `git apply` gets from the diff view, checked against git itself: a last line without
// a newline, lines picked out of a block, unstaging and discarding.
describe('patches against real git', () => {
  it('stage a block, partial lines, unstage, discard', () => {
    const d = mkdtempSync(join(tmpdir(), 'bonk-patch-'));
    // core.autocrlf off: a Windows runner's global autocrlf=true would write CRLF on `git apply -R`.
    sh(d, 'git init -q && git config core.autocrlf false && git config user.email a@b && git config user.name a');
    writeFileSync(join(d, 'a.txt'), '1\n2\n3\n4\n5\n6\n7\n8');
    sh(d, 'git add -A && git commit -qm base');
    writeFileSync(join(d, 'a.txt'), '1 changed\n2\n3\n4\n5\n6\n7\n8a\n8b');
    const lines = fileLines(sh(d, 'git diff -U100000 -- a.txt'));
    const [b1, b2] = changeBlocks(lines);
    const apply = (p: string, flags: string) => sh(d, `git apply --recount --whitespace=nowarn ${flags} -`, p);
    // stage only «+8a» of block 2
    apply(blockPatch('a.txt', lines, b2, new Set([b2.start + 1])), '--cached');
    expect(sh(d, 'git show :a.txt')).toBe('1\n2\n3\n4\n5\n6\n7\n8\n8a\n');
    // unstage it again from the staged diff
    const staged = fileLines(sh(d, 'git diff --cached -U100000 -- a.txt'));
    const [sb] = changeBlocks(staged);
    apply(blockPatch('a.txt', staged, sb, undefined, true), '--cached -R');
    expect(sh(d, 'git show :a.txt')).toBe('1\n2\n3\n4\n5\n6\n7\n8');
    // discard only «+8b» from the working file
    apply(blockPatch('a.txt', lines, b2, new Set([b2.start + 2]), true), '-R');
    expect(readFileSync(join(d, 'a.txt'), 'utf8')).toBe('1 changed\n2\n3\n4\n5\n6\n7\n8a\n');
    // stage block 1 whole
    const now = fileLines(sh(d, 'git diff -U100000 -- a.txt'));
    apply(blockPatch('a.txt', now, changeBlocks(now)[0]), '--cached');
    expect(sh(d, 'git show :a.txt').startsWith('1 changed\n2\n')).toBe(true);
    expect(b1).toEqual({ start: 0, end: 2 });
    rmSync(d, { recursive: true, force: true });
  });
});
