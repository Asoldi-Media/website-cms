import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import createCmsRoutes from '../server/routes.js';

// There is no built-in admin password; tests set the first admin's password explicitly.
const ADMIN_PASSWORD = 'test-admin-password';
process.env.CMS_ADMIN_PASSWORD = ADMIN_PASSWORD;
import { applyFieldMap, formsRuntimeScript } from '../server/forms.js';

// What Website Creator's Step 3 ships as cms.site.json.
const SEED = {
  version: 1,
  site: { name: 'Byneset Bydelskafé', language: 'nb', domain: 'byneset.no' },
  lists: [{ id: 'seed-list-1', name: 'Nyhetsbrev', slug: 'nyhetsbrev' }],
  forms: [
    {
      id: 'f_newsletter',
      label: 'Meld deg på nyhetsbrevet vårt',
      purpose: 'newsletter',
      destination: { type: 'list', listId: 'seed-list-1' },
      fieldMap: { email: 'email', consent: 'marketingAccept' },
      fields: [
        { key: 'email', name: 'email', type: 'email', required: true },
        { key: 'consent', name: 'consent', type: 'checkbox' },
      ],
      pages: ['/', '/meny'],
      reviewed: true,
    },
    {
      id: 'f_contact',
      label: 'Kontakt oss',
      purpose: 'contact',
      destination: { type: 'inbox' },
      fieldMap: { navn: 'name', epost: 'email', melding: 'message', tlf: 'sms' },
      fields: [
        { key: 'navn', name: 'navn', type: 'text' },
        { key: 'epost', name: 'epost', type: 'email' },
        { key: 'tlf', name: 'tlf', type: 'tel' },
        { key: 'melding', name: 'melding', type: 'textarea' },
      ],
      pages: ['/kontakt'],
      reviewed: true,
    },
  ],
  pages: [
    { route: '/', title: 'Hjem', kind: 'home', inNav: true },
    { route: '/meny', title: 'Meny', kind: 'menu', inNav: true },
    { route: '/blogg/innlegg', title: 'Innlegg', kind: 'blog-post', isTemplate: true, inNav: false },
  ],
};

