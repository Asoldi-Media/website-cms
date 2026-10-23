import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (name) => JSON.parse(readFileSync(path.join(ROOT, name), 'utf8'));

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parse(version) {
  const m = SEMVER.exec(String(version));
  if (!m) throw new Error(`not semver: ${version}`);
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] };
}

/** Semver 2.0 precedence: -1, 0 or 1. A pre-release sorts below its release. */
function compareSemver(a, b) {
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i += 1) if (x.core[i] !== y.core[i]) return x.core[i] < y.core[i] ? -1 : 1;
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i += 1) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn && Number(p) !== Number(q)) return Number(p) < Number(q) ? -1 : 1;
    if (pn !== qn) return pn ? -1 : 1;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

test('the comparator follows semver precedence', () => {
  const ordered = ['1.4.0', '1.4.1', '1.7.0-sec.1', '1.7.0', '1.7.1', '1.8.0', '2.1.3', '2.2.0'];
  for (let i = 0; i < ordered.length; i += 1) {
    for (let j = 0; j < ordered.length; j += 1) {
      assert.equal(compareSemver(ordered[i], ordered[j]), Math.sign(i - j), `${ordered[i]} vs ${ordered[j]}`);
    }
  }
  assert.equal(compareSemver('1.0.0-alpha', '1.0.0-alpha.1'), -1);
  assert.equal(compareSemver('1.0.0-alpha.beta', '1.0.0-beta'), -1);
  assert.equal(compareSemver('1.0.0-2', '1.0.0-11'), -1);
});

test('this release is a plain patch on the 1.7 line, newer than 1.7.0 and older than every 1.8+/2.x release', () => {
  const { version } = readJson('package.json');
  const { pre } = parse(version);
  assert.equal(pre.length, 0, 'a patch release, never a pre-release (a pre-release sorts below 1.7.0)');
  assert.match(version, /^1\.7\.\d+$/);
  assert.equal(compareSemver(version, '1.7.0'), 1, 'fleet gates must see the patched site as newer than 1.7.0');
  assert.equal(compareSemver(version, '1.8.0'), -1);
  assert.equal(compareSemver(version, '2.0.0'), -1);
  assert.equal(compareSemver('1.7.0-sec.1', '1.7.0'), -1, 'why the backport is not tagged as a pre-release');
});

test('package-lock.json carries the same version as package.json', () => {
  const pkg = readJson('package.json');
  const lock = readJson('package-lock.json');
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
});
