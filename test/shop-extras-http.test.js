import test from 'node:test';
import assert from 'node:assert/strict';
import { api, browser, createProduct, docs, employee, payStripe, shopSettings, withShop } from './_shop-harness.js';
import { beforePrice } from '../server/shop/product.js';

const DAY = 86_400_000;

async function buy(base, hub, items, email = 'ola@example.com') {
  const v = browser(base);
  for (const item of items) assert.equal((await v.post('/cart/add', item)).status, 303);
  const start = await v.post('/checkout', { provider: 'stripe', terms: '1', email });
  assert.equal(start.status, 303, start.text.slice(0, 400));
  const id = start.location.split('/').pop();
  hub.sessions.get(id).customerEmail = email;
  assert.equal((await payStripe(hub, v, id)).status, 200);
}

test('EX-1 førpris = lowest logged price in the 30 days before the reduction', () => {
  const now = Date.now();
  const at = (days) => new Date(now - days * DAY).toISOString();
  const product = { saleFrom: '', priceLog: [{ at: at(40), v: 'default', p: 300 }, { at: at(20), v: 'default', p: 450 }, { at: at(10), v: 'default', p: 500 }, { at: at(0.1), v: 'default', p: 400 }] };
  assert.equal(beforePrice(product, 'default', 500, now, 400), 450, 'the sale price itself and prices older than 30 days do not count');
  assert.equal(beforePrice({ saleFrom: '', priceLog: [{ at: at(0.1), v: 'default', p: 400 }] }, 'default', 500, now, 400), 500);
  assert.equal(beforePrice({ saleFrom: at(5), priceLog: product.priceLog }, 'default', 500, now, 400), 450);
});

test('EX-2 variants, stock per variant, sale price with førpris, JSON-LD offers', async () => {
  await withShop(async ({ base, admin }) => {
    const shirt = await createProduct(base, admin, {
      name: 'Genser',
      price: 500,
      options: [{ name: 'Farge', values: ['Rød', 'Blå'] }],
      variants: [{ id: 'red', optionValues: { Farge: 'Rød' }, stockQty: 1, sku: 'G-R' }, { id: 'blue', optionValues: { Farge: 'Blå' }, price: 550, stockQty: 0, sku: 'G-B' }],
    });
    const v = browser(base);
    const page = await v.get(`/shop/product/${shirt.id}`);
    assert.match(page.text, /<option value="blue"[^>]*disabled/);
    const ld = JSON.parse(page.text.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1].replace(/\\u003c/g, '<'));
    assert.equal(ld['@type'], 'Product');
    assert.equal(ld.offers.length, 2);
    assert.equal((await v.post('/cart/add', { product: shirt.id, variant: 'blue' })).status, 400);
    assert.equal((await v.post('/cart/add', { product: shirt.id })).status, 400, 'a variant must be chosen');
    assert.equal((await v.post('/cart/add', { product: shirt.id, variant: 'red' })).status, 303);
    const s = (await v.get('/cart.json')).data;
    assert.equal(s.items[0].variantLabel, 'Rød');
    assert.equal(s.totalMinor, 50000);

    await api(base, admin, 'PUT', `/products/${shirt.id}`, { salePrice: 400 });
    const sale = await v.get(`/shop/product/${shirt.id}`);
    assert.match(sale.text, /Førpris \(laveste pris siste 30 dager\): 500/);
    assert.equal((await v.get('/cart.json')).data.totalMinor, 40000, 'sale price applies in the cart');
    const pub = (await fetch(`${base}/catalog`).then((r) => r.json())).products.find((p) => p.id === shirt.id);
    assert.equal(pub.variants.find((x) => x.id === 'red').beforePrice, 500);
    assert.equal(pub.priceLog, undefined, 'price history stays private');
  });
});

