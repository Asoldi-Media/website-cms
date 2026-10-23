import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TEST_ADMIN_PASSWORD } from './_admin.js';
import { bearer, bootCms, postJson, tokenSignedWith, waitFor } from './_cms-boot.js';
import { createTokenSigner, LOCAL_TOKEN_MS, LOGIN_TOKEN_MS, safeEqual } from '../server/admin-token.js';
import { KNOWN_DEFAULT_SECRETS } from '../server/secret.js';

const DAY = 86_400_000;

function tempData() {
  return mkdtempSync(path.join(tmpdir(), 'asoldi-token-'));
}

async function adminLogin(base) {
  return waitFor(async () => {
    const res = await postJson(`${base}/admin/login`, { username: 'admin', password: TEST_ADMIN_PASSWORD });
    return res.status === 200 ? res.data.token : null;
  });
}

/** Run fn with Date.now shifted forward. */
async function later(ms, fn) {
  const real = Date.now;
  const shifted = () => real() + ms;
  Date.now = shifted;
  try {
    return await fn();
  } finally {
    Date.now = real;
  }
}

test('signer: tokens carry at/exp, verify in constant time, and expire', () => {
  let clock = 1_000_000;
  const signer = createTokenSigner('unit-secret', { now: () => clock });
  const token = signer.sign({ role: 'admin', username: 'a' });
  const payload = signer.verify(token);
  assert.equal(payload.at, 1_000_000);
  assert.equal(payload.exp, 1_000_000 + LOGIN_TOKEN_MS);
  clock += LOGIN_TOKEN_MS;
  assert.ok(signer.verify(token), 'valid on the last millisecond');
  clock += 1;
  assert.equal(signer.verify(token), null, 'expired after 7 days');

  clock = 1_000_000;
  const short = signer.sign({ role: 'admin' }, LOCAL_TOKEN_MS);
  clock += LOCAL_TOKEN_MS + 1;
  assert.equal(signer.verify(short), null, 'local-open tokens last 12 hours');

  clock = 1_000_000;
  const legacy = tokenSignedWith('unit-secret', { role: 'admin', username: 'a', at: 1_000_000 });
  assert.ok(signer.verify(legacy), 'a token without exp lives 7 days from at');
  clock += 7 * DAY + 1;
  assert.equal(signer.verify(legacy), null);
  clock = 1_000_000;
  assert.equal(signer.verify(tokenSignedWith('unit-secret', { role: 'admin' })), null, 'no at and no exp: refused');

  const raw = JSON.parse(Buffer.from(token, 'base64url').toString());
  const tampered = Buffer.from(JSON.stringify({ data: raw.data.replace('"a"', '"b"'), sig: raw.sig })).toString('base64url');
  assert.equal(signer.verify(tampered), null);
  const shortSig = Buffer.from(JSON.stringify({ data: raw.data, sig: 'abc' })).toString('base64url');
  assert.equal(signer.verify(shortSig), null, 'a different-length signature is refused without throwing');
  assert.equal(signer.verify('not-base64-json'), null);
  assert.equal(signer.verify(tokenSignedWith('other-secret', { role: 'admin', at: clock })), null);
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('', ''), false);
});

test('HTTP: with no env secret, tokens signed with any placeholder secret get 401', async () => {
  delete process.env.CMS_ADMIN_SECRET;
  delete process.env.ADMIN_SECRET;
  const root = tempData();
  const cms = await bootCms({ dataPath: root });
  try {
    for (const secret of KNOWN_DEFAULT_SECRETS) {
      const placeholderToken = tokenSignedWith(secret, { role: 'admin', username: 'admin', rank: 'admin', at: Date.now() });
      const res = await fetch(`${cms.base}/admin/me`, { headers: bearer(placeholderToken) });
      assert.equal(res.status, 401, secret);
    }
    const token = await adminLogin(cms.base);
    const me = await fetch(`${cms.base}/admin/me`, { headers: bearer(token) });
    assert.equal(me.status, 200, 'a real login still works');
  } finally {
    await cms.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('HTTP: login tokens expire after 7 days (clock moved forward)', async () => {
  const root = tempData();
  const cms = await bootCms({ dataPath: root });
  try {
    const token = await adminLogin(cms.base);
    const payload = JSON.parse(JSON.parse(Buffer.from(token, 'base64url').toString()).data);
    assert.equal(payload.exp - payload.at, LOGIN_TOKEN_MS);
    const day6 = await later(6 * DAY, () => fetch(`${cms.base}/admin/me`, { headers: bearer(token) }));
    assert.equal(day6.status, 200);
    const day8 = await later(7 * DAY + 60_000, () => fetch(`${cms.base}/admin/me`, { headers: bearer(token) }));
    assert.equal(day8.status, 401);
  } finally {
    await cms.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('HTTP: a restart keeps sessions and the cart cookie (same secret on disk)', async () => {
  process.env.CMS_DEV_ECOMMERCE = '1';
  const root = tempData();
  let cms = await bootCms({ dataPath: root });
  let token;
  let cookie;
  try {
    token = await adminLogin(cms.base);
    const product = await postJson(`${cms.base}/products`, { name: 'Kaffe', price: 120, productType: 'normal' }, bearer(token));
    assert.equal(product.status, 201);
    const add = await fetch(`${cms.base}/cart/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ product: product.data.id, quantity: '2' }),
      redirect: 'manual',
    });
    assert.equal(add.status, 303);
    cookie = add.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    assert.ok(cookie, 'cart cookie set');
  } finally {
    await cms.close();
  }
  cms = await bootCms({ dataPath: root });
  try {
    const me = await fetch(`${cms.base}/admin/me`, { headers: bearer(token) });
    assert.equal(me.status, 200, 'admin session survives a restart');
    const cart = await fetch(`${cms.base}/cart.json`, { headers: { Cookie: cookie } }).then((r) => r.json());
    assert.equal(cart.items.length, 1, 'cart survives a restart');
    assert.equal(cart.items[0].quantity, 2);
  } finally {
    await cms.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('HTTP: local-open sessions last 12 hours', async () => {
  process.env.CMS_LOCAL_OPEN = '1';
  const root = tempData();
  const cms = await bootCms({ dataPath: root });
  try {
    const session = await fetch(`${cms.base}/admin/local-session`).then((r) => r.json());
    const payload = JSON.parse(JSON.parse(Buffer.from(session.token, 'base64url').toString()).data);
    assert.equal(payload.exp - payload.at, LOCAL_TOKEN_MS);
    const after = await later(LOCAL_TOKEN_MS + 60_000, () => fetch(`${cms.base}/admin/me`, { headers: bearer(session.token) }));
    assert.equal(after.status, 401);
  } finally {
    delete process.env.CMS_LOCAL_OPEN;
    await cms.close();
    rmSync(root, { recursive: true, force: true });
  }
});
