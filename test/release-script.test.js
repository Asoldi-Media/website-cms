import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addChangelogStub, bumpVersionFiles, changelogState, CHANGELOG_STUB, compareSemver, parseSemver } from '../scripts/release.mjs';

test('semver order, including pre-releases below their release', () => {
  assert.equal(compareSemver('2.2.0', '2.1.3'), 1);
  assert.equal(compareSemver('2.1.3', '2.1.3'), 0);
  assert.equal(compareSemver('1.4.1', '1.4.0'), 1);
  assert.equal(compareSemver('1.4.0-sec.1', '1.4.0'), -1, 'a -sec.1 pre-release sorts below 1.4.0');
  assert.equal(compareSemver('1.4.0-sec.2', '1.4.0-sec.10'), -1);
  assert.equal(compareSemver('10.0.0', '9.9.9'), 1);
  assert.equal(parseSemver('2.2'), null);
  assert.throws(() => compareSemver('x', '1.0.0'));
});

test('bumpVersionFiles updates package, lock, README and CONTEXT and keeps line endings', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'cms-release-'));
  try {
    writeFileSync(path.join(root, 'package.json'), '{\r\n  "name": "x",\r\n  "version": "2.1.3"\r\n}\r\n');
    writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ name: 'x', version: '2.1.3', packages: { '': { name: 'x', version: '2.1.3' }, 'node_modules/ms': { version: '2.1.3' } } }, null, 2));
    writeFileSync(path.join(root, 'README.md'), 'Package version: **2.1.3**.\n');
    writeFileSync(path.join(root, 'CONTEXT.md'), 'This repo is **x** (v2.1.3): the CMS.\n');
    assert.deepEqual(bumpVersionFiles(root, '2.2.0').sort(), ['CONTEXT.md', 'README.md', 'package-lock.json', 'package.json']);
    const pkgRaw = readFileSync(path.join(root, 'package.json'), 'utf8');
    assert.ok(pkgRaw.includes('\r\n'));
    assert.equal(JSON.parse(pkgRaw).version, '2.2.0');
    const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
    assert.equal(lock.version, '2.2.0');
    assert.equal(lock.packages[''].version, '2.2.0');
    assert.equal(lock.packages['node_modules/ms'].version, '2.1.3', 'dependency versions are untouched');
    assert.match(readFileSync(path.join(root, 'README.md'), 'utf8'), /\*\*2\.2\.0\*\*/);
    assert.match(readFileSync(path.join(root, 'CONTEXT.md'), 'utf8'), /\(v2\.2\.0\)/);
    assert.deepEqual(bumpVersionFiles(root, '2.2.0'), [], 'a second run changes nothing');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('changelog: missing, stub, and written sections', () => {
  const base = '# Changelog\n\n## 2.1.3\n\n- old\n';
  assert.equal(changelogState(base, '2.2.0'), 'missing');
  const stubbed = addChangelogStub(base, '2.2.0', '2026-10-23');
  assert.match(stubbed, /# Changelog\n\n## 2\.2\.0 \(2026-10-23\)\n\n- \(describe this release\)\n\n## 2\.1\.3/);
  assert.equal(changelogState(stubbed, '2.2.0'), 'stub');
  assert.equal(changelogState(stubbed.replace(CHANGELOG_STUB, '- Real notes.'), '2.2.0'), 'ok');
  assert.equal(changelogState(readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8'), JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version), 'ok', 'this repo documents its current version');
});
