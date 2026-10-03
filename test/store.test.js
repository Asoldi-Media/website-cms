import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/store.js';
import {
  normalizeCatalogType,
  normalizeFeatures,
  normalizePrice,
  normalizeProduct,
  resolveCatalogType,
} from '../server/catalog.js';

function makeTempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'client-cms-'));
  return { dir, store: createStore(dir), cmsDir: join(dir, 'cms') };
}

test('normalizeCatalogType accepts menu, tiers, and normal', () => {
  assert.equal(normalizeCatalogType('menu'), 'menu');
  assert.equal(normalizeCatalogType('tiers'), 'tiers');
  assert.equal(normalizeCatalogType('normal'), 'normal');
  assert.equal(normalizeCatalogType('other'), null);
  assert.equal(resolveCatalogType(null), 'normal');
});

test('normalizeFeatures fills new flags without dropping users', () => {
  assert.deepEqual(normalizeFeatures({ ecommerce: true }), {
    users: true,
    analytics: false,
    ecommerce: true,
    blog: false,
    socialSync: false,
    emailMarketing: false,
    general: false,
  });
});

test('normalizePrice keeps display strings and parses numbers', () => {
  assert.equal(normalizePrice(12.5), 12.5);
  assert.equal(normalizePrice('18'), 18);
  assert.equal(normalizePrice('109,-'), '109,-');
  assert.equal(normalizePrice('$59 / month'), '$59 / month');
});

test('migrates flat products.json in place', () => {
  const { dir, store, cmsDir } = makeTempStore();
  mkdirSync(cmsDir, { recursive: true });
  writeFileSync(
    join(cmsDir, 'products.json'),
    JSON.stringify([
      { id: 'old-1', name: 'Nigiri', price: 109, description: 'Salmon', imageUrl: '/n.jpg', createdAt: '2026-01-01T00:00:00.000Z' },
    ]),
    'utf8',
  );

  const products = store.getAllProducts();
  assert.equal(products.length, 1);
  assert.equal(products[0].name, 'Nigiri');
  assert.equal(products[0].price, 109);
  assert.equal(products[0].categoryId, '');
  assert.equal(products[0].allergens, '');
  assert.equal(products[0].subtitle, '');
  assert.deepEqual(products[0].bullets, []);
  assert.equal(products[0].cta, '');

  const persisted = JSON.parse(readFileSync(join(cmsDir, 'products.json'), 'utf8'));
  assert.equal(persisted[0].allergens, '');
  rmSync(dir, { recursive: true, force: true });
});

test('category CRUD and deleting a category unassigns products', async () => {
  const { dir, store } = makeTempStore();
  const created = store.createCategory({ name: 'Nigiri' });
  assert.equal(created.ok, true);
  const duplicate = store.createCategory({ name: 'nigiri' });
  assert.equal(duplicate.ok, false);

  const product = store.createProduct({
    name: 'Salmon nigiri',
    price: '109,-',
    description: 'Two pieces',
    allergens: 'Fish',
    categoryId: created.category.id,
  });
  assert.equal(product.ok, true);
  assert.equal(product.product.categoryId, created.category.id);
  assert.equal(product.product.allergens, 'Fish');
  assert.equal(product.product.price, '109,-');

  const deleted = store.deleteCategory(created.category.id);
  assert.equal(deleted.ok, true);
  const after = store.getProductById(product.product.id);
  assert.equal(after.categoryId, '');
  assert.equal(store.getAllCategories().length, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('creates and updates typed products for menu, tiers, and normal', () => {
  const { dir, store } = makeTempStore();

  const menu = store.createProduct({
    name: 'Garden Bowl',
    price: 14,
    description: 'Roasted vegetables',
    allergens: 'Sesame',
    categoryId: 'type-1',
  });
  assert.equal(menu.ok, true);
  assert.equal(menu.product.allergens, 'Sesame');

  const tier = store.createProduct({
    name: 'Growth',
    price: '$149 / month',
    bullets: ['Priority support', 'Five offer types'],
    cta: 'Book a call',
  });
  assert.equal(tier.ok, true);
  assert.equal(tier.product.price, '$149 / month');
  assert.deepEqual(tier.product.bullets, ['Priority support', 'Five offer types']);

  const normal = store.createProduct({
    name: 'Cloud Runner',
    subtitle: 'Lightweight daily trainer',
    price: 89,
    categoryId: 'featured',
  });
  assert.equal(normal.ok, true);

  const updated = store.updateProduct(normal.product.id, { subtitle: 'Updated subtitle', price: 92 });
  assert.equal(updated.ok, true);
  assert.equal(updated.product.subtitle, 'Updated subtitle');
  assert.equal(updated.product.price, 92);
  assert.equal(updated.product.name, 'Cloud Runner');

  const missingName = store.createProduct({ price: 10 });
  assert.equal(missingName.ok, false);

  rmSync(dir, { recursive: true, force: true });
});

test('normalizeProduct fills defaults for incomplete rows', () => {
  const product = normalizeProduct({ id: '1', name: 'Hat' });
  assert.equal(product.imageUrl, '');
  assert.equal(product.sortOrder, 0);
  assert.ok(product.createdAt);
});

test('seedCatalog writes once and refuses a second write', () => {
  const { dir, store } = makeTempStore();
  const first = store.seedCatalog({
    categories: [{ id: 'cat_1', name: 'Food' }],
    products: [{ id: 'prod_1', name: 'Soup', price: 49, productType: 'menu' }],
  });
  assert.equal(first.seeded, true);
  assert.equal(store.getAllProducts().length, 1);
  const second = store.seedCatalog({
    products: [{ id: 'prod_2', name: 'Cake', price: 10 }],
  });
  assert.equal(second.seeded, false);
  assert.equal(store.getAllProducts()[0].name, 'Soup');
  rmSync(dir, { recursive: true, force: true });
});
