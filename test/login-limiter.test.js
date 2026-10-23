import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { TEST_ADMIN_PASSWORD } from './_admin.js';
import { bearer, bootCms, fakeHub, postJson, waitFor } from './_cms-boot.js';
import { clientAddressMode, clientIp, createLoginLimiter, isProxyAddress, readLoginBody, trustedProxyHops } from '../server/login-limiter.js';

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

test('limiter: begin counts the attempt before the password check, so unsettled attempts still use the limit', () => {
  const limiter = createLoginLimiter({ maxInFlight: 1000, now: () => 0 });
  const verdicts = Array.from({ length: 50 }, () => limiter.begin('admin', '198.51.100.30'));
  const tickets = verdicts.filter((v) => v.ok).map((v) => v.ticket);
  assert.equal(tickets.length, 10, 'ten attempts start while none has finished; the rest are refused');
  assert.ok(verdicts.filter((v) => !v.ok).every((v) => v.retryAfterSec > 0 && !v.busy));
  for (const ticket of tickets) ticket.fail();
  assert.equal(limiter.check('admin', '198.51.100.30').ok, false, 'failed attempts stay counted');
  assert.equal(limiter.running(), 0, 'settled checks are no longer running');
});

test('limiter: at most maxInFlight checks run at once per username and per address', () => {
  const limiter = createLoginLimiter({ maxInFlight: 2, now: () => 0 });
  const a = limiter.begin('admin', '198.51.100.1');
  const b = limiter.begin('admin', '198.51.100.2');
  const c = limiter.begin('admin', '198.51.100.3');
  assert.equal(a.ok && b.ok, true);
  assert.deepEqual(c, { ok: false, retryAfterSec: 1, busy: true }, 'a third check for one username waits, from any address');
  a.ticket.fail();
  assert.equal(limiter.begin('admin', '198.51.100.3').ok, true, 'a finished check frees a place');

  const d = limiter.begin('x1', '203.0.113.50');
  const e = limiter.begin('x2', '203.0.113.50');
  assert.equal(d.ok && e.ok, true);
  assert.equal(limiter.begin('x3', '203.0.113.50').busy, true, 'a third check from one address waits, for any username');
  e.ticket.succeed();
  e.ticket.fail();
  e.ticket.succeed();
  assert.equal(limiter.begin('x3', '203.0.113.50').ok, true, 'settling twice frees one place only once');
  assert.equal(limiter.begin('x4', '203.0.113.50').busy, true);
});

test('limiter: a correct password takes its attempt back from every count', () => {
  const limiter = createLoginLimiter({ maxPerPair: 3, maxPerAccount: 4, maxPerIp: 3, now: () => 0 });
  for (let i = 0; i < 10; i += 1) {
    const verdict = limiter.begin('owner', '198.51.100.40');
    assert.equal(verdict.ok, true, `sign-in ${i + 1}`);
    verdict.ticket.succeed();
  }
  assert.deepEqual(limiter.keys(), [], 'successful sign-ins leave no counts behind');
  const wrong = limiter.begin('owner', '198.51.100.40');
  wrong.ticket.fail();
  wrong.ticket.succeed();
  assert.equal(limiter.keys().length, 3, 'a ticket settles once; a late succeed does not undo a failure');
});

test('client address mode: reported without the address', () => {
  const req = (remoteAddress, xff) => ({ socket: { remoteAddress }, headers: xff === undefined ? {} : { 'x-forwarded-for': xff } });
  assert.deepEqual(clientAddressMode(req('203.0.113.5')), { mode: 'direct', forwardedFor: false });
  assert.deepEqual(clientAddressMode(req('203.0.113.5', '198.51.100.1')), { mode: 'direct', forwardedFor: true }, 'a proxy on a public address');
  assert.deepEqual(clientAddressMode(req('127.0.0.1', 'a, 198.51.100.1')), { mode: 'forwarded', forwardedFor: true });
  assert.deepEqual(clientAddressMode(req('127.0.0.1')), { mode: 'shared-proxy', forwardedFor: false }, 'a local proxy with no header');
  assert.deepEqual(clientAddressMode(req('127.0.0.1', '198.51.100.1'), { hops: 0 }), { mode: 'shared-proxy', forwardedFor: true });
});

/** Counts password checks and how many run at once. Wrong passwords answer after `delayMs`, like a slow hash. */
function watchPasswordChecks({ delayMs = 30 } = {}) {
  const original = bcrypt.compare;
  const stats = { calls: 0, running: 0, maxRunning: 0 };
  bcrypt.compare = async (plain, hash) => {
    stats.calls += 1;
    stats.running += 1;
    stats.maxRunning = Math.max(stats.maxRunning, stats.running);
    try {
      if (plain === TEST_ADMIN_PASSWORD) return await original(plain, hash);
      await new Promise((r) => setTimeout(r, delayMs));
      return false;
    } finally {
      stats.running -= 1;
    }
  };
  return { stats, restore: () => { bcrypt.compare = original; } };
}

const statusCounts = (results) => results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});

