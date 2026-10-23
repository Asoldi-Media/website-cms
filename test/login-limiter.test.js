import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clientIpFromRequest,
  createLoginLimiter,
  isProxyAddress,
  trustedProxyHops,
} from '../server/auth-hardening.js';

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

test('a full key table never drops a real account that is still locked', () => {
  const limiter = createLoginLimiter({ maxKeys: 200 });
  for (let i = 0; i < 10; i += 1) limiter.fail('admin', '203.0.113.5', { knownAccount: true });
  assert.equal(limiter.check('admin', '198.51.100.1').ok, false, 'locked after 10 failures');
  // Cheap failures: unknown usernames from ever-new addresses.
  for (let n = 0; n < 5000; n += 1) {
    limiter.fail(`spray-${n}`, `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`, { knownAccount: false });
  }
  assert.equal(limiter.check('admin', '198.51.100.1').ok, false, 'still locked after 5000 other failures');
  if (typeof limiter.keys === 'function') assert.ok(limiter.keys().length <= 200, 'the table stays within maxKeys');
});

test('at the cap, IP keys and unknown usernames go first, oldest first', () => {
  const limiter = createLoginLimiter({ maxKeys: 10 });
  limiter.fail('owner', '203.0.113.1', { knownAccount: true });
  limiter.fail('ghost', '203.0.113.2', { knownAccount: false });
  for (let n = 0; n < 20; n += 1) limiter.fail(`spray-${n}`, `198.51.100.${n}`, { knownAccount: false });
  const keys = limiter.keys();
  assert.ok(keys.length <= 10, String(keys.length));
  assert.ok(keys.includes('a:owner'), 'the real account stays');
  assert.ok(!keys.includes('a:ghost'), 'an old unknown username goes');
  assert.ok(!keys.includes('i:203.0.113.1') && !keys.includes('i:203.0.113.2'), 'old IP keys go');
  assert.ok(keys.includes('a:spray-19') && keys.includes('i:198.51.100.19'), 'the newest keys stay');
});

test('a known account stays protected when later attempts look unknown (case, spacing)', () => {
  const limiter = createLoginLimiter({ maxKeys: 4 });
  limiter.fail('Owner', '', { knownAccount: true });
  limiter.fail(' owner ', '', { knownAccount: false });
  for (let n = 0; n < 10; n += 1) limiter.fail(`spray-${n}`, '', { knownAccount: false });
  assert.ok(limiter.keys().includes('a:owner'));
});

test('when only real accounts inside their window are left, new attempts are refused (fails closed)', () => {
  let t = 1_000_000;
  const limiter = createLoginLimiter({ maxKeys: 4, now: () => t });
  for (const name of ['a1', 'a2', 'a3', 'a4']) limiter.fail(name, '', { knownAccount: true });
  const refused = limiter.begin('stranger', '203.0.113.9', { knownAccount: false });
  assert.equal(refused.ok, false);
  assert.ok(refused.retryAfterSec > 0 && refused.retryAfterSec <= WINDOW / 1000);
  assert.equal(limiter.check('a5', '').ok, false);
  limiter.fail('a5', '', { knownAccount: true });
  assert.deepEqual(limiter.keys().sort(), ['a:a1', 'a:a2', 'a:a3', 'a:a4'], 'no real account was dropped');
  assert.equal(limiter.begin('a1', '').ok, true, 'an account already in the table can still try');
  t += WINDOW;
  assert.equal(limiter.begin('stranger', '203.0.113.9', { knownAccount: false }).ok, true, 'room again once the window passed');
});

test('begin counts an attempt before the password check; succeed takes it back and clears the account', () => {
  let t = 5_000_000;
  const limiter = createLoginLimiter({ maxPerAccount: 2, maxPerIp: 3, now: () => t });
  const first = limiter.begin('admin', '203.0.113.1');
  const second = limiter.begin('admin', '203.0.113.2');
  assert.equal(first.ok && second.ok, true);
  const third = limiter.begin('admin', '203.0.113.3');
  assert.equal(third.ok, false, 'two attempts still being checked already use the limit');
  first.ticket.succeed();
  second.ticket.fail();
  assert.equal(limiter.check('admin', '203.0.113.1').ok, true, 'a right password clears the account');
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
