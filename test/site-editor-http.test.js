import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import createCmsRoutes, { mountCmsAdmin } from '../server/routes.js';
import { applyPatchesToHtml } from '../server/site-hydrator.js';

const HOME = `<!doctype html><html><body data-asoldi-route="/" data-asoldi-page-role="home">
<section data-asoldi-section="hero" data-asoldi-key="hero-1">
  <h1 data-asoldi-text="hero-1/heading/1">Hello</h1>
  <img data-asoldi-media="hero-1/image/1" src="/old.jpg" alt="">
</section>
<section data-asoldi-section="about" data-asoldi-key="about-1">
  <p data-asoldi-text="about-1/body/1">About copy</p>
</section>
</body></html>`;

const ABOUT = `<!doctype html><html><body data-asoldi-route="/about" data-asoldi-page-role="about">
<section data-asoldi-section="about" data-asoldi-key="about-1">
  <h1 data-asoldi-text="about-1/heading/1">About</h1>
</section>
</body></html>`;

const PRODUCT = `<!doctype html><html><body data-asoldi-route="/product" data-asoldi-page-role="other">
<header data-asoldi-section="header" data-asoldi-key="header-1"><span data-asoldi-text="header-1/link/1">Chrome</span></header>
<h1 data-asoldi-text="product-1/heading/1" data-cms-slot="product.name">Demo dish</h1>
<p data-asoldi-text="product-1/price/1" data-cms-slot="product.price" data-cms-product-id="dish-1">49</p>
</body></html>`;

const SEED = {
  version: 1,
  site: { name: 'Editor Test', language: 'nb', domain: 'test.local' },
  lists: [],
  forms: [],
  pages: [
    {
      route: '/',
      title: 'Hjem',
      kind: 'home',
      inNav: true,
      slots: { hasMarkers: true, text: [{ key: 'hero-1/heading/1' }], media: [{ key: 'hero-1/image/1' }], sections: [{ key: 'hero-1', section: 'hero' }], cmsSlots: [] },
    },
    {
      route: '/about',
      title: 'Om oss',
      kind: 'about',
      inNav: true,
      slots: { hasMarkers: true, text: [{ key: 'about-1/heading/1' }], media: [], sections: [{ key: 'about-1', section: 'about' }], cmsSlots: [] },
    },
    {
      route: '/product',
      title: 'Produkt',
      kind: 'product-page',
      isTemplate: true,
      inNav: false,
      slots: { hasMarkers: true, text: [], media: [], sections: [], cmsSlots: [{ slot: 'product.name' }, { slot: 'product.price' }] },
    },
  ],
  catalog: {
    catalogType: 'menu',
    categories: [{ id: 'cat_1', name: 'Food' }],
    products: [{ id: 'seed-soup', name: 'Seed soup', price: 49, productType: 'menu' }],
  },
  content: { cmsSlotAttr: 'data-cms-slot', injectOrder: ['forms-runtime', 'asoldi-hydrator', 'content-runtime'], asoldiHydratorSkipsCmsSlots: true },
};

async function withServer(fn) {
  const root = mkdtempSync(path.join(tmpdir(), 'asoldi-site-editor-'));
  const publicDir = path.join(root, 'public');
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(path.join(publicDir, 'index.html'), HOME);
  writeFileSync(path.join(publicDir, 'about.html'), ABOUT);
  writeFileSync(path.join(publicDir, 'product.html'), PRODUCT);
  const app = express();
  app.use(express.json());
  app.use(
    '/api/cms',
    createCmsRoutes({
      dataPath: root,
      hubUrl: '',
      siteKey: 'editor-test',
      adminSecret: 'test-secret',
      siteSeed: SEED,
      publicPath: publicDir,
    })
  );
  mountCmsAdmin(app, { publicPath: publicDir, siteSeed: SEED });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    await fn(base, publicDir);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    rmSync(root, { recursive: true, force: true });
  }
}

