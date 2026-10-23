import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { TEST_ADMIN_PASSWORD } from './_admin.js';
import { bootCms, fakeHub, waitFor } from './_cms-boot.js';
import { PUBLIC_CONFIG_KEYS, publicConfig, readPackageBuild } from '../server/public-config.js';

const SITE_KEY = 'public-config-site';

function tempData() {
  return mkdtempSync(path.join(tmpdir(), 'asoldi-config-'));
}

function hubConfig() {
  return {
    id: 'site-1',
    name: 'Kafé Test',
    domain: 'kafe.example',
    features: { users: true, ecommerce: true, blog: true },
    ecommerceCatalogType: 'menu',
    websitePlan: 'standard',
    analyticsLevel: 'basic',
    desiredCmsVersion: '2.2.0',
    analyticsGoals: { mainCtaText: 'Bestill', mainCtaUrl: '/bestill', ctaPath: '/bestill' },
    clientAdmin: { name: 'Kari Eier', email: 'kari@kafe.example', phone: '+4790000000' },
    pendingAdmin: { username: 'kari', passwordHash: bcrypt.hashSync('kari-sin-kode-1', 4) },
    futureHubField: { token: 'not-for-the-public' },
  };
}

test('publicConfig keeps only the allowlisted keys', () => {
  const out = publicConfig({ ...hubConfig(), packageVersion: '2.2.0', packageBuild: 'abcdefabcdef', adminSynced: true });
  assert.deepEqual(Object.keys(out).sort(), [...PUBLIC_CONFIG_KEYS].sort());
  for (const key of ['clientAdmin', 'pendingAdmin', 'packageBuild', 'adminSynced', 'futureHubField', 'id', 'analyticsGoals']) {
    assert.equal(key in out, false, key);
  }
  assert.deepEqual(publicConfig(null), {});
});

test('GET /config never shows hub admin data, unknown hub fields or the build id', async () => {
  const hub = await fakeHub({ siteKey: SITE_KEY, config: hubConfig() });
  const root = tempData();
  const cms = await bootCms({ dataPath: root, hubUrl: hub.url, siteKey: SITE_KEY });
  try {
    const res = await fetch(`${cms.base}/config`);
    assert.equal(res.status, 200);
    const text = await res.text();
    for (const hidden of ['passwordHash', 'pendingAdmin', 'clientAdmin', 'kari@kafe.example', 'Kari Eier', 'not-for-the-public', 'packageBuild', '$2a$', '$2b$']) {
      assert.equal(text.includes(hidden), false, `config shows ${hidden}`);
    }
    const body = JSON.parse(text);
    assert.equal(body.name, 'Kafé Test');
    assert.equal(body.features.ecommerce, true);
    assert.equal(body.ecommerceCatalogType, 'menu');
    assert.equal(typeof body.packageVersion, 'string');
  } finally {
    await cms.close();
    await hub.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('hub calls send x-site-key (query kept for older hubs); heartbeat reports packageBuild', async () => {
  const hub = await fakeHub({ siteKey: SITE_KEY, config: { ...hubConfig(), pendingAdmin: null } });
  const root = tempData();
  const cms = await bootCms({ dataPath: root, hubUrl: hub.url, siteKey: SITE_KEY });
  try {
    await fetch(`${cms.base}/config`);
    const request = await waitFor(() => hub.state.configRequests[0]);
    assert.equal(request.headerKey, SITE_KEY);
    assert.equal(request.query.site_key, SITE_KEY);
    const beat = await waitFor(() => hub.state.heartbeats[0]);
    assert.equal(beat.site_key, SITE_KEY);
    assert.equal(beat.packageBuild, 'dev', 'source tree without a vendor manifest reports dev');
    assert.equal(typeof beat.packageVersion, 'string');
    assert.equal(beat.passwordHash, undefined);
  } finally {
    await cms.close();
    await hub.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('first-admin sync from the hub pendingAdmin still works', async () => {
  const hub = await fakeHub({ siteKey: SITE_KEY, config: hubConfig() });
  const root = tempData();
  const cms = await bootCms({ dataPath: root, hubUrl: hub.url, siteKey: SITE_KEY });
  try {
    assert.equal((await fetch(`${cms.base}/config`)).status, 200);
    const login = await fetch(`${cms.base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'kari', password: 'kari-sin-kode-1' }),
    });
    assert.equal(login.status, 200, 'the client admin from the hub can sign in');
    const beat = await waitFor(() => hub.state.heartbeats.find((b) => b.adminApplied === true));
    assert.equal(beat.adminApplied, true);
    const old = await fetch(`${cms.base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: TEST_ADMIN_PASSWORD }),
    });
    assert.equal(old.status, 401, 'the hub login replaced the env one');
  } finally {
    await cms.close();
    await hub.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('readPackageBuild reads the vendor manifest or falls back to dev', () => {
  const root = tempData();
  try {
    assert.equal(readPackageBuild(root), 'dev');
    writeFileSync(path.join(root, 'cms.vendor.manifest.json'), JSON.stringify({ packageBuild: '3f9c1a7be210' }));
    assert.equal(readPackageBuild(root), '3f9c1a7be210');
    writeFileSync(path.join(root, 'cms.vendor.manifest.json'), JSON.stringify({ packageBuild: '<script>' }));
    assert.equal(readPackageBuild(root), 'dev');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
