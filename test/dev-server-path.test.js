import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultDevDataPath } from '../dev-server.mjs';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('dev server data folder is a real path next to the repo on every OS', () => {
  const dataPath = defaultDevDataPath({});
  assert.equal(path.isAbsolute(dataPath), true);
  assert.equal(path.resolve(dataPath), path.join(repoRoot, '.dev-data'));
  assert.doesNotMatch(dataPath, /^\/[A-Za-z]:/, 'no URL-style /C:/ prefix on Windows');
  assert.doesNotMatch(dataPath, /%20/, 'spaces stay spaces');
});

test('CMS_DATA_PATH overrides the dev data folder', () => {
  assert.equal(defaultDevDataPath({ CMS_DATA_PATH: '/tmp/cms-dev' }), '/tmp/cms-dev');
});

test('importing the dev server does not start it', async () => {
  const mod = await import('../dev-server.mjs');
  assert.equal(typeof mod.startDevServer, 'function');
});
