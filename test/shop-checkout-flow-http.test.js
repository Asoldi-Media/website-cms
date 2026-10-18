import test from 'node:test';
import assert from 'node:assert/strict';
import { api, browser, createProduct, docs, employee, payStripe, shopSettings, withShop } from './_shop-harness.js';

const orders = async (base, admin) => (await api(base, admin, 'GET', '/orders')).data;
const refOf = (hub, id) => new URL(hub.sessions.get(id).successUrl).searchParams.get('ref');

test('CK-1..3 cart → legal checkout → Stripe → exactly one order, stock, receipt, owner notice', async () => {
  await withShop(async ({ base, hub, admin }) => {
    const coffee = await createProduct(base, admin, { name: 'Kaffebønner', price: 199, stockQty: 2, extraOptions: [{ name: 'Malt', price: '10' }] });
    await createProduct(base, admin, { name: 'Konsulent', price: 'Fra 990' });

    const catalog = await fetch(`${base}/catalog`).then((r) => r.json());
    assert.equal(catalog.checkout, true);
    assert.equal(catalog.products.find((p) => p.name === 'Kaffebønner').buyable, true);
    assert.equal(catalog.products.find((p) => p.name === 'Konsulent').buyable, false, '"Fra 990" stays contact-only');

    const v = browser(base);
    const page = await v.get(`/shop/product/${coffee.id}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /Legg i handlekurven/);
    assert.match(page.text, /application\/ld\+json/);

    const add = await v.post('/cart/add', { product: coffee.id, quantity: '2', extras: 'Malt', price: '1' });
    assert.equal(add.status, 303);
    assert.equal(add.location, '/api/cms/cart');
    assert.equal(v.jar.get('asoldi_cart_count'), '2');

    const summary = (await v.get('/cart.json')).data;
    assert.equal(summary.count, 2);
    assert.equal(summary.totalMinor, 41800, 'price comes from the product (+extra), never the form');
    assert.equal(summary.taxMinor, 8360, '25 % MVA extracted from the gross price');

    const cart = await v.get('/cart');
    assert.match(cart.text, /Bestill med betalingsplikt/);
    assert.match(cart.text, /name="terms"/);
    assert.match(cart.text, /angrerett/i);

    const noTerms = await v.post('/checkout', { provider: 'stripe' });
    assert.equal(noTerms.status, 400);
    assert.match(noTerms.text, /salgsbetingelsene/);

    const start = await v.post('/checkout', { provider: 'stripe', terms: '1', email: 'ola@example.com' });
    assert.equal(start.status, 303);
    assert.equal(start.location, 'https://checkout.stripe.test/cs_test_1');
    const sent = hub.sessions.get('cs_test_1');
    assert.deepEqual(sent.lineItems.map((l) => [l.unitAmount, l.quantity]), [[20900, 2]]);
    assert.deepEqual(sent.allowedCountries, ['NO'], 'buyer address locked to the priced country');
    assert.equal(sent.expiresInMinutes, 60);
    assert.equal(sent.customerEmail, 'ola@example.com');

    const ref = refOf(hub, 'cs_test_1');
    const unpaid = await v.get(`/checkout/return?ref=${ref}&provider=stripe&session_id=cs_test_1`);
    assert.equal(unpaid.status, 202);
    assert.equal((await orders(base, admin)).length, 0, 'no order before the hub confirms payment');

    sent.paid = true;
    const [a, b] = await Promise.all([
      v.get(`/checkout/return?ref=${ref}&provider=stripe&session_id=cs_test_1`),
      fetch(`${base}/checkout/notify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'checkout.completed', id: 'cs_test_1' }) }),
    ]);
    assert.equal(a.status, 200);
    assert.match(a.text, /Takk for bestillingen/);
    assert.equal(b.status, 200);
    assert.equal(v.jar.has('asoldi_cart'), false, 'cart cleared after payment');
    await v.get(`/checkout/return?ref=${ref}&provider=stripe&session_id=cs_test_1`);

    const list = await orders(base, admin);
    assert.equal(list.length, 1, 'return + webhook + reload still make one order');
    const order = list[0];
    assert.equal(order.number, '1001');
    assert.equal(order.paymentStatus, 'paid');
    assert.equal(order.paymentRef, 'pi_cs_test_1');
    assert.equal(order.totalMinor, 41800);
    assert.equal(order.taxMinor, 8360);
    assert.equal(order.lines[0].quantity, 2);
    assert.equal(order.shippingAddress.line, 'Ola, Gate 1, 7014 Trondheim, NO');
    assert.equal(order.fulfillment.status, 'unfulfilled');

    const products = (await api(base, admin, 'GET', '/products')).data;
    assert.equal(products.find((p) => p.id === coffee.id).stockQty, 0);
    const after = await fetch(`${base}/catalog`).then((r) => r.json());
    assert.equal(after.products.find((p) => p.id === coffee.id).buyable, false, 'sold out after the last unit');

    const receipt = docs(hub, 'order');
    assert.equal(receipt.length, 1);
    assert.equal(receipt[0].document.number, '1001');
    assert.deepEqual(receipt[0].document.taxLines.map((t) => [t.rate, t.taxMinor]), [[25, 8360]]);
    assert.match(receipt[0].document.withdrawal.formUrl, /\/api\/cms\/angreskjema\?order=1001/);
    assert.equal(hub.formPosts.length, 1);
    assert.match(hub.formPosts[0].message, /Ordre #1001/);
    assert.match(hub.formPosts[0].message, /2 × Kaffebønner/);
    assert.match(hub.formPosts[0].message, /Lite på lager/);

    const v2 = browser(base);
    const soldOut = await v2.post('/cart/add', { product: coffee.id, quantity: '1' });
    assert.equal(soldOut.status, 400);
  });
});

