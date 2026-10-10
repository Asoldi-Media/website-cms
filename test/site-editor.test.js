import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSlotMapFromHtml } from '../server/slot-map.js';
import { applyPatchesToHtml, injectSiteRuntimes } from '../server/site-hydrator.js';
import { normalizePatchList } from '../server/site-edits.js';
import { preparePublicHtml } from '../server/html-tracker.js';
import { siteEditorRuntimeScript } from '../server/site-editor-runtime.js';

const HOME = `<!doctype html><html><body data-asoldi-route="/" data-asoldi-page-role="home">
<header data-asoldi-section="header" data-asoldi-key="header-1"><a data-asoldi-text="header-1/link/1" href="/">Logo</a></header>
<section data-asoldi-section="hero" data-asoldi-key="hero-1">
  <h1 data-asoldi-text="hero-1/heading/1">Hello</h1>
  <p data-asoldi-text="hero-1/body/1">Welcome</p>
  <img data-asoldi-media="hero-1/image/1" src="/old.jpg" alt="">
</section>
<section data-asoldi-section="menu" data-asoldi-key="menu-1">
  <span data-asoldi-text="menu-1/item-1/price/1" data-cms-slot="product.price" data-cms-product-id="dish-1">99</span>
</section>
</body></html>`;

test('slot map extracts asoldi keys and cms-slots', () => {
  const map = extractSlotMapFromHtml(HOME);
  assert.equal(map.hasMarkers, true);
  assert.ok(map.text.some((row) => row.key === 'hero-1/heading/1'));
  assert.ok(map.media.some((row) => row.key === 'hero-1/image/1'));
  assert.ok(map.sections.some((row) => row.key === 'hero-1' && row.section === 'hero'));
  assert.ok(map.cmsSlots.some((row) => row.slot === 'product.price'));
});

test('hydrator ignores patches for another route with the same key', () => {
  const next = applyPatchesToHtml(HOME, [
    { type: 'text', route: '/about', key: 'hero-1/heading/1', value: 'Wrong page' },
    { type: 'text', route: '/', key: 'hero-1/heading/1', value: 'Edited' },
  ]);
  assert.match(next, />Edited</);
  assert.doesNotMatch(next, /Wrong page/);
});

test('hydrator applies text and media patches', () => {
  const next = applyPatchesToHtml(HOME, [
    { type: 'text', route: '/', key: 'hero-1/heading/1', value: 'Edited' },
    { type: 'media', route: '/', key: 'hero-1/image/1', value: '/new.jpg' },
  ]);
  assert.match(next, />Edited</);
  assert.match(next, /src="\/new\.jpg"/);
  assert.doesNotMatch(next, />Hello</);
});

test('hydrator skips data-cms-slot nodes', () => {
  const next = applyPatchesToHtml(HOME, [
    { type: 'text', route: '/', key: 'menu-1/item-1/price/1', value: '1' },
  ]);
  assert.match(next, />99</);
  assert.doesNotMatch(next, />1</);
});

test('hydrator hide + insert + remove', () => {
  const hidden = applyPatchesToHtml(HOME, [{ type: 'hide', route: '/', key: 'hero-1', hidden: true }]);
  assert.match(hidden, /data-asoldi-hidden="1"/);
  const inserted = applyPatchesToHtml(HOME, [
    {
      type: 'insert',
      route: '/',
      key: 'block-1',
      afterKey: 'hero-1',
      html: '<section data-asoldi-key="block-1" data-asoldi-inserted="1"><p data-asoldi-text="block-1/body/1">Ny</p></section>',
    },
  ]);
  assert.match(inserted, /block-1\/body\/1/);
  const removed = applyPatchesToHtml(inserted, [{ type: 'remove', route: '/', key: 'block-1' }]);
  assert.doesNotMatch(removed, /block-1\/body\/1/);
});

test('normalize patches drops unknown types', () => {
  assert.equal(normalizePatchList([{ type: 'explode', key: 'x' }]).length, 0);
  const text = normalizePatchList([{ type: 'text', key: 'hero-1/heading/1', value: 'A' }]);
  assert.equal(text.length, 1);
  assert.equal(text[0].hidden, false);
});

test('published patches stay comparable after server ids are added', () => {
  const client = [{ type: 'text', route: '/', key: 'hero-1/eyebrow/1', value: 'Vi er et testbyrå' }];
  const fromDisk = normalizePatchList(client);
  assert.equal(fromDisk[0].id.startsWith('p_'), true);
  assert.equal(fromDisk[0].value, client[0].value);
  assert.equal(fromDisk[0].hidden, false);
});

test('public inject adds hydrator, editor inject skips hydrator', () => {
  const pub = preparePublicHtml(HOME, { editor: false, analytics: false });
  assert.match(pub, /site-hydrator\.js/);
  assert.doesNotMatch(pub, /site-editor-runtime\.js/);
  const edit = preparePublicHtml(HOME, { editor: true, analytics: false });
  assert.match(edit, /site-editor-runtime\.js/);
  assert.doesNotMatch(edit, /site-hydrator\.js/);
});

test('editor runtime opens a side panel instead of contenteditable', () => {
  const src = siteEditorRuntimeScript();
  assert.doesNotMatch(src, /setAttribute\(['"]contenteditable['"]/);
  assert.match(src, /asoldi-editor-select/);
  assert.match(src, /asoldi-ed-selected/);
  assert.match(src, /a\[href\],area\[href\]/);
  assert.match(src, /backgroundImage/);
  assert.match(src, /Ikke redigerbar/);
});

test('inject is idempotent', () => {
  const once = injectSiteRuntimes(HOME, { editor: false });
  const twice = injectSiteRuntimes(once, { editor: false });
  assert.equal(twice.split('site-hydrator.js').length, 2);
});
