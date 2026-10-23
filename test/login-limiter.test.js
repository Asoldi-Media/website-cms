import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TEST_ADMIN_PASSWORD } from './_admin.js';
import { bearer, bootCms, postJson, waitFor } from './_cms-boot.js';
import { clientIp, createLoginLimiter, isProxyAddress, readLoginBody, trustedProxyHops } from '../server/login-limiter.js';

test('limiter: a username locks per address first, then everywhere at the higher ceiling', () => {
  let clock = 0;
  const limiter = createLoginLimiter({ windowMs: 1000, maxPerPair: 3, maxPerAccount: 6, maxPerIp: 50, now: () => clock });
  for (let i = 0; i < 3; i += 1) limiter.fail('Admin', '1.1.1.1');
  const blocked = limiter.check('admin', '1.1.1.1');
  assert.equal(blocked.ok, false, 'usernames are case-insensitive');
  assert.equal(blocked.retryAfterSec, 1);
  assert.equal(limiter.check('admin', '9.9.9.9').ok, true, 'the owner on another address still gets in');
  assert.equal(limiter.check('other', '1.1.1.1').ok, true, 'another username from the same address is not locked');
  for (let i = 0; i < 3; i += 1) limiter.fail('admin', `2.2.2.${i}`);
  assert.equal(limiter.check('admin', '9.9.9.9').ok, false, 'six failures over many addresses lock the username everywhere');
  clock = 1001;
  assert.equal(limiter.check('admin', '1.1.1.1').ok, true, 'the window slides');
});

test('limiter: an address is limited across usernames, and a success clears only that username on that address', () => {
  const limiter = createLoginLimiter({ windowMs: 1000, maxPerPair: 3, maxPerAccount: 100, maxPerIp: 5, now: () => 0 });
  for (const name of ['a', 'b', 'c', 'd', 'e']) limiter.fail(name, '1.1.1.1');
  assert.equal(limiter.check('f', '1.1.1.1').ok, false, 'five failures from one address block that address');
  assert.equal(limiter.check('f', '2.2.2.2').ok, true);

  limiter.fail('x', '3.3.3.3');
  limiter.fail('x', '3.3.3.3');
  limiter.succeed('x', '3.3.3.3');
  limiter.fail('x', '3.3.3.3');
  limiter.fail('x', '3.3.3.3');
  assert.equal(limiter.check('x', '3.3.3.3').ok, true, 'the success reset the count for that address');
  limiter.fail('y', '');
  limiter.fail('y', '');
  limiter.fail('y', '');
  assert.equal(limiter.check('y', '').ok, false, 'with no address the per-username lock still applies');
});

test('limiter: memory stays bounded under long usernames and many addresses', () => {
  let clock = 0;
  const limiter = createLoginLimiter({ maxKeys: 200, now: () => clock });
  const huge = 'u'.repeat(1024 * 1024);
  for (let i = 0; i < 500; i += 1) {
    clock += 1;
    limiter.fail(`${huge}${i}`, `203.0.113.${i % 250}-${'x'.repeat(5000)}-${i}`);
  }
  const keys = limiter.keys();
  assert.ok(keys.length <= 200, `key count ${keys.length} is capped`);
  assert.ok(keys.every((key) => key.length <= 66), 'usernames are hashed and addresses are capped');
});

test('limiter: expired keys are swept on a timer, not on every failure', () => {
  let clock = 0;
  const limiter = createLoginLimiter({ windowMs: 1000, sweepEveryMs: 500, now: () => clock });
  for (let i = 0; i < 50; i += 1) limiter.fail(`user-${i}`, `198.51.100.${i}`);
  assert.equal(limiter.keys().length, 150, 'pair, username and address keys');
  clock = 1200;
  limiter.fail('late', '192.0.2.1');
  assert.equal(limiter.keys().length, 3, 'the sweep dropped every expired key');
  clock = 2300;
  limiter.fail('later', '192.0.2.2');
  assert.equal(limiter.keys().length, 3, 'the next sweep dropped the late keys');
});

test('client address: the socket, or the hop a local proxy appended, never the first forwarded hop', () => {
  const req = (remoteAddress, xff) => ({ socket: { remoteAddress }, headers: xff === undefined ? {} : { 'x-forwarded-for': xff } });
  assert.equal(clientIp(req('203.0.113.5', '198.51.100.1')), '203.0.113.5', 'a direct client cannot pick its address');
  assert.equal(clientIp(req('127.0.0.1', 'client-written, 203.0.113.9')), '203.0.113.9', 'behind a local proxy the appended hop counts');
  assert.equal(clientIp(req('::ffff:127.0.0.1', '203.0.113.9')), '203.0.113.9');
  assert.equal(clientIp(req(undefined, 'a, 203.0.113.7')), '203.0.113.7', 'a Unix socket counts as a local proxy');
  assert.equal(clientIp(req('10.1.2.3', 'client-written, 203.0.113.9, 10.0.0.1'), { hops: 2 }), '203.0.113.9', 'two trusted proxies');
  assert.equal(clientIp(req('127.0.0.1', 'client-written, 203.0.113.9'), { hops: 0 }), '127.0.0.1', 'hops 0 ignores the header');
  assert.equal(clientIp(req('127.0.0.1')), '127.0.0.1');
  assert.equal(clientIp(req('127.0.0.1', '9'.repeat(500))).length, 64, 'addresses are capped');
  for (const a of ['127.0.0.1', '::1', '10.0.0.1', '172.16.0.1', '172.31.255.1', '192.168.1.1', 'fd00::1', 'fe80::1', '']) assert.equal(isProxyAddress(a), true, a);
  for (const a of ['203.0.113.1', '172.32.0.1', '8.8.8.8', '2001:db8::1']) assert.equal(isProxyAddress(a), false, a);
  assert.equal(trustedProxyHops({}), 1);
  assert.equal(trustedProxyHops({ CMS_TRUSTED_PROXY_HOPS: '2' }), 2);
  assert.equal(trustedProxyHops({ CMS_TRUSTED_PROXY_HOPS: 'lots' }), 1);
});

