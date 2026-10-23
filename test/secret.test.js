import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isUsableEnvSecret, resolveCmsSecrets } from '../server/secret.js';

const SECRET_MODULE = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'secret.js')).href;
const quiet = { warn() {} };

function tempRoot() {
  return mkdtempSync(path.join(tmpdir(), 'asoldi-cms-secret-'));
}

test('without env, a secret is generated once on disk and reused', () => {
  const root = tempRoot();
  try {
    const first = resolveCmsSecrets({ dataPath: root, env: {}, log: quiet });
    assert.equal(first.source, 'disk');
    assert.match(first.adminSecret, /^[A-Za-z0-9_-]{43}$/);
    const file = path.join(root, 'cms', 'private', 'secrets.json');
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(saved.version, 1);
    assert.equal(saved.adminSecret, first.adminSecret);
    assert.ok(!Number.isNaN(Date.parse(saved.createdAt)));
    if (process.platform !== 'win32') {
      assert.equal(statSync(file).mode & 0o777, 0o600);
      assert.equal(statSync(path.dirname(file)).mode & 0o777, 0o700);
    }
    const second = resolveCmsSecrets({ dataPath: root, env: {}, log: quiet });
    assert.equal(second.adminSecret, first.adminSecret);
    // No temp files are left behind.
    assert.deepEqual(readdirSync(path.dirname(file)), ['secrets.json']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a strong env secret is honoured and nothing is written to disk', () => {
  const root = tempRoot();
  try {
    const result = resolveCmsSecrets({ dataPath: root, env: { CMS_ADMIN_SECRET: 'a-long-enough-env-secret-value' }, log: quiet });
    assert.equal(result.source, 'env');
    assert.equal(result.adminSecret, 'a-long-enough-env-secret-value');
    assert.equal(existsSync(path.join(root, 'cms', 'private', 'secrets.json')), false);
    const fallback = resolveCmsSecrets({ dataPath: root, env: { ADMIN_SECRET: 'another-long-env-secret-value' }, log: quiet });
    assert.equal(fallback.source, 'env');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('placeholder or short env secrets are ignored with a warning', () => {
  const root = tempRoot();
  try {
    for (const weak of ['change-me', 'changeme', 'CHANGE-ME-IN-PRODUCTION', 'short-secret']) {
      const warnings = [];
      const result = resolveCmsSecrets({ dataPath: root, env: { CMS_ADMIN_SECRET: weak }, log: { warn: (m) => warnings.push(m) } });
      assert.equal(result.source, 'disk', weak);
      assert.notEqual(result.adminSecret, weak);
      assert.equal(warnings.length, 1);
    }
    assert.equal(isUsableEnvSecret('change-me-in-production'), false);
    assert.equal(isUsableEnvSecret('0123456789abcdef'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an unreadable secrets file is moved aside and replaced', () => {
  const root = tempRoot();
  try {
    const dir = path.join(root, 'cms', 'private');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'secrets.json'), '{ not json');
    const result = resolveCmsSecrets({ dataPath: root, env: {}, log: quiet });
    assert.match(result.adminSecret, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(readdirSync(dir).some((name) => name.startsWith('secrets.json.invalid-')));
    assert.equal(resolveCmsSecrets({ dataPath: root, env: {}, log: quiet }).adminSecret, result.adminSecret);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function runResolver(root) {
  const code = `
    import { createHash } from 'node:crypto';
    const { resolveCmsSecrets } = await import(${JSON.stringify(SECRET_MODULE)});
    const { adminSecret } = resolveCmsSecrets({ dataPath: ${JSON.stringify(root)}, env: {}, log: { warn() {} } });
    process.stdout.write(createHash('sha256').update(adminSecret).digest('hex'));
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (status) => (status === 0 ? resolve(out.trim()) : reject(new Error(err || `exit ${status}`))));
  });
}

test('processes starting at the same time end up with one secret', async () => {
  const root = tempRoot();
  try {
    const hashes = await Promise.all(Array.from({ length: 6 }, () => runResolver(root)));
    assert.equal(new Set(hashes).size, 1, 'every process must see the same secret');
    const dir = path.join(root, 'cms', 'private');
    assert.deepEqual(readdirSync(dir), ['secrets.json']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
