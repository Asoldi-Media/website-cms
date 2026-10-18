import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProduct } from '../server/catalog.js';
import { normalizeShopSettings, taxRateFor } from '../server/shop/settings.js';
import { priceCart } from '../server/shop/pricing.js';
import { normalizeDiscount } from '../server/shop/discounts.js';
import { allocate, formatMoney, parseMajor, toMinor } from '../server/shop/money.js';
import { appendPriceLog, findVariant, isBuyable, productJsonLd, productVariants, variantPricing } from '../server/shop/product.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-18T12:00:00Z');

const zones = [
  { id: 'no', name: 'Norge', countries: ['NO'], methods: [
    { id: 'post', type: 'flat', name: 'Posten', price: 99, freeOver: 1000, estimateMinDays: 2, estimateMaxDays: 4 },
    { id: 'pickup', type: 'pickup', name: 'Henting i butikk' },
  ] },
  { id: 'nordic', name: 'Norden', countries: ['SE', 'DK'], methods: [
    { id: 'weight', type: 'weight', name: 'Vektbasert', tiers: [{ upToGrams: 1000, price: 150 }, { upToGrams: 5000, price: 300 }] },
  ] },
];

const settings = (patch = {}) => normalizeShopSettings({ shipping: { zones }, ...patch });

const products = {
  shirt: normalizeProduct({ id: 'shirt', name: 'T-skjorte', price: 250, categoryId: 'clothes', weightGrams: 200, options: [{ name: 'Str', values: ['S', 'M'] }], variants: [
    { id: 's', optionValues: { Str: 'S' }, stockQty: 2, sku: 'TS-S' },
    { id: 'm', optionValues: { Str: 'M' }, price: 300, sku: 'TS-M' },
  ] }),
  coffee: normalizeProduct({ id: 'coffee', name: 'Kaffe', price: 115, taxClass: 'food', weightGrams: 500, stockQty: 10 }),
  odd: normalizeProduct({ id: 'odd', name: 'Pin', price: '33,33' }),
  ebook: normalizeProduct({ id: 'ebook', name: 'E-bok', price: 99, kind: 'digital', digitalFiles: [{ id: 'f1', name: 'bok.pdf', file: 'abc.pdf' }] }),
  gift: normalizeProduct({ id: 'gift', name: 'Gavekort', kind: 'giftcard', giftcard: { amounts: [500, 1000] } }),
  course: normalizeProduct({ id: 'course', name: 'Kurs', price: 199, kind: 'subscription', subscription: { interval: 'month' } }),
  legacy: normalizeProduct({ id: 'legacy', name: 'Gammel vare', price: 120, stockQty: 3, extraOptions: [{ name: 'Gaveinnpakning', price: '30' }] }),
  contact: normalizeProduct({ id: 'contact', name: 'Fra 990', price: 'Fra 990' }),
};

function cart(items, extra = {}) {
  return priceCart({ items, settings: extra.settings || settings(), getProduct: (id) => products[id] || null, now: NOW, ...extra });
}

function providerSum(r) {
  return r.providerLines.reduce((s, l) => s + l.unitAmount * l.quantity, 0) + (r.providerShipping?.amountMinor || 0);
}

test('money helpers', () => {
  assert.equal(parseMajor('1 299,50'), 1299.5);
  assert.equal(parseMajor('kr 99,-'), 99);
  assert.equal(parseMajor('Fra 990'), null);
  assert.equal(toMinor('33,33'), 3333);
  assert.deepEqual(allocate(10, [1, 1, 1]), [4, 3, 3]);
  assert.equal(allocate(9900, [25000, 11500]).reduce((a, b) => a + b), 9900);
  assert.equal(formatMoney(129950), '1\u00a0299,50 kr');
});