test('sign-in body: text only, with length caps', () => {
  assert.deepEqual(readLoginBody({ username: 'admin', password: 'pw' }), { username: 'admin', password: 'pw' });
  assert.ok(readLoginBody({ username: { $ne: 1 }, password: 'pw' }).error);
  assert.ok(readLoginBody({ username: ['admin'], password: 'pw' }).error);
  assert.ok(readLoginBody({ username: 'admin' }).error);
  assert.ok(readLoginBody(null).error);
  assert.match(readLoginBody({ username: 'a'.repeat(201), password: 'pw' }).error, /too long/);
  assert.match(readLoginBody({ username: 'admin', password: 'p'.repeat(1025) }).error, /too long/);
});

test('HTTP: ten wrong passwords lock a username for that address only, with Retry-After', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'asoldi-limit-'));
  const cms = await bootCms({ dataPath: root });
  try {
    await waitFor(async () => (await postJson(`${cms.base}/admin/login`, { username: 'admin', password: TEST_ADMIN_PASSWORD })).status === 200);
    // The test server listens on loopback, so it reads the last X-Forwarded-For hop like a CMS behind its proxy.
    for (let i = 0; i < 10; i += 1) {
      const res = await postJson(`${cms.base}/admin/login`, { username: 'admin', password: `wrong-${i}` }, { 'x-forwarded-for': `10.9.9.${i}, 198.51.100.7` });
      assert.equal(res.status, 401);
    }
    const locked = await postJson(`${cms.base}/admin/login`, { username: 'admin', password: TEST_ADMIN_PASSWORD }, { 'x-forwarded-for': 'another-first-hop, 198.51.100.7' });
    assert.equal(locked.status, 429, 'even the right password waits, and a new first hop does not help');
    assert.ok(Number(locked.headers.get('retry-after')) > 0);

    const owner = await postJson(`${cms.base}/admin/login`, { username: 'admin', password: TEST_ADMIN_PASSWORD }, { 'x-forwarded-for': '198.51.100.8' });
    assert.equal(owner.status, 200, 'the owner on another address is not locked out');

    const otherAccount = await postJson(`${cms.base}/admin/login`, { username: 'someone', password: 'nope-nope' }, { 'x-forwarded-for': '198.51.100.7' });
    assert.equal(otherAccount.status, 401, 'another username is not locked');
  } finally {
    await cms.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('HTTP: long or non-text usernames are refused before the limiter counts them', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'asoldi-limit-'));
  const cms = await bootCms({ dataPath: root });
  try {
    for (const route of ['/admin/login', '/auth/login']) {
      const long = await postJson(`${cms.base}${route}`, { username: 'a'.repeat(20000), password: 'x' });
      assert.equal(long.status, 400, route);
      assert.match(long.data.message, /too long/);
      assert.equal((await postJson(`${cms.base}${route}`, { username: { $gt: '' }, password: 'x' })).status, 400, route);
      assert.equal((await postJson(`${cms.base}${route}`, { username: 'admin', password: ['x'] })).status, 400, route);
    }
    for (let i = 0; i < 12; i += 1) await postJson(`${cms.base}/admin/login`, { username: 'b'.repeat(500), password: 'x' });
    const fine = await waitFor(async () => {
      const r = await postJson(`${cms.base}/admin/login`, { username: 'admin', password: TEST_ADMIN_PASSWORD });
      return r.status === 200 ? r : null;
    });
    assert.equal(fine.status, 200, 'refused bodies never reach the limiter');
  } finally {
    await cms.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('HTTP: /auth/login (staff) is limited too, and a success resets the count', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'asoldi-limit-'));
  const cms = await bootCms({ dataPath: root });
  try {
    const adminToken = await waitFor(async () => {
      const r = await postJson(`${cms.base}/admin/login`, { username: 'admin', password: TEST_ADMIN_PASSWORD });
      return r.status === 200 ? r.data.token : null;
    });
    const created = await postJson(`${cms.base}/admin/users`, { username: 'emp', password: 'emp-pass-1', rank: 'employee' }, bearer(adminToken));
    assert.equal(created.status, 201);
    for (let i = 0; i < 9; i += 1) assert.equal((await postJson(`${cms.base}/auth/login`, { username: 'emp', password: 'bad' })).status, 401);
    assert.equal((await postJson(`${cms.base}/auth/login`, { username: 'emp', password: 'emp-pass-1' })).status, 200, 'nine failures still allow the right password');
    for (let i = 0; i < 9; i += 1) assert.equal((await postJson(`${cms.base}/auth/login`, { username: 'emp', password: 'bad' })).status, 401, 'the success reset the count');
    assert.equal((await postJson(`${cms.base}/auth/login`, { username: 'emp', password: 'bad' })).status, 401);
    assert.equal((await postJson(`${cms.base}/auth/login`, { username: 'emp', password: 'emp-pass-1' })).status, 429);
  } finally {
    await cms.close();
    rmSync(root, { recursive: true, force: true });
  }
});
