// Site credential for hub calls (server/hub-credential.js): made once, sent only to the configured
// hub, proof only for this CMS's own pending nonce, enrollment with pauses, revoke and hub change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHubCredential, hubTarget, CREDENTIAL_FILE, ENROLL_PROOF_WINDOW_MS } from '../server/hub-credential.js';
import { cmsSecretsDir } from '../server/secret.js';

const quiet = { log() {}, warn() {} };
const SITE_KEY = 'credential-site';

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'cms-hub-credential-'));
}

/** A fake hub fetch: the enroll handler asks `proofFor` (the CMS proof route) and records the result. */
function fakeHubFetch(cred, { answer = 'ok', status = 200 } = {}) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/api/hub/site-credential/enroll')) {
      const body = JSON.parse(init.body);
      const proof = cred().proofFor(body.nonce);
      const expected = createHmac('sha256', body.credential).update(body.nonce).digest('hex');
      calls.at(-1).proofMatched = proof === expected;
      if (answer === 'ok' && proof === expected) return new Response(JSON.stringify({ ok: true, kind: 'first' }), { status: 200 });
      return new Response(JSON.stringify({ ok: false, code: answer === 'ok' ? 'proof-mismatch' : answer }), { status: answer === 'enrollment-off' ? 503 : 403 });
    }
    return new Response('{}', { status, headers: { 'content-type': 'application/json' } });
  };
  return { impl, calls };
}

test('the credential is made once in the private secrets folder and reused by every start', () => {
  const dataPath = tempDir();
  try {
    const first = createHubCredential({ dataPath, hubUrl: 'https://hub.example', siteKey: SITE_KEY, log: quiet, autoEnroll: false });
    const a = first.record();
    assert.match(a.credential, /^[A-Za-z0-9_-]{43}$/);
    const file = join(cmsSecretsDir(dataPath), CREDENTIAL_FILE);
    assert.ok(existsSync(file));
    if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
    const second = createHubCredential({ dataPath, hubUrl: 'https://hub.example', siteKey: SITE_KEY, log: quiet, autoEnroll: false });
    assert.equal(second.record().credential, a.credential, 'a new start keeps the same credential');
    second.start();
    second.stop();
    assert.equal(second.record().credential, a.credential);
    writeFileSync(file, 'not json');
    const third = createHubCredential({ dataPath, hubUrl: 'https://hub.example', siteKey: SITE_KEY, log: quiet, autoEnroll: false });
    assert.match(third.record().credential, /^[A-Za-z0-9_-]{43}$/, 'a damaged file is set aside and a new credential made');
  } finally {
    rmSync(dataPath, { recursive: true, force: true });
  }
});

test('the header goes only to the configured hub, over https or to a local hub', () => {
  const dataPath = tempDir();
  try {
    const cred = createHubCredential({ dataPath, hubUrl: 'https://hub.example/base/', siteKey: SITE_KEY, log: quiet, autoEnroll: false });
    const value = cred.record().credential;
    assert.deepEqual(cred.headersFor('https://hub.example/base/api/hub/site-config?site_key=x'), { 'x-site-credential': value });
    for (const url of ['https://hub.example/other/api', 'https://hub.example.evil.test/base/api', 'http://hub.example/base/api', 'https://site.example/base/api', 'not a url']) {
      assert.deepEqual(cred.headersFor(url), {}, url);
    }
    const plain = createHubCredential({ dataPath, hubUrl: 'http://hub.example', siteKey: SITE_KEY, log: quiet, autoEnroll: false });
    assert.deepEqual(plain.headersFor('http://hub.example/api/hub/heartbeat'), {}, 'never in clear text to a public host');
    const local = createHubCredential({ dataPath: tempDir(), hubUrl: 'http://127.0.0.1:4100', siteKey: SITE_KEY, log: quiet, autoEnroll: false });
    assert.ok(local.headersFor('http://127.0.0.1:4100/api/hub/heartbeat')['x-site-credential']);
    assert.equal(createHubCredential({ dataPath, hubUrl: '', siteKey: SITE_KEY, log: quiet }).linked, false);
    assert.equal(hubTarget('https://user:pw@hub.example'), null);
  } finally {
    rmSync(dataPath, { recursive: true, force: true });
  }
});

test('the proof is given only for a nonce this CMS sent, within two minutes, for its current credential', async () => {
  const dataPath = tempDir();
  let t = Date.parse('2026-10-23T10:00:00Z');
  try {
    let cred;
    const hub = fakeHubFetch(() => cred);
    cred = createHubCredential({ dataPath, hubUrl: 'https://hub.example', siteKey: SITE_KEY, fetchImpl: hub.impl, now: () => t, log: quiet, autoEnroll: false });
    const result = await cred.enroll();
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(hub.calls[0].proofMatched, true);
    const sent = JSON.parse(hub.calls[0].init.body);
    assert.equal(sent.siteKey, SITE_KEY);
    assert.equal(hub.calls[0].init.redirect, 'error', 'the enroll call never follows a redirect');
    assert.equal(cred.proofFor(sent.nonce), null, 'the nonce is dropped once the hub has answered');
    assert.equal(cred.proofFor(randomBytes(32).toString('base64url')), null, 'a nonce this CMS never sent');
    assert.equal(cred.proofFor('../../etc'), null);
    assert.equal(cred.enrolledHere(), true);

    // A nonce that is still pending, then too old.
    let seen;
    const slow = createHubCredential({
      dataPath,
      hubUrl: 'https://hub.example',
      siteKey: SITE_KEY,
      now: () => t,
      log: quiet,
      autoEnroll: false,
      fetchImpl: async (_url, init) => {
        seen = JSON.parse(init.body).nonce;
        assert.match(slow.proofFor(seen), /^[a-f0-9]{64}$/);
        t += ENROLL_PROOF_WINDOW_MS + 1;
        assert.equal(slow.proofFor(seen), null, 'older than two minutes');
        return new Response(JSON.stringify({ ok: false, code: 'proof-refused' }), { status: 403 });
      },
    });
    assert.equal((await slow.enroll()).ok, false);
  } finally {
    rmSync(dataPath, { recursive: true, force: true });
  }
});