test('CK-4 a checkout holds stock; cancel releases it', async () => {
  await withShop(async ({ base, admin }) => {
    const shirt = await createProduct(base, admin, { name: 'T-skjorte', price: 299, stockQty: 1 });
    const a = browser(base);
    const b = browser(base);
    assert.equal((await a.post('/cart/add', { product: shirt.id })).status, 303);
    assert.equal((await b.post('/cart/add', { product: shirt.id })).status, 303, 'both may have it in the cart');
    const start = await a.post('/checkout', { provider: 'stripe', terms: '1' });
    assert.equal(start.status, 303);
    const blocked = await b.post('/checkout', { provider: 'stripe', terms: '1' });
    assert.equal(blocked.status, 409, 'the last unit is held for the first checkout');
    const ref = new URL(start.location).pathname.split('/').pop();
    assert.ok(ref);
    const row = (await api(base, admin, 'GET', '/shop/admin/checkouts')).data[0];
    const cancel = await a.get(`/checkout/cancel?ref=${row.ref}`);
    assert.equal(cancel.status, 303);
    assert.equal((await b.post('/checkout', { provider: 'stripe', terms: '1' })).status, 303, 'released on cancel');
  });
});

test('CK-5 PayPal capture on return; wrong token and amount mismatch never become orders', async () => {
  await withShop(async ({ base, hub, admin }) => {
    const pizza = await createProduct(base, admin, { name: 'Pizza', price: 149 });
    const v = browser(base);
    await v.post('/cart/add', { product: pizza.id });
    const start = await v.post('/checkout', { provider: 'paypal', terms: '1' });
    assert.equal(start.status, 303);
    assert.equal(start.location, 'https://paypal.test/checkoutnow?token=PPORDER1XX');
    const order = hub.orders.get('PPORDER1XX');
    const ref = new URL(order.successUrl).searchParams.get('ref');

    assert.equal((await v.get(`/checkout/return?ref=${ref}&provider=paypal&token=PPORDER1XX`)).status, 202);
    order.approved = true;
    assert.equal((await v.get(`/checkout/return?ref=${ref}&provider=paypal&token=PPORDER9XX`)).status, 400, 'a token from another checkout is refused');
    assert.equal((await v.get(`/checkout/return?ref=${ref}&provider=paypal&token=PPORDER1XX&PayerID=X`)).status, 200);
    let list = await orders(base, admin);
    assert.equal(list.length, 1);
    assert.equal(list[0].paymentProvider, 'paypal');
    assert.equal(list[0].customerEmail, 'kari@example.com');

    const v2 = browser(base);
    await v2.post('/cart/add', { product: pizza.id });
    await v2.post('/checkout', { provider: 'stripe', terms: '1' });
    hub.sessions.get('cs_test_1').tamper = 100;
    const mismatch = await payStripe(hub, v2, 'cs_test_1');
    assert.equal(mismatch.status, 400);
    list = await orders(base, admin);
    assert.equal(list.length, 1);
    const rows = (await api(base, admin, 'GET', '/shop/admin/checkouts?status=mismatch')).data;
    assert.equal(rows.length, 1);
  });
});

