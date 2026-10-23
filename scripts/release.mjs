#!/usr/bin/env node
/**
 * Cut a client CMS release. Never pushes.
 *
 *   node scripts/release.mjs 2.2.0          bump version files, check the changelog, npm test, lint, build:admin
 *   node scripts/release.mjs 2.2.0 --tag    same checks on a clean, committed tree, then git tag -a v2.2.0
 *
 * Add --dry-run to print the plan only. Push the tag yourself when the release may go public.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CHANGELOG_STUB = '- (describe this release)';

/** Parse x.y.z with an optional -pre tag; null when invalid. */
export function parseSemver(value) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(value || '').trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] || '' };
}

/** Semver order: -1, 0, 1. A pre-release sorts before its release (1.4.0-sec.1 < 1.4.0). */
export function compareSemver(a, b) {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) throw new Error(`Not a version: ${!x ? a : b}`);
  for (const key of ['major', 'minor', 'patch']) {
    if (x[key] !== y[key]) return x[key] < y[key] ? -1 : 1;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  const xa = x.pre.split('.');
  const ya = y.pre.split('.');
  for (let i = 0; i < Math.max(xa.length, ya.length); i += 1) {
    if (xa[i] === undefined) return -1;
    if (ya[i] === undefined) return 1;
    const xn = /^\d+$/.test(xa[i]);
    const yn = /^\d+$/.test(ya[i]);
    if (xn && yn && Number(xa[i]) !== Number(ya[i])) return Number(xa[i]) < Number(ya[i]) ? -1 : 1;
    if (xn !== yn) return xn ? -1 : 1;
    if (xa[i] !== ya[i]) return xa[i] < ya[i] ? -1 : 1;
  }
  return 0;
}

function rewrite(file, edit) {
  if (!existsSync(file)) return false;
  const raw = readFileSync(file, 'utf8');
  const crlf = raw.includes('\r\n');
  const next = edit(raw.replace(/\r\n/g, '\n'));
  if (next === raw.replace(/\r\n/g, '\n')) return false;
  writeFileSync(file, crlf ? next.replace(/\n/g, '\r\n') : next);
  return true;
}

/** Set the version in package.json, package-lock.json, README.md and CONTEXT.md. Returns changed files. */
export function bumpVersionFiles(root, version) {
  const changed = [];
  const json = (name, apply) => {
    if (rewrite(path.join(root, name), (text) => `${JSON.stringify(apply(JSON.parse(text)), null, 2)}\n`)) changed.push(name);
  };
  json('package.json', (pkg) => ({ ...pkg, version }));
  json('package-lock.json', (lock) => {
    const next = { ...lock, version };
    if (next.packages?.['']) next.packages = { ...next.packages, '': { ...next.packages[''], version } };
    return next;
  });
  if (rewrite(path.join(root, 'README.md'), (t) => t.replace(/Package version: \*\*[^*]+\*\*/, `Package version: **${version}**`))) changed.push('README.md');
  if (rewrite(path.join(root, 'CONTEXT.md'), (t) => t.replace(/\(v\d+\.\d+\.\d+[^)]*\)/, `(v${version})`))) changed.push('CONTEXT.md');
  return changed;
}

/** 'ok' when CHANGELOG.md has a written section for the version, 'stub' when only the stub, 'missing' otherwise. */
export function changelogState(text, version) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => line.startsWith(`## ${version}`));
  if (start === -1) return 'missing';
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    if (line.trim()) body.push(line.trim());
  }
  if (!body.length || body.every((line) => line === CHANGELOG_STUB)) return 'stub';
  return 'ok';
}

/** Insert a stub section for the version under the title. */
export function addChangelogStub(text, version, date = new Date().toISOString().slice(0, 10)) {
  const source = String(text || '# Changelog\n').replace(/\r\n/g, '\n');
  const lines = source.split('\n');
  const titleAt = lines.findIndex((line) => line.startsWith('# '));
  const insertAt = titleAt === -1 ? 0 : titleAt + 1;
  lines.splice(insertAt, 0, '', `## ${version} (${date})`, '', CHANGELOG_STUB);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

function run(cmd, args) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { cwd: REPO, stdio: 'inherit', shell: process.platform === 'win32' });
}

function main(argv) {
  const version = argv.find((a) => !a.startsWith('--'));
  const tag = argv.includes('--tag');
  const dryRun = argv.includes('--dry-run');
  if (!parseSemver(version)) throw new Error('Usage: node scripts/release.mjs <x.y.z> [--tag] [--dry-run]');
  const current = JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;
  const order = compareSemver(version, current);
  if (order < 0) throw new Error(`${version} is lower than the current ${current}.`);
  if (tag && order !== 0) throw new Error(`Bump and commit ${version} first (package.json says ${current}).`);
  const tagName = `v${version}`;
  if (tag && git(['tag', '--list', tagName])) throw new Error(`Tag ${tagName} already exists.`);
  if (tag && git(['status', '--porcelain', '--untracked-files=no'])) throw new Error('Commit or stash changes before tagging.');
  if (dryRun) {
    console.log(tag ? `Would check and tag ${tagName}.` : `Would bump ${current} -> ${version}, then test, lint and build:admin.`);
    return;
  }
  if (!tag) {
    const changed = bumpVersionFiles(REPO, version);
    console.log(changed.length ? `Version ${version} in: ${changed.join(', ')}` : `Already at ${version}.`);
  }
  const changelogPath = path.join(REPO, 'CHANGELOG.md');
  const changelog = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : '# Changelog\n';
  const state = changelogState(changelog, version);
  if (state === 'missing') writeFileSync(changelogPath, addChangelogStub(changelog, version));
  if (state !== 'ok') throw new Error(`Write the ${version} section in CHANGELOG.md (keep it neutral; this repo is public), then re-run.`);
  run('npm', ['test']);
  run('npm', ['run', 'lint']);
  run('npm', ['run', 'build:admin']);
  if (!tag) {
    console.log(`Ready. Commit the release files, then: node scripts/release.mjs ${version} --tag`);
    return;
  }
  if (git(['status', '--porcelain', '--untracked-files=no', '--', 'admin-dist'])) {
    throw new Error('admin-dist changed after build:admin. Commit the rebuilt admin-dist, then tag.');
  }
  git(['tag', '-a', tagName, '-m', `client-cms ${version}`]);
  console.log(`Tagged ${tagName} at ${git(['rev-parse', '--short', 'HEAD'])}. Not pushed: git push origin ${tagName}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error?.message || error);
    process.exit(1);
  }
}
