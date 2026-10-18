import test from 'node:test';
import assert from 'node:assert/strict';
import { api, browser, createProduct, docs, employee, payStripe, shopSettings, withShop } from './_shop-harness.js';
import { computeRefund, trackingUrlFor } from '../server/shop/ops.js';

async function buy(base, hub, items, { email = 'ola@example.com', method } = {}) {
  const v = browser(base);
  for (const item of items) assert.equal((await v.post('/cart/add', item)).status, 303);
  if (method) await v.post('/cart/options', { method });
  const start = await v.post('/checkout', { provider: 'stripe', terms: '1', email });
  assert.equal(start.status, 303, start.text.slice(0, 300));
  const id = start.location.split('/').pop();
  hub.sessions.get(id).customerEmail = email;
  v.receipt = await payStripe(hub, v, id);
  assert.equal(v.receipt.status, 200);
  return v;
}

const latest = async (base, admin) => (await api(base, admin, 'GET', '/orders')).data[0];

test('OR-0 refund maths and tracking links (pure)', () => {
  const order = { lines: [{ key: 'a', name: 'A', quantity: 3, refundedQty: 0, lineTotalMinor: 10000 }, { key: 'b', name: 'B', quantity: 1, refundedQty: 0, lineTotalMinor: 5000 }], shippingMinor: 9900, totalMinor: 24900, refundedMinor: 0, refunds: [] };
  assert.deepEqual(computeRefund(order, { lines: [{ key: 'a', quantity: 1 }] }), { lines: [{ key: 'a', quantity: 1, amountMinor: 3333 }], shippingMinor: 0, amountMinor: 3333 });
  const all = computeRefund({ ...order, lines: [{ ...order.lines[0], refundedQty: 1 }, order.lines[1]], refunds: [{ lines: [{ key: 'a', amountMinor: 3333 }], shippingMinor: 0 }], refundedMinor: 3333 }, { lines: [{ key: 'a', quantity: 2 }], shipping: true });
  assert.equal(all.lines[0].amountMinor, 6667, 'last units take the rounding remainder');
  assert.equal(all.amountMinor, 6667 + 9900);
  const custom = computeRefund(order, { amountMinor: 3000 });
  assert.equal(custom.amountMinor, 3000);
  assert.equal(custom.lines.reduce((s, l) => s + l.amountMinor, 0), 3000, 'amount-only refund is spread over the lines');
  assert.throws(() => computeRefund(order, { lines: [{ key: 'a', quantity: 4 }] }), /maks 3/);
  assert.throws(() => computeRefund(order, { amountMinor: 999999 }), /større/);
  assert.throws(() => computeRefund(order, {}), /Velg/);
  assert.equal(trackingUrlFor('posten', 'AB 1'), 'https://sporing.posten.no/sporing/AB%201');
  assert.equal(trackingUrlFor('ukjent', 'X'), '');
});