test('CK-6 unfinished payment methods are hidden; employees cannot connect; legacy URLs still work', async () => {
  await withShop(async ({ base, hub, admin }) => {
    const tea = await createProduct(base, admin, { name: 'Te', price: 39 });
    hub.stripeReady = false;
    const status = (await api(base, admin, 'GET', '/payments')).data;
    assert.equal(status.linked, true);
    assert.equal(status.stripe.ready, false);
    const v = browser(base);
    await v.post('/cart/add', { product: tea.id });
    const cart = await v.get('/cart');
    assert.doesNotMatch(cart.text, /value="stripe"/);
    assert.match(cart.text, /value="paypal"/);
    assert.equal((await v.post('/checkout', { provider: 'stripe', terms: '1' })).status, 409);

    await api(base, admin, 'PUT', '/payments', { paypal: { enabled: false } });
    const legacy = await v.get(`/checkout?product=${tea.id}`);
    assert.equal(legacy.status, 200);
    assert.match(legacy.text, /ikke satt opp/);
    assert.equal((await fetch(`${base}/catalog`).then((r) => r.json())).checkout, false);
    const legacyPost = await v.post('/checkout', { product: tea.id, quantity: '1' });
    assert.equal(legacyPost.status, 303);
    assert.match(legacyPost.location, /\/api\/cms\/checkout\?product=/);

    const connect = (await api(base, admin, 'POST', '/payments/stripe/connect')).data;
    assert.match(connect.url, /^https:\/\/connect\.stripe\.test\/\?back=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Fadmin%3Fpayments%3Dstripe$/);
    assert.equal((await api(base, admin, 'POST', '/payments/paypal/connect', { email: 'shop@example.com' })).status, 200);
    const emp = await employee(base, admin);
    assert.equal((await api(base, emp, 'POST', '/payments/stripe/connect')).status, 403);
    assert.equal((await api(base, emp, 'POST', '/payments/disconnect', { provider: 'stripe' })).status, 403);
    assert.equal((await api(base, emp, 'GET', '/payments')).status, 200, 'employees can see the status');
    assert.equal((await api(base, admin, 'POST', '/payments/disconnect', { provider: 'stripe' })).status, 200);
  });
});

test('CK-7 shipping zones: country + method change the price; unshippable country blocks checkout', async () => {
  await withShop(async ({ base, hub, admin }) => {
    await shopSettings(base, admin, {
      shipping: {
        zones: [
          { id: 'no', name: 'Norge', countries: ['NO'], methods: [{ id: 'post', type: 'flat', name: 'Posten', price: '99', freeOver: '1000', estimateMinDays: 1, estimateMaxDays: 3 }, { id: 'hent', type: 'pickup', name: 'Hent i butikk', pickupAddress: 'Gata 1' }] },
          { id: 'se', name: 'Sverige', countries: ['SE'], methods: [{ id: 'se-post', type: 'flat', name: 'PostNord', price: '199' }] },
        ],
      },
    });
    const mug = await createProduct(base, admin, { name: 'Krus', price: 250 });
    const v = browser(base);
    await v.post('/cart/add', { product: mug.id });
    let s = (await v.get('/cart.json')).data;
    assert.equal(s.shippingMinor, 9900);
    assert.equal(s.totalMinor, 34900);
    await v.post('/cart/options', { method: 'hent' });
    assert.equal((await v.get('/cart.json')).data.shippingMinor, 0);
    await v.post('/cart/options', { country: 'SE', method: 'se-post' });
    assert.equal((await v.get('/cart.json')).data.shippingMinor, 19900);
    await v.post('/cart/update', { key: s.items[0].key, quantity: '4' });
    await v.post('/cart/options', { country: 'NO', method: 'post' });
    s = (await v.get('/cart.json')).data;
    assert.equal(s.shippingMinor, 0, 'free over 1000 kr');

    const start = await v.post('/checkout', { provider: 'stripe', terms: '1' });
    assert.equal(start.status, 303);
    const sent = hub.sessions.get('cs_test_1');
    assert.deepEqual(sent.allowedCountries, ['NO']);
    assert.equal(sent.shipping, null);

    await v.post('/cart/options', { method: 'hent' });
    await v.post('/checkout', { provider: 'stripe', terms: '1' });
    assert.equal(hub.sessions.get('cs_test_2').collectShipping, false, 'pickup asks for no address');

    await v.post('/cart/options', { country: 'US' });
    const blocked = await v.post('/checkout', { provider: 'stripe', terms: '1' });
    assert.equal(blocked.status, 409);
    assert.match(blocked.text, /sender ikke/i);
  });
});