async function withServer(fn) {
  const root = mkdtempSync(path.join(tmpdir(), 'asoldi-site-forms-'));
  const app = express();
  app.use(express.json());
  app.use('/api/cms', createCmsRoutes({ dataPath: root, hubUrl: '', siteKey: 'test-site', adminSecret: 'test-secret', siteSeed: SEED }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/api/cms`;
  try {
    await fn(base);
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
      body: JSON.stringify({ username: 'admin', password: ADMIN_PASSWORD }),
    });
    if (res.ok) {
      const data = await res.json();
      return { Authorization: `Bearer ${data.token}` };
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('login failed');
}

test('applyFieldMap routes mapped keys, keeps unmapped as extra, honours skip', () => {
  const form = {
    fieldMap: { email: 'email', consent: 'marketingAccept', hp: 'skip', fname: 'firstName', lname: 'lastName' },
    fields: [{ key: 'email', name: 'email' }, { key: 'consent', name: 'consent' }, { key: 'hp', name: 'hp' }, { key: 'fname', name: 'fname' }, { key: 'lname', name: 'lname' }],
  };
  const { mapped, extra, skipped } = applyFieldMap(
    { email: ' Ola@Example.com ', consent: 'on', hp: 'x', fname: 'Ola', lname: 'Nordmann', comment: 'hei', _gotcha: '', _cms_return: '/' },
    form
  );
  assert.equal(mapped.email, 'Ola@Example.com');
  assert.equal(mapped.marketingAccept, true);
  assert.equal(mapped.name, 'Ola Nordmann');
  assert.deepEqual(extra, { comment: 'hei' });
  assert.deepEqual(skipped, ['hp']);
  assert.ok(!('_cms_return' in extra));
});

test('runtime script is served and self-contained', () => {
  const js = formsRuntimeScript({ messages: { success: { a: 'Takk!' }, error: 'Feil' } });
  assert.match(js, /data-cms-form/);
  assert.match(js, /"a":"Takk!"/);
  assert.match(js, /addEventListener\('submit'/);
});

test('seeded list + bound newsletter form + inbox form work end to end', async () => {
  process.env.CMS_DEV_EMAIL = '1';
  await withServer(async (base) => {
    // Runtime is public.
    const rt = await fetch(`${base}/forms-runtime.js`);
    assert.equal(rt.status, 200);
    assert.match(rt.headers.get('content-type') || '', /javascript/);
    assert.match(await rt.text(), /f_newsletter/);

    // JSON submit (runtime path) → lead in the seeded list with preserved id.
    const sub = await fetch(`${base}/forms/f_newsletter/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email: 'kari@example.com', consent: 'on', _cms_page: '/meny' }),
    });
    assert.equal(sub.status, 201);
    const subBody = await sub.json();
    assert.equal(subBody.ok, true);
    assert.equal(subBody.kind, 'lead');
    assert.equal(subBody.listId, 'seed-list-1');
    assert.match(subBody.message, /Takk/);

    // No-JS submit (urlencoded) → redirect back to the page with ?cms-form=ok.
    const noJs = await fetch(`${base}/forms/f_contact/submit`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ navn: 'Ola', epost: 'ola@example.com', melding: 'Hei der', tlf: '900 00 000', _cms_return: '/kontakt', ekstra: 'x' }).toString(),
    });
    assert.equal(noJs.status, 303);
    assert.match(noJs.headers.get('location') || '', /^\/kontakt\?cms-form=ok&form=f_contact$/);

    // Honeypot → pretend success, store nothing.
    const bot = await fetch(`${base}/forms/f_newsletter/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email: 'bot@example.com', _gotcha: 'spam' }),
    });
    assert.equal(bot.status, 200);

    // Unknown form / missing e-mail.
    assert.equal((await fetch(`${base}/forms/nope/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}' })).status, 404);
    assert.equal((await fetch(`${base}/forms/f_newsletter/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ consent: 'on' }) })).status, 400);

    const headers = await login(base);
    const lists = await fetch(`${base}/lists`, { headers }).then((r) => r.json());
    const nyhetsbrev = lists.find((l) => l.slug === 'nyhetsbrev');
    assert.ok(nyhetsbrev, 'seeded list exists');
    assert.equal(nyhetsbrev.id, 'seed-list-1');
    assert.equal(nyhetsbrev.count, 1);
    assert.equal(nyhetsbrev.forms.length, 1);
    assert.equal(nyhetsbrev.forms[0].id, 'f_newsletter');

    const leads = await fetch(`${base}/leads?listId=seed-list-1`, { headers }).then((r) => r.json());
    assert.equal(leads.length, 1);
    assert.equal(leads[0].email, 'kari@example.com');
    assert.equal(leads[0].marketingAccept, true);
    assert.equal(leads[0].formId, 'f_newsletter');
    assert.equal(leads[0].language, 'nb');

    const submissions = await fetch(`${base}/submissions`, { headers }).then((r) => r.json());
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].name, 'Ola');
    assert.equal(submissions[0].email, 'ola@example.com');
    assert.equal(submissions[0].message, 'Hei der');
    assert.equal(submissions[0].sms, '900 00 000');
    assert.deepEqual(submissions[0].extra, { ekstra: 'x' });
    assert.equal(submissions[0].page, '/kontakt');
    assert.equal(submissions[0].read, false);

    const marked = await fetch(`${base}/submissions/${submissions[0].id}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ read: true }) });
    assert.equal(marked.status, 200);
    assert.equal((await marked.json()).read, true);

    const forms = await fetch(`${base}/forms`, { headers }).then((r) => r.json());
    assert.equal(forms.length, 2);
    assert.equal(forms.find((f) => f.id === 'f_newsletter').count, 1);
    assert.equal(forms.find((f) => f.id === 'f_newsletter').destination.listName, 'Nyhetsbrev');
    assert.equal(forms.find((f) => f.id === 'f_contact').count, 1);

    const pages = await fetch(`${base}/pages`, { headers }).then((r) => r.json());
    assert.equal(pages.length, 3);
    assert.equal(pages.find((p) => p.route === '/blogg/innlegg').isTemplate, true);
    assert.equal(pages.find((p) => p.route === '/meny').kind, 'menu');

    // Restarting with the same data dir does not duplicate the seeded list.
    const again = await fetch(`${base}/lists`, { headers }).then((r) => r.json());
    assert.equal(again.filter((l) => l.slug === 'nyhetsbrev').length, 1);
  });
});