test('EX-3 automatic discounts: BXGY and quantity tiers apply without a code', async () => {
  await withShop(async ({ base, admin }) => {
    const soap = await createProduct(base, admin, { name: 'Såpe', price: 100 });
    const candle = await createProduct(base, admin, { name: 'Lys', price: 80 });
    await api(base, admin, 'POST', '/shop/admin/discounts', { method: 'automatic', title: '3 for 2 på såpe', type: 'bxgy', bxgy: { buyQty: 2, getQty: 1, getPercent: 100, buyProductIds: [soap.id], getProductIds: [soap.id] } });
    await api(base, admin, 'POST', '/shop/admin/discounts', { method: 'automatic', title: 'Kjøp 5 lys', type: 'tiered', appliesTo: { productIds: [candle.id] }, tiers: [{ minQty: 5, percent: 20 }] });
    const v = browser(base);
    await v.post('/cart/add', { product: soap.id, quantity: '3' });
    let s = (await v.get('/cart.json')).data;
    assert.equal(s.discountMinor, 10000);
    assert.equal(s.totalMinor, 20000);
    await v.post('/cart/add', { product: candle.id, quantity: '5' });
    s = (await v.get('/cart.json')).data;
    assert.equal(s.discountMinor, 10000, 'product discounts do not combine by default: best one per line wins');
    const cart = await v.get('/cart');
    assert.match(cart.text, /3 for 2 på såpe|Kjøp 5 lys/);
  });
});

test('EX-4 magic-link account: orders, bookings (ICS + cancel with refund), logout, no account enumeration', async () => {
  await withShop(async ({ base, hub, admin }) => {
    const all = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [['09:00', '12:00']]]));
    await shopSettings(base, admin, { bookings: { hours: all, minNoticeMinutes: 0, slotStepMinutes: 60, location: 'Gata 1, Oslo' } });
    const cut = await createProduct(base, admin, { name: 'Klipp', price: 400, kind: 'booking', booking: { durationMinutes: 60 } });
    const day = new Date(Date.now() + 4 * DAY).toISOString().slice(0, 10);
    const slot = (await api(base, admin, 'GET', `/shop/slots?product=${cut.id}&date=${day}`)).data.slots[0];
    await buy(base, hub, [{ product: cut.id, slot: slot.start }]);
    assert.equal(docs(hub, 'booking').length, 1);

    const v = browser(base);
    const unknown = await v.post('/account/login', { email: 'nobody@example.com' });
    const known = await v.post('/account/login', { email: 'OLA@example.com' });
    assert.equal(unknown.status, 200);
    assert.equal(known.status, 200);
    assert.equal(unknown.text, known.text, 'same answer whether or not the address has orders');
    const links = docs(hub, 'magic-link');
    assert.equal(links.length, 1);
    assert.equal(links[0].to, 'ola@example.com');
    assert.ok('seller' in links[0].document, 'login mail carries the seller block for the sender name');
    const link = new URL(links[0].document.link);
    assert.equal(link.pathname, '/api/cms/account/verify');

    const confirm = await v.get(`/account/verify${link.search}`);
    assert.equal(confirm.status, 200);
    assert.match(confirm.text, /<form method="post" action="\/api\/cms\/account\/verify">/, 'a GET (mail scanner) does not log in');
    assert.equal(v.jar.has('asoldi_account'), false);
    const token = link.searchParams.get('token');
    const signedIn = await v.post('/account/verify', { token });
    assert.equal(signedIn.status, 303);
    assert.ok(v.jar.get('asoldi_account'));
    assert.equal((await browser(base).post('/account/verify', { token })).status, 401, 'links work once');

    const home = await v.get('/account');
    assert.match(home.text, /#1001/);
    assert.match(home.text, /Kommende timer/);
    assert.equal((await v.get('/account/orders/1001')).status, 200);
    assert.equal((await v.get('/account/orders/9999')).status, 404);
    assert.equal((await browser(base).get('/account/orders/1001')).status, 303, 'signed-out visitors are sent to login');

    const booking = (await api(base, admin, 'GET', '/shop/admin/bookings')).data[0];
    const ics = await v.get(`/account/bookings/${booking.id}.ics`);
    assert.match(ics.headers.get('content-type'), /text\/calendar/);
    assert.match(ics.text, /BEGIN:VCALENDAR[\s\S]*SUMMARY:Klipp[\s\S]*LOCATION:Gata 1\\, Oslo/);
    assert.equal((await browser(base).get(`/account/bookings/${booking.id}.ics`)).status, 404);

    const cancel = await v.post(`/account/bookings/${booking.id}/cancel`, {});
    assert.equal(cancel.status, 200, cancel.text.slice(0, 300));
    assert.equal(hub.refunds.length, 1, 'paid booking is refunded on cancel');
    assert.equal(hub.refunds[0].amountMinor, 40000);
    assert.equal((await api(base, admin, 'GET', '/shop/admin/bookings')).data[0].status, 'cancelled');
    assert.equal(docs(hub, 'booking-cancelled').length, 1);
    assert.equal(docs(hub, 'credit-note').length, 1);

    for (let i = 0; i < 3; i += 1) await browser(base).post('/account/login', { email: 'ola@example.com' }, { headers: { 'X-Forwarded-For': `10.0.0.${i + 10}` } });
    assert.equal(docs(hub, 'magic-link').length, 3, 'max 3 links per address per 15 minutes');

    assert.equal((await v.post('/account/logout', {})).status, 303);
    assert.match((await v.get('/account')).text, /Send innloggingslenke/);
  });
});

