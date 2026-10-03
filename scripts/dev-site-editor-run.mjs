/**
 * Preview the Website editor on a real generated run (template + optional Step 2 client rewrite).
 *
 *   node scripts/dev-site-editor-run.mjs
 *   RUN_ID=9b7e892c-09fb-4636-a957-613b3ae56380 STEP=2 PORT=4189 node scripts/dev-site-editor-run.mjs
 */
import express from 'express';
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import createCmsRoutes, { mountCmsAdmin } from '../server/routes.js';
import { extractSlotMapFromHtml, emptySlotMap } from '../server/slot-map.js';
import { CONTENT_SEED_CONTRACT } from '../server/cms-slot-contract.js';

const root = dirname(fileURLToPath(import.meta.url));
const makerRoot = join(root, '..', '..', '..', '..', '..');
const runsRoot = join(makerRoot, '.generated-runs');
const runId = process.env.RUN_ID || '313d3363-2891-48dc-81af-3aab10bc8f19';
const step = String(process.env.STEP || '1.5');
const port = Number(process.env.PORT || 4188);
const runDir = join(runsRoot, runId);
const htmlDir = join(runDir, `step-${step}`);
const assetsDir = existsSync(join(runDir, 'step-1', 'assets'))
  ? join(runDir, 'step-1', 'assets')
  : join(htmlDir, 'assets');

if (!existsSync(join(htmlDir, 'index.html'))) {
  console.error(`Missing ${htmlDir}/index.html`);
  process.exit(1);
}

function rewriteLocal(text) {
  return String(text || '').replace(/localasset:\/\/([a-zA-Z0-9._-]+)/gi, '/assets/$1');
}

function fileForRoute(route, fileName) {
  if (fileName && existsSync(join(htmlDir, fileName))) return fileName;
  if (!route || route === '/') return 'index.html';
  const dashed = `${route.replace(/^\//, '').replace(/\//g, '__')}.html`;
  if (existsSync(join(htmlDir, dashed))) return dashed;
  const nested = `${route.replace(/^\//, '')}.html`;
  if (existsSync(join(htmlDir, nested))) return nested;
  return '';
}

const manifest = existsSync(join(htmlDir, 'manifest.json'))
  ? JSON.parse(readFileSync(join(htmlDir, 'manifest.json'), 'utf8'))
  : { pages: [] };
const cmsPages = existsSync(join(runDir, 'cms', 'pages.json'))
  ? JSON.parse(readFileSync(join(runDir, 'cms', 'pages.json'), 'utf8'))
  : [];
const runRecord = existsSync(join(runDir, 'run.json'))
  ? JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'))
  : {};

const publicDir = join(tmpdir(), `asoldi-real-editor-${runId.slice(0, 8)}`);
mkdirSync(publicDir, { recursive: true });

const pages = [];
const seen = new Set();
const sourcePages = cmsPages.length
  ? cmsPages.map((p) => ({
      route: p.route,
      title: p.title || p.navLabel || p.route,
      kind: p.kind || 'other',
      isTemplate: p.isTemplate === true,
      inNav: p.inNav !== false,
      fileName: p.fileName,
    }))
  : (manifest.pages || []).map((p) => {
      const raw = String(p.pageType || p.kind || 'other').toLowerCase();
      const kind =
        raw === 'post' ? 'blog-post'
        : raw === 'blog' ? 'blog-index'
        : raw === 'product' ? 'product-page'
        : raw === 'service' ? 'services'
        : raw === 'team-member' ? 'about'
        : raw;
      return {
        route: p.routePath || p.route || '/',
        title: p.pageTitle || p.title || p.routePath,
        kind,
        isTemplate: kind === 'product-page' || kind === 'blog-post',
        inNav: true,
        fileName: p.fileName,
      };
    });

for (const page of sourcePages) {
  const route = page.route || '/';
  if (seen.has(route)) continue;
  const srcName = fileForRoute(route, page.fileName);
  if (!srcName) continue;
  const html = rewriteLocal(readFileSync(join(htmlDir, srcName), 'utf8'));
  const destRel = !route || route === '/' ? 'index.html' : `${route.replace(/^\//, '')}.html`;
  const dest = join(publicDir, destRel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, html);
  seen.add(route);
  pages.push({
    route,
    title: page.title,
    navLabel: page.title,
    kind: page.kind || 'other',
    isTemplate: page.isTemplate === true || page.kind === 'product-page' || page.kind === 'blog-post',
    inNav: page.inNav !== false,
    slots: extractSlotMapFromHtml(html) || emptySlotMap(),
  });
}

const seed = {
  version: 1,
  site: {
    name: runRecord.answers?.businessName || 'Real template',
    language: runRecord.answers?.websiteLanguage || '',
    domain: runRecord.answers?.websiteDomain || 'localhost',
  },
  lists: [],
  forms: [],
  pages,
  content: { ...CONTENT_SEED_CONTRACT },
};
const seedPath = join(publicDir, 'cms.site.json');
writeFileSync(seedPath, JSON.stringify(seed, null, 2));

process.env.CMS_DEV_ECOMMERCE = process.env.CMS_DEV_ECOMMERCE || '1';
process.env.CMS_DEV_GENERAL = process.env.CMS_DEV_GENERAL || '1';
process.env.CMS_DEV_BLOG = process.env.CMS_DEV_BLOG || '1';
const dataPath = join(tmpdir(), `asoldi-real-editor-data-${runId.slice(0, 8)}`);
const app = express();
app.use(express.json({ limit: '2mb' }));
if (existsSync(assetsDir)) {
  app.use('/assets', (req, res, next) => {
    const name = String(req.path || '').replace(/^\//, '');
    const file = join(assetsDir, name);
    if (!name || name.includes('..') || !existsSync(file) || !statSync(file).isFile()) return next();
    const ext = extname(file).toLowerCase();
    if (ext === '.css' || ext === '.js' || ext === '.svg' || ext === '.html') {
      res.type(ext === '.js' ? 'application/javascript' : ext);
      return res.send(rewriteLocal(readFileSync(file, 'utf8')));
    }
    return res.sendFile(file);
  });
}
app.use(
  '/api/cms',
  createCmsRoutes({
    dataPath,
    hubUrl: '',
    siteKey: `real-${runId.slice(0, 8)}`,
    adminSecret: 'dev-secret',
    siteSeedPath: seedPath,
  })
);
mountCmsAdmin(app, { publicPath: publicDir, siteSeedPath: seedPath });

app.listen(port, '127.0.0.1', () => {
  const marked = pages.filter((p) => p.slots?.hasMarkers).length;
  console.log(`Real-template editor http://127.0.0.1:${port}/admin  (admin / changeme)`);
  console.log(`Run ${runId} step-${step}  pages=${pages.length} marked=${marked}`);
  console.log(pages.map((p) => `${p.route} [${p.kind}] text=${p.slots.text?.length || 0}`).join('\n'));
});
