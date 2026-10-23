import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TEST_ADMIN_PASSWORD } from './_admin.js';
import { bearer, bootCms, postJson, waitFor } from './_cms-boot.js';
import { clientIp, createLoginLimiter } from '../server/login-limiter.js';

test('limiter: per account and per IP, with a sliding window', () => {
  let clock = 0;
  const limiter = createLoginLimiter({ windowMs: 1000, maxPerAccount: 3, maxPerIp: 5, now: () => clock });
  for (let i = 0; i < 3; i += 1) limiter.fail('Admin', '1.1.1.1');
  const blocked = limiter.check('admin', '9.9.9.9');
  assert.equal(blocked.ok, false, 'usernames are case-insensitive');
  assert.equal(blocked.retryAfterSec, 1);
  assert.equal(limiter.check('other', '1.1.1.1').ok, true);
  limiter.fail('a', '1.1.1.1');
  limiter.fail('b', '1.1.1.1');
  assert.equal(limiter.check('c', '1.1.1.1').ok, false, 'five failures from one IP block that IP');
  assert.equal(limiter.check('c', '2.2.2.2').ok, true);
  clock = 1001;
  assert.equal(limiter.check('admin', '1.1.1.1').ok, true, 'the window slides');
  limiter.fail('x', '');
  limiter.fail('x', '');
  limiter.succeed('x');
  assert.equal(limiter.check('x', '').ok, true, 'a success clears the account');
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } }), '203.0.113.9');
  assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }), '127.0.0.1');
});

test('HTTP: ten wrong passwords lock /admin/login for that username, with Retry-After', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'asoldi-limit-'));
  const cms = await bootCms({ dataPath: root });
  try {
    await waitFor(async () => (await postJson(`${cms.base}/admin/login`, { username: 'admin', password: TEST_ADMIN_PASSWORD })).status === 200);
    for (let i = 0; i < 10; i += 1) {
      const res = await postJson(`${cms.base}/admin/login`, { username: 'admin', password: `wrong-${i}` }, { 'x-forwarded-for': `198.51.100.${i}` });
      assert.equal(res.status, 401);
    }
    const locked = await postJson(`${cms.base}/admin/login`, { username: 'admin', password: TEST_ADMIN_PASSWORD }, { 'x-forwarded-for': '198.51.100.99' });
    assert.equal(locked.status, 429, 'even the right password waits');
    assert.ok(Number(locked.headers.get('retry-after')) > 0);

    const otherAccount = await postJson(`${cms.base}/admin/login`, { username: 'someone', password: 'nope-nope' });
    assert.equal(otherAccount.status, 401, 'another username is not locked');
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