test('PR-1: prices incl. 25 % MVA; tax extracted per line; shipping taxed', () => {
  const r = cart([{ productId: 'shirt', variantId: 's', quantity: 2 }]);
  assert.equal(r.ok, true);
  assert.equal(r.lines[0].lineTotalMinor, 50000);
  assert.equal(r.lines[0].taxMinor, 10000);
  assert.equal(r.shipping.amountMinor, 9900);
  assert.equal(r.shipping.taxMinor, 1980);
  assert.equal(r.totalMinor, 59900);
  assert.equal(r.taxMinor, 11980);
  assert.deepEqual(r.taxLines, [{ rate: 25, netMinor: 47920, taxMinor: 11980 }]);
  assert.equal(providerSum(r), r.amountDueMinor);
});

test('PR-2: prices entered excl. MVA become gross for the buyer', () => {
  const r = cart([{ productId: 'shirt', variantId: 's', quantity: 1 }], { settings: settings({ tax: { pricesIncludeTax: false } }) });
  assert.equal(r.lines[0].unitGrossMinor, 31250);
  assert.equal(r.lines[0].taxMinor, 6250);
});

test('PR-3: tax class per product (food 15 %)', () => {
  const r = cart([{ productId: 'coffee', quantity: 1 }], { methodId: 'pickup' });
  assert.equal(r.lines[0].rate, 15);
  assert.equal(r.lines[0].taxMinor, 1500);
  assert.equal(r.shipping.amountMinor, 0);
});

test('PR-4: export outside Norway is zero-rated; weight tiers price shipping', () => {
  const r = cart([{ productId: 'coffee', quantity: 2 }], { country: 'SE' });
  assert.equal(r.lines[0].rate, 0);
  assert.equal(r.taxMinor, 0);
  assert.equal(r.shipping.amountMinor, 15000);
  const heavy = cart([{ productId: 'coffee', quantity: 3 }], { country: 'SE' });
  assert.equal(heavy.shipping.amountMinor, 30000);
  assert.equal(taxRateFor(settings({ tax: { exportZeroRated: false } }), { country: 'SE', taxClass: 'standard' }), 25);
});

test('PR-5: odd amounts round per line and providers get exactly the total', () => {
  const r = cart([{ productId: 'odd', quantity: 3 }], { methodId: 'pickup' });
  assert.equal(r.lines[0].lineTotalMinor, 9999);
  assert.equal(r.lines[0].taxMinor, 2000);
  const tenOff = normalizeDiscount({ id: 'd', code: 'TEN', type: 'percent', value: 10 });
  const d = cart([{ productId: 'odd', quantity: 3 }], { methodId: 'pickup', codes: ['ten'], discounts: [tenOff] });
  assert.equal(d.lines[0].lineTotalMinor, 8999);
  assert.deepEqual(d.providerLines, [{ name: '3 × Pin', unitAmount: 8999, quantity: 1 }]);
  assert.equal(providerSum(d), d.amountDueMinor);
});

test('PR-6: zones match by country; pickup; unknown country blocks', () => {
  const pickup = cart([{ productId: 'shirt', variantId: 's', quantity: 1 }], { methodId: 'pickup' });
  assert.equal(pickup.shipping.method.id, 'pickup');
  assert.equal(pickup.shipping.amountMinor, 0);
  assert.deepEqual(pickup.shipping.methods.map((m) => m.id), ['post', 'pickup']);
  const us = cart([{ productId: 'shirt', variantId: 's', quantity: 1 }], { country: 'US' });
  assert.equal(us.ok, false);
  assert.equal(us.errors[0].scope, 'shipping');
  assert.deepEqual(us.shipping.countries.sort(), ['DK', 'NO', 'SE']);
});

test('PR-7: shipping MVA is split by the goods rates', () => {
  const r = cart([{ productId: 'shirt', variantId: 's', quantity: 1 }, { productId: 'coffee', quantity: 1 }]);
  assert.equal(r.shipping.amountMinor, 9900);
  const by = Object.fromEntries(r.taxLines.map((t) => [t.rate, t.taxMinor]));
  assert.equal(by[25], 5000 + 1356);
  assert.equal(by[15], 1500 + 407);
  assert.equal(r.taxMinor, by[25] + by[15]);
  assert.equal(r.shipping.taxMinor, 1356 + 407);
});

