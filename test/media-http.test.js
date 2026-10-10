import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import createCmsRoutes from '../server/routes.js';
import { fixLatin1Name, listPublicSiteMedia, readUploadMaxBytes, sanitizeUploadName } from '../server/media.js';

async function withServer(fn) {
  const root = mkdtempSync(path.join(tmpdir(), 'asoldi-media-http-'));
  const app = express();
  app.use(express.json());
  app.use('/api/cms', createCmsRoutes({ dataPath: root, hubUrl: '', siteKey: 'test-site', adminSecret: 'test-secret' }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}/api/cms`, root);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    rmSync(root, { recursive: true, force: true });
  }
}

async function login(base) {
  for (let i = 0; i < 10; i += 1) {
    const res = await fetch(`${base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'changeme' }),
    });
    if (res.ok) return { Authorization: `Bearer ${(await res.json()).token}` };
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('login failed');
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test('media helpers', () => {
  assert.equal(sanitizeUploadName('Blåbær Øl (final).PNG'), 'Blabaer-Ol-final.png');
  assert.equal(fixLatin1Name(Buffer.from('Pizza Ø.png', 'utf8').toString('latin1')), 'Pizza Ø.png');
  assert.equal(fixLatin1Name('Crème.png'), 'Crème.png');
  assert.equal(readUploadMaxBytes({}), 25 * 1024 * 1024);
  assert.equal(readUploadMaxBytes({ CMS_UPLOAD_MAX_MB: '2' }), 2 * 1024 * 1024);
});

test('listPublicSiteMedia includes images from the live public dir', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'asoldi-site-media-'));
  mkdirSync(path.join(root, 'images'), { recursive: true });
  writeFileSync(path.join(root, 'images', 'hero.png'), PNG);
  writeFileSync(path.join(root, 'note.txt'), 'skip');
  const items = listPublicSiteMedia(root);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'images/hero.png');
  assert.equal(items[0].url, '/images/hero.png');
  assert.equal(items[0].origin, 'site');
  rmSync(root, { recursive: true, force: true });
});

test('media library: upload, list, alt/rename, delete; index stays private', async () => {
  await withServer(async (base, root) => {
    const auth = await login(base);

    assert.equal((await fetch(`${base}/media`)).status, 401);

    const form = new FormData();
    form.append('file', new Blob([PNG], { type: 'image/png' }), 'Pizza Ø.png');
    const up = await fetch(`${base}/upload`, { method: 'POST', headers: auth, body: form });
    assert.equal(up.status, 200);
    const upJson = await up.json();
    assert.equal(upJson.url, '/api/cms/uploads/Pizza-O.png');
    assert.equal(upJson.item.kind, 'image');

    // Second upload with the same name never overwrites.
    const form2 = new FormData();
    form2.append('files', new Blob([PNG], { type: 'image/png' }), 'Pizza Ø.png');
    form2.append('files', new Blob([Buffer.from('%PDF-1.4')], { type: 'application/pdf' }), 'Meny.pdf');
    const multi = await fetch(`${base}/media`, { method: 'POST', headers: auth, body: form2 });
    assert.equal(multi.status, 201);
    const names = (await multi.json()).items.map((i) => i.name);
    assert.deepEqual(names, ['Pizza-O-2.png', 'Meny.pdf']);

    const bad = new FormData();
    bad.append('file', new Blob([Buffer.from('<script>')], { type: 'text/html' }), 'evil.html');
    assert.equal((await fetch(`${base}/upload`, { method: 'POST', headers: auth, body: bad })).status, 400);

    const list = await fetch(`${base}/media`, { headers: auth }).then((r) => r.json());
    const listed = list.items.map((item) => item.name);
    assert.ok(listed.includes('Pizza-O.png'));
    assert.ok(listed.includes('test-innlegg-1.svg'));
    assert.equal(listed.length, 6);
    assert.equal(list.maxBytes, 25 * 1024 * 1024);

    const served = await fetch(`${base}/uploads/Pizza-O.png`);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get('content-type'), 'image/png');
    assert.equal((await fetch(`${base}/uploads/media-index.json`)).status, 404);

    const patched = await fetch(`${base}/media/Pizza-O.png`, {
      method: 'PATCH',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ alt: 'Margherita', rename: 'margherita.png' }),
    }).then((r) => r.json());
    assert.equal(patched.item.name, 'margherita.png');
    assert.equal(patched.item.alt, 'Margherita');
    assert.equal(existsSync(path.join(root, 'cms', 'uploads', 'margherita.png')), true);

    const badRename = await fetch(`${base}/media/margherita.png`, {
      method: 'PATCH',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rename: 'margherita.mp4' }),
    });
    assert.equal(badRename.status, 400);

    assert.equal((await fetch(`${base}/media/..%2F..%2Fadmin.json`, { method: 'DELETE', headers: auth })).status, 404);
    assert.equal((await fetch(`${base}/media/margherita.png`, { method: 'DELETE', headers: auth })).status, 200);
    assert.equal(existsSync(path.join(root, 'cms', 'uploads', 'margherita.png')), false);
    assert.equal((await fetch(`${base}/media`, { headers: auth }).then((r) => r.json())).items.length, 5);
  });
});

test('media library lists images from the original public site', async () => {
  await withServer(async (base, root) => {
    const publicDir = path.join(root, 'public');
    mkdirSync(path.join(publicDir, 'images'), { recursive: true });
    writeFileSync(path.join(publicDir, 'images', 'hero.png'), PNG);
    const app = express();
    app.use(express.json());
    app.use('/api/cms', createCmsRoutes({
      dataPath: path.join(root, 'cms-data'),
      hubUrl: '',
      siteKey: 'site-media',
      adminSecret: 'test-secret',
      publicPath: publicDir,
    }));
    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const { port } = server.address();
    const cms = `http://127.0.0.1:${port}/api/cms`;
    try {
      const auth = await login(cms);
      const list = await fetch(`${cms}/media`, { headers: auth }).then((r) => r.json());
      const hero = list.items.find((item) => item.name === 'images/hero.png');
      assert.ok(hero);
      assert.equal(hero.url, '/images/hero.png');
      assert.equal(hero.origin, 'site');
    } finally {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
