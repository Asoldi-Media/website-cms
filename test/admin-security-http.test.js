import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import express from 'express';
import createCmsRoutes from '../server/routes.js';
import { PUBLIC_CONFIG_KEYS, createLoginLimiter } from '../server/auth-hardening.js';

const DAY = 24 * 60 * 60 * 1000;

function clearAuthEnv() {
  for (const key of ['CMS_ADMIN_SECRET', 'ADMIN_SECRET', 'CMS_ADMIN_PASSWORD', 'ADMIN_PASSWORD', 'CMS_ADMIN_USERNAME', 'ADMIN_USERNAME']) {
    delete process.env[key];
  }
}

function tempRoot() {
  return mkdtempSync(path.join(tmpdir(), 'asoldi-cms-security-'));
}

async function listen(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

async function withCms(options, fn) {
  const app = express();
  app.use(express.json());
  app.use('/api/cms', createCmsRoutes({ hubUrl: '', siteKey: 'security-test', ...options }));
  const { server, base } = await listen(app);
  try {
    await fn(`${base}/api/cms`);
  } finally {
    await close(server);
  }
}

/** A token exactly as CMS 1.7.0 and earlier signed it with the old built-in secret. */
function legacyDefaultSecretToken(payload = { role: 'admin', username: 'admin', rank: 'admin', at: Date.now() }) {
  const data = JSON.stringify(payload);
  const sig = createHmac('sha256', 'change-me').update(data).digest('hex');
  return Buffer.from(JSON.stringify({ data, sig })).toString('base64url');
}

function tokenWithSecret(secret, payload) {
  const data = JSON.stringify(payload);
  const sig = createHmac('sha256', secret).update(data).digest('hex');
  return Buffer.from(JSON.stringify({ data, sig })).toString('base64url');
}

async function login(base, username, password, headers = {}) {
  const res = await fetch(`${base}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ username, password }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})), retryAfter: res.headers.get('retry-after') };
}

function readInitialAdmin(root) {
  return JSON.parse(readFileSync(path.join(root, 'cms', 'private', 'initial-admin.json'), 'utf8'));
}

test('a token signed with the 1.7.0 default secret is refused (no env secret set)', async () => {
  clearAuthEnv();
  const root = tempRoot();
  try {
    await withCms({ dataPath: root }, async (base) => {
      for (const route of ['/admin/me', '/admin/users', '/orders', '/payments', '/leads']) {
        const res = await fetch(`${base}${route}`, { headers: { Authorization: `Bearer ${legacyDefaultSecretToken()}` } });
        assert.equal(res.status, 401, route);
      }
      const withExp = legacyDefaultSecretToken({ role: 'admin', username: 'admin', rank: 'admin', at: Date.now(), exp: Date.now() + DAY });
      assert.equal((await fetch(`${base}/admin/me`, { headers: { Authorization: `Bearer ${withExp}` } })).status, 401);
    });
    assert.ok(existsSync(path.join(root, 'cms', 'private', 'secrets.json')), 'secret generated on disk');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a fresh site has no default admin login; the random first password works', async () => {
  clearAuthEnv();
  const root = tempRoot();
  try {
    await withCms({ dataPath: root }, async (base) => {
      for (const password of ['changeme', 'change-me', 'admin', 'password']) {
        assert.equal((await login(base, 'admin', password)).status, 401, password);
      }
      const initial = readInitialAdmin(root);
      assert.equal(initial.username, 'admin');
      assert.equal(initial.reason, 'first-boot');
      assert.match(initial.password, /^[A-Za-z0-9_-]{24}$/);
      const ok = await login(base, 'admin', initial.password);
      assert.equal(ok.status, 200);
      const me = await fetch(`${base}/admin/me`, { headers: { Authorization: `Bearer ${ok.body.token}` } });
      assert.equal(me.status, 200);
      assert.equal((await me.json()).rank, 'admin');
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a placeholder env password is ignored; a strong one is used and not written to disk', async () => {
  clearAuthEnv();
  const weakRoot = tempRoot();
  const strongRoot = tempRoot();
  try {
    process.env.CMS_ADMIN_PASSWORD = 'changeme';
    await withCms({ dataPath: weakRoot }, async (base) => {
      assert.equal((await login(base, 'admin', 'changeme')).status, 401);
      assert.equal((await login(base, 'admin', readInitialAdmin(weakRoot).password)).status, 200);
    });
    process.env.CMS_ADMIN_PASSWORD = 'a-strong-env-password';
    await withCms({ dataPath: strongRoot }, async (base) => {
      assert.equal((await login(base, 'admin', 'a-strong-env-password')).status, 200);
      assert.equal(existsSync(path.join(strongRoot, 'cms', 'private', 'initial-admin.json')), false);
    });
  } finally {
    clearAuthEnv();
    rmSync(weakRoot, { recursive: true, force: true });
    rmSync(strongRoot, { recursive: true, force: true });
  }
});

test('an existing admin still on the old default password gets a random one; a real password is kept', async () => {
  clearAuthEnv();
  const defaultRoot = tempRoot();
  const realRoot = tempRoot();
  try {
    // Data as CMS 1.7.0 left it on a site whose admin was never set from the hub.
    mkdirSync(path.join(defaultRoot, 'cms'), { recursive: true });
    writeFileSync(path.join(defaultRoot, 'cms', 'admin.json'), JSON.stringify({ username: 'admin', passwordHash: bcrypt.hashSync('changeme', 4) }));
    await withCms({ dataPath: defaultRoot }, async (base) => {
      assert.equal((await login(base, 'admin', 'changeme')).status, 401);
      const initial = readInitialAdmin(defaultRoot);
      assert.equal(initial.reason, 'default-password-replaced');
      assert.equal((await login(base, 'admin', initial.password)).status, 200);
    });

    mkdirSync(path.join(realRoot, 'cms'), { recursive: true });
    writeFileSync(path.join(realRoot, 'cms', 'admin.json'), JSON.stringify({ username: 'owner@example.test', passwordHash: bcrypt.hashSync('the-clients-own-password', 4) }));
    await withCms({ dataPath: realRoot }, async (base) => {
      assert.equal((await login(base, 'owner@example.test', 'the-clients-own-password')).status, 200);
      assert.equal(existsSync(path.join(realRoot, 'cms', 'private', 'initial-admin.json')), false);
    });
  } finally {
    rmSync(defaultRoot, { recursive: true, force: true });
    rmSync(realRoot, { recursive: true, force: true });
  }
});

test('tokens expire, survive a restart on the same data dir, and old secrets stop working', async () => {
  clearAuthEnv();
  process.env.CMS_ADMIN_PASSWORD = 'restart-test-password';
  const root = tempRoot();
  try {
    let token = '';
    await withCms({ dataPath: root }, async (base) => {
      const res = await login(base, 'admin', 'restart-test-password');
      assert.equal(res.status, 200);
      token = res.body.token;
      const payload = JSON.parse(JSON.parse(Buffer.from(token, 'base64url').toString()).data);
      assert.equal(payload.exp - payload.at, 7 * DAY);
    });
    await withCms({ dataPath: root }, async (base) => {
      assert.equal((await fetch(`${base}/admin/me`, { headers: { Authorization: `Bearer ${token}` } })).status, 200, 'same disk secret after restart');
      const secret = JSON.parse(readFileSync(path.join(root, 'cms', 'private', 'secrets.json'), 'utf8')).adminSecret;
      const expired = tokenWithSecret(secret, { role: 'admin', username: 'admin', rank: 'admin', at: Date.now() - 8 * DAY, exp: Date.now() - DAY });
      assert.equal((await fetch(`${base}/admin/me`, { headers: { Authorization: `Bearer ${expired}` } })).status, 401);
      const oldNoExp = tokenWithSecret(secret, { role: 'admin', username: 'admin', rank: 'admin', at: Date.now() - 8 * DAY });
      assert.equal((await fetch(`${base}/admin/me`, { headers: { Authorization: `Bearer ${oldNoExp}` } })).status, 401);
      const recentNoExp = tokenWithSecret(secret, { role: 'admin', username: 'admin', rank: 'admin', at: Date.now() - DAY });
      assert.equal((await fetch(`${base}/admin/me`, { headers: { Authorization: `Bearer ${recentNoExp}` } })).status, 200);
    });
  } finally {
    clearAuthEnv();
    rmSync(root, { recursive: true, force: true });
  }
});

test('failed logins are limited per account and per IP', async () => {
  clearAuthEnv();
  process.env.CMS_ADMIN_PASSWORD = 'limiter-test-password';
  const root = tempRoot();
  try {
    // Default limits: the 11th try on one account from one address in 15 minutes is refused.
    await withCms({ dataPath: root }, async (base) => {
      for (let i = 0; i < 10; i += 1) assert.equal((await login(base, 'nobody', `guess-${i}`)).status, 401);
      const blocked = await login(base, 'nobody', 'guess-10');
      assert.equal(blocked.status, 429);
      assert.ok(Number(blocked.retryAfter) > 0);
      const employee = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'NOBODY', password: 'x' }),
      });
      assert.equal(employee.status, 429, '/auth/login shares the account limit (case-insensitive)');
      assert.equal((await login(base, 'admin', 'limiter-test-password')).status, 200, 'other accounts unaffected');
    });

    // Small limits for speed: a locked account refuses even the right password; IPs are limited too.
    await withCms({ dataPath: root, loginLimiter: createLoginLimiter({ maxPerAccount: 3, maxPerIp: 5 }) }, async (base) => {
      for (let i = 0; i < 3; i += 1) assert.equal((await login(base, 'admin', `wrong-${i}`)).status, 401);
      assert.equal((await login(base, 'admin', 'limiter-test-password')).status, 429);
      const ip = { 'X-Forwarded-For': '203.0.113.9' };
      for (let i = 0; i < 5; i += 1) assert.equal((await login(base, `user-${i}`, 'x', ip)).status, 401);
      assert.equal((await login(base, 'user-99', 'x', ip)).status, 429);
      assert.equal((await login(base, 'user-99', 'x', { 'X-Forwarded-For': '203.0.113.10' })).status, 401);
    });

    // A successful login clears the account's failures from that address.
    await withCms({ dataPath: root, loginLimiter: createLoginLimiter({ maxPerPair: 3, maxPerIp: 50 }) }, async (base) => {
      for (let i = 0; i < 2; i += 1) assert.equal((await login(base, 'admin', `wrong-${i}`)).status, 401);
      assert.equal((await login(base, 'admin', 'limiter-test-password')).status, 200);
      for (let i = 0; i < 2; i += 1) assert.equal((await login(base, 'admin', `wrong-again-${i}`)).status, 401);
      assert.equal((await login(base, 'admin', 'limiter-test-password')).status, 200);
    });
  } finally {
    clearAuthEnv();
    rmSync(root, { recursive: true, force: true });
  }
});

test('wrong current passwords on change-password count toward the limit', async () => {
  clearAuthEnv();
  process.env.CMS_ADMIN_PASSWORD = 'change-pw-test-password';
  const root = tempRoot();
  try {
    await withCms({ dataPath: root, loginLimiter: createLoginLimiter({ maxPerAccount: 2, maxPerIp: 50 }) }, async (base) => {
      const { body } = await login(base, 'admin', 'change-pw-test-password');
      const change = (currentPassword) =>
        fetch(`${base}/admin/change-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${body.token}` },
          body: JSON.stringify({ currentPassword, newPassword: 'next-password-123' }),
        });
      assert.equal((await change('nope-1')).status, 401);
      assert.equal((await change('nope-2')).status, 401);
      assert.equal((await change('change-pw-test-password')).status, 429);
    });
  } finally {
    clearAuthEnv();
    rmSync(root, { recursive: true, force: true });
  }
});

test('public config shows only allowlisted keys; the hub first-admin sync still works', async () => {
  clearAuthEnv();
  const root = tempRoot();
  const hubPassword = 'set-in-the-hub-portal';
  const heartbeats = [];
  const hub = express();
  hub.use(express.json());
  hub.get('/api/hub/site-config', (req, res) => {
    assert.equal(req.query.site_key, 'security-test');
    res.json({
      id: 'site-1',
      name: 'Test Shop',
      domain: 'shop.example.test',
      features: { ecommerce: true, blog: true },
      ecommerceCatalogType: 'menu',
      websitePlan: 'tier-1',
      desiredCmsVersion: null,
      analyticsLevel: 'none',
      clientAdmin: { name: 'Owner Name', email: 'owner@example.test', pendingSync: true },
      pendingAdmin: { username: 'owner@example.test', passwordHash: bcrypt.hashSync(hubPassword, 4) },
      futureHubField: 'not public',
    });
  });
  hub.post('/api/hub/heartbeat', (req, res) => {
    heartbeats.push(req.body);
    res.json({ ok: true });
  });
  const hubServer = await listen(hub);
  try {
    await withCms({ dataPath: root, hubUrl: hubServer.base }, async (base) => {
      const res = await fetch(`${base}/config`);
      assert.equal(res.status, 200);
      const text = await res.text();
      const config = JSON.parse(text);
      for (const key of Object.keys(config)) assert.ok(PUBLIC_CONFIG_KEYS.includes(key), `unexpected public key ${key}`);
      assert.equal(config.name, 'Test Shop');
      assert.equal(config.ecommerceCatalogType, 'menu');
      assert.equal(config.features.ecommerce, true);
      assert.ok(config.packageVersion);
      for (const secret of ['pendingAdmin', 'clientAdmin', 'passwordHash', '$2', 'owner@example.test', 'adminSynced', 'futureHubField']) {
        assert.ok(!text.includes(secret), `public config shows ${secret}`);
      }
      // The hub's password landed on the CMS admin, and the heartbeat says so.
      assert.equal((await login(base, 'owner@example.test', hubPassword)).status, 200);
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(heartbeats.at(-1)?.adminApplied, true);
    });
  } finally {
    await close(hubServer.server);
    rmSync(root, { recursive: true, force: true });
  }
});

test('the heartbeat says where the sign-in limits take the client address from, never the address', async () => {
  clearAuthEnv();
  delete process.env.CMS_TRUSTED_PROXY_HOPS;
  process.env.CMS_ADMIN_PASSWORD = 'heartbeat-test-password';
  const root = tempRoot();
  const heartbeats = [];
  const hub = express();
  hub.use(express.json());
  hub.get('/api/hub/site-config', (_req, res) => res.json({ id: 'site-1', name: 'Test Shop', features: {} }));
  hub.post('/api/hub/heartbeat', (req, res) => {
    heartbeats.push(req.body);
    res.json({ ok: true });
  });
  const hubServer = await listen(hub);
  const warnings = [];
  const consoleWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  const addressWarnings = () => warnings.filter((line) => line.includes('loginAddressMode='));
  try {
    await withCms({ dataPath: root, hubUrl: hubServer.base }, async (base) => {
      /** Loads the public config (which sends a heartbeat) and returns that heartbeat's address fields. */
      const heartbeatAfterConfig = async (headers = {}) => {
        const before = heartbeats.length;
        assert.equal((await fetch(`${base}/config`, { headers })).status, 200);
        for (let i = 0; i < 100 && heartbeats.length === before; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
        const { loginAddressMode, loginForwardedFor, loginAddressFrom } = heartbeats.at(-1) || {};
        return { loginAddressMode, loginForwardedFor, loginAddressFrom };
      };
      // Before any sign-in, the config request itself is the sample.
      assert.deepEqual(await heartbeatAfterConfig(), { loginAddressMode: 'shared-proxy', loginForwardedFor: false, loginAddressFrom: 'request' });
      assert.deepEqual(await heartbeatAfterConfig({ 'X-Forwarded-For': '198.51.100.9, 203.0.113.5' }), {
        loginAddressMode: 'forwarded',
        loginForwardedFor: true,
        loginAddressFrom: 'request',
      });
      // After a sign-in, the heartbeat reports how that sign-in arrived.
      assert.equal((await login(base, 'admin', 'heartbeat-test-password', { 'X-Forwarded-For': '203.0.113.5' })).status, 200);
      assert.deepEqual(await heartbeatAfterConfig(), { loginAddressMode: 'forwarded', loginForwardedFor: true, loginAddressFrom: 'sign-in' });
      assert.deepEqual(addressWarnings(), [], 'no warning while each visitor has its own address');
      // A sign-in through a local proxy that sends no X-Forwarded-For: every visitor shares one address.
      assert.equal((await login(base, 'admin', 'heartbeat-test-password')).status, 200);
      assert.equal((await login(base, 'admin', 'heartbeat-test-password')).status, 200);
      assert.deepEqual(await heartbeatAfterConfig({ 'X-Forwarded-For': '203.0.113.5' }), {
        loginAddressMode: 'shared-proxy',
        loginForwardedFor: false,
        loginAddressFrom: 'sign-in',
      });
      assert.equal(addressWarnings().length, 1, 'the shared address is logged once');
      assert.match(addressWarnings()[0], /loginAddressMode=shared-proxy/);
      assert.match(addressWarnings()[0], /CMS_TRUSTED_PROXY_HOPS/);
    });
    const sent = JSON.stringify(heartbeats) + warnings.join('\n');
    for (const address of ['198.51.100.9', '203.0.113.5']) assert.ok(!sent.includes(address), `the heartbeat or log names ${address}`);
  } finally {
    console.warn = consoleWarn;
    clearAuthEnv();
    await close(hubServer.server);
    rmSync(root, { recursive: true, force: true });
  }
});
