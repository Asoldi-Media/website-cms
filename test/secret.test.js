import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  cmsPrivateDir,
  initialAdminCredentials,
  isStrongSecret,
  isUsableAdminPassword,
  KNOWN_DEFAULT_SECRETS,
  readOrCreateDiskSecrets,
  resolveCmsSecrets,
} from '../server/secret.js';

const SECRET_MODULE = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'secret.js')).href;

function tempData() {
  return mkdtempSync(path.join(tmpdir(), 'asoldi-secret-'));
}

test('without env the secret is generated once in the private data folder and reused', () => {
  const root = tempData();
  try {
    const first = resolveCmsSecrets({ dataPath: root, env: {} });
    assert.equal(first.source, 'disk');
    assert.equal(first.warning, '');
    assert.ok(first.adminSecret.length >= 43, 'at least 32 random bytes');
    const file = path.join(cmsPrivateDir(root), 'secrets.json');
    const stored = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(stored.version, 1);
    assert.equal(stored.adminSecret, first.adminSecret);
    assert.ok(Date.parse(stored.createdAt));
    const second = resolveCmsSecrets({ dataPath: root, env: {} });
    assert.equal(second.adminSecret, first.adminSecret, 'a restart reuses the secret');
    assert.equal(second.createdAt, stored.createdAt);
    assert.deepEqual(readdirSync(cmsPrivateDir(root)).sort(), ['secrets.json'], 'no temp files left behind');
    if (process.platform !== 'win32') {
      assert.equal(statSync(file).mode & 0o777, 0o600);
      assert.equal(statSync(cmsPrivateDir(root)).mode & 0o777, 0o700);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a strong env secret is used; a short or placeholder one is refused with a warning', () => {
  const root = tempData();
  try {
    const strong = 'x'.repeat(24);
    const fromEnv = resolveCmsSecrets({ dataPath: root, env: { CMS_ADMIN_SECRET: strong } });
    assert.equal(fromEnv.source, 'env');
    assert.equal(fromEnv.adminSecret, strong);
    assert.equal(resolveCmsSecrets({ dataPath: root, env: { ADMIN_SECRET: strong } }).source, 'env', 'ADMIN_SECRET is the second env name');
    assert.equal(existsSync(path.join(cmsPrivateDir(root), 'secrets.json')), false, 'env secret writes nothing to disk');
    for (const value of [...KNOWN_DEFAULT_SECRETS, 'short-1234']) {
      const resolved = resolveCmsSecrets({ dataPath: root, env: { CMS_ADMIN_SECRET: value } });
      assert.equal(resolved.source, 'disk', value);
      assert.notEqual(resolved.adminSecret, value);
      assert.match(resolved.warning, /CMS_ADMIN_SECRET/);
    }
    const marked = resolveCmsSecrets({ dataPath: root, env: { CMS_ADMIN_SECRET: 'zq-marker-7' } });
    assert.equal(marked.warning.includes('zq-marker-7'), false, 'the warning never repeats the value');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an explicit adminSecret option wins unless it is a placeholder', () => {
  const root = tempData();
  try {
    assert.deepEqual(resolveCmsSecrets({ dataPath: root, env: {}, explicit: 'test-secret' }).source, 'explicit');
    const placeholder = resolveCmsSecrets({ dataPath: root, env: {}, explicit: 'change-me' });
    assert.equal(placeholder.source, 'disk');
    assert.match(placeholder.warning, /placeholder/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('concurrent first starts agree on one secret', async () => {
  const root = tempData();
  try {
    const script = `import(${JSON.stringify(SECRET_MODULE)}).then((m) => { process.stdout.write(m.readOrCreateDiskSecrets(process.argv[1]).adminSecret); });`;
    const runs = Array.from({ length: 8 }, () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', script, root], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(err))));
    }));
    const secrets = await Promise.all(runs);
    assert.equal(new Set(secrets).size, 1, 'every process got the same secret');
    assert.equal(JSON.parse(readFileSync(path.join(cmsPrivateDir(root), 'secrets.json'), 'utf8')).adminSecret, secrets[0]);
    assert.deepEqual(readdirSync(cmsPrivateDir(root)), ['secrets.json']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a damaged secrets file is set aside and replaced', () => {
  const root = tempData();
  try {
    mkdirSync(cmsPrivateDir(root), { recursive: true });
    writeFileSync(path.join(cmsPrivateDir(root), 'secrets.json'), '{"adminSecret":"');
    const result = readOrCreateDiskSecrets(root);
    assert.ok(result.adminSecret.length >= 43);
    assert.ok(readdirSync(cmsPrivateDir(root)).some((name) => name.startsWith('secrets.json.damaged-')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('secret and password strength rules', () => {
  assert.equal(isStrongSecret('a'.repeat(16)), true);
  assert.equal(isStrongSecret('a'.repeat(15)), false);
  assert.equal(isStrongSecret('change-me-in-production'), false);
  assert.equal(isUsableAdminPassword('changeme'), false);
  assert.equal(isUsableAdminPassword('Admin'), false);
  assert.equal(isUsableAdminPassword('short'), false);
  assert.equal(isUsableAdminPassword('a-real-pass'), true);
  const generated = initialAdminCredentials({ CMS_ADMIN_PASSWORD: 'changeme' });
  assert.equal(generated.generated, true);
  assert.notEqual(generated.password, 'changeme');
  assert.equal(generated.password.length, 24);
  assert.deepEqual(initialAdminCredentials({ CMS_ADMIN_USERNAME: 'owner', CMS_ADMIN_PASSWORD: 'a-real-pass' }), { username: 'owner', password: 'a-real-pass', generated: false });
});
