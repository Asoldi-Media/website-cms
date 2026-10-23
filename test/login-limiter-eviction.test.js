import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { clientIp, createLoginLimiter } from '../server/login-limiter.js';
import { clientIp as shopClientIp } from '../server/shop/storefront.js';
import { createStore } from '../server/store.js';

const sprayer = (limiter, count, start = 0) => {
  for (let i = start; i < start + count; i += 1) limiter.fail(`made-up-${i}`, `198.51.${(i >> 8) & 255}.${i & 255}`);
};

test('limiter: a flood of made-up usernames never frees a locked real account inside the window', () => {
  let clock = 0;
  const limiter = createLoginLimiter({ maxKeys: 200, now: () => clock, isKnownAccount: (name) => name.toLowerCase() === 'admin' });
  for (let i = 0; i < 10; i += 1) limiter.fail('admin', '203.0.113.5');
  for (let i = 0; i < 90; i += 1) limiter.fail('admin', `203.0.113.${100 + (i % 50)}`);
  assert.equal(limiter.check('admin', '203.0.113.5').ok, false, 'locked for the address');
  assert.equal(limiter.check('admin', '192.0.2.77').ok, false, 'locked everywhere after 100');
  clock += 1;
  sprayer(limiter, 5000);
  assert.equal(limiter.check('Admin', '203.0.113.5').ok, false, 'still locked for the address after 5000 cheap failures');
  assert.equal(limiter.check('admin', '192.0.2.77').ok, false, 'still locked everywhere');
  const begun = limiter.begin('admin', '192.0.2.78');
  assert.equal(begun.ok, false, 'begin refuses as well');
  const sizeAfterSpray = limiter.keys().length;
  assert.ok(sizeAfterSpray <= 200 + 51, `bounded: ${sizeAfterSpray} keys (cap plus the real account's own keys)`);
  clock += 15 * 60 * 1000;
  assert.equal(limiter.check('admin', '203.0.113.5').ok, true, 'the window still ends');
});

test('limiter: at capacity, made-up usernames go before addresses, so an address lock holds', () => {
  const limiter = createLoginLimiter({ maxKeys: 300, maxPerIp: 50, now: () => 0, isKnownAccount: () => false });
  for (let i = 0; i < 50; i += 1) limiter.fail(`guess-${i}`, '203.0.113.9');
  assert.equal(limiter.check('anyone', '203.0.113.9').ok, false);
  // Made-up names from a few other addresses (no limit is reached there, so every failure is counted).
  for (let i = 0; i < 2000; i += 1) limiter.fail(`made-up-${i}`, `198.51.100.${i % 50}`);
  assert.equal(limiter.check('anyone', '203.0.113.9').ok, false, 'the address key outlived the made-up username keys');
  assert.ok(limiter.keys().length <= 300);
});

test('limiter: without the real-account check, the same flood frees the lock (the case the check exists for)', () => {
  const limiter = createLoginLimiter({ maxKeys: 200, now: () => 0 });
  for (let i = 0; i < 10; i += 1) limiter.fail('admin', '203.0.113.5');
  assert.equal(limiter.check('admin', '203.0.113.5').ok, false);
  sprayer(limiter, 5000);
  assert.equal(limiter.check('admin', '203.0.113.5').ok, true);
});

test('limiter: a real-account check that throws counts the name as unknown and never breaks sign-in', () => {
  const limiter = createLoginLimiter({ now: () => 0, isKnownAccount: () => { throw new Error('disk'); } });
  const begun = limiter.begin('admin', '203.0.113.5');
  assert.equal(begun.ok, true);
  begun.ticket.fail();
});

test('store: real usernames are the admin and staff logins, case-insensitive', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'asoldi-known-'));
  try {
    const store = createStore(root);
    assert.equal(store.isKnownUsername('admin'), false, 'no admin yet');
    await store.setAdminCredentials('Owner', 'owner-pass-123');
    await store.createUser('emp', 'emp-pass-123', { rank: 'employee' });
    assert.equal(store.isKnownUsername('owner'), true);
    assert.equal(store.isKnownUsername(' OWNER '), true);
    assert.equal(store.isKnownUsername('EMP'), true);
    assert.equal(store.isKnownUsername('nobody'), false);
    assert.equal(store.isKnownUsername(''), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('shop limits use the same client address as sign-ins (the proxy hop, not the first forwarded entry)', () => {
  const req = (remoteAddress, xff) => ({
    socket: { remoteAddress },
    headers: xff === undefined ? {} : { 'x-forwarded-for': xff },
    get(name) { return this.headers[String(name).toLowerCase()]; },
    ip: remoteAddress,
  });
  assert.equal(shopClientIp(req('127.0.0.1', 'client-written, 203.0.113.9')), '203.0.113.9');
  assert.equal(shopClientIp(req('203.0.113.5', '198.51.100.1')), '203.0.113.5', 'a direct client cannot pick its address');
  assert.equal(shopClientIp(req('127.0.0.1')), '127.0.0.1');
  const sample = req('127.0.0.1', 'a, b, 203.0.113.44');
  assert.equal(shopClientIp(sample), clientIp(sample));
});