test('HTTP: parallel wrong passwords from one address get at most ten checks, and the owner elsewhere still signs in', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'asoldi-limit-'));
  const cms = await bootCms({ dataPath: root });
  let watch = null;
  try {
    await waitFor(async () => (await postJson(`${cms.base}/admin/login`, { username: 'admin', password: TEST_ADMIN_PASSWORD })).status === 200);
    watch = watchPasswordChecks();
    const from = { 'x-forwarded-for': 'client-written, 198.51.100.20' };
    const wrong = (i) => postJson(`${cms.base}/admin/login`, { username: 'admin', password: `wrong-${i}` }, from);
    const burst = statusCounts(await Promise.all(Array.from({ length: 50 }, (_, i) => wrong(i))));
    assert.ok((burst[401] || 0) >= 1 && (burst[401] || 0) <= 10, `burst: ${JSON.stringify(burst)}`);
    assert.equal((burst[401] || 0) + (burst[429] || 0), 50, 'every other request is refused with 429');
    let failed = burst[401] || 0;
    for (let wave = 0; wave < 5; wave += 1) {
      const counts = statusCounts(await Promise.all(Array.from({ length: 10 }, (_, i) => wrong(100 + wave * 10 + i))));
      failed += counts[401] || 0;
    }
    for (let i = 0; i < 20 && failed < 10; i += 1) if ((await wrong(500 + i)).status === 401) failed += 1;
    assert.equal(failed, 10, 'exactly ten wrong passwords were checked for this username and address');
    assert.equal(watch.stats.calls, 10, 'one password check per counted attempt');
    assert.ok(watch.stats.maxRunning <= 2, `at most two checks at once (saw ${watch.stats.maxRunning})`);
    assert.equal((await wrong(999)).status, 429);

    const owner = await postJson(`${cms.base}/admin/login`, { username: 'admin', password: TEST_ADMIN_PASSWORD }, { 'x-forwarded-for': '198.51.100.21' });
    assert.equal(owner.status, 200, 'the owner on a clean address signs in');
  } finally {
    watch?.restore();
    await cms.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('HTTP: parallel wrong passwords from rotating addresses get at most 100 checks for one username', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'asoldi-limit-'));
  const cms = await bootCms({ dataPath: root });
  let watch = null;
  try {
    await waitFor(async () => (await postJson(`${cms.base}/admin/login`, { username: 'admin', password: TEST_ADMIN_PASSWORD })).status === 200);
    watch = watchPasswordChecks({ delayMs: 10 });
    let n = 0;
    const wrong = () => {
      n += 1;
      const hop = `198.${18 + (n >> 16)}.${(n >> 8) & 255}.${n & 255}`;
      return postJson(`${cms.base}/admin/login`, { username: 'admin', password: `wrong-${n}` }, { 'x-forwarded-for': `10.0.0.1, ${hop}` });
    };
    let failed = 0;
    let refused = 0;
    for (let wave = 0; wave < 3; wave += 1) {
      const counts = statusCounts(await Promise.all(Array.from({ length: 80 }, wrong)));
      failed += counts[401] || 0;
      refused += counts[429] || 0;
    }
    assert.equal(failed + refused, 240);
    for (let i = 0; i < 150 && failed < 100; i += 1) if ((await wrong()).status === 401) failed += 1;
    assert.equal(failed, 100, 'the username ceiling holds');
    const after = statusCounts(await Promise.all(Array.from({ length: 60 }, wrong)));
    assert.deepEqual(after, { 429: 60 }, 'nothing more is checked once the ceiling is reached');
    assert.equal(watch.stats.calls, 100, 'at most 100 password checks for one username in the window');
    assert.ok(watch.stats.maxRunning <= 2, `at most two checks at once (saw ${watch.stats.maxRunning})`);
  } finally {
    watch?.restore();
    await cms.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('HTTP: the heartbeat reports how sign-ins reach the CMS, never an address', async () => {
  const hub = await fakeHub({ siteKey: 'limit-site' });
  const root = mkdtempSync(path.join(tmpdir(), 'asoldi-limit-'));
  const cms = await bootCms({ dataPath: root, hubUrl: hub.url, siteKey: 'limit-site' });
  try {
    await fetch(`${cms.base}/config`);
    const first = await waitFor(() => hub.state.heartbeats[0]);
    assert.equal(first.loginAddressMode, 'shared-proxy', 'a loopback request with no header');
    assert.equal(first.loginForwardedFor, false);
    assert.equal(first.loginAddressFrom, 'request');
    await postJson(`${cms.base}/admin/login`, { username: 'admin', password: 'wrong-once' }, { 'x-forwarded-for': '198.51.100.60' });
    await fetch(`${cms.base}/config`);
    const second = await waitFor(() => hub.state.heartbeats[1]);
    assert.equal(second.loginAddressMode, 'forwarded');
    assert.equal(second.loginForwardedFor, true);
    assert.equal(second.loginAddressFrom, 'sign-in');
    assert.ok(!JSON.stringify(hub.state.heartbeats).includes('198.51.100.60'), 'no address leaves the site');
  } finally {
    await cms.close();
    await hub.close();
    rmSync(root, { recursive: true, force: true });
  }
});
