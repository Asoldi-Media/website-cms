import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { api, shopSettings, withShop } from './_shop-harness.js';
import { shopModulesFrom, visibleShopPages } from '../client/shop-modules.js';

const menu = (modules) => visibleShopPages(shopModulesFrom(modules)).map((page) => page.label);

/** A 2.1.x shop: discounts and bookings in use, settings saved before modules existed. */
function seedLegacyShop(root) {
  const dir = path.join(root, 'cms', 'shop');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ currency: 'nok', seller: { legalName: 'Kafé AS' }, orders: { prefix: 'K' } }));
  writeFileSync(path.join(dir, 'discounts.json'), JSON.stringify([{ id: 'd1', code: 'SOMMER', type: 'percent', value: 10, active: true }]));
  writeFileSync(path.join(dir, 'bookings.json'), JSON.stringify([{ id: 'bk1', productId: 'p1', start: '2026-11-02T09:00:00.000Z', end: '2026-11-02T10:00:00.000Z', status: 'confirmed' }]));
}

test('a shop saved before modules existed shows every module, and its data is untouched', async () => {
  await withShop(async ({ base, admin }) => {
    const settings = await api(base, admin, 'GET', '/shop/admin/settings');
    assert.equal(settings.status, 200);
    assert.deepEqual(settings.data.modules, { bookings: true, discounts: true, giftcards: true, subscriptions: true, reviews: true, abandoned: true });
    assert.deepEqual(menu(settings.data.modules), ['Timer', 'Rabatter', 'Gavekort', 'Abonnement', 'Omtaler', 'Forlatte kasser'], 'the admin menu lists every page');
    assert.equal(settings.data.seller.legalName, 'Kafé AS');
    const discounts = await api(base, admin, 'GET', '/shop/admin/discounts');
    assert.equal(discounts.status, 200);
    assert.ok(JSON.stringify(discounts.data).includes('SOMMER'));
  }, { seed: seedLegacyShop });
});

test('switching a module off is saved and survives other settings saves', async () => {
  await withShop(async ({ base, admin }) => {
    const saved = await shopSettings(base, admin, { modules: { reviews: false } });
    assert.equal(saved.modules.reviews, false);
    assert.equal(saved.modules.discounts, true);
    assert.equal(menu(saved.modules).includes('Omtaler'), false, 'Omtaler leaves the admin menu');
    const again = await shopSettings(base, admin, { seller: { legalName: 'Nytt navn AS' } });
    assert.equal(again.modules.reviews, false, 'an explicit false stays off');
    assert.equal(again.modules.bookings, true);
  }, { seed: seedLegacyShop });
});