test('OR-1..3 ship with tracking, partial + full refund with credit notes and restock', async () => {
  await withShop(async ({ base, hub, admin }) => {
    await shopSettings(base, admin, { shipping: { zones: [{ id: 'no', name: 'Norge', countries: ['NO'], methods: [{ id: 'post', type: 'flat', name: 'Posten', price: '99' }] }] } });
    const lamp = await createProduct(base, admin, { name: 'Lampe', price: 400, stockQty: 5 });
    const buyer = await buy(base, hub, [{ product: lamp.id, quantity: '2' }]);
    assert.match(buyer.receipt.text, /Frakt: Posten<\/td><td class="r">99/, 'thank-you page shows the shipping that is in the total');
    let order = await latest(base, admin);
    assert.equal(order.totalMinor, 89900);
    assert.equal(order.shippingMinor, 9900);

    const overview = (await api(base, admin, 'GET', '/shop/admin/overview')).data;
    assert.equal(overview.toFulfil, 1);

    const part = await api(base, admin, 'POST', `/orders/${order.id}/ship`, { lines: [{ key: order.lines[0].key, quantity: 1 }], carrier: 'posten', trackingNumber: 'AB123' });
    assert.equal(part.status, 200);
    assert.equal(part.data.fulfillment.status, 'partial');
    assert.equal(part.data.fulfillment.shipments[0].trackingUrl, 'https://sporing.posten.no/sporing/AB123');
    const rest = await api(base, admin, 'POST', `/orders/${order.id}/ship`, { carrier: 'bring', trackingNumber: 'CD456' });
    assert.equal(rest.data.fulfillment.status, 'fulfilled');
    assert.equal(rest.data.status, 'shipped');
    assert.equal(docs(hub, 'shipped').length, 2);
    assert.equal((await api(base, admin, 'POST', `/orders/${order.id}/ship`, {})).status, 400, 'nothing left to ship');

    const emp = await employee(base, admin);
    assert.equal((await api(base, emp, 'POST', `/orders/${order.id}/refund`, { lines: [{ key: order.lines[0].key, quantity: 1 }] })).status, 403, 'only the owner moves money');

    const r1 = await api(base, admin, 'POST', `/orders/${order.id}/refund`, { lines: [{ key: order.lines[0].key, quantity: 1 }], reason: 'Knust' });
    assert.equal(r1.status, 200, JSON.stringify(r1.data));
    assert.equal(r1.data.refund.amountMinor, 40000);
    assert.equal(r1.data.refund.creditNoteNumber, 'K1');
    assert.equal(r1.data.order.paymentStatus, 'partially_refunded');
    assert.deepEqual(hub.refunds[0], { provider: 'stripe', providerId: 'cs_test_1', paymentRef: 'pi_cs_test_1', amountMinor: 40000, currency: 'nok', ref: '1001' });
    const credit = docs(hub, 'credit-note');
    assert.equal(credit.length, 1);
    assert.equal(credit[0].document.number, 'K1');
    assert.equal(credit[0].document.creditFor, '1001');
    assert.deepEqual(credit[0].document.taxLines.map((t) => [t.rate, t.taxMinor]), [[25, 8000]]);
    const stock = (await api(base, admin, 'GET', '/products')).data.find((p) => p.id === lamp.id).stockQty;
    assert.equal(stock, 4, 'refunded unit is restocked');

    const r2 = await api(base, admin, 'POST', `/orders/${order.id}/refund`, { lines: [{ key: order.lines[0].key, quantity: 1 }], shipping: true, restock: false });
    assert.equal(r2.data.refund.amountMinor, 49900);
    assert.equal(r2.data.refund.creditNoteNumber, 'K2');
    assert.equal(r2.data.order.paymentStatus, 'refunded');
    assert.equal((await api(base, admin, 'GET', '/products')).data.find((p) => p.id === lamp.id).stockQty, 4);
    const nothing = await api(base, admin, 'POST', `/orders/${order.id}/refund`, { amount: '1' });
    assert.equal(nothing.status, 409);
    assert.match(nothing.data.message, /allerede refundert/);

    const resend = await api(base, admin, 'POST', `/orders/${order.id}/resend`, { kind: 'credit-note' });
    assert.equal(resend.status, 200);
    assert.equal(docs(hub, 'credit-note').at(-1).resend, true);
    assert.equal((await api(base, admin, 'POST', `/orders/${order.id}/resend`, { kind: 'order' })).status, 200);
    assert.equal((await api(base, admin, 'POST', `/orders/${order.id}/resend`, { kind: 'shipped' })).status, 200);
    const noted = await api(base, emp, 'POST', `/orders/${order.id}/note`, { text: 'Kunden ringte' });
    assert.equal(noted.data.events.at(-1).text, 'Kunden ringte');
    const one = await api(base, emp, 'GET', `/orders/${order.id}`);
    assert.equal(one.data.number, order.number, 'single order for the admin drawer');
    assert.equal((await api(base, emp, 'GET', '/orders/nope')).status, 404);
    assert.equal((await api(base, {}, 'GET', `/orders/${order.id}`)).status, 401);
    order = await latest(base, admin);
    assert.ok(order.documents.length >= 6, 'every document is logged on the order');
  });
});

