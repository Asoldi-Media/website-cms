import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import createCmsRoutes from '../server/routes.js';
import { mountPublicHtmlTracker } from '../server/html-tracker.js';
import { normalizePost, publicPost } from '../server/blog.js';

async function listen(app) {
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function withApp(seed, publicDir, fn) {
    const data = mkdtempSync(path.join(tmpdir(), 'asoldi-content-'));
    const app = express();
    app.use(express.json());
    app.use('/api/cms', createCmsRoutes({
        dataPath: data,
        hubUrl: '',
        siteKey: 'test-site',
        adminSecret: 'test-secret',
        siteSeed: seed,
        publicPath: publicDir,
    }));
    mountPublicHtmlTracker(app, publicDir, { siteSeed: seed });
    const { server, origin } = await listen(app);
    try {
        await fn(origin);
    } finally {
        await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
        rmSync(data, { recursive: true, force: true });
    }
}

async function login(origin) {
    const password = process.env.CMS_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'changeme';
    const username = process.env.CMS_ADMIN_USERNAME || process.env.ADMIN_USERNAME || 'admin';
    for (let i = 0; i < 10; i += 1) {
        const res = await fetch(`${origin}/api/cms/admin/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        if (res.ok)
            return { Authorization: `Bearer ${(await res.json()).token}` };
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('login failed');
}

test('a written excerpt and cover are what the public post exposes', () => {
    const post = publicPost(normalizePost({
        title: 'Hei',
        excerpt: 'Kort ingress',
        featuredImage: '/cover.jpg',
        blocks: [{ type: 'text', text: 'Lang brødtekst' }],
    }));
    assert.equal(post.excerpt, 'Kort ingress');
    assert.equal(post.featuredImage, '/cover.jpg');
});

test('blog URL uses the CMS template when the site has no blog page', async () => {
    const publicDir = mkdtempSync(path.join(tmpdir(), 'asoldi-public-'));
    writeFileSync(path.join(publicDir, 'index.html'), '<html><body>HOME</body></html>');
    const seed = { pages: [{ route: '/', title: 'Hjem', kind: 'home' }] };
    await withApp(seed, publicDir, async (origin) => {
        const auth = await login(origin);
        const created = await fetch(`${origin}/api/cms/admin/posts`, {
            method: 'POST',
            headers: { ...auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'Hei fra CMS', status: 'published', blocks: [{ type: 'text', text: 'Brødtekst' }] }),
        });
        assert.equal(created.status, 201);
        const slug = (await created.json()).slug;
        const page = await fetch(`${origin}/blog/${slug}`);
        const html = await page.text();
        assert.equal(page.status, 200);
        assert.match(html, /data-cms-slot="post.title"/);
        assert.match(html, /content-runtime\.js/);
        assert.doesNotMatch(html, /CLIENT-BLOG-PAGE/);
    });
    rmSync(publicDir, { recursive: true, force: true });
});

test('a published blog-post page wins over the CMS template', async () => {
    const publicDir = mkdtempSync(path.join(tmpdir(), 'asoldi-public-'));
    writeFileSync(path.join(publicDir, 'innlegg.html'), '<html><body>CLIENT-BLOG-PAGE</body></html>');
    const seed = { pages: [{ route: '/innlegg', title: 'Innlegg', kind: 'blog-post', isTemplate: true }] };
    await withApp(seed, publicDir, async (origin) => {
        const page = await fetch(`${origin}/blog/noe`);
        const html = await page.text();
        assert.equal(page.status, 200);
        assert.match(html, /CLIENT-BLOG-PAGE/);
        assert.doesNotMatch(html, /data-cms-slot="post.title"/);
    });
    rmSync(publicDir, { recursive: true, force: true });
});

test('capabilities lists posts, pages, and analytics for an admin', async () => {
    const publicDir = mkdtempSync(path.join(tmpdir(), 'asoldi-public-'));
    await withApp({ pages: [] }, publicDir, async (origin) => {
        const auth = await login(origin);
        const res = await fetch(`${origin}/api/cms/capabilities`, { headers: auth });
        assert.equal(res.status, 200);
        const body = await res.json();
        const ids = [...body.publicEndpoints, ...body.adminEndpoints].map((row) => row.id);
        assert.ok(ids.includes('posts.list'));
        assert.ok(ids.includes('pages.list'));
        assert.ok(ids.includes('analytics.overview'));
        const coverage = await fetch(`${origin}/api/cms/content-pages`, { headers: auth });
        const content = await coverage.json();
        assert.equal(content.content.find((row) => row.kind === 'blog-post').source, 'cms');
    });
    rmSync(publicDir, { recursive: true, force: true });
});