test('PR-8: free shipping over an amount', () => {
  const r = cart([{ productId: 'shirt', variantId: 'm', quantity: 4 }]);
  assert.equal(r.goodsMinor, 120000);
  assert.equal(r.shipping.amountMinor, 0);
  assert.equal(r.providerShipping, null);
});

test('PR-9: digital and service carts skip shipping', () => {
  const r = cart([{ productId: 'ebook', quantity: 1 }]);
  assert.equal(r.shipping.required, false);
  assert.equal(r.providerShipping, null);
  assert.equal(r.totalMinor, 9900);
  assert.equal(r.lines[0].digital, true);
});

test('PR-10: coupon percent, fixed cart and fixed product', () => {
  const discounts = [
    normalizeDiscount({ id: '1', code: 'TI', type: 'percent', value: 10 }),
    normalizeDiscount({ id: '2', code: 'FEMTI', type: 'amount', value: 50 }),
    normalizeDiscount({ id: '3', code: 'SKJORTE', type: 'fixed_product', value: 20, appliesTo: { productIds: ['shirt'] } }),
  ];
  const items = [{ productId: 'shirt', variantId: 's', quantity: 2 }, { productId: 'coffee', quantity: 1 }];
  const pct = cart(items, { codes: ['ti'], discounts, methodId: 'pickup' });
  assert.equal(pct.discountMinor, 6150);
  assert.equal(pct.totalMinor, 61500 - 6150);
  const fixed = cart(items, { codes: ['femti'], discounts, methodId: 'pickup' });
  assert.equal(fixed.discountMinor, 5000);
  const perUnit = cart(items, { codes: ['skjorte'], discounts, methodId: 'pickup' });
  assert.equal(perUnit.discountMinor, 4000);
  assert.equal(perUnit.lines.find((l) => l.productId === 'coffee').discountMinor, 0);
  assert.equal(providerSum(perUnit), perUnit.amountDueMinor);
});

test('PR-11: coupon rules (min spend, expiry, limits, per email, sale items, individual use)', () => {
  const discounts = [
    normalizeDiscount({ id: 'a', code: 'MIN', type: 'percent', value: 10, minSubtotal: 1000 }),
    normalizeDiscount({ id: 'b', code: 'OLD', type: 'percent', value: 10, endsAt: new Date(NOW - DAY).toISOString() }),
    normalizeDiscount({ id: 'c', code: 'USED', type: 'percent', value: 10, usageLimit: 1, usedCount: 1 }),
    normalizeDiscount({ id: 'd', code: 'ONCE', type: 'percent', value: 10, usageLimitPerEmail: 1, usedBy: { 'ola@x.no': 1 } }),
    normalizeDiscount({ id: 'e', code: 'FRI', type: 'percent', value: 10, freeShipping: true }),
  ];
  const items = [{ productId: 'shirt', variantId: 's', quantity: 1 }];
  const msg = (codes, extra = {}) => cart(items, { codes, discounts, ...extra }).errors.map((e) => e.message);
  assert.match(msg(['MIN'])[0], /minst 1000/);
  assert.match(msg(['OLD'])[0], /utløpt/);
  assert.match(msg(['USED'])[0], /brukt opp/);
  assert.match(msg(['ONCE'])[0], /e-post/);
  assert.match(msg(['ONCE'], { email: 'OLA@x.no' })[0], /allerede brukt/);
  assert.equal(msg(['ONCE'], { email: 'kari@x.no' }).length, 0);
  assert.match(msg(['NOPE'])[0], /Ugyldig/);
  const free = cart(items, { codes: ['FRI'], discounts });
  assert.equal(free.shipping.amountMinor, 0);
  assert.equal(free.discountMinor, 2500);

  const sale = { ...products.shirt, salePrice: 200, saleFrom: new Date(NOW - DAY).toISOString() };
  const excl = normalizeDiscount({ id: 'x', code: 'NOSALE', type: 'percent', value: 10, appliesTo: { excludeSale: true } });
  const r = priceCart({ items: [{ productId: 'shirt', variantId: 's', quantity: 1 }], settings: settings(), getProduct: () => sale, now: NOW, codes: ['NOSALE'], discounts: [excl] });
  assert.match(r.errors[0].message, /gjelder ikke/);
});