test('CK-8 discount codes: owner creates, cart applies, usage counted, bad code refused', async () => {
  await withShop(async ({ base, hub, admin }) => {
    const emp = await employee(base, admin);
    assert.equal((await api(base, emp, 'POST', '/shop/admin/discounts', { code: 'X', type: 'percent', value: 10 })).status, 403);
    const created = await api(base, admin, 'POST', '/shop/admin/discounts', { method: 'code', code: 'sommer10', type: 'percent', value: 10, usageLimit: 1 });
    assert.equal(created.status, 201);
    assert.equal(created.data.code, 'SOMMER10');
    assert.equal((await api(base, admin, 'POST', '/shop/admin/discounts', { method: 'code', code: 'SOMMER10', type: 'amount', value: 5 })).status, 409);

    const bag = await createProduct(base, admin, { name: 'Veske', price: 500 });
    const v = browser(base);
    await v.post('/cart/add', { product: bag.id });
    const bad = await v.post('/cart/code', { code: 'FINNESIKKE' });
    assert.equal(bad.status, 400);
    assert.equal((await v.post('/cart/code', { code: 'sommer10' })).status, 303);
    const s = (await v.get('/cart.json')).data;
    assert.deepEqual(s.codes, ['SOMMER10']);
    assert.equal(s.discountMinor, 5000);
    assert.equal(s.totalMinor, 45000);
    await v.post('/checkout', { provider: 'stripe', terms: '1' });
    assert.deepEqual(hub.sessions.get('cs_test_1').lineItems.map((l) => l.unitAmount * l.quantity).reduce((x, y) => x + y, 0), 45000);
    await payStripe(hub, v, 'cs_test_1');
    const d = (await api(base, admin, 'GET', '/shop/admin/discounts')).data[0];
    assert.equal(d.usedCount, 1);

    const v2 = browser(base);
    await v2.post('/cart/add', { product: bag.id });
    assert.equal((await v2.post('/cart/code', { code: 'SOMMER10' })).status, 400, 'usage limit reached');
    const key = (await v2.get('/cart.json')).data.items[0].key;
    assert.equal((await v2.post('/cart/remove', { key })).status, 303);
    assert.equal((await v2.get('/cart.json')).data.count, 0);
    assert.equal(v2.jar.get('asoldi_cart_count'), '0');
    await v.post('/cart/code/remove', { code: 'SOMMER10' });

    assert.equal((await api(base, admin, 'PUT', `/shop/admin/discounts/${d.id}`, { active: false })).data.active, false);
    assert.equal((await api(base, admin, 'DELETE', `/shop/admin/discounts/${d.id}`)).status, 200);
  });
});