test('OR-4 amount-only refund, refunding a used gift card is refused, unpaid orders are cancelled not refunded', async () => {
  await withShop(async ({ base, hub, admin }) => {
    const book = await createProduct(base, admin, { name: 'Bok', price: 300 });
    await buy(base, hub, [{ product: book.id }]);
    const order = await latest(base, admin);
    const r = await api(base, admin, 'POST', `/orders/${order.id}/refund`, { amount: '50' });
    assert.equal(r.status, 200);
    assert.equal(hub.refunds[0].amountMinor, 5000);

    const gc = await createProduct(base, admin, { name: 'Gavekort', price: 0, kind: 'giftcard', giftcard: { amounts: [200] } });
    await buy(base, hub, [{ product: gc.id, giftcardAmount: '200' }]);
    const gcOrder = await latest(base, admin);
    const code = docs(hub, 'giftcard')[0].document.giftcard.code;
    const v = browser(base);
    await v.post('/cart/add', { product: book.id });
    await v.post('/cart/giftcard', { code });
    const s = await v.post('/checkout', { provider: 'stripe', terms: '1' });
    assert.equal(s.status, 303);
    assert.equal(hub.sessions.get(s.location.split('/').pop()).lineItems[0].name, 'Bestilling (rest etter gavekort)');
    await payStripe(hub, v, s.location.split('/').pop());
    const refused = await api(base, admin, 'POST', `/orders/${gcOrder.id}/refund`, { lines: [{ key: gcOrder.lines[0].key, quantity: 1 }] });
    assert.equal(refused.status, 409, 'a used gift card cannot be refunded');

    const mixed = await latest(base, admin);
    assert.equal(mixed.amountPaidMinor, 10000);
    const back = await api(base, admin, 'POST', `/orders/${mixed.id}/refund`, { lines: [{ key: mixed.lines[0].key, quantity: 1 }] });
    assert.equal(back.status, 200);
    assert.equal(back.data.refund.giftcardMinor, 20000, 'the gift card part goes back onto the card');
    assert.equal(hub.refunds.at(-1).amountMinor, 10000, 'only the card-paid part goes to Stripe');
    const card = (await api(base, admin, 'GET', '/shop/admin/giftcards')).data[0];
    assert.equal(card.balanceMinor, 20000);

    const all = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [['10:00', '12:00']]]));
    await shopSettings(base, admin, { bookings: { hours: all, payMode: 'reserve', minNoticeMinutes: 0, slotStepMinutes: 60 } });
    const visit = await createProduct(base, admin, { name: 'Konsultasjon', price: 600, kind: 'booking', booking: { durationMinutes: 60 } });
    const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const slot = (await api(base, admin, 'GET', `/shop/slots?product=${visit.id}&date=${day}`)).data.slots[0];
    const b = browser(base);
    await b.post('/cart/add', { product: visit.id, slot: slot.start });
    const cart = await b.get('/cart');
    assert.doesNotMatch(cart.text, /value="stripe"/, 'pay-on-site mode offers no card button');
    const res = await b.post('/checkout', { provider: 'reserve', terms: '1', email: 'per@example.com' });
    await b.get(res.location.replace('/api/cms', ''));
    const reserved = await latest(base, admin);
    assert.equal((await api(base, admin, 'POST', `/orders/${reserved.id}/refund`, { amount: '10' })).status, 409);
    const cancelled = await api(base, admin, 'POST', `/orders/${reserved.id}/cancel`);
    assert.equal(cancelled.data.status, 'cancelled');
    assert.equal((await api(base, admin, 'GET', '/shop/admin/bookings')).data[0].status, 'cancelled');
    assert.equal((await api(base, admin, 'POST', `/orders/${order.id}/cancel`)).status, 409, 'paid orders are refunded, not cancelled');
  });
});

test('OR-5 reports, VAT per rate net of credit notes, CSV, customers, overview', async () => {
  await withShop(async ({ base, hub, admin }) => {
    const food = await createProduct(base, admin, { name: 'Sjokolade', price: 115, taxClass: 'food', stockQty: 3, lowStockAt: 2 });
    const mug = await createProduct(base, admin, { name: 'Krus', price: 250 });
    await buy(base, hub, [{ product: food.id }, { product: mug.id }]);
    await buy(base, hub, [{ product: mug.id }], { email: 'kari@example.com' });
    const list = (await api(base, admin, 'GET', '/orders')).data;
    const first = list.find((o) => o.customerEmail === 'ola@example.com');
    await api(base, admin, 'POST', `/orders/${first.id}/refund`, { lines: [{ key: first.lines.find((l) => l.name === 'Krus').key, quantity: 1 }] });

    const report = (await api(base, admin, 'GET', '/shop/admin/reports?preset=30d')).data;
    assert.equal(report.orders, 2);
    assert.equal(report.grossMinor, 11500 + 25000 + 25000);
    assert.equal(report.refundedMinor, 25000);
    assert.deepEqual(report.topProducts.map((p) => [p.name, p.quantity, p.totalMinor]), [['Krus', 2, 50000], ['Sjokolade', 1, 11500]], 'top products are gross like the totals; refunds are reported separately');
    const vat = (await api(base, admin, 'GET', '/shop/admin/reports/vat?preset=30d')).data;
    const byRate = Object.fromEntries(vat.rates.map((r) => [r.rate, r]));
    assert.equal(byRate[15].taxMinor, 1500);
    assert.equal(byRate[25].taxMinor, 5000, 'two mugs sold, one credited');
    const csv = await api(base, admin, 'GET', '/shop/admin/reports/orders.csv?preset=30d');
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.match(csv.data, /1001/);
    assert.match(csv.data, /1002/);

    const customers = (await api(base, admin, 'GET', '/shop/admin/customers')).data;
    assert.equal(customers.length, 2);
    const ola = customers.find((c) => c.email === 'ola@example.com');
    const detail = (await api(base, admin, 'GET', `/shop/admin/customers/${ola.id}`)).data;
    assert.equal(detail.orders.length, 1);
    assert.equal((await api(base, admin, 'PUT', `/shop/admin/customers/${ola.id}`, { note: 'Stamkunde', tags: ['vip'] })).data.note, 'Stamkunde');
    assert.equal((await api(base, admin, 'GET', '/shop/admin/customers?q=kari')).data.length, 1);

    const overview = (await api(base, admin, 'GET', '/shop/admin/overview')).data;
    assert.equal(overview.lowStock.length, 1);
    assert.equal(overview.lowStock[0].qty, 2);
    assert.match(hub.formPosts[0].message, /Lite på lager:\nSjokolade: 2 igjen/);
  });
});

