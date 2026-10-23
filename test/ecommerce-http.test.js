import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import createCmsRoutes from '../server/routes.js';

// There is no built-in admin password; tests set the first admin's password explicitly.
const ADMIN_PASSWORD = 'test-admin-password';
process.env.CMS_ADMIN_PASSWORD = ADMIN_PASSWORD;

async function withServer(fn) {
  const root = mkdtempSync(path.join(tmpdir(), 'asoldi-cms-http-'));
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
    await fn(base, root);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    rmSync(root, { recursive: true, force: true });
  }
}

async function login(base) {
  let last = null;
  for (let i = 0; i < 10; i += 1) {
    const res = await fetch(`${base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: ADMIN_PASSWORD }),
    });
    if (res.ok) {
      const data = await res.json();
      return { Authorization: `Bearer ${data.token}` };
    }
    last = res.status;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`login failed: ${last}`);
}

test('admin can create a typed product, toggle sold out, and store an order', async () => {
  process.env.CMS_DEV_ECOMMERCE = '1';
  process.env.CMS_DEV_CATALOG_TYPE = 'menu';
  await withServer(async (base) => {
    const headers = await login(base);
    const created = await fetch(`${base}/products`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Nigiri',
        price: '109,-',
        productType: 'menu',
        allergens: 'Fisk',
        extraOptions: [{ name: 'Wasabi', price: '10' }],
        stockQty: 8,
      }),
    });
    assert.equal(created.status, 201);
    const product = await created.json();
    assert.equal(product.productType, 'menu');
    assert.equal(product.soldOut, false);

    const sold = await fetch(`${base}/products/${product.id}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ soldOut: true }),
    });
    const updated = await sold.json();
    assert.equal(updated.soldOut, true);
    assert.equal(updated.stockQty, 0);

    const orderRes = await fetch(`${base}/orders`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Test Kjøper',
        customerEmail: 'buyer@example.com',
        productId: product.id,
        productName: product.name,
        amount: 109,
        preset: 'normal',
      }),
    });
    assert.equal(orderRes.status, 201);
    const listed = await fetch(`${base}/orders?email=buyer`, { headers });
    const orders = await listed.json();
    assert.equal(orders.length, 1);
    const stats = await fetch(`${base}/orders/stats?range=day`, { headers }).then((r) => r.json());
    assert.equal(stats.count, 1);
    const catalog = await fetch(`${base}/catalog`).then((r) => r.json());
    assert.equal(catalog.catalogType, 'menu');
    assert.equal(catalog.products[0].soldOut, true);
  });
});
