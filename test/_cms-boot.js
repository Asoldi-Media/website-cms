/** Boot helpers for the admin-access tests: a CMS on a random port and a fake hub that records calls. */
import { createHmac } from 'node:crypto';
import express from 'express';
import createCmsRoutes from '../server/routes.js';

export function listen(app) {
  return new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
}

/** CMS mounted at /api/cms. Omit adminSecret to use env or the private data folder. */
export async function bootCms({ dataPath, hubUrl = '', siteKey = 'access-site', adminSecret, siteSeed } = {}) {
  const app = express();
  app.use(express.json());
  const options = { dataPath, hubUrl, siteKey, siteSeed };
  if (adminSecret !== undefined) options.adminSecret = adminSecret;
  app.use('/api/cms', createCmsRoutes(options));
  const server = await listen(app);
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    base: `${origin}/api/cms`,
    close: () => new Promise((r) => server.close(r)),
  };
}

/** Hub stand-in for /api/hub/site-config and /api/hub/heartbeat. */
export async function fakeHub({ siteKey = 'access-site', config = {} } = {}) {
  const state = { configRequests: [], heartbeats: [], config };
  const app = express();
  app.use(express.json());
  app.get('/api/hub/site-config', (req, res) => {
    state.configRequests.push({ query: { ...req.query }, headerKey: req.get('x-site-key') || '' });
    const key = req.get('x-site-key') || req.query.site_key;
    if (key !== siteKey) return res.status(404).json({ message: 'Site not found' });
    res.json(state.config);
  });
  app.post('/api/hub/heartbeat', (req, res) => {
    state.heartbeats.push(req.body);
    res.json({ ok: true });
  });
  const server = await listen(app);
  return {
    state,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

/** Token in the CMS wire format, signed with any secret (used to prove other secrets are refused). */
export function tokenSignedWith(secret, payload) {
  const data = JSON.stringify(payload);
  const sig = createHmac('sha256', secret).update(data).digest('hex');
  return Buffer.from(JSON.stringify({ data, sig })).toString('base64url');
}

export async function waitFor(check, { timeoutMs = 5000, stepMs = 25 } = {}) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > until) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

export async function postJson(url, body, headers = {}) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data, headers: res.headers };
}

export const bearer = (token) => ({ Authorization: `Bearer ${token}` });
