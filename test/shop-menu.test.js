import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeShopSettings, SHOP_MODULES } from '../server/shop/settings.js';
import { NO_SHOP_MODULES, SHOP_EXTRA_PAGES, shopModulesFrom, shopPageBlocked, visibleShopPages } from '../client/shop-modules.js';

const ALL_LABELS = ['Timer', 'Rabatter', 'Gavekort', 'Abonnement', 'Omtaler', 'Forlatte kasser'];
const labels = (modules) => visibleShopPages(modules).map((page) => page.label);

test('the admin menu and the server know the same shop modules', () => {
  assert.deepEqual(SHOP_EXTRA_PAGES.map((page) => page.id), [...SHOP_MODULES]);
});

test('a shop saved before modules existed lists every optional page in the menu', () => {
  const legacy = normalizeShopSettings({ currency: 'nok', seller: { legalName: 'Kafé AS' } });
  assert.deepEqual(labels(shopModulesFrom(legacy.modules)), ALL_LABELS);
  assert.deepEqual(labels(shopModulesFrom(undefined)), ALL_LABELS, 'no modules key at all');
  assert.deepEqual(labels(shopModulesFrom({ reviews: null })), ALL_LABELS, 'null counts as never set');
  for (const page of SHOP_EXTRA_PAGES) assert.equal(shopPageBlocked(page.id, shopModulesFrom(legacy.modules)), false, page.id);
});

test('a module switched off leaves the menu and its page is blocked', () => {
  const settings = normalizeShopSettings({ modules: { reviews: false } });
  const modules = shopModulesFrom(settings.modules);
  assert.deepEqual(labels(modules), ALL_LABELS.filter((label) => label !== 'Omtaler'));
  assert.equal(shopPageBlocked('reviews', modules), true);
  assert.equal(shopPageBlocked('discounts', modules), false);
  assert.equal(shopPageBlocked('orders', modules), false, 'main shop pages are never blocked');
  assert.deepEqual(labels(shopModulesFrom({ reviews: 0, bookings: false })), ['Rabatter', 'Gavekort', 'Abonnement', 'Forlatte kasser']);
});

test('before settings load the menu shows no optional page', () => {
  assert.deepEqual(labels(NO_SHOP_MODULES), []);
});

test('the admin shell builds its shop menu from these helpers', () => {
  const source = readFileSync(new URL('../client/ClientCMS.jsx', import.meta.url), 'utf8');
  assert.match(source, /from '\.\/shop-modules\.js'/);
  assert.match(source, /visibleShopPages\(modules\)\.map\(/);
  assert.match(source, /shopPageBlocked\(shopPage, modules\)/);
  assert.equal((source.match(/setModules\(/g) || []).length, (source.match(/setModules\(shopModulesFrom\(/g) || []).length, 'every settings load goes through shopModulesFrom');
});