test('EX-5 digital downloads: private upload, link in receipt, limited downloads, never public', async () => {
  await withShop(async ({ base, hub, admin, origin }) => {
    const upload = (headers, name) => {
      const fd = new FormData();
      fd.append('file', new Blob(['PDF-DATA']), name);
      return fetch(`${base}/shop/admin/files`, { method: 'POST', headers, body: fd });
    };
    const emp = await employee(base, admin);
    assert.equal((await upload(emp, 'guide.pdf')).status, 403);
    assert.equal((await upload(admin, 'virus.exe')).status, 400);
    const res = await upload(admin, 'guide.pdf');
    assert.equal(res.status, 201);
    const file = await res.json();
    assert.equal((await api(base, admin, 'GET', '/shop/admin/files')).data.length, 1);

    const ebook = await createProduct(base, admin, { name: 'E-bok', price: 99, kind: 'digital', digitalFiles: [{ id: file.id, name: 'Guide', file: file.file }], downloadLimit: 2 });
    const pub = (await fetch(`${base}/catalog`).then((r) => r.json())).products.find((p) => p.id === ebook.id);
    assert.equal(JSON.stringify(pub).includes(file.file), false, 'stored file name is never public');
    assert.equal((await fetch(`${base}/uploads/${file.file}`)).status, 404);

    await buy(base, hub, [{ product: ebook.id }]);
    const receipt = docs(hub, 'order')[0].document;
    assert.equal(receipt.downloads.length, 1);
    const url = new URL(receipt.downloads[0].url);
    assert.equal(url.origin, origin);
    const first = await fetch(url);
    assert.equal(first.status, 200);
    assert.equal(await first.text(), 'PDF-DATA');
    assert.match(first.headers.get('content-disposition'), /attachment/);
    assert.equal((await fetch(url)).status, 200);
    assert.equal((await fetch(url)).status, 410, 'download limit reached');
    assert.equal((await fetch(`${base}/downloads/not-a-token`)).status, 410);

    assert.equal((await api(base, admin, 'DELETE', `/shop/admin/files/${file.file}`)).status, 200);
    assert.equal((await api(base, admin, 'DELETE', '/shop/admin/files/..%2F..%2Fcms%2Fusers.json')).status, 404);
  });
});

test('EX-6 angreskjema: matched order gets a receipt on a durable medium; unmatched is still forwarded', async () => {
  await withShop(async ({ base, hub, admin }) => {
    const lamp = await createProduct(base, admin, { name: 'Lampe', price: 400 });
    await buy(base, hub, [{ product: lamp.id }]);
    const v = browser(base);
    const form = await v.get('/angreskjema?order=1001');
    assert.match(form.text, /value="1001"/);
    const ok = await v.post('/angreskjema', { order: '1001', email: 'ola@example.com', name: 'Ola', text: 'Lampen', received: '01.10.2026' });
    assert.equal(ok.status, 200);
    assert.equal(docs(hub, 'withdrawal').length, 1);
    assert.equal(docs(hub, 'withdrawal')[0].document.withdrawal.name, 'Ola');
    const order = (await api(base, admin, 'GET', '/orders')).data[0];
    assert.equal(order.events.at(-1).type, 'withdrawal');
    const wrong = await v.post('/angreskjema', { order: '1001', email: 'someone@example.com', name: 'X', text: 'Y' });
    assert.equal(wrong.status, 200);
    assert.equal(docs(hub, 'withdrawal').length, 1, 'no receipt for an email that did not place the order');
    assert.ok(hub.formPosts.some((p) => /Angreskjema mottatt for ordre 1001/.test(p.message)));
    assert.equal((await v.post('/angreskjema', { order: '1', email: 'bad', text: '' })).status, 400);
    const audit = (await api(base, admin, 'GET', '/shop/admin/audit')).data;
    assert.equal(audit.filter((a) => a.action === 'withdrawal').length, 2);
  });
});

