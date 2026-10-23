// A booted CMS and a stand-in hub on 127.0.0.1: enrollment through the CMS proof route, the
// credential on hub calls only, the client admin password sync, and a revoke followed by a new
// enrollment. The stand-in hub checks proofs the way the real hub does (lib/site-credentials.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import express from 'express';
import { bootCms, listen, waitFor } from './_cms-boot.js';
import { cmsSecretsDir } from '../server/secret.js';

const SITE_KEY = 'enroll-site';
const sha = (value) => createHash('sha256').update(String(value)).digest('hex');

function tempData() {
  return mkdtempSync(join(tmpdir(), 'cms-hub-cred-http-'));
}

/** Stand-in hub: enroll (asks the CMS for the proof), site-config, heartbeat and shop status. */
async function credentialHub() {
  const state = { cmsOrigin: '', hash: '', enrollments: [], requests: [], heartbeats: [], pendingAdmin: null, enrollment: 'on' };
  const statusOf = (req) => {
    if (!state.hash) return 'not-enrolled';
    const sent = req.get('x-site-credential');
    if (!sent) return 'missing';
    return sha(sent) === state.hash ? 'valid' : 'invalid';
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    state.requests.push({ path: req.path, credential: req.get('x-site-credential') || '', key: req.get('x-site-key') || req.query.site_key || req.body?.site_key || '' });
    next();
  });
  app.post('/api/hub/site-credential/enroll', async (req, res) => {
    if (state.enrollment !== 'on') return res.status(503).json({ ok: false, code: 'enrollment-off' });
    const { siteKey, credential, nonce } = req.body || {};
    if (siteKey !== SITE_KEY) return res.status(401).json({ ok: false, code: 'unknown-site' });
    const answer = await fetch(`${state.cmsOrigin}/api/cms/hub-enroll-proof?nonce=${encodeURIComponent(nonce)}`);
    const body = await answer.json().catch(() => ({}));
    const expected = createHmac('sha256', credential).update(nonce).digest('hex');
    state.enrollments.push({ status: answer.status, matched: body.proof === expected, cacheControl: answer.headers.get('cache-control') });
    if (answer.status !== 200 || body.proof !== expected) return res.status(403).json({ ok: false, code: 'proof-mismatch' });
    state.hash = sha(credential);
    return res.json({ ok: true, kind: 'first' });
  });
  app.get('/api/hub/site-config', (req, res) => {
    const status = statusOf(req);
    res.set('x-site-credential-status', status);
    res.json({ name: 'Kafe', features: { users: true, ecommerce: true }, ...(status === 'valid' ? { pendingAdmin: state.pendingAdmin } : {}) });
  });
  app.post('/api/hub/heartbeat', (req, res) => {
    const status = statusOf(req);
    res.set('x-site-credential-status', status);
    state.heartbeats.push({ body: req.body, status });
    res.json({ ok: true, verified: status === 'valid' });
  });
  app.get('/api/hub/shop/status', (req, res) => {
    const status = statusOf(req);
    res.set('x-site-credential-status', status);
    if (status !== 'valid' && status !== 'not-enrolled') return res.status(401).json({ code: 'site-credential-required' });
    res.json({ stripe: { ready: false }, paypal: { ready: false } });
  });
  const server = await listen(app);
  return { state, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

function storedCredential(dataPath) {
  return JSON.parse(readFileSync(join(cmsSecretsDir(dataPath), 'hub-credential.json'), 'utf8')).credential;
}

test('a CMS enrolls through its own proof route and then sends its credential to the hub only', async () => {
  const hub = await credentialHub();
  const dataPath = tempData();
  const cms = await bootCms({ dataPath, hubUrl: hub.url, siteKey: SITE_KEY });
  hub.state.cmsOrigin = cms.origin;
  try {
    const config = await fetch(`${cms.base}/config`).then((r) => r.text());
    await waitFor(() => hub.state.hash, { timeoutMs: 10_000 });
    const credential = storedCredential(dataPath);
    assert.equal(hub.state.hash, sha(credential));
    assert.equal(hub.state.enrollments[0].matched, true);
    assert.equal(hub.state.enrollments[0].cacheControl, 'no-store');
    const enrollRequest = hub.state.requests.find((r) => r.path === '/api/hub/site-credential/enroll');
    assert.equal(enrollRequest.key, SITE_KEY);

    const after = await fetch(`${cms.base}/config`).then((r) => r.text());
    await waitFor(() => hub.state.heartbeats.find((b) => b.status === 'valid'));
    const configCall = hub.state.requests.filter((r) => r.path === '/api/hub/site-config').at(-1);
    assert.equal(configCall.credential, credential, 'site config is asked with the credential');
    for (const text of [config, after, JSON.stringify(hub.state.heartbeats.map((b) => b.body))]) {
      assert.equal(text.includes(credential), false, 'never in the public config or a heartbeat body');
    }
    const health = await fetch(`${cms.base}/capabilities`).then((r) => r.text());
    assert.equal(health.includes(credential), false);
    assert.equal((await fetch(`${cms.base}/hub-enroll-proof?nonce=${randomBytes(32).toString('base64url')}`)).status, 404);
    assert.equal((await fetch(`${cms.base}/hub-enroll-proof`)).status, 404);
  } finally {
    await cms.close();
    await hub.close();
    rmSync(dataPath, { recursive: true, force: true });
  }
});

test('the client admin password set in the hub reaches the CMS once it sends its credential', async () => {
  const hub = await credentialHub();
  const dataPath = tempData();
  const cms = await bootCms({ dataPath, hubUrl: hub.url, siteKey: SITE_KEY });
  hub.state.cmsOrigin = cms.origin;
  try {
    hub.state.pendingAdmin = { username: 'eier', passwordHash: bcrypt.hashSync('eier-kode-123', 4) };
    hub.state.enrollment = 'off';
    await fetch(`${cms.base}/config`);
    const login = () => fetch(`${cms.base}/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'eier', password: 'eier-kode-123' }) });
    assert.equal((await login()).status, 401, 'not enrolled: the hub keeps the password back');
    hub.state.enrollment = 'on';
    const credential = storedCredential(dataPath);
    // The enrollment pause after the switched-off hub is long; this test asks for an attempt now.
    const res = await fetch(`${hub.url}/api/hub/site-credential/enroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ siteKey: SITE_KEY, credential, nonce: randomBytes(32).toString('base64url') }),
    });
    assert.equal(res.status, 403, 'a nonce the CMS did not send gets no proof');
    hub.state.hash = sha(credential);
    await fetch(`${cms.base}/config`);
    assert.equal((await login()).status, 200);
    const beat = await waitFor(() => hub.state.heartbeats.find((b) => b.status === 'valid' && b.body.adminApplied === true));
    assert.ok(beat);
  } finally {
    await cms.close();
    await hub.close();
    rmSync(dataPath, { recursive: true, force: true });
  }
});