async function login(base, username = 'admin', password = 'changeme') {
  for (let i = 0; i < 10; i += 1) {
    const res = await fetch(`${base}/api/cms/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (res.ok) {
      const data = await res.json();
      return { Authorization: `Bearer ${data.token}`, rank: data.rank };
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('login failed');
}

test('site seed pages include slots', async () => {
  await withServer(async (base) => {
    const headers = await login(base);
    const res = await fetch(`${base}/api/cms/site`, { headers });
    assert.equal(res.ok, true);
    const site = await res.json();
    const home = site.pages.find((p) => p.route === '/');
    assert.equal(home.slots.hasMarkers, true);
    assert.equal(site.content.asoldiHydratorSkipsCmsSlots, true);
  });
});

test('draft publish then visitor html keeps git file unchanged', async () => {
  await withServer(async (base, publicDir) => {
    const headers = await login(base);
    const before = readFileSync(path.join(publicDir, 'index.html'), 'utf8');
    const put = await fetch(`${base}/api/cms/site-edits/draft`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patches: [{ type: 'text', route: '/', key: 'hero-1/heading/1', value: 'Published heading' }],
      }),
    });
    assert.equal(put.ok, true);
    const pub = await fetch(`${base}/api/cms/site-edits/publish`, { method: 'POST', headers });
    assert.equal(pub.ok, true);
    const visitor = await fetch(`${base}/`);
    const html = await visitor.text();
    assert.match(html, /site-hydrator\.js/);
    assert.match(html, /content-runtime\.js/);
    const publicJson = await fetch(`${base}/api/cms/site-edits/public`);
    const data = await publicJson.json();
    assert.equal(data.patches[0].value, 'Published heading');
    assert.equal(readFileSync(path.join(publicDir, 'index.html'), 'utf8'), before);
  });
});

test('editor query injects overlay runtime', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/about?asoldi-edit=1`);
    const html = await res.text();
    assert.match(html, /site-editor-runtime\.js/);
    assert.doesNotMatch(html, /site-hydrator\.js/);
    assert.doesNotMatch(html, /content-runtime\.js/);
  });
});

test('product PUT does not require a site-edits patch', async () => {
  await withServer(async (base) => {
    const headers = await login(base);
    const created = await fetch(`${base}/api/cms/products`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'dish-1', name: 'Soup', price: 49 }),
    });
    assert.equal(created.status, 201);
    const product = await created.json();
    const id = product.id;
    assert.ok(id);
    const put = await fetch(`${base}/api/cms/products/${id}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: 79 }),
    });
    assert.equal(put.ok, true);
    const body = await put.json();
    assert.equal(Number(body.price), 79);
    const edits = await fetch(`${base}/api/cms/site-edits`, { headers });
    const snap = await edits.json();
    assert.equal((snap.draft?.patches || []).length, 0);
  });
});

test('GET /products/:id serves the product-page sample HTML', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/products/soup`);
    assert.equal(res.ok, true);
    const html = await res.text();
    assert.match(html, /data-cms-slot="product.name"/);
    assert.match(html, /content-runtime\.js/);
  });
});

test('seeded catalog is public without hub ecommerce flag', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/cms/catalog`);
    assert.equal(res.ok, true);
    const body = await res.json();
    assert.equal(body.products.some((p) => p.name === 'Seed soup'), true);
  });
});

test('content-runtime.js is served', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/cms/content-runtime.js`);
    assert.equal(res.ok, true);
    const js = await res.text();
    assert.match(js, /\/api\/cms\/catalog/);
    assert.match(js, /data-cms-slot/);
  });
});

test('writer cannot publish site edits', async () => {
  await withServer(async (base) => {
    const admin = await login(base);
    const created = await fetch(`${base}/api/cms/admin/users`, {
      method: 'POST',
      headers: { ...admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'writer1', password: 'writerpass', rank: 'writer' }),
    });
    assert.equal(created.status, 201);
    const writer = await login(base, 'writer1', 'writerpass');
    assert.equal(writer.rank, 'writer');
    const pub = await fetch(`${base}/api/cms/site-edits/publish`, {
      method: 'POST',
      headers: writer,
    });
    assert.equal(pub.status, 403);
  });
});

test('published asoldi patch does not overwrite a cms-slot on the visitor page', async () => {
  await withServer(async (base) => {
    const headers = await login(base);
    const put = await fetch(`${base}/api/cms/site-edits/draft`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patches: [{ type: 'text', route: '/product', key: 'product-1/heading/1', value: 'Hacked name' }],
      }),
    });
    assert.equal(put.ok, true);
    const pub = await fetch(`${base}/api/cms/site-edits/publish`, { method: 'POST', headers });
    assert.equal(pub.ok, true);
    const visitor = await fetch(`${base}/product`);
    const html = await visitor.text();
    assert.match(html, /Demo dish/);
    assert.doesNotMatch(html, /Hacked name/);
    const publicJson = await fetch(`${base}/api/cms/site-edits/public`);
    const data = await publicJson.json();
    const applied = applyPatchesToHtml(PRODUCT, data.patches);
    assert.match(applied, /Demo dish/);
    assert.doesNotMatch(applied, /Hacked name/);
  });
});
