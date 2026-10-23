// CMS 1.7.2 with a stand-in hub on 127.0.0.1: the site enrolls through its proof route, then the
// pending client admin password arrives with the credential, and the credential stays out of the
// public config and the heartbeat body.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import express from 'express';
import createCmsRoutes from '../server/routes.js';
import { cmsSecretsDir } from '../server/hub-credential.js';

const SITE_KEY = 'legacy-enroll-site';
const sha = (value) => createHash('sha256').update(String(value)).digest('hex');

function listen(app) {
  return new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
}

async function waitFor(check, { timeoutMs = 10_000, stepMs = 25 } = {}) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > until) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

async function standInHub() {
  const state = { cmsOrigin: '', hash: '', requests: [], heartbeats: [], pendingAdmin: null };
  const statusOf = (req) => {
    if (!state.hash) return 'not-enrolled';
    const sent = req.get('x-site-credential');
    if (!sent) return 'missing';
    return sha(sent) === state.hash ? 'valid' : 'invalid';
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    state.requests.push({ path: req.path, credential: req.get('x-site-credential') || '' });
    next();
  });
  app.post('/api/hub/site-credential/enroll', async (req, res) => {
    const { siteKey, credential, nonce } = req.body || {};
    if (siteKey !== SITE_KEY) return res.status(401).json({ ok: false });
    const answer = await fetch(`${state.cmsOrigin}/api/cms/hub-enroll-proof?nonce=${encodeURIComponent(nonce)}`);
    const body = await answer.json().catch(() => ({}));
    if (body.proof !== createHmac('sha256', credential).update(nonce).digest('hex')) return res.status(403).json({ ok: false, code: 'proof-mismatch' });
    state.hash = sha(credential);
    return res.json({ ok: true, kind: 'first' });
  });
  app.get('/api/hub/site-config', (req, res) => {
    const status = statusOf(req);
    res.set('x-site-credential-status', status);
    res.json({ name: 'Kafe', features: { users: true }, ...(status === 'valid' ? { pendingAdmin: state.pendingAdmin } : {}) });
  });
  app.post('/api/hub/heartbeat', (req, res) => {
    const status = statusOf(req);
    res.set('x-site-credential-status', status);
    state.heartbeats.push({ body: req.body, status });
    res.json({ ok: true });
  });
  const server = await listen(app);
  return { state, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

test('CMS 1.7.2 enrolls through its proof route, then gets the client admin password with its credential', async () => {
  const hub = await standInHub();
  const dataPath = mkdtempSync(path.join(tmpdir(), 'cms17-hub-cred-'));
  const app = express();
  app.use(express.json());
  app.use('/api/cms', createCmsRoutes({ hubUrl: hub.url, siteKey: SITE_KEY, dataPath, adminSecret: 'x'.repeat(40) }));
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}/api/cms`;
  hub.state.cmsOrigin = `http://127.0.0.1:${server.address().port}`;
  try {
    hub.state.pendingAdmin = { username: 'eier', passwordHash: bcrypt.hashSync('eier-kode-123', 4) };
    const first = await fetch(`${base}/config`).then((r) => r.text());
    await waitFor(() => hub.state.hash);
    const credential = JSON.parse(readFileSync(path.join(cmsSecretsDir(dataPath), 'hub-credential.json'), 'utf8')).credential;
    assert.equal(hub.state.hash, sha(credential));
    const login = () => fetch(`${base}/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'eier', password: 'eier-kode-123' }) });
    const second = await fetch(`${base}/config`).then((r) => r.text());
    assert.equal((await login()).status, 200, 'the hub password landed');
    const beat = await waitFor(() => hub.state.heartbeats.find((b) => b.status === 'valid' && b.body.adminApplied === true));
    assert.ok(beat);
    for (const text of [first, second, JSON.stringify(hub.state.heartbeats.map((b) => b.body))]) {
      assert.equal(text.includes(credential), false);
    }
    assert.equal((await fetch(`${base}/hub-enroll-proof?nonce=${randomBytes(32).toString('base64url')}`)).status, 404);
  } finally {
    await new Promise((r) => server.close(r));
    await hub.close();
    rmSync(dataPath, { recursive: true, force: true });
  }
});
