import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import express from 'express';
import createCmsRoutes from '../server/routes.js';
import { createLoginLimiter } from '../server/auth-hardening.js';

function clearAuthEnv() {
  for (const key of ['CMS_ADMIN_SECRET', 'ADMIN_SECRET', 'CMS_ADMIN_PASSWORD', 'ADMIN_PASSWORD', 'CMS_ADMIN_USERNAME', 'ADMIN_USERNAME', 'CMS_TRUSTED_PROXY_HOPS']) {
    delete process.env[key];
  }
}

function tempRoot() {
  return mkdtempSync(path.join(tmpdir(), 'asoldi-cms-sign-in-'));
}

function siteWithAdmin(username, password, cost = 4) {
  const root = tempRoot();
  mkdirSync(path.join(root, 'cms'), { recursive: true });
  writeFileSync(path.join(root, 'cms', 'admin.json'), JSON.stringify({ username, passwordHash: bcrypt.hashSync(password, cost) }));
  return root;
}

async function withCms(options, fn) {
  const app = express();
  app.use(express.json());
  app.use('/api/cms', createCmsRoutes({ hubUrl: '', siteKey: 'sign-in-test', ...options }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    await fn(`http://127.0.0.1:${server.address().port}/api/cms`);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

async function login(base, username, password, headers = {}) {
  const res = await fetch(`${base}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ username, password }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function send(base, method, route, token, payload) {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const WEAK_MESSAGE = /^(Passordet må ha minst 8 tegn\.|Dette passordet er for enkelt å gjette\. Velg et annet passord\.)$/;

test('new passwords need 8+ characters and may not be a known default (change-password)', async () => {
  clearAuthEnv();
  process.env.CMS_ADMIN_PASSWORD = 'policy-test-password';
  const root = tempRoot();
  try {
    await withCms({ dataPath: root }, async (base) => {
      const admin = (await login(base, 'admin', 'policy-test-password')).body.token;
      for (const weak of ['password', 'changeme', 'change-me', 'Password', ' changeme ', 'admin', 'kort']) {
        const res = await send(base, 'POST', '/admin/change-password', admin, { currentPassword: 'policy-test-password', newPassword: weak });
        assert.equal(res.status, 400, weak);
        assert.match(res.body.message, WEAK_MESSAGE, weak);
      }
      assert.equal((await login(base, 'admin', 'policy-test-password')).status, 200, 'a refused change keeps the password');
      const ok = await send(base, 'POST', '/admin/change-password', admin, { currentPassword: 'policy-test-password', newPassword: 'the-clients-new-password' });
      assert.equal(ok.status, 200);
      assert.equal((await login(base, 'admin', 'the-clients-new-password')).status, 200);
    });
  } finally {
    clearAuthEnv();
    rmSync(root, { recursive: true, force: true });
  }
});

test('new passwords need 8+ characters and may not be a known default (create and update users)', async () => {
  clearAuthEnv();
  process.env.CMS_ADMIN_PASSWORD = 'policy-test-password';
  const root = tempRoot();
  try {
    await withCms({ dataPath: root }, async (base) => {
      const admin = (await login(base, 'admin', 'policy-test-password')).body.token;
      for (const weak of ['password', 'changeme', 'emppass']) {
        const res = await send(base, 'POST', '/admin/users', admin, { username: `staff-${weak}`, password: weak, rank: 'employee' });
        assert.equal(res.status, 400, weak);
        assert.match(res.body.message, WEAK_MESSAGE, weak);
      }
      assert.deepEqual((await send(base, 'GET', '/admin/users', admin)).body, [], 'no user is created with a weak password');

      const created = await send(base, 'POST', '/admin/users', admin, { username: 'staff-1', password: 'staff-own-password', rank: 'employee' });
      assert.equal(created.status, 201);
      const id = created.body.id;
      for (const weak of ['password', 'short', 12345678]) {
        const res = await send(base, 'PUT', `/admin/users/${id}`, admin, { password: weak });
        assert.equal(res.status, 400, String(weak));
        assert.match(res.body.message, WEAK_MESSAGE, String(weak));
      }
      assert.equal((await login(base, 'staff-1', 'staff-own-password')).status, 200, 'refused updates keep the password');
      assert.equal((await send(base, 'PUT', `/admin/users/${id}`, admin, { name: 'Staff One', password: '' })).status, 200, 'edits without a new password still work');
      assert.equal((await send(base, 'PUT', `/admin/users/${id}`, admin, { password: 'staff-next-password' })).status, 200);

      const staff = (await login(base, 'staff-1', 'staff-next-password')).body.token;
      assert.ok(staff);
      const weakOwn = await send(base, 'POST', '/admin/change-password', staff, { currentPassword: 'staff-next-password', newPassword: 'changeme' });
      assert.equal(weakOwn.status, 400);
      assert.equal((await send(base, 'POST', '/admin/change-password', staff, { currentPassword: 'staff-next-password', newPassword: 'staff-third-password' })).status, 200);
      assert.equal((await login(base, 'staff-1', 'staff-third-password')).status, 200);
    });
  } finally {
    clearAuthEnv();
    rmSync(root, { recursive: true, force: true });
  }
});

test('a restart replaces only the default passwords releases shipped; a password the client chose is kept', async () => {
  clearAuthEnv();
  const roots = [];
  try {
    for (const shipped of ['changeme', 'change-me']) {
      const root = siteWithAdmin('admin', shipped);
      roots.push(root);
      await withCms({ dataPath: root }, async (base) => {
        assert.equal((await login(base, 'admin', shipped)).status, 401, shipped);
      });
      const initial = JSON.parse(readFileSync(path.join(root, 'cms', 'private', 'initial-admin.json'), 'utf8'));
      assert.equal(initial.reason, 'default-password-replaced', shipped);
    }
    // Chosen with an earlier release, before new passwords were checked: it keeps working across starts.
    const chosen = siteWithAdmin('admin', 'password');
    roots.push(chosen);
    for (let start = 1; start <= 2; start += 1) {
      await withCms({ dataPath: chosen }, async (base) => {
        assert.equal((await login(base, 'admin', 'password')).status, 200, `start ${start}`);
      });
    }
    assert.equal(existsSync(path.join(chosen, 'cms', 'private', 'initial-admin.json')), false);
  } finally {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  }
});

test('the per-IP limit uses the X-Forwarded-For hop the proxy appended, not the first one', async () => {
  clearAuthEnv();
  process.env.CMS_ADMIN_PASSWORD = 'forwarded-test-password';
  const root = tempRoot();
  try {
    await withCms({ dataPath: root, loginLimiter: createLoginLimiter({ maxPerAccount: 100, maxPerIp: 5 }) }, async (base) => {
      const statuses = [];
      for (let i = 0; i < 8; i += 1) {
        // The client writes any first hop it likes; the local proxy appends the address it saw.
        statuses.push((await login(base, `nobody-${i}`, 'x', { 'X-Forwarded-For': `198.51.100.${i}, 203.0.113.50` })).status);
      }
      assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429, 429, 429]);
      assert.equal((await login(base, 'nobody-9', 'x', { 'X-Forwarded-For': '198.51.100.1, 203.0.113.51' })).status, 401, 'another client is not affected');
    });
  } finally {
    clearAuthEnv();
    rmSync(root, { recursive: true, force: true });
  }
});

test('parallel wrong passwords cannot pass the account limit together', async () => {
  clearAuthEnv();
  const root = siteWithAdmin('owner', 'burst-test-password', 10);
  try {
    await withCms({ dataPath: root }, async (base) => {
      const results = await Promise.all(
        Array.from({ length: 30 }, (_, i) => login(base, 'owner', `burst-${i}`, { 'X-Forwarded-For': `203.0.113.${i + 1}` }))
      );
      const counts = {};
      for (const { status } of results) counts[status] = (counts[status] || 0) + 1;
      assert.deepEqual(counts, { 401: 10, 429: 20 }, 'only 10 attempts reach the password check');
      assert.equal((await login(base, 'owner', 'burst-test-password', { 'X-Forwarded-For': '198.51.100.77' })).status, 429, 'the account stays locked');
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('failed sign-ins for unknown usernames from many addresses never unlock a real account', async () => {
  clearAuthEnv();
  const root = siteWithAdmin('owner', 'spray-test-password');
  try {
    await withCms({ dataPath: root, loginLimiter: createLoginLimiter({ maxKeys: 20 }) }, async (base) => {
      for (let i = 0; i < 10; i += 1) {
        assert.equal((await login(base, 'owner', `wrong-${i}`, { 'X-Forwarded-For': `203.0.113.${i + 1}` })).status, 401);
      }
      assert.equal((await login(base, 'owner', 'spray-test-password', { 'X-Forwarded-For': '198.51.100.200' })).status, 429);
      for (let n = 0; n < 60; n += 1) {
        assert.equal((await login(base, `spray-${n}`, 'x', { 'X-Forwarded-For': `192.0.2.${n + 1}` })).status, 401);
      }
      assert.equal((await login(base, 'owner', 'spray-test-password', { 'X-Forwarded-For': '198.51.100.201' })).status, 429, 'still locked');
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
