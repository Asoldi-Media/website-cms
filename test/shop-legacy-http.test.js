import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { api, browser, withShop } from './_shop-harness.js';

/** Files exactly as CMS 1.8.1 wrote them (live sites today). */
function seed181(root) {
  const dir = path.join(root, 'cms');
  mkdirSync(dir, { recursive: true });
  const write = (file, value) => writeFileSync(path.join(dir, file), JSON.stringify(value, null, 2));
  write('products.json', [
    { id: 'p-cut', name: 'Herreklipp', price: '450', productType: 'normal', stockQty: 4, soldOut: false, extraOptions: [{ name: 'Vask', price: '100' }], categoryId: '', createdAt: '2026-04-01T10:00:00.000Z' },
    { id: 'p-ask', name: 'Brudefrisyre', price: 'Pris på forespørsel', contactInsteadOfPrice: true, productType: 'normal', createdAt: '2026-04-01T10:00:00.000Z' },
  ]);
  write('orders.json', [
    { id: 'o-old', customerName: 'Kari', customerEmail: 'kari@example.com', productId: 'p-cut', productName: 'Herreklipp', quantity: 2, amount: '900', currency: 'NOK', purchasedAt: '2026-05-01T10:00:00.000Z', status: 'completed', preset: 'normal', additions: ['Vask'], shippingAddress: { line: 'Gate 1', postal: '7014', city: 'Trondheim', country: 'Norge' }, createdAt: '2026-05-01T10:00:00.000Z' },
  ]);
  write('payments.json', { stripe: { enabled: true, connected: false, accountId: '', status: 'not_started' }, paypal: { enabled: false }, createdAt: '2026-04-01T10:00:00.000Z' });
}

test('LG-1 CMS 1.8.1 data loads: old orders list and open, old products sell through the new cart, reports skip manual orders', async () => {
  await withShop(
    async ({ base, root, hub, admin }) => {
      const orders = await api(base, admin, 'GET', '/orders');
      assert.equal(orders.status, 200);
      const old = orders.data.find((o) => o.id === 'o-old');
      assert.equal(old.amount, 900);
      assert.equal(old.productName, 'Herreklipp');
      assert.deepEqual(old.lines, []);
      assert.equal(old.number, '');
      assert.equal((await api(base, admin, 'GET', '/orders/o-old')).data.customerEmail, 'kari@example.com');
      assert.equal((await api(base, admin, 'GET', '/orders/stats?range=all')).status, 200);

      const overview = await api(base, admin, 'GET', '/shop/admin/overview');
      assert.equal(overview.status, 200, JSON.stringify(overview.data));
      const report = await api(base, admin, 'GET', '/shop/admin/reports?from=2026-04-01&to=2026-06-01');
      assert.equal(report.status, 200);
      assert.equal(report.data.grossMinor, 0, 'manual 1.8.1 orders have no payment and are not counted as sales');
      assert.equal((await api(base, admin, 'GET', '/shop/admin/customers')).status, 200);
      assert.equal((await api(base, admin, 'GET', '/payments')).status, 200);

      const v = browser(base);
      const page = await v.get('/shop/product/p-cut');
      assert.equal(page.status, 200);
      assert.match(page.text, /Herreklipp/);
      assert.match(page.text, /Vask/);
      assert.equal((await v.post('/cart/add', { product: 'p-cut', quantity: '1', extras: 'Vask' })).status, 303);
      const cart = await v.get('/cart.json');
      assert.equal(cart.data.totalMinor, 55000, 'price string "450" + extra "100", MVA included');
      const ask = await v.post('/cart/add', { product: 'p-ask', quantity: '1' });
      assert.equal(ask.status, 400, 'price-on-request products cannot be bought');

      const start = await v.post('/checkout', { provider: 'stripe', terms: '1', email: 'ola@example.com' });
      assert.equal(start.status, 303, start.text.slice(0, 300));
      const session = hub.sessions.get(start.location.split('/').pop());
      assert.equal(session.lineItems.reduce((s, l) => s + l.unitAmount * l.quantity, 0) + (session.shipping?.amountMinor || 0), 55000);

      const products = JSON.parse(readFileSync(path.join(root, 'cms', 'products.json'), 'utf8'));
      assert.equal(products.find((p) => p.id === 'p-cut').extraOptions[0].name, 'Vask', '1.8.1 fields survive the rewrite');
      const raw = JSON.parse(readFileSync(path.join(root, 'cms', 'orders.json'), 'utf8'));
      assert.equal(raw.find((o) => o.id === 'o-old').amount, '900', 'old orders are not rewritten just by reading them');
    },
    { seed: seed181 },
  );
});