test('failed enrollments wait longer each time; a switched-off hub is asked again after 30 minutes or more', async () => {
  const dataPath = tempDir();
  let t = 0;
  try {
    let cred;
    const hub = fakeHubFetch(() => cred, { answer: 'enrollment-off' });
    cred = createHubCredential({ dataPath, hubUrl: 'https://hub.example', siteKey: SITE_KEY, fetchImpl: hub.impl, now: () => t, log: quiet, autoEnroll: false });
    assert.equal((await cred.ensureEnrolled()).code, 'enrollment-off');
    assert.ok(cred.backoffState().nextAt >= 0.8 * 30 * 60_000);
    assert.equal((await cred.ensureEnrolled()).code, 'waiting');
    assert.equal(hub.calls.length, 1, 'no call while waiting');
    t = cred.backoffState().nextAt + 1;
    await cred.ensureEnrolled();
    assert.equal(hub.calls.length, 2);
    const failing = createHubCredential({ dataPath: tempDir(), hubUrl: 'https://hub.example', siteKey: SITE_KEY, fetchImpl: async () => { throw new Error('down'); }, now: () => t, log: quiet, autoEnroll: false });
    const pauses = [];
    for (let i = 0; i < 4; i += 1) {
      const before = t;
      await failing.enroll();
      pauses.push(failing.backoffState().nextAt - before);
      t = failing.backoffState().nextAt + 1;
    }
    assert.ok(pauses[3] > pauses[0] * 4, `pauses grow: ${pauses.map((p) => Math.round(p / 1000)).join(',')}`);
  } finally {
    rmSync(dataPath, { recursive: true, force: true });
  }
});

test('after a revoke the CMS makes a new credential; "invalid" enrolls the same one again', async () => {
  const dataPath = tempDir();
  try {
    let cred;
    const hub = fakeHubFetch(() => cred);
    cred = createHubCredential({ dataPath, hubUrl: 'https://hub.example', siteKey: SITE_KEY, fetchImpl: hub.impl, log: quiet, autoEnroll: false });
    assert.equal((await cred.enroll()).ok, true);
    const first = cred.record().credential;
    cred.noteStatus('invalid', { sentCredential: first });
    assert.equal(cred.enrolledHere(), false);
    assert.equal(cred.record().credential, first, 'invalid keeps the credential');
    assert.equal((await cred.ensureEnrolled()).ok, true);
    cred.noteStatus('not-enrolled', { sentCredential: first });
    const second = cred.record().credential;
    assert.notEqual(second, first, 'a revoke makes a new credential');
    assert.equal(cred.enrolledHere(), false);
    cred.noteStatus('not-enrolled', { sentCredential: first });
    assert.equal(cred.record().credential, second, 'a late answer about the old credential changes nothing');
    assert.equal((await cred.ensureEnrolled()).ok, true);
    assert.equal(JSON.parse(hub.calls.at(-1).init.body).credential, second);
  } finally {
    rmSync(dataPath, { recursive: true, force: true });
  }
});

test('a credential made for one hub is never sent to another hub', () => {
  const dataPath = tempDir();
  try {
    const a = createHubCredential({ dataPath, hubUrl: 'https://hub-a.example', siteKey: SITE_KEY, log: quiet, autoEnroll: false }).record();
    const b = createHubCredential({ dataPath, hubUrl: 'https://hub-b.example', siteKey: SITE_KEY, log: quiet, autoEnroll: false });
    assert.notEqual(b.record().credential, a.credential);
    assert.equal(b.record().hubOrigin, 'https://hub-b.example');
    assert.equal(JSON.parse(readFileSync(join(cmsSecretsDir(dataPath), CREDENTIAL_FILE), 'utf8')).hubOrigin, 'https://hub-b.example');
  } finally {
    rmSync(dataPath, { recursive: true, force: true });
  }
});

test('the credential never follows a redirect: the call is made again without it', async () => {
  const dataPath = tempDir();
  try {
    const calls = [];
    const cred = createHubCredential({
      dataPath,
      hubUrl: 'https://hub.example',
      siteKey: SITE_KEY,
      log: quiet,
      autoEnroll: false,
      fetchImpl: async (url, init = {}) => {
        calls.push({ url, headers: { ...(init.headers || {}) }, redirect: init.redirect });
        if (calls.length === 1) return new Response('', { status: 302, headers: { location: 'https://elsewhere.example/api/hub/heartbeat' } });
        return new Response('{}', { status: 200 });
      },
    });
    const res = await cred.hubFetch('https://hub.example/api/hub/heartbeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 200);
    assert.equal(calls[0].redirect, 'manual');
    assert.ok(calls[0].headers['x-site-credential']);
    assert.equal(calls[1].headers['x-site-credential'], undefined);
    assert.equal(calls[1].redirect, undefined);
  } finally {
    rmSync(dataPath, { recursive: true, force: true });
  }
});
