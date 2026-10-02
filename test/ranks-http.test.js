import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import createCmsRoutes from '../server/routes.js';

async function withServer(fn) {
  const root = mkdtempSync(path.join(tmpdir(), 'asoldi-ranks-http-'));
  const app = express();
  app.use(express.json());
  app.use(
    '/api/cms',
    createCmsRoutes({
      dataPath: root,
      hubUrl: '',
      siteKey: 'test-site',
      adminSecret: 'test-secret',
    })
  );
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/api/cms`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    rmSync(root, { recursive: true, force: true });
  }
}

async function login(base, username = 'admin', password = 'changeme') {
  for (let i = 0; i < 10; i += 1) {
    const res = await fetch(`${base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (res.ok) {
      const data = await res.json();
      return { Authorization: `Bearer ${data.token}`, rank: data.rank };
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`login failed for ${username}`);
}

test('writer can publish blog posts but cannot manage products; employee cannot delete users', async () => {
  process.env.CMS_DEV_BLOG = '1';
  process.env.CMS_DEV_ECOMMERCE = '1';
  process.env.CMS_DEV_GENERAL = '1';
  await withServer(async (base) => {
    const admin = await login(base);
    const writerRes = await fetch(`${base}/admin/users`, {
      method: 'POST',
      headers: { ...admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'writer1', password: 'writerpass', rank: 'writer' }),
    });
    assert.equal(writerRes.status, 201);
    const employeeRes = await fetch(`${base}/admin/users`, {
      method: 'POST',
      headers: { ...admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'emp1', password: 'emppass', rank: 'employee' }),
    });
    const employee = await employeeRes.json();

    const writer = await login(base, 'writer1', 'writerpass');
    assert.equal(writer.rank, 'writer');
    const postRes = await fetch(`${base}/admin/posts`, {
      method: 'POST',
      headers: { ...writer, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'From writer',
        status: 'published',
        blocks: [{ type: 'text', text: 'Hello' }],
      }),
    });
    assert.equal(postRes.status, 201);
    const productRes = await fetch(`${base}/products`, {
      method: 'POST',
      headers: { ...writer, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Should fail' }),
    });
    assert.equal(productRes.status, 403);

    const publicPosts = await fetch(`${base}/posts`).then((r) => r.json());
    const writerPost = publicPosts.find((post) => post.authorName === 'writer1');
    assert.equal(publicPosts.length, 4);
    assert.equal(writerPost.title, 'From writer');

    const emp = await login(base, 'emp1', 'emppass');
    const del = await fetch(`${base}/admin/users/${employee.id}`, { method: 'DELETE', headers: emp });
    assert.equal(del.status, 403);
    const adminDel = await fetch(`${base}/admin/users/${employee.id}`, { method: 'DELETE', headers: admin });
    assert.equal(adminDel.status, 200);
  });
});

test('analytics and payments admin endpoints persist', async () => {
  process.env.CMS_DEV_ANALYTICS = '1';
  process.env.CMS_DEV_ECOMMERCE = '1';
  await withServer(async (base) => {
    const headers = await login(base);
    const saved = await fetch(`${base}/analytics`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'example.no', measurementId: 'G-LOCAL' }),
    }).then((r) => r.json());
    assert.equal(saved.measurementId, 'G-LOCAL');
    const payments = await fetch(`${base}/payments`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stripe: { enabled: true, connected: true, accountId: 'acct_test' },
        paypal: { enabled: true, connected: true, merchantId: 'merchant_test' },
      }),
    }).then((r) => r.json());
    assert.equal(payments.stripe.accountId, 'acct_test');
    assert.equal(payments.paypal.merchantId, 'merchant_test');
  });
});
