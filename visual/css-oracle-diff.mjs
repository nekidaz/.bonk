// Compare two computed-style dumps (visual/css-oracle.ts): node visual/css-oracle-diff.mjs <baseline-dir> <current-dir>
// Prints every element/property that differs and exits 1 if anything does.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const [a, b] = process.argv.slice(2);
const load = (f) => JSON.parse(gunzipSync(readFileSync(f)));
const LIMIT = Number(process.env.LIMIT ?? 40);
let diffs = 0;
const report = (msg) => {
  if (++diffs <= LIMIT) console.log(msg);
};

const files = readdirSync(a).filter((f) => f.endsWith('.json.gz'));
for (const f of files) {
  if (!existsSync(`${b}/${f}`)) {
    report(`${f}: missing in ${b}`);
    continue;
  }
  const A = load(`${a}/${f}`);
  const B = load(`${b}/${f}`);
  for (const variant of Object.keys(A)) {
    const x = A[variant];
    const y = B[variant];
    if (!y) {
      report(`${f} [${variant}]: variant missing`);
      continue;
    }
    const yIdx = new Map(y.props.map((p, i) => [p, i]));
    for (const p of x.props) if (!yIdx.has(p)) report(`${f} [${variant}]: property ${p} gone`);
    for (const p of y.props) if (!x.props.includes(p)) report(`${f} [${variant}]: property ${p} new`);
    for (const el of new Set([...Object.keys(x.els), ...Object.keys(y.els)])) {
      if (!(el in x.els) || !(el in y.els)) {
        report(`${f} [${variant}] ${el}: element only in ${el in x.els ? a : b}`);
        continue;
      }
      const rx = x.rows[x.els[el]];
      const ry = y.rows[y.els[el]];
      const cls = x.cls?.[el.replace(/::.*$/, '')];
      const name = cls ? `${el} (.${cls.trim().split(/\s+/).join('.')})` : el;
      x.props.forEach((p, i) => {
        const vy = yIdx.has(p) ? ry[yIdx.get(p)] : undefined;
        if (vy !== undefined && rx[i] !== vy) report(`${f} [${variant}] ${name} ${p}: ${rx[i]} -> ${vy}`);
      });
    }
  }
}
console.log(
  diffs ? `\n${diffs} difference(s) in ${files.length} dumps` : `computed styles identical (${files.length} dumps)`,
);
process.exit(diffs ? 1 : 0);