test('PR-12: zero-decimal currencies', () => {
  const r = cart([{ productId: 'shirt', variantId: 's', quantity: 1 }], { settings: settings({ currency: 'jpy' }), methodId: 'pickup' });
  assert.equal(r.lines[0].unitGrossMinor, 250);
  assert.equal(r.currency, 'jpy');
});

test('PR-13: not VAT registered → no MVA lines', () => {
  const r = cart([{ productId: 'shirt', variantId: 's', quantity: 1 }], { settings: settings({ seller: { vatRegistered: false } }) });
  assert.equal(r.taxMinor, 0);
  assert.equal(r.taxLines.every((t) => t.taxMinor === 0), true);
});

test('PR-14: automatic discounts: order threshold, tiered quantity, buy X get Y', () => {
  const over = normalizeDiscount({ id: 'o', method: 'automatic', title: '10 % over 500', type: 'percent', value: 10, minSubtotal: 500 });
  const small = cart([{ productId: 'shirt', variantId: 's', quantity: 1 }], { discounts: [over] });
  assert.equal(small.discountMinor, 0);
  assert.equal(small.errors.length, 0);
  const big = cart([{ productId: 'shirt', variantId: 's', quantity: 2 }], { discounts: [over] });
  assert.equal(big.discountMinor, 5000);
  assert.equal(big.discounts[0].title, '10 % over 500');

  const tiered = normalizeDiscount({ id: 't', method: 'automatic', type: 'tiered', tiers: [{ minQty: 2, percent: 5 }, { minQty: 4, percent: 15 }], appliesTo: { productIds: ['coffee'] } });
  assert.equal(cart([{ productId: 'coffee', quantity: 2 }], { discounts: [tiered] }).discountMinor, 1150);
  assert.equal(cart([{ productId: 'coffee', quantity: 4 }], { discounts: [tiered] }).discountMinor, 6900);

  const b2g1 = normalizeDiscount({ id: 'b', method: 'automatic', type: 'bxgy', bxgy: { buyQty: 2, getQty: 1, getPercent: 100 }, appliesTo: {} });
  const r = cart([{ productId: 'shirt', variantId: 'm', quantity: 2 }, { productId: 'coffee', quantity: 1 }], { discounts: [b2g1] });
  assert.equal(r.discountMinor, 11500, 'cheapest unit free');
  const cross = normalizeDiscount({ id: 'c', method: 'automatic', type: 'bxgy', bxgy: { buyQty: 1, buyProductIds: ['shirt'], getQty: 1, getProductIds: ['coffee'], getPercent: 50 } });
  assert.equal(cart([{ productId: 'shirt', variantId: 'm', quantity: 1 }, { productId: 'coffee', quantity: 2 }], { discounts: [cross] }).discountMinor, 5750);
});

