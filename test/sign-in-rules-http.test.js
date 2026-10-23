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

// A request the site never answers fails the test instead of hanging it.
const REQUEST_TIMEOUT_MS = 15000;

async function post(base, route, payload, headers = {}) {
  const res = await fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const login = (base, username, password, headers = {}) => post(base, '/admin/login', { username, password }, headers);

async function send(base, method, route, token, payload) {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/**
 * Holds every bcrypt password check until `count` are waiting (or `maxWaitMs` has passed), so parallel
 * sign-ins really overlap whatever the machine's speed. `reached()` is how many checks started.
 */
function holdPasswordChecks(count, maxWaitMs = 3000) {
  const original = bcrypt.compare;
  const waiting = [];
  let reached = 0;
  let timer = null;
  const release = () => {
    clearTimeout(timer);
    timer = null;
    for (const go of waiting.splice(0)) go();
  };
  bcrypt.compare = (...args) => {
    reached += 1;
    return new Promise((resolve) => {
      waiting.push(resolve);
      if (waiting.length >= count) release();
      else if (!timer) timer = setTimeout(release, maxWaitMs);
    }).then(() => original.apply(bcrypt, args));
  };
  return {
    reached: () => reached,
    restore() {
      release();
      bcrypt.compare = original;
    },
  };
}

const WEAK_MESSAGE = /^(Passordet må ha minst 8 tegn\.|Passordet kan ha høyst 1024 tegn\.|Dette passordet er for enkelt å gjette\. Velg et annet passord\.)$/;

test('new passwords need 8+ characters and may not be a known default (change-password)', async () => {
  clearAuthEnv();
  process.env.CMS_ADMIN_PASSWORD = 'policy-test-password';
  const root = tempRoot();
  try {
    await withCms({ dataPath: root }, async (base) => {
      const admin = (await login(base, 'admin', 'policy-test-password')).body.token;
      for (const weak of ['password', 'changeme', 'change-me', 'Password', ' changeme ', 'admin', 'kort', '        ', '       x', 'p'.repeat(1025)]) {
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
      for (const weak of ['password', 'changeme', 'emppass', '        ']) {
        const res = await send(base, 'POST', '/admin/users', admin, { username: `staff-${weak.trim() || 'blank'}`, password: weak, rank: 'employee' });
        assert.equal(res.status, 400, weak);
        assert.match(res.body.message, WEAK_MESSAGE, weak);
      }
      assert.deepEqual((await send(base, 'GET', '/admin/users', admin)).body, [], 'no user is created with a weak password');

      const created = await send(base, 'POST', '/admin/users', admin, { username: 'staff-1', password: 'staff-own-password', rank: 'employee' });
      assert.equal(created.status, 201);
      const id = created.body.id;
      for (const weak of ['password', 'short', 12345678, '         ']) {
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

/** Counts answers by status, e.g. { 401: 10, 429: 20 }. */
function countStatuses(results) {
  const counts = {};
  for (const { status } of results) counts[status] = (counts[status] || 0) + 1;
  return counts;
}

test('parallel wrong passwords cannot pass the limits together', async () => {
  clearAuthEnv();
  const root = siteWithAdmin('owner', 'burst-test-password');
  let gate = null;
  try {
    await withCms({ dataPath: root }, async (base) => {
      // One sign-in first, so start-up (which checks the stored hash too) is over before checks are held.
      assert.equal((await login(base, 'nobody', 'x')).status, 401);
      gate = holdPasswordChecks(30);
      const fromOne = { 'X-Forwarded-For': '203.0.113.1' };
      const results = await Promise.all(Array.from({ length: 30 }, (_, i) => login(base, 'owner', `burst-${i}`, fromOne)));
      assert.deepEqual(countStatuses(results), { 401: 10, 429: 20 }, 'only 10 attempts from one address reach the password check');
      assert.equal(gate.reached(), 10, 'only 10 password checks started');
      gate.restore();
      assert.equal((await login(base, 'owner', 'burst-test-password', fromOne)).status, 429, 'that address stays locked for the account');
      assert.equal((await login(base, 'owner', 'burst-test-password', { 'X-Forwarded-For': '198.51.100.77' })).status, 200, 'the owner elsewhere is not');
    });
    // The per-username ceiling holds the same way for parallel attempts from many addresses.
    await withCms({ dataPath: root, loginLimiter: createLoginLimiter({ maxPerAccount: 10 }) }, async (base) => {
      assert.equal((await login(base, 'nobody', 'x')).status, 401);
      gate = holdPasswordChecks(30);
      const results = await Promise.all(
        Array.from({ length: 30 }, (_, i) => login(base, 'owner', `burst-${i}`, { 'X-Forwarded-For': `203.0.113.${i + 1}` }))
      );
      assert.deepEqual(countStatuses(results), { 401: 10, 429: 20 }, 'only 10 attempts reach the password check');
      assert.equal(gate.reached(), 10, 'only 10 password checks started');
      gate.restore();
      assert.equal((await login(base, 'owner', 'burst-test-password', { 'X-Forwarded-For': '198.51.100.77' })).status, 429, 'the account stays locked');
    });
  } finally {
    gate?.restore();
    rmSync(root, { recursive: true, force: true });
  }
});

test('wrong passwords from other addresses do not lock the owner out of their own address', async () => {
  clearAuthEnv();
  const root = siteWithAdmin('admin', 'owner-real-password');
  try {
    await withCms({ dataPath: root }, async (base) => {
      // Ten wrong passwords, each from another client address (the hop the local proxy appended).
      for (let i = 0; i < 10; i += 1) {
        assert.equal((await login(base, 'admin', `guess-${i}`, { 'X-Forwarded-For': `198.51.100.${i + 1}` })).status, 401);
      }
      const owner = { 'X-Forwarded-For': '203.0.113.77' };
      assert.equal((await login(base, 'admin', 'owner-real-password', owner)).status, 200, 'the owner signs in from their own address');
      // Ten more from one address lock that address for the account, and only that address.
      const one = { 'X-Forwarded-For': '192.0.2.10' };
      for (let i = 0; i < 10; i += 1) assert.equal((await login(base, 'admin', `again-${i}`, one)).status, 401);
      assert.equal((await login(base, 'admin', 'owner-real-password', one)).status, 429);
      assert.equal((await login(base, 'admin', 'owner-real-password', owner)).status, 200, 'the owner is still not locked');
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('failed sign-ins for unknown usernames from many addresses never unlock a real account', async () => {
  clearAuthEnv();
  const root = siteWithAdmin('owner', 'spray-test-password');
  try {
    // Locked for one address (10 failures from it).
    await withCms({ dataPath: root, loginLimiter: createLoginLimiter({ maxKeys: 20 }) }, async (base) => {
      const one = { 'X-Forwarded-For': '203.0.113.1' };
      for (let i = 0; i < 10; i += 1) assert.equal((await login(base, 'owner', `wrong-${i}`, one)).status, 401);
      assert.equal((await login(base, 'owner', 'spray-test-password', one)).status, 429);
      for (let n = 0; n < 60; n += 1) {
        assert.equal((await login(base, `spray-${n}`, 'x', { 'X-Forwarded-For': `192.0.2.${n + 1}` })).status, 401);
      }
      assert.equal((await login(base, 'owner', 'spray-test-password', one)).status, 429, 'still locked');
    });
    // Locked everywhere (the per-username ceiling, small here for speed).
    await withCms({ dataPath: root, loginLimiter: createLoginLimiter({ maxKeys: 30, maxPerAccount: 10 }) }, async (base) => {
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

test('sign-in bodies that are not text, or too long, get 400 and the account limit still holds', async () => {
  clearAuthEnv();
  const root = siteWithAdmin('owner', 'typed-test-password');
  writeFileSync(
    path.join(root, 'cms', 'users.json'),
    JSON.stringify([{ id: 'u1', username: 'staff-1', passwordHash: bcrypt.hashSync('staff-typed-password', 4), rank: 'employee' }])
  );
  const odd = (username) => [
    { username, password: ['x'] },
    { username, password: {} },
    { username, password: 123 },
    { username, password: true },
    { username: [username], password: 'x' },
    { username: { $ne: 1 }, password: 'x' },
    { username: 'o'.repeat(201), password: 'x' },
    { username, password: 'p'.repeat(1025) },
  ];
  try {
    await withCms({ dataPath: root }, async (base) => {
      for (let i = 0; i < 9; i += 1) assert.equal((await login(base, 'owner', `wrong-${i}`)).status, 401);
      for (const body of odd('owner')) {
        assert.equal((await post(base, '/admin/login', body)).status, 400, JSON.stringify(body).slice(0, 60));
      }
      for (const body of odd('staff-1')) {
        assert.equal((await post(base, '/auth/login', body)).status, 400, JSON.stringify(body).slice(0, 60));
      }
      assert.equal((await login(base, 'owner', 'wrong-9')).status, 401, 'the 10th wrong password is still checked');
      assert.equal((await login(base, 'owner', 'typed-test-password')).status, 429, 'the 11th attempt is refused: the count held');
      assert.equal((await post(base, '/auth/login', { username: 'staff-1', password: 'staff-typed-password' })).status, 200, 'staff sign-in still works');
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('change-password refuses a current password that is not text and a new one that is too long', async () => {
  clearAuthEnv();
  const root = siteWithAdmin('owner', 'change-test-password');
  try {
    await withCms({ dataPath: root }, async (base) => {
      const token = (await login(base, 'owner', 'change-test-password')).body.token;
      assert.ok(token);
      for (const currentPassword of [['x'], { a: 1 }, 12345678, 'p'.repeat(1025)]) {
        const res = await send(base, 'POST', '/admin/change-password', token, { currentPassword, newPassword: 'a-new-owner-password' });
        assert.equal(res.status, 400, JSON.stringify(currentPassword).slice(0, 40));
      }
      const long = await send(base, 'POST', '/admin/change-password', token, { currentPassword: 'change-test-password', newPassword: 'p'.repeat(1025) });
      assert.equal(long.status, 400);
      assert.equal(long.body.message, 'Passordet kan ha høyst 1024 tegn.');
      assert.equal((await login(base, 'owner', 'change-test-password')).status, 200, 'the password is unchanged');
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a request that fails while saving answers 500 and the site keeps running', async () => {
  clearAuthEnv();
  const root = siteWithAdmin('owner', 'disk-test-password');
  const errors = [];
  const consoleError = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    await withCms({ dataPath: root }, async (base) => {
      const token = (await login(base, 'owner', 'disk-test-password')).body.token;
      // users.json is a folder, so saving a new user throws (like a full or read-only disk).
      mkdirSync(path.join(root, 'cms', 'users.json'));
      const res = await send(base, 'POST', '/admin/users', token, { username: 'staff-1', password: 'staff-own-password', rank: 'employee' });
      assert.equal(res.status, 500);
      assert.deepEqual(res.body, { message: 'Request failed' });
      assert.equal((await send(base, 'GET', '/admin/me', token)).status, 200, 'the site still answers');
      assert.equal((await login(base, 'owner', 'disk-test-password')).status, 200);
    });
    assert.ok(errors.some((line) => line.includes('POST /api/cms/admin/users failed')), errors.join('\n'));
  } finally {
    console.error = consoleError;
    rmSync(root, { recursive: true, force: true });
  }
});
