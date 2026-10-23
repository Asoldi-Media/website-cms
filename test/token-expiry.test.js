import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { TOKEN_TTL_MS, createTokenSigner, isTokenLive, safeEqual } from '../server/auth-hardening.js';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 24, 12, 0, 0);

function clock(start) {
  let now = start;
  return { now: () => now, set: (value) => (now = value) };
}

function rawToken(secret, payload) {
  const data = JSON.stringify(payload);
  const sig = createHmac('sha256', secret).update(data).digest('hex');
  return Buffer.from(JSON.stringify({ data, sig })).toString('base64url');
}

test('login tokens carry exp and expire after 7 days', () => {
  const c = clock(T0);
  const signer = createTokenSigner('unit-test-secret-value', { now: c.now });
  const token = signer.sign({ role: 'admin', username: 'admin', rank: 'admin', at: T0 });
  const payload = signer.verify(token);
  assert.equal(payload.role, 'admin');
  assert.equal(payload.exp, T0 + 7 * DAY);
  assert.equal(TOKEN_TTL_MS, 7 * DAY);
  c.set(T0 + 7 * DAY - 1000);
  assert.ok(signer.verify(token), 'still valid just before 7 days');
  c.set(T0 + 7 * DAY + 1000);
  assert.equal(signer.verify(token), null, 'refused after 7 days');
});

test('tokens issued without exp (earlier releases) live 7 days from at', () => {
  const c = clock(T0 + 6 * DAY);
  const signer = createTokenSigner('unit-test-secret-value', { now: c.now });
  const legacy = rawToken('unit-test-secret-value', { role: 'admin', username: 'admin', at: T0 });
  assert.ok(signer.verify(legacy));
  c.set(T0 + 8 * DAY);
  assert.equal(signer.verify(legacy), null);
  assert.equal(signer.verify(rawToken('unit-test-secret-value', { role: 'admin', username: 'admin' })), null, 'no at and no exp');
});

test('tokens from the future, other secrets or with a bad signature are refused', () => {
  const c = clock(T0);
  const signer = createTokenSigner('unit-test-secret-value', { now: c.now });
  assert.equal(signer.verify(rawToken('unit-test-secret-value', { role: 'admin', at: T0 + DAY })), null);
  assert.equal(signer.verify(rawToken('change-me', { role: 'admin', username: 'admin', at: T0 })), null);
  const good = JSON.parse(Buffer.from(signer.sign({ role: 'admin', at: T0 }), 'base64url').toString());
  const shortSig = Buffer.from(JSON.stringify({ data: good.data, sig: good.sig.slice(0, 10) })).toString('base64url');
  assert.equal(signer.verify(shortSig), null);
  const flipped = Buffer.from(JSON.stringify({ data: good.data, sig: `${good.sig.slice(0, -1)}${good.sig.endsWith('0') ? '1' : '0'}` })).toString('base64url');
  assert.equal(signer.verify(flipped), null);
  assert.equal(signer.verify('not-a-token'), null);
  assert.equal(signer.verify(''), null);
  assert.equal(signer.verify(Buffer.from(JSON.stringify({ data: 1, sig: [] })).toString('base64url')), null);
});

test('safeEqual and isTokenLive edge cases', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual('', ''), false);
  assert.equal(isTokenLive(null, T0), false);
  assert.equal(isTokenLive({ exp: 'soon' }, T0), false);
  assert.equal(isTokenLive({ at: T0, exp: T0 + 1 }, T0), true);
});