test('EX-7 reviews: pending until approved, verified purchase flag, rating in JSON-LD', async () => {
  await withShop(async ({ base, hub, admin }) => {
    const bag = await createProduct(base, admin, { name: 'Veske', price: 600, reviewsEnabled: true });
    const quiet = await createProduct(base, admin, { name: 'Stille', price: 10, reviewsEnabled: false });
    await buy(base, hub, [{ product: bag.id }]);
    const v = browser(base);
    assert.equal((await v.post('/reviews', { product: bag.id, rating: '5', name: 'Ola', email: 'ola@example.com', text: 'Supert!' })).status, 201);
    assert.equal((await v.post('/reviews', { product: bag.id, rating: '3', name: 'Per', email: 'per@example.com', text: 'Grei' })).status, 201);
    assert.equal((await v.post('/reviews', { product: quiet.id, rating: '5', name: 'A', email: 'a@example.com', text: 'x' })).status, 404);
    assert.equal((await v.post('/reviews', { product: bag.id, rating: '9', name: 'A', email: 'a@example.com', text: 'x' })).status, 400);
    assert.doesNotMatch((await v.get(`/shop/product/${bag.id}`)).text, /Supert!/, 'pending reviews are hidden');
    const rows = (await api(base, admin, 'GET', '/shop/admin/reviews')).data;
    assert.equal(rows.find((r) => r.name === 'Ola').verified, true);
    assert.equal(rows.find((r) => r.name === 'Per').verified, false);
    for (const r of rows) await api(base, admin, 'PUT', `/shop/admin/reviews/${r.id}`, { status: 'approved', reply: r.name === 'Per' ? 'Takk!' : '' });
    const page = (await v.get(`/shop/product/${bag.id}`)).text;
    assert.match(page, /Supert!/);
    assert.match(page, /Verifisert kjøp/);
    assert.match(page, /Svar fra butikken: Takk!/);
    const ld = JSON.parse(page.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1].replace(/\\u003c/g, '<'));
    assert.equal(ld.aggregateRating.reviewCount, 2);
    assert.equal(Number(ld.aggregateRating.ratingValue), 4);
    assert.equal((await api(base, admin, 'DELETE', `/shop/admin/reviews/${rows[0].id}`)).status, 200);
    let limited;
    for (let i = 0; i < 6; i += 1) limited = await v.post('/reviews', { product: bag.id, rating: '4', name: 'Spam', email: 's@example.com', text: 'x' });
    assert.equal(limited.status, 429);
  });
});