test('after the hub revokes the credential the CMS makes a new one and enrolls again', async () => {
  const hub = await credentialHub();
  const dataPath = tempData();
  const cms = await bootCms({ dataPath, hubUrl: hub.url, siteKey: SITE_KEY });
  hub.state.cmsOrigin = cms.origin;
  try {
    await fetch(`${cms.base}/config`);
    await waitFor(() => hub.state.hash, { timeoutMs: 10_000 });
    await waitFor(() => JSON.parse(readFileSync(join(cmsSecretsDir(dataPath), 'hub-credential.json'), 'utf8')).enrolledAt);
    const first = storedCredential(dataPath);
    hub.state.hash = '';
    await fetch(`${cms.base}/config`);
    await waitFor(() => hub.state.hash && hub.state.hash !== sha(first), { timeoutMs: 10_000 });
    const second = storedCredential(dataPath);
    assert.notEqual(second, first);
    assert.equal(hub.state.hash, sha(second));
    // Shop calls carry the new credential.
    await fetch(`${cms.base}/catalog`);
    const shopCall = await waitFor(() => hub.state.requests.find((r) => r.path === '/api/hub/shop/status' && r.credential === second));
    assert.ok(shopCall);
  } finally {
    await cms.close();
    await hub.close();
    rmSync(dataPath, { recursive: true, force: true });
  }
});

test('a CMS without a hub never makes or sends a credential', async () => {
  const dataPath = tempData();
  const cms = await bootCms({ dataPath, hubUrl: '', siteKey: SITE_KEY });
  try {
    assert.equal((await fetch(`${cms.base}/config`)).status, 200);
    assert.equal((await fetch(`${cms.base}/hub-enroll-proof?nonce=${randomBytes(32).toString('base64url')}`)).status, 404);
    assert.throws(() => storedCredential(dataPath));
  } finally {
    await cms.close();
    rmSync(dataPath, { recursive: true, force: true });
  }
});