test('CK-9 gift cards: sell → code emailed to recipient → redeem as payment → zero to pay', async () => {
  await withShop(async ({ base, hub, admin }) => {
    const card = await createProduct(base, admin, { name: 'Gavekort', price: 0, kind: 'giftcard', giftcard: { amounts: [500, 1000], allowCustom: true } });
    const v = browser(base);
    const add = await v.post('/cart/add', { product: card.id, giftcardAmount: '500', recipientName: 'Kari', recipientEmail: 'kari@example.com', giftcardMessage: 'Gratulerer!' });
    assert.equal(add.status, 303);
    const s = (await v.get('/cart.json')).data;
    assert.equal(s.totalMinor, 50000);
    assert.equal(s.taxMinor, 0, 'multi-purpose voucher: no MVA when sold');
    await v.post('/checkout', { provider: 'stripe', terms: '1', email: 'ola@example.com' });
    assert.equal((await payStripe(hub, v, 'cs_test_1')).status, 200);
    const sent = docs(hub, 'giftcard');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'kari@example.com');
    const code = sent[0].document.giftcard.code;
    assert.match(code, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    const cards = (await api(base, admin, 'GET', '/shop/admin/giftcards')).data;
    assert.equal(cards.length, 1);
    assert.equal(cards[0].balanceMinor, 50000);

    const soap = await createProduct(base, admin, { name: 'Såpe', price: 120 });
    const b = browser(base);
    await b.post('/cart/add', { product: soap.id });
    assert.equal((await b.post('/cart/giftcard', { code: 'AAAA-BBBB-CCCC' })).status, 400);
    assert.equal((await b.post('/cart/giftcard', { code: code.toLowerCase() })).status, 303);
    assert.equal((await b.post('/cart/giftcard/remove', { code })).status, 303);
    assert.equal((await b.get('/cart.json')).data.amountDueMinor, 12000);
    assert.equal((await b.post('/cart/giftcard', { code })).status, 303);
    const priced = (await b.get('/cart.json')).data;
    assert.equal(priced.amountDueMinor, 0);
    const cartHtml = (await b.get('/cart')).text;
    assert.match(cartHtml, /value="giftcard"/);
    assert.match(cartHtml, /name="line"[^>]*required/, 'no payment page will ask for the delivery address, so the cart must');
    assert.equal((await b.post('/checkout', { provider: 'giftcard', terms: '1', email: 'per@example.com' })).status, 400);
    const pay = await b.post('/checkout', { provider: 'giftcard', terms: '1', email: 'per@example.com', name: 'Per Hansen', line: 'Storgata 1', postal: '0155', city: 'Oslo' });
    assert.equal(pay.status, 303);
    assert.match(pay.location, /\/api\/cms\/checkout\/return\?ref=chk_/);
    const done = await b.get(pay.location.replace('/api/cms', ''));
    assert.equal(done.status, 200);
    const after = (await api(base, admin, 'GET', '/shop/admin/giftcards')).data[0];
    assert.equal(after.balanceMinor, 38000);
    const order = (await orders(base, admin)).find((o) => o.paymentProvider === 'giftcard');
    assert.equal(order.giftcardPayments[0].amountMinor, 12000);
    assert.deepEqual([order.customerName, order.shippingAddress], ['Per Hansen', { line: 'Storgata 1', postal: '0155', city: 'Oslo', country: 'NO' }]);
    assert.equal(hub.sessions.size, 1, 'no provider checkout for a fully covered order');

    const limited = browser(base);
    await limited.post('/cart/add', { product: soap.id });
    let last;
    for (let i = 0; i < 11; i += 1) last = await limited.post('/cart/giftcard', { code: `ZZZZ-ZZZZ-ZZ${String(i).padStart(2, '0')}` });
    assert.equal(last.status, 429, 'code guessing is rate-limited');

    const manual = await api(base, admin, 'POST', '/shop/admin/giftcards', { amount: '250', recipientEmail: 'x@example.com' });
    assert.equal(manual.status, 201);
    const adjusted = await api(base, admin, 'PUT', `/shop/admin/giftcards/${manual.data.id}`, { adjust: '-50', reason: 'test' });
    assert.equal(adjusted.data.balanceMinor, 20000);
  });
});