test('EX-8 CSV: Shopify import with variants (dry run first), Woo-compatible export round trip', async () => {
  await withShop(async ({ base, admin }) => {
    const csv = 'Handle,Title,Body (HTML),Vendor,Type,Option1 Name,Option1 Value,Variant SKU,Variant Price,Variant Inventory Qty\n'
      + 'genser,Genser,<p>Varm</p>,Asoldi,Klær,Størrelse,S,G-S,499,3\n'
      + 'genser,,,,,,M,G-M,499,0\n'
      + 'lue,Lue,,,Klær,Title,Default Title,L-1,"199,50",5\n';
    const post = (query, headers = admin) => fetch(`${base}/shop/admin/products/import${query}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'text/csv' }, body: csv }).then(async (r) => ({ status: r.status, data: await r.json() }));
    const emp = await employee(base, admin);
    assert.equal((await post('?dryRun=1', emp)).status, 403);
    const dry = await post('?dryRun=1');
    assert.equal(dry.status, 200);
    assert.deepEqual([dry.data.format, dry.data.created, dry.data.updated], ['shopify', 2, 0]);
    assert.deepEqual(dry.data.newCategories, ['Klær']);
    assert.equal((await api(base, admin, 'GET', '/products')).data.length, 0, 'dry run writes nothing');
    const done = await post('');
    assert.equal(done.data.created, 2);
    const products = (await api(base, admin, 'GET', '/products')).data;
    const genser = products.find((p) => p.name === 'Genser');
    assert.equal(genser.variants.length, 2);
    assert.equal(genser.variants.find((x) => x.sku === 'G-S').stockQty, 3);
    assert.equal(products.find((p) => p.name === 'Lue').price, 199.5);

    const exported = await api(base, admin, 'GET', '/shop/admin/products/export.csv');
    assert.match(exported.headers.get('content-type'), /text\/csv/);
    assert.match(exported.data, /^\uFEFF?ID,Type,SKU,Name/);
    const again = await fetch(`${base}/shop/admin/products/import`, { method: 'POST', headers: { ...admin, 'Content-Type': 'text/csv' }, body: exported.data }).then((r) => r.json());
    assert.equal(again.format, 'woocommerce');
    assert.equal(again.created, 0, 'export → import updates by SKU instead of duplicating');
    assert.equal((await api(base, admin, 'GET', '/products')).data.length, 2);
    assert.equal((await fetch(`${base}/shop/admin/products/import`, { method: 'POST', headers: { ...admin, 'Content-Type': 'text/csv' }, body: 'a,b\n1,2' })).status, 400);
  });
});

test('EX-9 settings are owner-only; button text, prices excl. MVA and export zero-rating apply', async () => {
  await withShop(async ({ base, admin }) => {
    const emp = await employee(base, admin);
    assert.equal((await api(base, emp, 'GET', '/shop/admin/settings')).status, 200);
    assert.equal((await api(base, emp, 'PUT', '/shop/admin/settings', { checkout: { buttonText: 'x' } })).status, 403);
    await shopSettings(base, admin, {
      checkout: { buttonText: 'Bestill og betal' },
      tax: { pricesIncludeTax: false, exportZeroRated: true },
      shipping: { zones: [{ id: 'all', name: 'Hele verden', countries: ['*'], methods: [{ id: 'f', type: 'flat', name: 'Frakt', price: '100' }] }] },
    });
    const item = await createProduct(base, admin, { name: 'Vare', price: 100 });
    const v = browser(base);
    await v.post('/cart/add', { product: item.id });
    const s = (await v.get('/cart.json')).data;
    assert.equal(s.totalMinor, 25000, '100 + 25 % and 100 shipping + 25 %');
    assert.equal(s.taxMinor, 5000);
    assert.match((await v.get('/cart')).text, /Bestill og betal/);
    await v.post('/cart/options', { country: 'US' });
    const us = (await v.get('/cart.json')).data;
    assert.equal(us.taxMinor, 0, 'export outside Norway is zero-rated');
    assert.equal(us.totalMinor, 20000);
    const audit = (await api(base, admin, 'GET', '/shop/admin/audit')).data;
    assert.equal(audit[0].action, 'settings');
    assert.equal((await api(base, emp, 'GET', '/shop/admin/audit')).status, 403);
  });
});

test('EX-10 abandoned checkout: one reminder only with consent; expired session frees the hold', async () => {
  await withShop(async ({ base, hub, admin }) => {
    await shopSettings(base, admin, { checkout: { reminderConsent: true }, seller: { legalName: 'Siste Butikk AS', email: 'post@siste.no' } });
    const last = await createProduct(base, admin, { name: 'Siste', price: 300, stockQty: 1 });
    const v = browser(base);
    await v.post('/cart/add', { product: last.id });
    assert.match((await v.get('/cart')).text, /name="consent"/);
    await v.post('/checkout', { provider: 'stripe', terms: '1', email: 'ola@example.com', consent: '1' });
    assert.equal(hub.sessions.get('cs_test_1').reminderConsent, true);
    assert.equal((await browser(base).post('/cart/add', { product: last.id })).status, 400, 'held');
    const notify = (id) => fetch(`${base}/checkout/notify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'checkout.expired', id }) }).then((r) => r.json());
    assert.equal((await notify('cs_test_1')).ok, false, 'an open session is not treated as expired');
    hub.sessions.get('cs_test_1').status = 'expired';
    assert.equal((await notify('cs_test_1')).reminded, true);
    assert.equal((await notify('cs_test_1')).skipped, true);
    const reminders = docs(hub, 'cart-reminder');
    assert.equal(reminders.length, 1);
    assert.equal(reminders[0].document.providerId, 'cs_test_1');
    assert.equal(reminders[0].document.seller.name, 'Siste Butikk AS', 'marketing mail names the legal sender');
    const link = reminders[0].document.recoveryUrl;
    assert.match(link, /^http:\/\/127\.0\.0\.1:\d+\/api\/cms\/cart\/recover\?token=[\w-]{20,}$/);
    const elsewhere = browser(base);
    const back = await elsewhere.get(link);
    assert.equal(back.location, '/api/cms/cart');
    const restored = (await elsewhere.get('/cart.json')).data;
    assert.equal(restored.count, 1, 'the reminder link rebuilds the cart on any device; checkout runs again with fresh prices');
    const forged = browser(base);
    await forged.get('/cart/recover?token=nope');
    assert.equal(forged.jar.has('asoldi_cart'), false);
    assert.equal((await browser(base).post('/cart/add', { product: last.id })).status, 303, 'hold released');

    const v2 = browser(base);
    await v2.post('/cart/add', { product: last.id });
    await v2.post('/checkout', { provider: 'stripe', terms: '1', email: 'per@example.com' });
    hub.sessions.get('cs_test_2').status = 'expired';
    assert.equal((await notify('cs_test_2')).reminded, false, 'no consent → no reminder');
    const rows = (await api(base, admin, 'GET', '/shop/admin/checkouts?status=expired')).data;
    assert.equal(rows.length, 2);
    assert.equal(rows.find((r) => r.email === 'ola@example.com').reminderSentAt !== '', true);

    await shopSettings(base, admin, { checkout: { reminderConsent: false } });
    const v3 = browser(base);
    await v3.post('/cart/add', { product: last.id });
    await v3.post('/checkout', { provider: 'stripe', terms: '1', email: 'kari@example.com', consent: '1' });
    assert.equal(hub.sessions.get('cs_test_3').reminderConsent, false, 'a forged consent field is ignored when reminders are off');
  });
});

