import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { bearer, bootCms, fakeHub, postJson, waitFor } from './_cms-boot.js';
import { initialAdminPath, readInitialAdminFile } from '../server/secret.js';

for (const name of ['CMS_ADMIN_USERNAME', 'ADMIN_USERNAME', 'CMS_ADMIN_PASSWORD', 'ADMIN_PASSWORD', 'CMS_ADMIN_SECRET', 'ADMIN_SECRET']) delete process.env[name];

function tempData() {
  return mkdtempSync(path.join(tmpdir(), 'asoldi-admin-'));
}

async function withEnv(vars, fn) {
  const before = {};
  for (const [k, v] of Object.entries(vars)) {
    before[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function captureConsole() {
  const lines = [];
  const original = { warn: console.warn, log: console.log, error: console.error };
  for (const level of Object.keys(original)) console[level] = (...args) => lines.push(args.join(' '));
  return { lines, restore: () => Object.assign(console, original) };
}

const login = (base, username, password) => postJson(`${base}/admin/login`, { username, password });

test('a new site gets a generated admin password in the private data folder, not a built-in one', async () => {
  const root = tempData();
  const out = captureConsole();
  let cms;
  try {
    cms = await bootCms({ dataPath: root });
    const initial = await waitFor(() => readInitialAdminFile(root));
    out.restore();
    assert.equal(initial.username, 'admin');
    assert.equal(initial.password.length, 24);
    assert.equal(initial.reason, 'first-start');
    assert.equal(path.dirname(initialAdminPath(root)), path.join(root, 'cms', 'private', 'secrets'));
    assert.equal((await login(cms.base, 'admin', 'changeme')).status, 401, 'no built-in password');
    assert.equal((await login(cms.base, 'admin', initial.password)).status, 200);
    assert.ok(out.lines.some((line) => line.includes(initialAdminPath(root))), 'the log names the file');
    assert.equal(out.lines.some((line) => line.includes(initial.password)), false, 'the log never shows the password');
  } finally {
    out.restore();
    await cms?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('a placeholder env password is ignored; a real one is used without a file', async () => {
  const weakRoot = tempData();
  const strongRoot = tempData();
  try {
    await withEnv({ CMS_ADMIN_PASSWORD: 'changeme' }, async () => {
      const cms = await bootCms({ dataPath: weakRoot });
      try {
        const initial = await waitFor(() => readInitialAdminFile(weakRoot));
        assert.notEqual(initial.password, 'changeme');
        assert.equal((await login(cms.base, 'admin', 'changeme')).status, 401);
      } finally {
        await cms.close();
      }
    });
    await withEnv({ CMS_ADMIN_USERNAME: 'owner', CMS_ADMIN_PASSWORD: 'owner-pass-77' }, async () => {
      const cms = await bootCms({ dataPath: strongRoot });
      try {
        const res = await waitFor(async () => {
          const r = await login(cms.base, 'owner', 'owner-pass-77');
          return r.status === 200 ? r : null;
        });
        assert.equal(res.status, 200);
        assert.equal(existsSync(initialAdminPath(strongRoot)), false);
      } finally {
        await cms.close();
      }
    });
  } finally {
    rmSync(weakRoot, { recursive: true, force: true });
    rmSync(strongRoot, { recursive: true, force: true });
  }
});

test('an existing admin still on the old built-in password gets a generated one at start', async () => {
  const root = tempData();
  mkdirSync(path.join(root, 'cms'), { recursive: true });
  writeFileSync(path.join(root, 'cms', 'admin.json'), JSON.stringify({ username: 'admin', passwordHash: bcrypt.hashSync('changeme', 4) }));
  const cms = await bootCms({ dataPath: root });
  try {
    const initial = await waitFor(() => readInitialAdminFile(root));
    assert.equal(initial.reason, 'replaced-default-password');
    assert.equal((await login(cms.base, 'admin', 'changeme')).status, 401);
    assert.equal((await login(cms.base, 'admin', initial.password)).status, 200);
  } finally {
    await cms.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('an admin with their own password is left alone', async () => {
  const root = tempData();
  mkdirSync(path.join(root, 'cms'), { recursive: true });
  writeFileSync(path.join(root, 'cms', 'admin.json'), JSON.stringify({ username: 'kari', passwordHash: bcrypt.hashSync('kari-sin-kode-1', 4) }));
  const cms = await bootCms({ dataPath: root });
  try {
    assert.equal((await waitFor(async () => {
      const r = await login(cms.base, 'kari', 'kari-sin-kode-1');
      return r.status === 200 ? r : null;
    })).status, 200);
    assert.equal(existsSync(initialAdminPath(root)), false);
  } finally {
    await cms.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('changing the password removes the one-time login file', async () => {
  const root = tempData();
  const cms = await bootCms({ dataPath: root });
  try {
    const initial = await waitFor(() => readInitialAdminFile(root));
    const token = (await login(cms.base, 'admin', initial.password)).data.token;
    const changed = await postJson(`${cms.base}/admin/change-password`, { currentPassword: initial.password, newPassword: 'my-own-pass-9' }, bearer(token));
    assert.equal(changed.status, 200);
    assert.equal(existsSync(initialAdminPath(root)), false);
    assert.equal((await login(cms.base, 'admin', 'my-own-pass-9')).status, 200);
  } finally {
    await cms.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('recovery: the hub client admin replaces the generated login and clears the file', async () => {
  const siteKey = 'recovery-site';
  const hub = await fakeHub({ siteKey, config: { name: 'Butikk', features: { users: true } } });
  const root = tempData();
  const cms = await bootCms({ dataPath: root, hubUrl: hub.url, siteKey });
  try {
    await waitFor(() => readInitialAdminFile(root));
    hub.state.config.pendingAdmin = { username: 'eier', passwordHash: bcrypt.hashSync('eier-kode-123', 4) };
    await fetch(`${cms.base}/config`);
    assert.equal((await login(cms.base, 'eier', 'eier-kode-123')).status, 200);
    assert.equal(existsSync(initialAdminPath(root)), false);
    const beat = await waitFor(() => hub.state.heartbeats.at(-1));
    assert.equal(beat.initialAdminPending, false);
  } finally {
    await cms.close();
    await hub.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('recovery: an Asoldi SSO session can create a new admin-rank login for the client', async () => {
  const siteKey = 'sso-recovery-site';
  const root = tempData();
  const cms = await bootCms({ dataPath: root, siteKey });
  try {
    await waitFor(() => readInitialAdminFile(root));
    const data = JSON.stringify({ sid: '1', n: randomBytes(16).toString('hex'), exp: Date.now() + 60_000, by: 'support@asoldi.com' });
    const link = Buffer.from(JSON.stringify({ data, sig: createHmac('sha256', siteKey).update(data).digest('hex') })).toString('base64url');
    const html = await fetch(`${cms.base}/admin/sso?token=${link}`).then((r) => r.text());
    const token = JSON.parse(html.match(/setItem\('adminToken',("[^"]+")\)/)[1]);
    const created = await postJson(`${cms.base}/admin/users`, { username: 'kunde', password: 'kunde-kode-55', rank: 'admin' }, bearer(token));
    assert.equal(created.status, 201);
    const res = await login(cms.base, 'kunde', 'kunde-kode-55');
    assert.equal(res.status, 200);
    assert.equal(res.data.rank, 'admin');
  } finally {
    await cms.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('the one-time login file is private JSON next to the secret', async () => {
  const root = tempData();
  const cms = await bootCms({ dataPath: root });
  try {
    await waitFor(() => readInitialAdminFile(root));
    const raw = JSON.parse(readFileSync(initialAdminPath(root), 'utf8'));
    assert.deepEqual(Object.keys(raw).sort(), ['createdAt', 'note', 'password', 'reason', 'username']);
    assert.ok(existsSync(path.join(root, 'cms', 'private', 'secrets', 'secrets.json')));
  } finally {
    await cms.close();
    rmSync(root, { recursive: true, force: true });
  }
});
