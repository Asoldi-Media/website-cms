import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import v8 from 'node:v8';
import vm from 'node:vm';
import {
  MAX_PASSWORD_LENGTH,
  MAX_USERNAME_LENGTH,
  clientIpFromRequest,
  createLoginLimiter,
  isProxyAddress,
  readLoginBody,
  trustedProxyHops,
} from '../server/auth-hardening.js';

/** Username keys hold a short hash of the trimmed, lower-cased username, never the username itself. */
const shortHash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 32);
const accountKeyOf = (name) => `a:${shortHash(name.trim().toLowerCase())}`;
const pairKeyOf = (name, ip) => `p:${shortHash(`${name.trim().toLowerCase()}\n${ip}`)}`;

const WINDOW = 15 * 60 * 1000;
const request = (remoteAddress, forwardedFor) => ({
  socket: { remoteAddress },
  headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
});

test('the client IP behind a local proxy is the hop the proxy appended; a client-written first hop is ignored', () => {
  const hops1 = { hops: 1 };
  assert.equal(clientIpFromRequest(request('127.0.0.1', '198.51.100.9, 203.0.113.5'), hops1), '203.0.113.5');
  assert.equal(clientIpFromRequest(request('127.0.0.1', '1.2.3.4, 5.6.7.8, 203.0.113.5'), hops1), '203.0.113.5');
  assert.equal(clientIpFromRequest(request('::ffff:127.0.0.1', '203.0.113.5'), hops1), '203.0.113.5');
  assert.equal(clientIpFromRequest(request('10.0.0.3', ' 203.0.113.5 '), hops1), '203.0.113.5');
  assert.equal(clientIpFromRequest(request('', '198.51.100.9, 203.0.113.5'), hops1), '203.0.113.5', 'Unix socket');
  // Two proxies (e.g. a CDN, then the local proxy): the client is the second hop from the right.
  assert.equal(clientIpFromRequest(request('127.0.0.1', '198.51.100.9, 203.0.113.5, 192.0.2.1'), { hops: 2 }), '203.0.113.5');
  assert.equal(clientIpFromRequest(request('127.0.0.1', '203.0.113.5'), { hops: 3 }), '203.0.113.5', 'fewer hops than configured');
  // hops 0 ignores the header: every visitor counts as the proxy's address.
  assert.equal(clientIpFromRequest(request('127.0.0.1', '198.51.100.9, 203.0.113.5'), { hops: 0 }), '127.0.0.1');
  // A local proxy without the header counts as itself.
  assert.equal(clientIpFromRequest(request('127.0.0.1'), hops1), '127.0.0.1');
  // A direct connection from a public address counts by that address, whatever the header says.
  assert.equal(clientIpFromRequest(request('203.0.113.8', '198.51.100.9'), hops1), '203.0.113.8');
  assert.equal(clientIpFromRequest(request('::ffff:203.0.113.8'), hops1), '203.0.113.8');
  // Rotating the first hop never changes the key.
  const keys = new Set();
  for (let i = 0; i < 50; i += 1) keys.add(clientIpFromRequest(request('127.0.0.1', `198.51.100.${i}, 203.0.113.5`), hops1));
  assert.deepEqual([...keys], ['203.0.113.5']);
  assert.ok(clientIpFromRequest(request('127.0.0.1', `${'9'.repeat(500)}`), hops1).length <= 64, 'addresses are capped');
});

test('local, private and link-local addresses count as a proxy; public ones do not', () => {
  for (const a of ['', '127.0.0.1', '::1', '::ffff:127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.1', '169.254.1.1', 'fd00::1', 'fe80::1']) {
    assert.equal(isProxyAddress(a), true, a);
  }
  for (const a of ['203.0.113.5', '172.32.0.1', '172.15.0.1', '8.8.8.8', '2001:db8::1']) {
    assert.equal(isProxyAddress(a), false, a);
  }
});