test('PR-15: combination rules decide which discounts stack', () => {
  const autoProduct = normalizeDiscount({ id: 'ap', method: 'automatic', title: 'Kaffe-rabatt', type: 'percent', value: 10, appliesTo: { productIds: ['coffee'] } });
  const code = normalizeDiscount({ id: 'cd', code: 'ORDRE', type: 'amount', value: 20 });
  const items = [{ productId: 'coffee', quantity: 1 }, { productId: 'shirt', variantId: 's', quantity: 1 }];
  const blocked = cart(items, { discounts: [autoProduct, code], codes: ['ORDRE'] });
  assert.match(blocked.errors[0].message, /kombineres med «Kaffe-rabatt»/);
  assert.equal(blocked.discountMinor, 1150);
  const both = cart(items, {
    discounts: [{ ...autoProduct, combinesWith: { product: false, order: true, shipping: true } }, { ...code, combinesWith: { product: true, order: false, shipping: true } }],
    codes: ['ORDRE'],
  });
  assert.equal(both.discountMinor, 1150 + 2000);
  assert.equal(both.appliedCodes[0], 'ORDRE');
});

test('PR-16: gift cards are sold at 0 % MVA without shipping', () => {
  const r = cart([{ productId: 'gift', quantity: 1, giftcard: { amount: 500, recipientName: 'Kari' } }]);
  assert.equal(r.lines[0].rate, 0);
  assert.equal(r.lines[0].lineTotalMinor, 50000);
  assert.equal(r.shipping.required, false);
  assert.equal(r.lines[0].giftcard.recipientName, 'Kari');
  assert.match(cart([{ productId: 'gift', quantity: 1, giftcard: { amount: 123 } }]).errors[0].message, /gyldig beløp/);
});

test('PR-17: gift cards redeem as payment (partial, several, zero to pay, not for gift cards)', () => {
  const cards = [
    { id: 'g1', code: 'GC-AAAA-1111', balanceMinor: 20000, active: true, currency: 'nok' },
    { id: 'g2', code: 'GC-BBBB-2222', balanceMinor: 100000, active: true, currency: 'nok' },
  ];
  const r = cart([{ productId: 'shirt', variantId: 's', quantity: 2 }], { giftcards: cards });
  assert.equal(r.totalMinor, 59900);
  assert.deepEqual(r.giftcardPayments.map((g) => g.amountMinor), [20000, 39900]);
  assert.equal(r.amountDueMinor, 0);
  assert.equal(r.providerLines.length, 0);
  assert.equal(r.taxMinor, 11980, 'VAT stays on the goods');

  const partial = cart([{ productId: 'shirt', variantId: 's', quantity: 2 }], { giftcards: [cards[0]] });
  assert.equal(partial.amountDueMinor, 39900);
  assert.deepEqual(partial.providerLines, [{ name: 'Bestilling (rest etter gavekort)', unitAmount: 39900, quantity: 1 }]);
  assert.equal(providerSum(partial), partial.amountDueMinor);

  const giftForGift = cart([{ productId: 'gift', quantity: 1, giftcard: { amount: 500 } }], { giftcards: [cards[1]] });
  assert.match(giftForGift.errors[0].message, /kjøpe gavekort/);
  assert.equal(giftForGift.amountDueMinor, 50000);
  const expired = cart([{ productId: 'ebook', quantity: 1 }], { giftcards: [{ ...cards[0], expiresAt: new Date(NOW - DAY).toISOString() }] });
  assert.match(expired.errors[0].message, /ikke gyldig/);
});

test('subscriptions price as recurring lines and refuse gift cards', () => {
  const r = cart([{ productId: 'course', quantity: 1 }], { giftcards: [{ id: 'g', code: 'GC-1', balanceMinor: 100, active: true }] });
  assert.equal(r.mode, 'subscription');
  assert.equal(r.requiresStripe, true);
  assert.deepEqual(r.recurringLines, [{ name: 'Kurs', unitAmount: 19900, quantity: 1, interval: 'month', intervalCount: 1 }]);
  assert.match(r.errors[0].message, /abonnement/);
});

