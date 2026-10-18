import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import createCmsRoutes from '../server/routes.js';

const SITE_KEY = 'site-key-sso';

/** Same format the hub mints in lib/cms-sso.js. */
function mint({ key = SITE_KEY, exp = Date.now() + 60_000, nonce = randomBytes(16).toString('hex'), by = 'damian@asoldi.com' } = {}) {
  const data = JSON.stringify({ sid: '1', n: nonce, exp, by });
  const sig = createHmac('sha256', key).update(data).digest('hex');
  return Buffer.from(JSON.stringify({ data, sig })).toString('base64url');
}

async function withCms(fn, { siteKey = SITE_KEY } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'asoldi-sso-'));
  const app = express();
  app.use(express.json());
  app.use('/api/cms', createCmsRoutes({ dataPath: root, siteKey, adminSecret: 'test-secret' }));
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/cms`;
  try {
    await fn(base);
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function tokenFromHtml(html) {
  return JSON.parse(html.match(/setItem\('adminToken',("[^"]+")\)/)[1]);
}

test('HS-2: a hub-signed link logs in once as asoldi-support and is audited', async () => {
  await withCms(async (base) => {
    const link = mint();
    const first = await fetch(`${base}/admin/sso?token=${link}`);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('cache-control'), 'no-store');
    assert.equal(first.headers.get('referrer-policy'), 'no-referrer');
    const token = tokenFromHtml(await first.text());
    const me = await fetch(`${base}/admin/me`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
    assert.equal(me.username, 'asoldi-support');
    assert.equal(me.rank, 'admin');

    const replay = await fetch(`${base}/admin/sso?token=${link}`);
    assert.equal(replay.status, 401, 'nonce is burned');

    const audit = await fetch(`${base}/admin/audit`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
    assert.equal(audit[0].action, 'sso-login');
    assert.equal(audit[0].by, 'damian@asoldi.com');
  });
});

test('HS-3: wrong key, expired, too-long-lived and malformed links are refused', async () => {
  await withCms(async (base) => {
    for (const link of [
      mint({ key: 'other-site-key' }),
      mint({ exp: Date.now() - 1000 }),
      mint({ exp: Date.now() + 10 * 60_000 }),
      mint({ nonce: 'short' }),
      'not-a-token',
    ]) {
      const res = await fetch(`${base}/admin/sso?token=${encodeURIComponent(link)}`);
      assert.equal(res.status, 401, link.slice(0, 20));
    }
  });
});

test('HS-3: a site without a site key has no SSO, and sessions expire', async () => {
  await withCms(async (base) => {
    assert.equal((await fetch(`${base}/admin/sso?token=${mint()}`)).status, 404);
  }, { siteKey: '' });

  await withCms(async (base) => {
    const data = JSON.stringify({ role: 'admin', username: 'asoldi-support', rank: 'admin', at: 1, exp: Date.now() - 1 });
    const sig = createHmac('sha256', 'test-secret').update(data).digest('hex');
    const stale = Buffer.from(JSON.stringify({ data, sig })).toString('base64url');
    assert.equal((await fetch(`${base}/admin/me`, { headers: { Authorization: `Bearer ${stale}` } })).status, 401);
  });
});
