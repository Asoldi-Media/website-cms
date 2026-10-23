import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import createCmsRoutes from '../server/routes.js';
import { createSsoVerifier, hubBase } from '../server/sso.js';
import { listen } from './_cms-boot.js';

const SITE_KEY = 'site-key-sso';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Hub stand-in for POST /api/cms/sso/redeem: one use per token, for the site it was issued to, within 60 s. */
async function fakeHub() {
  const state = { calls: [], tokens: new Map(), mode: 'normal' };
  const app = express();
  app.use(express.json());
  app.post('/api/cms/sso/redeem', async (req, res) => {
    state.calls.push({ key: req.get('x-site-key') || '', token: req.body?.token });
    if (state.mode === 'error') return res.status(500).json({ ok: true });
    if (state.mode === 'not-json') return res.type('text').send('ok');
    if (state.mode === 'ok-false') return res.json({ ok: false });
    if (state.mode === 'redirect') return res.redirect(307, '/api/cms/sso/elsewhere');
    if (state.mode === 'slow') await sleep(1500);
    const row = state.tokens.get(req.body?.token);
    if (!row || row.used || row.siteKey !== req.get('x-site-key') || row.exp < Date.now()) return res.status(401).json({ ok: false, message: 'Unauthorized.' });
    row.used = true;
    return res.json({ ok: true, by: row.by });
  });
  app.post('/api/cms/sso/elsewhere', (_req, res) => res.json({ ok: true, by: 'redirected' }));
  const server = await listen(app);
  return {
    state,
    url: `http://127.0.0.1:${server.address().port}`,
    issue(siteKey = SITE_KEY, by = 'staff@example.com') {
      const token = randomBytes(32).toString('base64url');
      state.tokens.set(token, { siteKey, by, exp: Date.now() + 60_000 });
      return token;
    },
    close: () => new Promise((r) => server.close(r)),
  };
}

async function withCms(fn, { siteKey = SITE_KEY, hubUrl } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'asoldi-sso-'));
  const app = express();
  app.use(express.json());
  app.use('/api/cms', createCmsRoutes({ dataPath: root, siteKey, hubUrl, adminSecret: 'test-secret' }));
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}/api/cms`;
  try {
    await fn(base);
  } finally {
    await new Promise((r) => server.close(r));
    rmSync(root, { recursive: true, force: true });
  }
}

/** The earlier link format: signed with the site key. 2.2.1 must refuse it. */
function siteKeySigned({ key = SITE_KEY, exp = Date.now() + 60_000, nonce = randomBytes(16).toString('hex'), by = 'someone' } = {}) {
  const data = JSON.stringify({ sid: '1', n: nonce, exp, by });
  const sig = createHmac('sha256', key).update(data).digest('hex');
  return Buffer.from(JSON.stringify({ data, sig })).toString('base64url');
}

function tokenFromHtml(html) {
  return JSON.parse(html.match(/setItem\('adminToken',("[^"]+")\)/)[1]);
}

test('HS-2: a hub-issued link is checked with the hub, logs in once as asoldi-support and is audited', async () => {
  const hub = await fakeHub();
  try {
    await withCms(async (base) => {
      const link = hub.issue();
      const first = await fetch(`${base}/admin/sso?token=${link}`);
      assert.equal(first.status, 200);
      assert.equal(first.headers.get('cache-control'), 'no-store');
      assert.equal(first.headers.get('referrer-policy'), 'no-referrer');
      assert.deepEqual(hub.state.calls, [{ key: SITE_KEY, token: link }], 'one server-to-server check with this site key');
      const token = tokenFromHtml(await first.text());
      const me = await fetch(`${base}/admin/me`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
      assert.equal(me.username, 'asoldi-support');
      assert.equal(me.rank, 'admin');

      const replay = await fetch(`${base}/admin/sso?token=${link}`);
      assert.equal(replay.status, 401, 'the token is burned');
      assert.equal(hub.state.calls.length, 1, 'a replay is refused here before the hub is asked');

      const audit = await fetch(`${base}/admin/audit`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
      assert.equal(audit[0].action, 'sso-login');
      assert.equal(audit[0].by, 'staff@example.com');
    }, { hubUrl: hub.url });
  } finally {
    await hub.close();
  }
});

test('HS-3: a link signed with the site key gets 401 and never reaches the hub', async () => {
  const hub = await fakeHub();
  try {
    await withCms(async (base) => {
      for (const link of [siteKeySigned(), siteKeySigned({ exp: Date.now() + 30_000, by: 'other' })]) {
        const res = await fetch(`${base}/admin/sso?token=${encodeURIComponent(link)}`);
        assert.equal(res.status, 401);
        assert.doesNotMatch(await res.text(), /adminToken/);
      }
      assert.equal(hub.state.calls.length, 0);
    }, { hubUrl: hub.url });
  } finally {
    await hub.close();
  }
});

test('HS-3: tokens the hub refuses (another site, unknown, already used there) get 401', async () => {
  const hub = await fakeHub();
  try {
    await withCms(async (base) => {
      const otherSite = hub.issue('another-site-key');
      const unknown = randomBytes(32).toString('base64url');
      const usedAtHub = hub.issue();
      hub.state.tokens.get(usedAtHub).used = true;
      for (const link of [otherSite, unknown, usedAtHub, 'not-a-token', '']) {
        const res = await fetch(`${base}/admin/sso?token=${encodeURIComponent(link)}`);
        assert.equal(res.status, 401, link || '(empty)');
      }
      assert.equal(hub.state.calls.length, 3, 'only well-formed tokens are sent to the hub');
      assert.ok(hub.state.calls.every((c) => c.key === SITE_KEY));
      assert.equal(hub.state.tokens.get(otherSite).used, undefined, 'the other site’s token was not used up');
    }, { hubUrl: hub.url });
  } finally {
    await hub.close();
  }
});

test('HS-3: an unreachable hub, an error, a redirect or any answer but ok:true refuses the link', async () => {
  const dead = await listen(express());
  const deadUrl = `http://127.0.0.1:${dead.address().port}`;
  await new Promise((r) => dead.close(r));
  await withCms(async (base) => {
    const res = await fetch(`${base}/admin/sso?token=${randomBytes(32).toString('base64url')}`);
    assert.equal(res.status, 401, 'hub down');
  }, { hubUrl: deadUrl });

  const hub = await fakeHub();
  try {
    await withCms(async (base) => {
      for (const mode of ['error', 'not-json', 'ok-false', 'redirect']) {
        hub.state.mode = mode;
        const res = await fetch(`${base}/admin/sso?token=${hub.issue()}`);
        assert.equal(res.status, 401, mode);
      }
    }, { hubUrl: hub.url });
  } finally {
    await hub.close();
  }
});

