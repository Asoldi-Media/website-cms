import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { TEST_ADMIN_PASSWORD } from './_admin.js';
import createCmsRoutes from '../server/routes.js';

async function withServer(fn) {
  const root = mkdtempSync(path.join(tmpdir(), 'asoldi-leads-http-'));
  const app = express();
  app.use(express.json());
  app.use(
    '/api/cms',
    createCmsRoutes({
      dataPath: root,
      hubUrl: '',
      siteKey: 'test-site',
      adminSecret: 'test-secret',
    })
  );
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
      body: JSON.stringify({ username: 'admin', password: TEST_ADMIN_PASSWORD }),
    });
    if (res.ok) {
      const data = await res.json();
      return { Authorization: `Bearer ${data.token}` };
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('login failed');
}

test('public form endpoint upserts a lead into the default Website forms list', async () => {
  process.env.CMS_DEV_EMAIL = '1';
  await withServer(async (base) => {
    const created = await fetch(`${base}/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Ola Nordmann',
        email: 'ola@example.com',
        sms: '90000000',
        language: 'nb',
        marketingAccept: true,
        source: 'contact-form',
      }),
    });
    assert.equal(created.status, 201);
    const body = await created.json();
    assert.equal(body.ok, true);
    assert.equal(body.listSlug, 'website-forms');

    const headers = await login(base);
    const lists = await fetch(`${base}/lists`, { headers }).then((r) => r.json());
    assert.equal(lists[0].slug, 'website-forms');
    assert.equal(lists[0].count, 1);
    const leads = await fetch(`${base}/leads?email=ola`, { headers }).then((r) => r.json());
    assert.equal(leads.length, 1);
    assert.equal(leads[0].marketingAccept, true);
    assert.equal(leads[0].email, 'ola@example.com');
  });
});
