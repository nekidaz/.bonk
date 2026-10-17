/**
 * Architecture guard for the frontend (runs with every `make test`).
 *
 * src/ has four layers; imports may only point DOWN:
 *   app → features → entities → shared
 * Each folder inside a layer is a "slice" (≈ a Go package). Its public API is index.ts (code)
 * and components.ts (Svelte components), like the capitalised names of a Go package.
 * See ARCHITECTURE.md.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';

const LAYERS = ['shared', 'entities', 'features', 'app'];
/** Files that sit outside the layers on purpose: the bootstrap and this test. */
const OUTSIDE = new Set(['main.ts', 'vite-env.d.ts', 'architecture.test.ts']);

type Slice = { layer: string; name: string };
type Ref = { from: string; spec: string; target: string; alias: boolean; mock: boolean };

/** 'entities/tab/store.svelte.ts' → entities/tab · 'app/App.svelte' → app · 'main.ts' → null (paths relative to src/). */
function sliceOf(path: string): Slice | null {
  const [layer, name] = path.split('/');
  if (layer === 'app') return { layer, name: 'app' };
  if (LAYERS.includes(layer) && name) return { layer, name: `${layer}/${name}` };
  return null;
}

function sourceFiles(dir = 'src'): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(ts|svelte)$/.test(e.name) ? [p.slice('src/'.length)] : [];
  });
}

const PATTERNS: [RegExp, boolean][] = [
  [
    /^[ \t]*(?:import|export)(?:\s+type)?\s+(?:[\w$]+\s*,\s*)?(?:\{[^}]*\}|\*\s+as\s+[\w$]+|\*|[\w$]+)\s+from\s+['"]([^'"\n]+)['"]/gm,
    false,
  ],
  [/^[ \t]*import\s+['"]([^'"\n]+)['"]/gm, false], // side-effect import
  [/\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/g, false], // dynamic import
  [/\bvi\.mock\(\s*['"]([^'"\n]+)['"]/g, true], // a mock must name the exact file, so it may go deep
];

function refsOf(file: string, src: string): Ref[] {
  const refs: Ref[] = [];
  for (const [re, mock] of PATTERNS) {
    for (const m of src.matchAll(re)) {
      const spec = m[1];
      if (spec.startsWith('$')) refs.push({ from: file, spec, target: spec.slice(1), alias: true, mock });
      else if (spec.startsWith('.'))
        refs.push({
          from: file,
          spec,
          target: posix.normalize(posix.join(posix.dirname(file), spec)),
          alias: false,
          mock,
        });
    }
  }
  return refs;
}

const files = sourceFiles();
const refs = files.flatMap((f) => refsOf(f, readFileSync(`src/${f}`, 'utf8')));
/** References that cross from one slice into another. */
const crossing = refs.filter((r) => {
  const a = sliceOf(r.from),
    b = sliceOf(r.target);
  return a !== null && b !== null && a.name !== b.name;
});
const fromSlice = (r: Ref) => sliceOf(r.from)!;
const toSlice = (r: Ref) => sliceOf(r.target)!;
const show = (r: Ref) => `${r.from} → '${r.spec}'`;

describe('frontend architecture', () => {
  it('every source file lives in a layer (src/{shared,entities,features}/<slice>/… or src/app/…)', () => {
    const stray = files.filter(
      (f) => !OUTSIDE.has(f) && !f.startsWith('app/') && !(sliceOf(f) && f.split('/').length >= 3),
    );
    expect(stray).toEqual([]);
  });

  it('imports only point down: app → features → entities → shared', () => {
    expect(
      crossing.filter((r) => LAYERS.indexOf(toSlice(r).layer) > LAYERS.indexOf(fromSlice(r).layer)).map(show),
    ).toEqual([]);
  });

  it('a feature never imports another feature (share it via entities/ or wire it in app/)', () => {
    expect(
      crossing.filter((r) => fromSlice(r).layer === 'features' && toSlice(r).layer === 'features').map(show),
    ).toEqual([]);
  });

  it("another slice is reached only through '$layer/slice' (index.ts) or '$layer/slice/components'", () => {
    const viaEntry = (r: Ref) =>
      r.alias && (r.mock || r.target === toSlice(r).name || r.target === `${toSlice(r).name}/components`);
    expect(crossing.filter((r) => !viaEntry(r)).map(show)).toEqual([]);
  });

  it('inside one slice, files import each other by relative path', () => {
    expect(
      refs
        .filter((r) => r.alias && sliceOf(r.from) !== null && sliceOf(r.from)!.name === sliceOf(r.target)?.name)
        .map(show),
    ).toEqual([]);
  });

  it(".ts modules never import another slice's components (keeps logic and tests free of .svelte)", () => {
    expect(
      crossing.filter((r) => /(?<!\.test)\.ts$/.test(r.from) && r.target.endsWith('/components')).map(show),
    ).toEqual([]);
  });

  it('slices never depend on each other in a circle', () => {
    const graph = new Map<string, Set<string>>();
    for (const r of crossing) {
      if (r.mock || r.from.endsWith('.test.ts')) continue;
      if (!graph.has(fromSlice(r).name)) graph.set(fromSlice(r).name, new Set());
      graph.get(fromSlice(r).name)!.add(toSlice(r).name);
    }
    const state = new Map<string, 'open' | 'done'>();
    const path: string[] = [];
    const cycles: string[] = [];
    const visit = (n: string): void => {
      state.set(n, 'open');
      path.push(n);
      for (const m of graph.get(n) ?? []) {
        if (state.get(m) === 'open') cycles.push([...path.slice(path.indexOf(m)), m].join(' → '));
        else if (!state.has(m)) visit(m);
      }
      path.pop();
      state.set(n, 'done');
    };
    for (const n of graph.keys()) if (!state.has(n)) visit(n);
    expect(cycles).toEqual([]);
  });
});