test('CMS_TRUSTED_PROXY_HOPS: default 1, 0 to 5 allowed, anything else falls back to 1', () => {
  assert.equal(trustedProxyHops({}), 1);
  assert.equal(trustedProxyHops({ CMS_TRUSTED_PROXY_HOPS: '' }), 1);
  assert.equal(trustedProxyHops({ CMS_TRUSTED_PROXY_HOPS: '0' }), 0);
  assert.equal(trustedProxyHops({ CMS_TRUSTED_PROXY_HOPS: '2' }), 2);
  assert.equal(trustedProxyHops({ CMS_TRUSTED_PROXY_HOPS: '5' }), 5);
  assert.equal(trustedProxyHops({ CMS_TRUSTED_PROXY_HOPS: '6' }), 1);
  assert.equal(trustedProxyHops({ CMS_TRUSTED_PROXY_HOPS: '-1' }), 1);
  assert.equal(trustedProxyHops({ CMS_TRUSTED_PROXY_HOPS: 'many' }), 1);
  const previous = process.env.CMS_TRUSTED_PROXY_HOPS;
  try {
    process.env.CMS_TRUSTED_PROXY_HOPS = '0';
    assert.equal(clientIpFromRequest(request('127.0.0.1', '203.0.113.5')), '127.0.0.1', 'the env var is read per request');
  } finally {
    if (previous === undefined) delete process.env.CMS_TRUSTED_PROXY_HOPS;
    else process.env.CMS_TRUSTED_PROXY_HOPS = previous;
  }
});

/** Every attempt holds three keys: the username and address together, the username, and the address. */
const keysOf = (name, ip) => [pairKeyOf(name, ip), accountKeyOf(name), ...(ip ? [`i:${ip}`] : [])];

test('limits: 10 per username from one address, 100 per username, 50 per address (the CMS 2.2 limits)', () => {
  const limiter = createLoginLimiter();
  // Ten failures from ten other addresses do not lock the owner's own address.
  for (let i = 0; i < 10; i += 1) limiter.fail('admin', `198.51.100.${i + 1}`, { knownAccount: true });
  assert.equal(limiter.check('admin', '203.0.113.77').ok, true, 'the owner can still sign in from their own address');
  const owner = limiter.begin('admin', '203.0.113.77');
  assert.equal(owner.ok, true);
  owner.ticket.succeed();
  // Ten failures from one address lock that address for that username only.
  for (let i = 0; i < 10; i += 1) limiter.fail('admin', '192.0.2.10', { knownAccount: true });
  assert.equal(limiter.check('admin', '192.0.2.10').ok, false, 'locked for that address after 10');
  assert.equal(limiter.check('Admin ', '192.0.2.10').ok, false, 'case and spaces do not matter');
  assert.equal(limiter.check('editor', '192.0.2.10').ok, true, 'other usernames from that address still try');
  assert.equal(limiter.check('admin', '203.0.113.77').ok, true, 'the owner is still not locked');
  // The username ceiling: 100 failures from all addresses lock it everywhere.
  for (let i = 0; i < 80; i += 1) limiter.fail('admin', `198.18.${i >> 8}.${i & 255}`, { knownAccount: true });
  assert.equal(limiter.check('admin', '203.0.113.77').ok, false, 'locked everywhere after 100');
  // The address limit: 50 failures from one address, over any usernames.
  for (let i = 0; i < 50; i += 1) limiter.fail(`nobody-${i}`, '192.0.2.99', { knownAccount: false });
  assert.equal(limiter.check('someone-else', '192.0.2.99').ok, false, 'locked after 50 from one address');
  assert.equal(limiter.check('someone-else', '192.0.2.98').ok, true);
});

test('a full key table never drops a real account that is still locked', () => {
  const limiter = createLoginLimiter({ maxKeys: 300 });
  for (let i = 0; i < 10; i += 1) limiter.fail('admin', '203.0.113.5', { knownAccount: true });
  for (let i = 0; i < 100; i += 1) limiter.fail('owner', `198.18.0.${i}`, { knownAccount: true });
  assert.equal(limiter.check('admin', '203.0.113.5').ok, false, 'locked for that address after 10 failures');
  assert.equal(limiter.check('owner', '198.51.100.1').ok, false, 'locked everywhere after 100 failures');
  // Cheap failures: unknown usernames from ever-new addresses.
  for (let n = 0; n < 5000; n += 1) {
    limiter.fail(`spray-${n}`, `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`, { knownAccount: false });
  }
  assert.equal(limiter.check('admin', '203.0.113.5').ok, false, 'still locked after 5000 other failures');
  assert.equal(limiter.check('owner', '198.51.100.1').ok, false, 'still locked after 5000 other failures');
  assert.ok(limiter.keys().length <= 300, 'the table stays within maxKeys');
});