test('TM-1 test mode: TEST- numbers, kept out of reports, cleared without touching real orders or the real series', async () => {
  await withShop(async ({ base, hub, admin }) => {
    const mug = await createProduct(base, admin, { name: 'Krus', price: 250, stockQty: 5 });
    await buy(base, hub, [{ product: mug.id }], { email: 'real@example.com' });
    await shopSettings(base, admin, { orders: { testMode: true } });
    const look = browser(base);
    await look.post('/cart/add', { product: mug.id });
    assert.match((await look.get('/cart')).text, /Testmodus/, 'buyers see the test banner');
    await buy(base, hub, [{ product: mug.id, quantity: '2' }], { email: 'test@example.com' });
    const testOrder = await latest(base, admin);
    assert.equal(testOrder.number, 'TEST-1');
    assert.equal(testOrder.test, true);
    const refund = await api(base, admin, 'POST', `/orders/${testOrder.id}/refund`, { lines: [{ key: testOrder.lines[0].key, quantity: 1 }], restock: false });
    assert.equal(refund.data.refund.creditNoteNumber, 'TEST-K1', 'credit notes for test orders use their own series');
    assert.equal((await api(base, admin, 'POST', '/shop/admin/giftcards', { amount: 100 })).status, 201);
    const cut = await createProduct(base, admin, { name: 'Klipp', price: 300, kind: 'booking', requiresShipping: false });
    assert.equal((await api(base, admin, 'POST', '/shop/admin/bookings', { productId: cut.id, start: new Date(Date.now() + 3 * 86_400_000).toISOString(), force: true, customerName: 'Telefon' })).status, 201);
    assert.equal((await api(base, admin, 'GET', '/shop/admin/reports?preset=30d')).data.orders, 1, 'reports count only the real order');
    assert.doesNotMatch((await api(base, admin, 'GET', '/shop/admin/reports/orders.csv?preset=30d')).data, /TEST-1/);

    const emp = await employee(base, admin);
    assert.equal((await api(base, emp, 'POST', '/shop/admin/test-data/clear')).status, 403, 'only the owner clears test data');
    const cleared = (await api(base, admin, 'POST', '/shop/admin/test-data/clear')).data;
    assert.deepEqual([cleared.orders, cleared.giftcards, cleared.customers, cleared.bookings], [1, 1, 1, 1], 'hand-made test bookings go too');
    assert.deepEqual((await api(base, admin, 'GET', '/orders')).data.map((o) => o.number), ['1001']);
    assert.deepEqual((await api(base, admin, 'GET', '/shop/admin/customers')).data.map((c) => c.email), ['real@example.com']);
    assert.equal((await api(base, admin, 'GET', '/products')).data.find((p) => p.id === mug.id).stockQty, 4, 'test units go back to stock');

    await shopSettings(base, admin, { orders: { testMode: false } });
    await buy(base, hub, [{ product: mug.id }], { email: 'next@example.com' });
    assert.equal((await latest(base, admin)).number, '1002', 'the real series continues without a gap');
  });
});