test('HS-3: a hub that does not answer in time refuses the link', async () => {
  const hub = await fakeHub();
  const root = mkdtempSync(path.join(tmpdir(), 'asoldi-sso-slow-'));
  try {
    hub.state.mode = 'slow';
    const sso = createSsoVerifier({ dataPath: root, siteKey: SITE_KEY, hubUrl: hub.url, timeoutMs: 200 });
    const started = Date.now();
    const result = await sso.verify(hub.issue());
    assert.deepEqual(result, { ok: false, reason: 'hub-unreachable' });
    assert.ok(Date.now() - started < 1400, 'gave up at the timeout');
  } finally {
    await hub.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('HS-3: the hub address comes from the server config only', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'asoldi-sso-cfg-'));
  try {
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push({ url, key: init.headers['x-site-key'], redirect: init.redirect });
      return new Response(JSON.stringify({ ok: true, by: 'staff' }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const sso = createSsoVerifier({ dataPath: root, siteKey: SITE_KEY, hubUrl: 'https://hub.example/', fetchImpl });
    const result = await sso.verify(randomBytes(32).toString('base64url'));
    assert.equal(result.ok, true);
    assert.deepEqual(seen, [{ url: 'https://hub.example/api/cms/sso/redeem', key: SITE_KEY, redirect: 'error' }]);
    for (const bad of ['', 'ftp://hub.example', 'javascript:alert(1)', 'https://user:pw@hub.example', 'not a url']) assert.equal(hubBase(bad), '', bad);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  const hub = await fakeHub();
  try {
    await withCms(async (base) => {
      const res = await fetch(`${base}/admin/sso?token=${hub.issue()}&hubUrl=http://127.0.0.1:9`, { headers: { 'X-Forwarded-Host': 'elsewhere.example' } });
      assert.equal(res.status, 200);
      assert.equal(hub.state.calls.length, 1, 'request parameters and headers do not move the check');
    }, { hubUrl: hub.url });
  } finally {
    await hub.close();
  }
});

test('HS-3: failed links are limited per address', async () => {
  const hub = await fakeHub();
  try {
    await withCms(async (base) => {
      for (let i = 0; i < 10; i += 1) {
        assert.equal((await fetch(`${base}/admin/sso?token=${randomBytes(32).toString('base64url')}`)).status, 401);
      }
      const limited = await fetch(`${base}/admin/sso?token=${hub.issue()}`);
      assert.equal(limited.status, 429);
      assert.ok(Number(limited.headers.get('retry-after')) > 0);
      assert.equal(hub.state.calls.length, 10, 'a limited address does not reach the hub');
    }, { hubUrl: hub.url });
  } finally {
    await hub.close();
  }
});

test('HS-3: a site without a site key or hub has no SSO, and sessions expire', async () => {
  const hub = await fakeHub();
  try {
    await withCms(async (base) => {
      assert.equal((await fetch(`${base}/admin/sso?token=${hub.issue()}`)).status, 404);
    }, { siteKey: '', hubUrl: hub.url });
    await withCms(async (base) => {
      assert.equal((await fetch(`${base}/admin/sso?token=${hub.issue()}`)).status, 404);
    }, { hubUrl: '' });
    assert.equal(hub.state.calls.length, 0);
  } finally {
    await hub.close();
  }

  await withCms(async (base) => {
    const data = JSON.stringify({ role: 'admin', username: 'asoldi-support', rank: 'admin', at: 1, exp: Date.now() - 1 });
    const sig = createHmac('sha256', 'test-secret').update(data).digest('hex');
    const stale = Buffer.from(JSON.stringify({ data, sig })).toString('base64url');
    assert.equal((await fetch(`${base}/admin/me`, { headers: { Authorization: `Bearer ${stale}` } })).status, 401);
  }, { hubUrl: '' });
});
