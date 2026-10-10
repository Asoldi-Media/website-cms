import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hostnameFromHostHeader,
  isLocalCmsOpenEnvOn,
  isLocalCmsOpenRequest,
  isLoopbackOrPrivateHostname,
  LOCAL_DEV_INBOX_FORM_ID,
} from '../server/local-open.js';

test('hostnameFromHostHeader strips port and brackets', () => {
  assert.equal(hostnameFromHostHeader('127.0.0.1:4100'), '127.0.0.1');
  assert.equal(hostnameFromHostHeader('localhost:3000'), 'localhost');
  assert.equal(hostnameFromHostHeader('[::1]:4100'), '::1');
});

test('loopback and private hosts are local; public domains are not', () => {
  assert.equal(isLoopbackOrPrivateHostname('localhost'), true);
  assert.equal(isLoopbackOrPrivateHostname('127.0.0.1'), true);
  assert.equal(isLoopbackOrPrivateHostname('::1'), true);
  assert.equal(isLoopbackOrPrivateHostname('192.168.68.92'), true);
  assert.equal(isLoopbackOrPrivateHostname('10.0.0.8'), true);
  assert.equal(isLoopbackOrPrivateHostname('172.28.7.10'), true);
  assert.equal(isLoopbackOrPrivateHostname('byneset.no'), false);
  assert.equal(isLoopbackOrPrivateHostname('asoldi.com'), false);
  assert.equal(isLoopbackOrPrivateHostname('8.8.8.8'), false);
});

test('local CMS open requires CMS_LOCAL_OPEN=1 and a private Host', () => {
  const req = { headers: { host: '127.0.0.1:4100' } };
  assert.equal(isLocalCmsOpenRequest(req, { CMS_LOCAL_OPEN: '1' }), true);
  assert.equal(isLocalCmsOpenRequest(req, { CMS_LOCAL_OPEN: '0' }), false);
  assert.equal(isLocalCmsOpenRequest(req, {}), false);
  assert.equal(
    isLocalCmsOpenRequest({ headers: { host: 'client.asoldi-sites.no' } }, { CMS_LOCAL_OPEN: '1' }),
    false
  );
  assert.equal(isLocalCmsOpenEnvOn({ CMS_LOCAL_OPEN: '1' }), true);
  assert.equal(LOCAL_DEV_INBOX_FORM_ID, 'local-dev-inbox');
});
