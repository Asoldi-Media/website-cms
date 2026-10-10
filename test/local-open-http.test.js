import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import createCmsRoutes from '../server/routes.js';

function request({ port, urlPath, host }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: urlPath, headers: { Host: host } },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(body);
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function withServer(envPatch, fn) {
  const prevOpen = process.env.CMS_LOCAL_OPEN;
  Object.assign(process.env, envPatch);
  const root = mkdtempSync(path.join(tmpdir(), 'asoldi-local-open-'));
  const app = express();
  app.use(express.json());
  app.use('/api/cms', createCmsRoutes({ dataPath: root, hubUrl: '', siteKey: 'local-test', adminSecret: 'test-secret' }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  try {
    await fn(port);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    rmSync(root, { recursive: true, force: true });
    if (prevOpen === undefined) delete process.env.CMS_LOCAL_OPEN;
    else process.env.CMS_LOCAL_OPEN = prevOpen;
  }
}

describe('local-open http', { concurrency: 1 }, () => {
test('local-session issues a token on localhost when CMS_LOCAL_OPEN=1', async () => {
  await withServer({ CMS_LOCAL_OPEN: '1' }, async (port) => {
    const open = await request({ port, urlPath: '/api/cms/admin/local-open', host: '127.0.0.1' });
    assert.equal(open.status, 200);
    assert.equal(open.json?.open, true);
    const sess = await request({ port, urlPath: '/api/cms/admin/local-session', host: '127.0.0.1' });
    assert.equal(sess.status, 200);
    assert.equal(typeof sess.json?.token, 'string');
    assert.ok(sess.json.token.length > 10);
  });
});

test('local-session stays closed on a public Host even if the env flag is on', async () => {
  await withServer({ CMS_LOCAL_OPEN: '1' }, async (port) => {
    const sess = await request({ port, urlPath: '/api/cms/admin/local-session', host: 'client.example.com' });
    assert.equal(sess.status, 404);
  });
});

test('local-session is absent when CMS_LOCAL_OPEN is off', async () => {
  await withServer({ CMS_LOCAL_OPEN: '0' }, async (port) => {
    const open = await request({ port, urlPath: '/api/cms/admin/local-open', host: '127.0.0.1' });
    assert.equal(open.json?.open, false);
    const sess = await request({ port, urlPath: '/api/cms/admin/local-session', host: '127.0.0.1' });
    assert.equal(sess.status, 404);
  });
});
});