test('CK-10 subscriptions: Stripe subscription mode, renewal order, cancel at period end', async () => {
  await withShop(async ({ base, hub, admin }) => {
    const box = await createProduct(base, admin, { name: 'Kaffeabonnement', price: 299, kind: 'subscription', subscription: { interval: 'month', intervalCount: 1 } });
    const v = browser(base);
    await v.post('/cart/add', { product: box.id });
    const cart = await v.get('/cart');
    assert.doesNotMatch(cart.text, /value="paypal"/, 'subscriptions are card only');
    assert.equal((await v.post('/checkout', { provider: 'paypal', terms: '1' })).status, 409);
    await v.post('/checkout', { provider: 'stripe', terms: '1', email: 'ola@example.com' });
    const sent = hub.sessions.get('cs_test_1');
    assert.equal(sent.mode, 'subscription');
    assert.equal(sent.recurringLines[0].unitAmount, 29900);
    assert.equal((await payStripe(hub, v, 'cs_test_1')).status, 200);
    const subs = (await api(base, admin, 'GET', '/shop/admin/subscriptions')).data;
    assert.equal(subs.length, 1);
    assert.equal(subs[0].stripeSubscriptionId, 'sub_cs_test_1');
    assert.equal(subs[0].status, 'active');

    hub.invoices.set('in_first', { id: 'in_first', paid: true, subscriptionId: 'sub_cs_test_1', billingReason: 'subscription_create', amountMinor: 29900, currency: 'nok' });
    hub.invoices.set('in_2', { id: 'in_2', paid: true, subscriptionId: 'sub_cs_test_1', billingReason: 'subscription_cycle', amountMinor: 29900, currency: 'nok', customerEmail: 'ola@example.com', periodEnd: new Date(Date.now() + 60 * 86_400_000).toISOString() });
    const notify = (body) => fetch(`${base}/checkout/notify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
    assert.equal((await notify({ type: 'invoice.paid', id: 'in_first' })).skipped, true, 'first invoice is the checkout order');
    assert.equal((await notify({ type: 'invoice.paid', id: 'in_2' })).ok, true);
    assert.equal((await notify({ type: 'invoice.paid', id: 'in_2' })).skipped, true, 'renewal webhooks are idempotent');
    const list = await orders(base, admin);
    assert.equal(list.length, 2);
    assert.equal(docs(hub, 'renewal').length, 1);

    hub.subscriptions.set('sub_cs_test_1', { id: 'sub_cs_test_1', status: 'past_due', cancelAtPeriodEnd: false });
    assert.equal((await notify({ type: 'subscription.updated', id: 'sub_cs_test_1' })).status, 'past_due');

    const cancelled = await api(base, admin, 'POST', `/shop/admin/subscriptions/${subs[0].id}/cancel`, { atPeriodEnd: true });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.data.cancelAtPeriodEnd, true);
  });
});

test('CK-11 bookings: slots from opening hours, hold the slot, reserve without prepayment, double booking refused', async () => {
  await withShop(async ({ base, hub, admin }) => {
    const all = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [['09:00', '17:00']]]));
    await shopSettings(base, admin, { bookings: { hours: all, payMode: 'both', minNoticeMinutes: 0, slotStepMinutes: 30, staff: [{ id: 'anna', name: 'Anna', active: true }] } });
    const cut = await createProduct(base, admin, { name: 'Herreklipp', price: 450, kind: 'booking', booking: { durationMinutes: 30 } });
    const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const slots = (await api(base, admin, 'GET', `/shop/slots?product=${cut.id}&date=${day}`)).data.slots;
    assert.equal(slots.length, 16, '09:00–17:00 in 30 min slots');
    assert.equal(slots[0].time, '09:00');

    const page = await browser(base).get(`/shop/product/${cut.id}?date=${day}`);
    assert.match(page.text, /name="slot"/);

    const a = browser(base);
    assert.equal((await a.post('/cart/add', { product: cut.id, slot: slots[0].start, date: day })).status, 303);
    const reserve = await a.post('/checkout', { provider: 'reserve', terms: '1', email: 'ola@example.com', name: 'Ola', phone: '90000000' });
    assert.equal(reserve.status, 303);
    assert.equal((await a.get(reserve.location.replace('/api/cms', ''))).status, 200);
    const order = (await orders(base, admin))[0];
    assert.equal(order.paymentProvider, 'reserve');
    assert.equal(order.paymentStatus, 'pending');
    assert.equal(docs(hub, 'booking').length, 1);
    assert.match(hub.formPosts[0].message, /Herreklipp/);

    const bookings = (await api(base, admin, 'GET', '/shop/admin/bookings')).data;
    assert.equal(bookings.length, 1);
    assert.equal(bookings[0].staffId, 'anna', '"first available" is assigned');

    const b = browser(base);
    const taken = await b.post('/cart/add', { product: cut.id, slot: slots[0].start, date: day });
    assert.equal(taken.status, 400, 'the slot is gone');
    const left = (await api(base, admin, 'GET', `/shop/slots?product=${cut.id}&date=${day}`)).data.slots;
    assert.equal(left.length, 15);

    const manual = await api(base, admin, 'POST', '/shop/admin/bookings', { productId: cut.id, start: slots[1].start, staffId: 'anna', customerName: 'Telefon' });
    assert.equal(manual.status, 201);
    assert.equal((await api(base, admin, 'POST', '/shop/admin/bookings', { productId: cut.id, start: slots[1].start, staffId: 'anna' })).status, 409);
    const moved = await api(base, admin, 'PUT', `/shop/admin/bookings/${manual.data.id}`, { start: slots[3].start });
    assert.equal(moved.status, 200);
    assert.equal(moved.data.start, slots[3].start);
  });
});
