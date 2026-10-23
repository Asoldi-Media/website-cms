import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bearer, bootCms, postJson, tokenSignedWith } from './_cms-boot.js';
import { cmsPrivateDir, cmsSecretsDir, isSignInFileName, readInitialAdminFile, resolveCmsSecrets } from '../server/secret.js';
import { createStore } from '../server/store.js';
import { hashToken } from '../server/shop/index.js';

for (const name of ['CMS_ADMIN_PASSWORD', 'ADMIN_PASSWORD', 'CMS_ADMIN_SECRET', 'ADMIN_SECRET']) delete process.env[name];
process.env.CMS_DEV_ECOMMERCE = '1';

const LEGACY_PASSWORD = 'legacy-first-admin-pw-17';
const SHOP_FILE = 'lp0abc-1a2b3c4d5e6f.pdf';

/** A data folder as CMS 1.7.x left it: secret and first admin login directly in cms/private. */
function legacySite({ secret = randomBytes(32).toString('base64url') } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'asoldi-legacy-signin-'));
  const dir = cmsPrivateDir(root);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'secrets.json'), `${JSON.stringify({ version: 1, adminSecret: secret, createdAt: '2026-10-20T10:00:00.000Z' }, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(path.join(dir, 'initial-admin.json'), `${JSON.stringify({ username: 'admin', password: LEGACY_PASSWORD, reason: 'first-start', createdAt: '2026-10-20T10:00:00.000Z' }, null, 2)}\n`, { mode: 0o600 });
  return { root, secret };
}

const signInFilesIn = (dir) => readdirSync(dir).filter(isSignInFileName).sort();

test('a site upgraded from 1.7 keeps its secret and first admin login, and both leave the shop files folder', () => {
  const { root, secret } = legacySite();
  try {
    writeFileSync(path.join(cmsPrivateDir(root), 'secrets.json.invalid-1700000000000'), '{"adminSecret":');
    writeFileSync(path.join(cmsPrivateDir(root), SHOP_FILE), '%PDF-1.4 test');

    const first = resolveCmsSecrets({ dataPath: root, env: {} });
    assert.equal(first.source, 'disk');
    assert.equal(first.adminSecret, secret, 'the 1.7 secret is reused, so its sessions stay valid');
    assert.equal(first.warning, '');
    assert.deepEqual([...first.adopted].sort(), ['initial-admin.json', 'secrets.json', 'secrets.json.invalid-1700000000000']);
    assert.deepEqual(readdirSync(cmsPrivateDir(root)).sort(), [SHOP_FILE, 'secrets'], 'only shop files and the secrets folder stay in cms/private');
    assert.deepEqual(signInFilesIn(cmsSecretsDir(root)), ['initial-admin.json', 'secrets.json', 'secrets.json.invalid-1700000000000']);
    assert.equal(readInitialAdminFile(root)?.password, LEGACY_PASSWORD, 'the first admin login is where this version looks for it');
    if (process.platform !== 'win32') assert.equal(statSync(path.join(cmsSecretsDir(root), 'secrets.json')).mode & 0o777, 0o600);

    const again = resolveCmsSecrets({ dataPath: root, env: {} });
    assert.equal(again.adminSecret, secret);
    assert.deepEqual(again.adopted, [], 'a later start has nothing to move');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a secret already in the secrets folder wins; a different 1.7 copy is kept beside it, an identical one is dropped', () => {
  const { root, secret: legacySecret } = legacySite();
  try {
    const current = randomBytes(32).toString('base64url');
    mkdirSync(cmsSecretsDir(root), { recursive: true });
    writeFileSync(path.join(cmsSecretsDir(root), 'secrets.json'), JSON.stringify({ version: 1, adminSecret: current, createdAt: '2026-10-22T10:00:00.000Z' }));
    const resolved = resolveCmsSecrets({ dataPath: root, env: {} });
    assert.equal(resolved.adminSecret, current);
    assert.deepEqual(signInFilesIn(cmsPrivateDir(root)), [], 'no sign-in file is left in cms/private');
    const kept = readdirSync(cmsSecretsDir(root)).filter((name) => name.startsWith('secrets.json.legacy-'));
    assert.equal(kept.length, 1);
    assert.equal(JSON.parse(readFileSync(path.join(cmsSecretsDir(root), kept[0]), 'utf8')).adminSecret, legacySecret, 'the older copy is kept for inspection');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  const same = legacySite();
  try {
    mkdirSync(cmsSecretsDir(same.root), { recursive: true });
    for (const name of ['secrets.json', 'initial-admin.json']) {
      writeFileSync(path.join(cmsSecretsDir(same.root), name), readFileSync(path.join(cmsPrivateDir(same.root), name)));
    }
    assert.equal(resolveCmsSecrets({ dataPath: same.root, env: {} }).adminSecret, same.secret);
    assert.deepEqual(signInFilesIn(cmsPrivateDir(same.root)), []);
    assert.deepEqual(signInFilesIn(cmsSecretsDir(same.root)), ['initial-admin.json', 'secrets.json'], 'identical copies are not duplicated');
  } finally {
    rmSync(same.root, { recursive: true, force: true });
  }
});

test('the files move whichever secret source wins', () => {
  for (const options of [{ env: { CMS_ADMIN_SECRET: 'x'.repeat(24) } }, { env: {}, explicit: 'explicit-test-secret' }]) {
    const { root } = legacySite();
    try {
      const resolved = resolveCmsSecrets({ dataPath: root, ...options });
      assert.notEqual(resolved.source, 'disk');
      assert.deepEqual([...resolved.adopted].sort(), ['initial-admin.json', 'secrets.json']);
      assert.deepEqual(signInFilesIn(cmsPrivateDir(root)), []);
      assert.equal(readInitialAdminFile(root)?.password, LEGACY_PASSWORD);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('a sign-in file that cannot be moved is reported in the warning, never thrown', () => {
  const { root } = legacySite();
  try {
    // A plain file where the secrets folder belongs makes the move impossible.
    writeFileSync(cmsSecretsDir(root), 'not a folder');
    const resolved = resolveCmsSecrets({ dataPath: root, env: { CMS_ADMIN_SECRET: 'y'.repeat(24) } });
    assert.equal(resolved.source, 'env');
    assert.deepEqual(resolved.adopted, []);
    assert.match(resolved.warning, /Could not move 2 sign-in file\(s\)/);
    assert.equal(resolved.warning.includes(LEGACY_PASSWORD), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sign-in file names never match a shop upload name', () => {
  for (const name of ['secrets.json', 'initial-admin.json', 'secrets.json.invalid-1700000000000', 'secrets.json.1234.abcdef.tmp', 'initial-admin.json.99.tmp']) {
    assert.equal(isSignInFileName(name), true, name);
  }
  for (const name of [SHOP_FILE, 'manual.pdf', 'my-secrets.json', 'secrets.jsonl', 'secrets', 'initial-admin.pdf', '', undefined]) {
    assert.equal(isSignInFileName(name), false, String(name));
  }
});

test('HTTP: after the upgrade a 1.7 session stays valid and the shop file routes skip sign-in file names', async () => {
  const { root, secret } = legacySite();
  await createStore(root).setAdminCredentials('admin', LEGACY_PASSWORD);
  const cms = await bootCms({ dataPath: root });
  try {
    const now = Date.now();
    const legacyToken = tokenSignedWith(secret, { role: 'admin', username: 'admin', rank: 'admin', at: now, exp: now + 86_400_000 });
    assert.equal((await fetch(`${cms.base}/admin/me`, { headers: bearer(legacyToken) })).status, 200, 'a session signed before the upgrade is still valid');
    const login = await postJson(`${cms.base}/admin/login`, { username: 'admin', password: LEGACY_PASSWORD });
    assert.equal(login.status, 200, 'the 1.7 first admin password still signs in');
    const token = login.data.token;
    assert.deepEqual(signInFilesIn(cmsPrivateDir(root)), [], 'the boot moved the sign-in files');

    // Even a sign-in file that lands in cms/private later is neither listed nor served.
    writeFileSync(path.join(cmsPrivateDir(root), 'initial-admin.json'), JSON.stringify({ username: 'admin', password: LEGACY_PASSWORD }));
    writeFileSync(path.join(cmsPrivateDir(root), 'manual.pdf'), '%PDF-1.4 test');
    const files = await fetch(`${cms.base}/shop/admin/files`, { headers: bearer(token) }).then((r) => r.json());
    assert.deepEqual(files.map((f) => f.file), ['manual.pdf']);

    const product = await postJson(`${cms.base}/products`, {
      name: 'Bok',
      price: 99,
      productType: 'normal',
      kind: 'digital',
      digitalFiles: [{ id: 'signin', name: 'x', file: 'initial-admin.json' }, { id: 'ok', name: 'manual.pdf', file: 'manual.pdf' }],
    }, bearer(token));
    assert.equal(product.status, 201, JSON.stringify(product.data));
    const grants = ['signin', 'ok'].map((fileId) => ({ id: fileId, tokenHash: hashToken(`tok-${fileId}`), productId: product.data.id, fileId, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), downloadsLeft: 3 }));
    mkdirSync(path.join(root, 'cms', 'shop'), { recursive: true });
    writeFileSync(path.join(root, 'cms', 'shop', 'downloads.json'), JSON.stringify(grants));

    const blocked = await fetch(`${cms.base}/downloads/tok-signin`);
    assert.equal(blocked.status, 404);
    assert.equal((await blocked.text()).includes(LEGACY_PASSWORD), false);
    const ok = await fetch(`${cms.base}/downloads/tok-ok`);
    assert.equal(ok.status, 200, 'a real shop file still downloads');
    assert.equal(await ok.text(), '%PDF-1.4 test');
    assert.ok(existsSync(path.join(cmsSecretsDir(root), 'secrets.json')));
  } finally {
    await cms.close();
    rmSync(root, { recursive: true, force: true });
  }
});
