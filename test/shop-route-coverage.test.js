import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import createCmsRoutes from '../server/routes.js';

const SHOP_PATHS = /^\/(cart|checkout|shop|account|orders\/:|payments|downloads|angreskjema|reviews|admin\/sso|admin\/audit)/;

/** Static check: every shop route is called by at least one HTTP test, so new endpoints cannot ship untested. */
test('RC every shop/account/payment route is exercised by a test', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'asoldi-rc-'));
  try {
    const router = createCmsRoutes({ dataPath: root, siteKey: 'rc', adminSecret: 'rc' });
    const routes = router.stack.filter((l) => l.route && SHOP_PATHS.test(l.route.path)).flatMap((l) => Object.keys(l.route.methods).map((m) => `${m.toUpperCase()} ${l.route.path}`));
    assert.ok(routes.length >= 60, `expected the full shop surface, found ${routes.length}`);
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const sources = readdirSync(dir).filter((f) => f.endsWith('.test.js') && f !== path.basename(fileURLToPath(import.meta.url))).map((f) => readFileSync(path.join(dir, f), 'utf8')).join('\n');
    const missing = routes.filter((r) => {
      const p = r.split(' ')[1];
      const pattern = p.split(/(:[A-Za-z_]+)/).map((part) => (part.startsWith(':') ? '[^/\'"`\\s?]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('');
      return !new RegExp(`${pattern}(?=[^A-Za-z0-9_\\-/.]|$)`, 'm').test(sources);
    });
    assert.deepEqual(missing, [], `routes without a test: ${missing.join(', ')}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
