import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createEmailTemplateStore, shouldSeedAsoldiPresets } from '../server/email-templates.js';

test('client sites start empty and can import HTML', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cms-email-'));
  try {
    const store = createEmailTemplateStore(dir);
    assert.equal(store.list({ seedAsoldi: false }).length, 0);
    const imported = store.importHtml({ name: 'Kampanje', html: '<p>Hei {{firstName}}</p>' });
    assert.equal(imported.ok, true);
    assert.equal(store.list().length, 1);
    assert.match(imported.template.html, /firstName/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Asoldi seed adds preset templates', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cms-email-asoldi-'));
  try {
    const store = createEmailTemplateStore(dir);
    const rows = store.list({ seedAsoldi: true });
    assert.equal(rows.length, 3);
    assert.ok(rows.some((row) => row.key === 'thank-you'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('seed detector recognizes asoldi.com', () => {
  assert.equal(shouldSeedAsoldiPresets({ domain: 'asoldi.com', name: 'Asoldi' }), true);
  assert.equal(shouldSeedAsoldiPresets({ domain: 'example-client.no', name: 'Example Client' }), false);
});
