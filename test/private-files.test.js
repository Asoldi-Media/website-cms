import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bearer, bootCms, postJson, waitFor } from './_cms-boot.js';
import { cmsSecretsDir, readInitialAdminFile } from '../server/secret.js';
import { hashToken } from '../server/shop/index.js';

for (const name of ['CMS_ADMIN_PASSWORD', 'ADMIN_PASSWORD', 'CMS_ADMIN_SECRET', 'ADMIN_SECRET']) delete process.env[name];
process.env.CMS_DEV_ECOMMERCE = '1';

/** Owner token for a fresh site: the generated one-time login. */
async function ownerToken(base, root) {
  const initial = await waitFor(() => readInitialAdminFile(root));
  return waitFor(async () => {
    const r = await postJson(`${base}/admin/login`, { username: initial.username, password: initial.password });
    return r.status === 200 ? r.data.token : null;
  });
}

test('shop file routes never list, delete or serve the secrets folder', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'asoldi-private-'));
  const cms = await bootCms({ dataPath: root });
  try {
    const token = await ownerToken(cms.base, root);
    const secretsFile = path.join(cmsSecretsDir(root), 'secrets.json');
    assert.ok(existsSync(secretsFile));
    writeFileSync(path.join(root, 'cms', 'private', 'manual.pdf'), '%PDF-1.4 test');

    const files = await fetch(`${cms.base}/shop/admin/files`, { headers: bearer(token) }).then((r) => r.json());
    assert.deepEqual(files.map((f) => f.file), ['manual.pdf'], 'only plain shop files are listed');

    const del = await fetch(`${cms.base}/shop/admin/files/secrets`, { method: 'DELETE', headers: bearer(token) });
    assert.equal(del.status, 404);
    assert.ok(existsSync(secretsFile));

    // A digital product pointed at the folder, or at a path inside it, cannot download it.
    const product = await postJson(`${cms.base}/products`, {
      name: 'Bok',
      price: 99,
      productType: 'normal',
      kind: 'digital',
      digitalFiles: [{ id: 'dir', name: 'x', file: 'secrets' }, { id: 'inside', name: 'y', file: 'secrets/secrets.json' }, { id: 'ok', name: 'manual.pdf', file: 'manual.pdf' }],
    }, bearer(token));
    assert.equal(product.status, 201, JSON.stringify(product.data));
    assert.equal(product.data.digitalFiles.find((f) => f.id === 'inside').file, 'secretssecrets.json', 'slashes are stripped from file names');
    const grants = ['dir', 'inside', 'ok'].map((fileId) => ({ id: fileId, tokenHash: hashToken(`tok-${fileId}`), productId: product.data.id, fileId, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), downloadsLeft: 3 }));
    mkdirSync(path.join(root, 'cms', 'shop'), { recursive: true });
    writeFileSync(path.join(root, 'cms', 'shop', 'downloads.json'), JSON.stringify(grants));

    for (const fileId of ['dir', 'inside']) {
      const res = await fetch(`${cms.base}/downloads/tok-${fileId}`);
      assert.equal(res.status, 404, fileId);
      assert.equal((await res.text()).includes(JSON.parse(readFileSync(secretsFile, 'utf8')).adminSecret), false);
    }
    const ok = await fetch(`${cms.base}/downloads/tok-ok`);
    assert.equal(ok.status, 200, 'a real shop file still downloads');
    assert.equal(await ok.text(), '%PDF-1.4 test');
    assert.equal((await fetch(`${cms.base}/admin/me`, { headers: bearer(token) })).status, 200, 'the server is still up');
  } finally {
    await cms.close();
    rmSync(root, { recursive: true, force: true });
  }
});