test('at the cap, IP keys and unknown usernames go first, oldest first', () => {
  const limiter = createLoginLimiter({ maxKeys: 10 });
  limiter.fail('owner', '203.0.113.1', { knownAccount: true });
  limiter.fail('ghost', '203.0.113.2', { knownAccount: false });
  for (let n = 0; n < 20; n += 1) limiter.fail(`spray-${n}`, `198.51.100.${n}`, { knownAccount: false });
  const keys = limiter.keys();
  assert.ok(keys.length <= 10, String(keys.length));
  assert.ok(keys.includes(accountKeyOf('owner')) && keys.includes(pairKeyOf('owner', '203.0.113.1')), 'the real account stays');
  assert.ok(!keys.includes(accountKeyOf('ghost')) && !keys.includes(pairKeyOf('ghost', '203.0.113.2')), 'an old unknown username goes');
  assert.ok(!keys.includes('i:203.0.113.1') && !keys.includes('i:203.0.113.2'), 'old IP keys go');
  for (const key of keysOf('spray-19', '198.51.100.19')) assert.ok(keys.includes(key), 'the newest keys stay');
});

test('a known account stays protected when later attempts look unknown (case, spacing)', () => {
  const limiter = createLoginLimiter({ maxKeys: 4 });
  limiter.fail('Owner', '', { knownAccount: true });
  limiter.fail(' owner ', '', { knownAccount: false });
  for (let n = 0; n < 10; n += 1) limiter.fail(`spray-${n}`, '', { knownAccount: false });
  assert.ok(limiter.keys().includes(accountKeyOf('owner')));
  assert.ok(limiter.keys().includes(pairKeyOf('owner', '')));
});

test('when only real accounts inside their window are left, new attempts are refused (fails closed)', () => {
  let t = 1_000_000;
  const limiter = createLoginLimiter({ maxKeys: 8, now: () => t });
  for (const name of ['a1', 'a2', 'a3', 'a4']) limiter.fail(name, '', { knownAccount: true });
  const realKeys = ['a1', 'a2', 'a3', 'a4'].flatMap((name) => keysOf(name, '')).sort();
  assert.deepEqual(limiter.keys().sort(), realKeys);
  const refused = limiter.begin('stranger', '203.0.113.9', { knownAccount: false });
  assert.equal(refused.ok, false);
  assert.ok(refused.retryAfterSec > 0 && refused.retryAfterSec <= WINDOW / 1000);
  assert.equal(limiter.check('a5', '').ok, false);
  limiter.fail('a5', '', { knownAccount: true });
  assert.deepEqual(limiter.keys().sort(), realKeys, 'no real account was dropped');
  assert.equal(limiter.begin('a1', '').ok, true, 'an account already in the table can still try');
  t += WINDOW;
  assert.equal(limiter.begin('stranger', '203.0.113.9', { knownAccount: false }).ok, true, 'room again once the window passed');
});

