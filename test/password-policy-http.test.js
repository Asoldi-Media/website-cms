import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TEST_ADMIN_PASSWORD } from './_admin.js';
import { bearer, bootCms, postJson } from './_cms-boot.js';

const WEAK = ['short', 'changeme', 'Change-Me', 'password', ' admin ', '12345678', 'administrator', 'passord'];

async function withCms(fn) {
  const dataPath = mkdtempSync(path.join(tmpdir(), 'asoldi-pw-policy-'));
  const cms = await bootCms({ dataPath, adminSecret: 'test-secret-for-policy' });
  try {
    const login = await postJson(`${cms.base}/admin/login`, { username: 'admin', password: TEST_ADMIN_PASSWORD });
    assert.equal(login.status, 200);
    await fn(cms, bearer(login.data.token));
  } finally {
    await cms.close();
    rmSync(dataPath, { recursive: true, force: true });
  }
}

async function putJson(url, body, headers) {
  const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
}

test('password policy: the admin cannot change to a short or well-known password', async () => {
  await withCms(async (cms, admin) => {
    for (const weak of WEAK) {
      const res = await postJson(`${cms.base}/admin/change-password`, { currentPassword: TEST_ADMIN_PASSWORD, newPassword: weak }, admin);
      assert.equal(res.status, 400, weak);
      assert.match(res.data.message, /8 characters/);
    }
    const tooLong = await postJson(`${cms.base}/admin/change-password`, { currentPassword: TEST_ADMIN_PASSWORD, newPassword: 'x'.repeat(1025) }, admin);
    assert.equal(tooLong.status, 400);
    const notText = await postJson(`${cms.base}/admin/change-password`, { currentPassword: TEST_ADMIN_PASSWORD, newPassword: { length: 20 } }, admin);
    assert.equal(notText.status, 400);
    assert.equal((await postJson(`${cms.base}/admin/login`, { username: 'admin', password: TEST_ADMIN_PASSWORD })).status, 200, 'the old password still works');
    const ok = await postJson(`${cms.base}/admin/change-password`, { currentPassword: TEST_ADMIN_PASSWORD, newPassword: 'a-new-own-pass-7' }, admin);
    assert.equal(ok.status, 200);
    assert.equal((await postJson(`${cms.base}/admin/login`, { username: 'admin', password: 'a-new-own-pass-7' })).status, 200);
  });
});

test('password policy: staff logins are created and updated with acceptable passwords only', async () => {
  await withCms(async (cms, admin) => {
    for (const weak of WEAK) {
      const res = await postJson(`${cms.base}/admin/users`, { username: `emp-${weak.trim()}`, password: weak, rank: 'employee' }, admin);
      assert.equal(res.status, 400, weak);
    }
    const created = await postJson(`${cms.base}/admin/users`, { username: 'emp', password: 'emp-pass-12', rank: 'employee' }, admin);
    assert.equal(created.status, 201);
    const id = created.data.id;
    for (const weak of WEAK) {
      const res = await putJson(`${cms.base}/admin/users/${id}`, { password: weak }, admin);
      assert.equal(res.status, 400, weak);
    }
    assert.equal((await postJson(`${cms.base}/auth/login`, { username: 'emp', password: 'emp-pass-12' })).status, 200, 'the stored password was not changed');
    assert.equal((await putJson(`${cms.base}/admin/users/${id}`, { name: 'Emp' }, admin)).status, 200, 'an update without a password is fine');
    assert.equal((await putJson(`${cms.base}/admin/users/${id}`, { password: 'emp-pass-13' }, admin)).status, 200);
    const staff = await postJson(`${cms.base}/auth/login`, { username: 'emp', password: 'emp-pass-13' });
    assert.equal(staff.status, 200);

    const staffAdmin = await postJson(`${cms.base}/admin/login`, { username: 'emp', password: 'emp-pass-13' });
    const own = await postJson(`${cms.base}/admin/change-password`, { currentPassword: 'emp-pass-13', newPassword: 'password' }, bearer(staffAdmin.data.token));
    assert.equal(own.status, 400, 'staff changing their own password follow the same rule');
  });
});