test('EX-10b back from the payment page still gets the one reminder, unless the buyer tried again', async () => {
  await withShop(async ({ base, hub, admin }) => {
    await shopSettings(base, admin, { checkout: { reminderConsent: true } });
    const hat = await createProduct(base, admin, { name: 'Lue', price: 200 });
    const notify = (id) => fetch(`${base}/checkout/notify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'checkout.expired', id }) }).then((r) => r.json());
    const refOf = (id) => new URL(hub.sessions.get(id).successUrl).searchParams.get('ref');

    const v = browser(base);
    await v.post('/cart/add', { product: hat.id });
    await v.post('/checkout', { provider: 'stripe', terms: '1', email: 'ola@example.com', consent: '1' });
    assert.equal((await v.get(`/checkout/cancel?ref=${refOf('cs_test_1')}`)).location, '/api/cms/cart');
    hub.sessions.get('cs_test_1').status = 'expired';
    assert.equal((await notify('cs_test_1')).reminded, true, 'clicking back is still an abandoned cart');

    const w = browser(base);
    await w.post('/cart/add', { product: hat.id });
    await w.post('/checkout', { provider: 'stripe', terms: '1', email: 'kari@example.com', consent: '1' });
    await w.get(`/checkout/cancel?ref=${refOf('cs_test_2')}`);
    await new Promise((r) => setTimeout(r, 5));
    await w.post('/checkout', { provider: 'stripe', terms: '1', email: 'kari@example.com', consent: '1' });
    hub.sessions.get('cs_test_2').status = 'expired';
    assert.equal((await notify('cs_test_2')).reminded, false, 'a newer checkout from the same buyer means no reminder');
    assert.equal(docs(hub, 'cart-reminder').length, 1);
  });
});

test('EX-11 customer cancels a subscription from Min side; documents survive a mail outage', async () => {
  await withShop(async ({ base, hub, admin }) => {
    const box = await createProduct(base, admin, { name: 'Abo', price: 99, kind: 'subscription', subscription: { interval: 'month' } });
    hub.failDocuments = true;
    await buy(base, hub, [{ product: box.id }]);
    const order = (await api(base, admin, 'GET', '/orders')).data[0];
    assert.equal(order.documents[0].ok, false, 'order is kept even when the receipt fails; the failure is logged');
    hub.failDocuments = false;
    assert.equal((await api(base, admin, 'POST', `/orders/${order.id}/resend`, { kind: 'order' })).data.ok, true);

    const v = browser(base);
    await v.post('/account/login', { email: 'ola@example.com' });
    const token = new URL(docs(hub, 'magic-link')[0].document.link).searchParams.get('token');
    await v.post('/account/verify', { token });
    const sub = (await api(base, admin, 'GET', '/shop/admin/subscriptions')).data[0];
    assert.match((await v.get('/account')).text, /Si opp/);
    const res = await v.post(`/account/subscriptions/${sub.id}/cancel`, {});
    assert.equal(res.status, 200);
    assert.equal((await api(base, admin, 'GET', '/shop/admin/subscriptions')).data[0].cancelAtPeriodEnd, true);
    assert.match((await v.get('/account')).text, /avsluttes ved periodens slutt/);
  });
});