test('begin counts an attempt before the password check; succeed takes it back and clears that address', () => {
  let t = 5_000_000;
  const limiter = createLoginLimiter({ maxPerPair: 2, maxPerAccount: 3, maxPerIp: 3, now: () => t });
  const first = limiter.begin('admin', '203.0.113.1');
  const second = limiter.begin('admin', '203.0.113.1');
  assert.equal(first.ok && second.ok, true);
  const third = limiter.begin('admin', '203.0.113.1');
  assert.equal(third.ok, false, 'two attempts still being checked already use the limit for that address');
  const elsewhere = limiter.begin('admin', '203.0.113.2');
  assert.equal(elsewhere.ok, true, 'another address has its own count');
  assert.equal(limiter.begin('admin', '203.0.113.3').ok, false, 'three attempts in all use the username limit');
  first.ticket.succeed();
  second.ticket.fail();
  elsewhere.ticket.fail();
  assert.equal(limiter.check('admin', '203.0.113.1').ok, true, 'a right password clears that address');
  const fourth = limiter.begin('admin', '203.0.113.3');
  assert.equal(fourth.ok, true, 'the right password took its own attempt back');
  fourth.ticket.fail();
  assert.equal(limiter.begin('admin', '203.0.113.4').ok, false, 'the username count keeps the other failures');
  // Per-IP: unsettled attempts count, successful ones do not.
  const ip = '198.51.100.5';
  limiter.begin('u1', ip).ticket.fail();
  limiter.begin('u2', ip).ticket.succeed();
  limiter.begin('u3', ip);
  limiter.begin('u4', ip).ticket.fail();
  assert.equal(limiter.begin('u5', ip).ok, false);
  t += WINDOW;
  assert.equal(limiter.begin('u5', ip).ok, true, 'the window slides');
});

test('sign-in bodies: the username and password must be non-empty text of a bounded length', () => {
  assert.deepEqual(readLoginBody({ username: 'admin', password: 'pw' }), { username: 'admin', password: 'pw' });
  const missing = [
    undefined, null, 'admin', [], {}, { username: 'admin' }, { password: 'pw' },
    { username: '', password: 'pw' }, { username: 'admin', password: '' },
    { username: ['admin'], password: 'pw' }, { username: { $ne: 1 }, password: 'pw' }, { username: 7, password: 'pw' },
    { username: 'admin', password: ['x'] }, { username: 'admin', password: {} }, { username: 'admin', password: 123 }, { username: 'admin', password: true },
  ];
  for (const body of missing) assert.equal(readLoginBody(body).error, 'Username and password required', JSON.stringify(body));
  assert.equal(MAX_USERNAME_LENGTH, 200);
  assert.equal(MAX_PASSWORD_LENGTH, 1024);
  assert.equal(readLoginBody({ username: 'u'.repeat(200), password: 'p'.repeat(1024) }).error, undefined);
  assert.equal(readLoginBody({ username: 'u'.repeat(201), password: 'pw' }).error, 'Username or password is too long');
  assert.equal(readLoginBody({ username: 'admin', password: 'p'.repeat(1025) }).error, 'Username or password is too long');
});

function collectGarbage() {
  if (typeof globalThis.gc === 'function') return globalThis.gc;
  try {
    v8.setFlagsFromString('--expose-gc');
    return vm.runInNewContext('gc');
  } catch {
    return null;
  }
}

test('very long usernames are kept as short hashes, so limiter memory stays small', () => {
  const gc = collectGarbage();
  const heapUsed = () => {
    gc?.();
    return process.memoryUsage().heapUsed;
  };
  const limiter = createLoginLimiter();
  const before = heapUsed();
  for (let i = 0; i < 50; i += 1) {
    const verdict = limiter.begin(`${i}-${'u'.repeat(1_900_000)}`, `203.0.113.${i % 8}`, { knownAccount: false });
    assert.equal(verdict.ok, true);
    verdict.ticket.fail();
  }
  const keys = limiter.keys();
  assert.equal(keys.length, 108, '50 usernames, each also with its address, and 8 addresses');
  for (const key of keys) assert.ok(key.length <= 40, `a key of ${key.length} characters`);
  if (gc) {
    const grown = heapUsed() - before;
    assert.ok(grown < 20 * 1024 * 1024, `the heap grew by ${Math.round(grown / 1024 / 1024)} MB`);
  }
  // Only the first 1024 characters count, so names that differ later share one key (and one limit).
  for (let i = 0; i < 2; i += 1) limiter.begin(`z-${'u'.repeat(2000)}${i}`, '', { knownAccount: false }).ticket.fail();
  assert.equal(limiter.keys().length, 110);
  // The same username, in other case or with spaces at the ends, is the same key.
  const t = limiter.begin('  Owner ', '', { knownAccount: true });
  t.ticket.fail();
  assert.equal(limiter.keys().filter((key) => key === accountKeyOf('owner')).length, 1);
});
