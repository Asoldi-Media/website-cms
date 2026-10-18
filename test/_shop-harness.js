/** Shared setup for the shop HTTP tests: a fake asoldi.com hub + a cookie-keeping browser. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import createCmsRoutes from '../server/routes.js';

export const SITE_KEY = 'site-key-1';

export function listen(app) {
  return new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
}

function sessionAmount(s) {
  const lines = (s.lineItems || []).reduce((sum, l) => sum + l.unitAmount * l.quantity, 0);
  const recurring = s.trialDays ? 0 : (s.recurringLines || []).reduce((sum, l) => sum + l.unitAmount * l.quantity, 0);
  return lines + (s.shipping?.amountMinor || 0) + recurring + (s.tamper || 0);
}

/** Answers like the real hub routes in asoldi-website lib/shop-payments*.js and records every call. */
export function fakeHub() {
  const state = { calls: [], stripeReady: true, paypalReady: true, sessions: new Map(), orders: new Map(), documents: [], refunds: [], formPosts: [], invoices: new Map(), subscriptions: new Map(), failDocuments: false };
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/client-forms/')) {
      state.formPosts.push(req.body);
      return res.json({ ok: true });
    }
    if (req.get('x-site-key') !== SITE_KEY) return res.status(401).json({ message: 'Unknown site.' });
    state.calls.push(`${req.method} ${req.path}`);
    next();
  });
  app.get('/api/hub/shop/status', (_req, res) => {
    res.json({
      stripe: { available: true, connected: state.stripeReady, ready: state.stripeReady },
      paypal: { available: true, connected: state.paypalReady, ready: state.paypalReady, method: 'email' },
    });
  });
  app.post('/api/hub/shop/stripe/connect', (req, res) => res.json({ url: `https://connect.stripe.test/?back=${encodeURIComponent(req.body.returnUrl)}` }));
  app.post('/api/hub/shop/paypal/connect', (_req, res) => res.json({ url: 'https://paypal.test/onboard' }));
  app.post('/api/hub/shop/disconnect', (_req, res) => res.json({ ok: true }));
  app.post('/api/hub/shop/stripe/checkout', (req, res) => {
    const id = `cs_test_${state.sessions.size + 1}`;
    state.sessions.set(id, { ...req.body, paid: false, status: 'open' });
    res.json({ id, url: `https://checkout.stripe.test/${id}` });
  });
  app.get('/api/hub/shop/stripe/session/:id', (req, res) => {
    const s = state.sessions.get(req.params.id);
    if (!s) return res.status(404).json({ message: 'nope' });
    const sub = s.mode === 'subscription';
    res.json({
      provider: 'stripe',
      id: req.params.id,
      ref: s.ref,
      paid: s.paid,
      status: s.status,
      amountMinor: sessionAmount(s),
      currency: s.currency,
      customerName: 'Ola Nordmann',
      customerEmail: s.customerEmail || 'ola@example.com',
      customerPhone: '+4790000000',
      shippingAddress: 'Ola, Gate 1, 7014 Trondheim, NO',
      shippingAddressParts: { line: 'Ola, Gate 1, 7014 Trondheim, NO', city: 'Trondheim', postal: '7014', country: 'NO' },
      paymentRef: `pi_${req.params.id}`,
      customerId: 'cus_test_1',
      subscriptionId: sub ? `sub_${req.params.id}` : '',
      subscriptionStatus: sub ? (s.trialDays ? 'trialing' : 'active') : '',
      currentPeriodEnd: sub ? new Date(Date.now() + 30 * 86_400_000).toISOString() : '',
    });
  });
  app.post('/api/hub/shop/paypal/order', (req, res) => {
    const id = `PPORDER${state.orders.size + 1}XX`;
    state.orders.set(id, { ...req.body, approved: false });
    res.json({ id, url: `https://paypal.test/checkoutnow?token=${id}` });
  });
  app.post('/api/hub/shop/paypal/capture', (req, res) => {
    const o = state.orders.get(req.body.orderId);
    if (!o) return res.status(404).json({ message: 'nope' });
    res.json({ provider: 'paypal', id: req.body.orderId, ref: o.ref, paid: o.approved, amountMinor: sessionAmount(o), currency: o.currency, customerName: 'Kari', customerEmail: 'kari@example.com', paymentRef: 'CAPTURE1' });
  });
  app.post('/api/hub/shop/document', (req, res) => {
    if (state.failDocuments) return res.status(502).json({ message: 'mail down' });
    state.documents.push(req.body);
    res.json({ ok: true });
  });
  app.post('/api/hub/shop/refund', (req, res) => {
    state.refunds.push(req.body);
    res.json({ id: `re_${state.refunds.length}`, status: 'succeeded' });
  });
  app.get('/api/hub/shop/stripe/invoice/:id', (req, res) => {
    const inv = state.invoices.get(req.params.id);
    if (!inv) return res.status(404).json({ message: 'nope' });
    res.json(inv);
  });
  app.get('/api/hub/shop/stripe/subscription/:id', (req, res) => {
    res.json(state.subscriptions.get(req.params.id) || { id: req.params.id, status: 'active', cancelAtPeriodEnd: false });
  });
  app.post('/api/hub/shop/stripe/subscription/:id/cancel', (req, res) => {
    const row = { id: req.params.id, status: req.body.atPeriodEnd ? 'active' : 'canceled', cancelAtPeriodEnd: Boolean(req.body.atPeriodEnd), currentPeriodEnd: new Date(Date.now() + 10 * 86_400_000).toISOString() };
    state.subscriptions.set(req.params.id, row);
    res.json(row);
  });
  return { app, state };
}