test('stock and holds limit the quantity; contact-only products are refused', () => {
  const over = cart([{ productId: 'shirt', variantId: 's', quantity: 3 }]);
  assert.match(over.errors[0].message, /Bare 2 igjen/);
  const held = cart([{ productId: 'shirt', variantId: 's', quantity: 1 }], { available: () => 0 });
  assert.match(held.errors[0].message, /utsolgt/);
  assert.match(cart([{ productId: 'contact', quantity: 1 }]).errors[0].message, /kan ikke kjøpes/);
  assert.match(cart([{ productId: 'shirt', quantity: 1 }]).errors[0].message, /Velg en variant/);
  assert.equal(cart([]).ok, false);
});

test('CA-2/CA-3: variants carry own price, SKU and stock', () => {
  const m = findVariant(products.shirt, 'm');
  assert.equal(variantPricing(products.shirt, m, NOW).price, 300);
  assert.equal(variantPricing(products.shirt, findVariant(products.shirt, 's'), NOW).price, 250);
  assert.equal(productVariants(products.shirt).length, 2);
  const dup = normalizeProduct({ id: 'x', name: 'x', price: 1, options: [{ name: 'Str', values: ['S'] }], variants: [{ optionValues: { Str: 'S' } }, { optionValues: { Str: 'S' } }, { optionValues: { Str: 'XL' } }] });
  assert.equal(dup.variants.length, 1, 'duplicate and unknown option values are dropped');
});

test('CA-4: legacy products become one implicit variant with extras', () => {
  assert.equal(products.legacy.kind, 'physical');
  assert.equal(productVariants(products.legacy)[0].id, 'default');
  const r = cart([{ productId: 'legacy', quantity: 2, extras: ['Gaveinnpakning'] }], { methodId: 'pickup' });
  assert.equal(r.lines[0].unitGrossMinor, 15000);
  assert.equal(r.providerLines[0].name, 'Gammel vare (Gaveinnpakning)');
  assert.equal(isBuyable(products.legacy), true);
  assert.equal(isBuyable(products.contact), false);
  assert.equal(normalizeProduct({ id: 'm', name: 'Pizza', price: 150, productType: 'menu' }).kind, 'service');
});

test('CA-5/CA-6: sale schedule and førpris (lowest price in 30 days)', () => {
  const base = normalizeProduct({ id: 'p', name: 'Vare', price: 500 });
  const before = { ...base, priceLog: [{ at: new Date(NOW - 20 * DAY).toISOString(), v: 'default', p: 450 }, { at: new Date(NOW - 40 * DAY).toISOString(), v: 'default', p: 300 }] };
  const onSale = { ...before, salePrice: 400, saleFrom: new Date(NOW - DAY).toISOString(), saleTo: new Date(NOW + DAY).toISOString() };
  const pricing = variantPricing(onSale, findVariant(onSale), NOW);
  assert.equal(pricing.price, 400);
  assert.equal(pricing.onSale, true);
  assert.equal(pricing.beforePrice, 450, '40-day-old 300 is outside the window');
  assert.equal(variantPricing(onSale, findVariant(onSale), NOW + 2 * DAY).price, 500, 'sale ended');
  assert.equal(variantPricing({ ...onSale, saleFrom: new Date(NOW + DAY).toISOString() }, findVariant(onSale), NOW).onSale, false);
  const log = appendPriceLog(base, { ...base, price: 550 }, NOW);
  assert.deepEqual(log.map((e) => e.p), [550]);
  assert.equal(appendPriceLog(base, base, NOW).length, 0);
});

test('CA-9: Product JSON-LD with offers per variant and rating', () => {
  const ld = productJsonLd(products.shirt, { origin: 'https://shop.no', currency: 'nok', rating: { average: 4.5, count: 2 }, now: NOW });
  assert.equal(ld['@type'], 'Product');
  assert.equal(ld.offers.length, 2);
  assert.equal(ld.offers[1].price, '300.00');
  assert.equal(ld.offers[0].availability, 'https://schema.org/InStock');
  assert.equal(ld.aggregateRating.reviewCount, 2);
});
