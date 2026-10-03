import express from 'express';
import { mkdirSync, cpSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import createCmsRoutes, { mountCmsAdmin } from '../server/routes.js';

const root = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(root, '..', 'test', 'fixtures', 'site-editor');
const publicDir = join(tmpdir(), 'asoldi-site-editor-public');
mkdirSync(publicDir, { recursive: true });
cpSync(join(fixtureDir, 'index.html'), join(publicDir, 'index.html'));
cpSync(join(fixtureDir, 'about.html'), join(publicDir, 'about.html'));
cpSync(join(fixtureDir, 'product.html'), join(publicDir, 'product.html'));

process.env.CMS_DEV_ECOMMERCE = process.env.CMS_DEV_ECOMMERCE || '1';
process.env.CMS_DEV_GENERAL = process.env.CMS_DEV_GENERAL || '1';
process.env.CMS_DEV_BLOG = process.env.CMS_DEV_BLOG || '1';
const dataPath = join(tmpdir(), 'asoldi-site-editor-data');
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(
  '/api/cms',
  createCmsRoutes({
    dataPath,
    hubUrl: '',
    siteKey: 'site-editor-dev',
    adminSecret: 'dev-secret',
    siteSeedPath: join(fixtureDir, 'cms.site.json'),
  })
);
mountCmsAdmin(app, { publicPath: publicDir });

const port = Number(process.env.PORT || 4177);
app.listen(port, '127.0.0.1', () => {
  console.log(`Site editor preview http://127.0.0.1:${port}/admin  (admin / changeme)`);
  console.log(`Pages: http://127.0.0.1:${port}/  and  /about  and  /product`);
});