export async function withShop(fn, { seed } = {}) {
  process.env.CMS_DEV_ECOMMERCE = '1';
  const root = mkdtempSync(path.join(tmpdir(), 'asoldi-shop-'));
  seed?.(root);
  const hub = fakeHub();
  const hubServer = await listen(hub.app);
  const hubUrl = `http://127.0.0.1:${hubServer.address().port}`;
  const app = express();
  app.use(express.json());
  app.use('/api/cms', createCmsRoutes({ dataPath: root, hubUrl, siteKey: SITE_KEY, adminSecret: 'test-secret' }));
  const server = await listen(app);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const base = `${origin}/api/cms`;
  try {
    const admin = await login(base);
    await fn({ base, origin, root, hub: hub.state, admin });
  } finally {
    await new Promise((r) => server.close(r));
    await new Promise((r) => hubServer.close(r));
    rmSync(root, { recursive: true, force: true });
  }
}

export async function login(base, username = 'admin', password = 'changeme') {
  for (let i = 0; i < 10; i += 1) {
    const res = await fetch(`${base}/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    if (res.ok) return { Authorization: `Bearer ${(await res.json()).token}` };
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('login failed');
}

export async function employee(base, admin) {
  await fetch(`${base}/admin/users`, { method: 'POST', headers: { ...admin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'emp', password: 'emppass1', rank: 'employee' }) });
  return login(base, 'emp', 'emppass1');
}

export async function api(base, headers, method, url, body) {
  const res = await fetch(`${base}${url}`, { method, headers: { ...headers, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* csv / html */
  }
  return { status: res.status, data, headers: res.headers };
}

export async function createProduct(base, admin, body) {
  const res = await api(base, admin, 'POST', '/products', { productType: 'normal', ...body });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data;
}

export async function shopSettings(base, admin, patch) {
  const res = await api(base, admin, 'PUT', '/shop/admin/settings', patch);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return res.data;
}

/** A visitor with a cookie jar; never follows redirects so tests can assert them. */
export function browser(base) {
  const jar = new Map();
  async function request(url, { method = 'GET', form, json, headers = {} } = {}) {
    const h = { ...headers };
    if (jar.size) h.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    let body;
    if (form) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(form)) for (const v of Array.isArray(value) ? value : [value]) params.append(key, v);
      body = params;
      h['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (json) {
      body = JSON.stringify(json);
      h['Content-Type'] = 'application/json';
    }
    const res = await fetch(url.startsWith('http') ? url : `${base}${url}`, { method, headers: h, body, redirect: 'manual' });
    for (const raw of res.headers.getSetCookie()) {
      const [pair, ...attrs] = raw.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (!value || attrs.some((a) => /max-age=0/i.test(a.trim()))) jar.delete(name);
      else jar.set(name, value);
    }
    const text = await res.text();
    let data = text;
    if ((res.headers.get('content-type') || '').includes('json')) data = JSON.parse(text);
    return { status: res.status, location: res.headers.get('location') || '', text, data, headers: res.headers };
  }
  return {
    jar,
    get: (url, opts) => request(url, opts),
    post: (url, form, opts = {}) => request(url, { method: 'POST', form, ...opts }),
    postJson: (url, json, opts = {}) => request(url, { method: 'POST', json, ...opts }),
  };
}

/** Pay a pending Stripe session the way the hub would after Checkout succeeds, then follow the return URL. */
export async function payStripe(hub, visitor, sessionId) {
  const s = hub.sessions.get(sessionId);
  s.paid = true;
  s.status = 'complete';
  const url = new URL(s.successUrl);
  return visitor.get(`${url.pathname}${url.search}&session_id=${sessionId}`.replace(/^\/api\/cms/, ''));
}

export function docs(hub, kind) {
  return hub.documents.filter((d) => d.document?.kind === kind);
}
