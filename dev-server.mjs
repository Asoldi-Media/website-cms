import express from 'express';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import createCmsRoutes, { mountCmsAdmin } from './server/routes.js';

/** Local dev data folder. `fileURLToPath` keeps the drive letter right on Windows. */
export function defaultDevDataPath(env = process.env) {
  return env.CMS_DATA_PATH || fileURLToPath(new URL('./.dev-data', import.meta.url));
}

/** Local CMS dev server: every module on, admin opens without a password on this machine. */
export function startDevServer(env = process.env) {
  env.CMS_DEV_ECOMMERCE = env.CMS_DEV_ECOMMERCE || '1';
  env.CMS_DEV_CATALOG_TYPE = env.CMS_DEV_CATALOG_TYPE || 'menu';
  env.CMS_DEV_EMAIL = env.CMS_DEV_EMAIL || '1';
  env.CMS_DEV_BLOG = env.CMS_DEV_BLOG || '1';
  env.CMS_DEV_ANALYTICS = env.CMS_DEV_ANALYTICS || '1';
  env.CMS_DEV_GENERAL = env.CMS_DEV_GENERAL || '1';
  env.CMS_LOCAL_OPEN = env.CMS_LOCAL_OPEN || '1';

  const port = Number(env.PORT || 3044);
  const host = env.HOST || '127.0.0.1';
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(
    '/api/cms',
    createCmsRoutes({
      dataPath: defaultDevDataPath(env),
      hubUrl: '',
      siteKey: 'local-dev',
    })
  );
  mountCmsAdmin(app);
  return app.listen(port, host, () => {
    console.log(`CMS dev listening on http://${host}:${port}/admin`);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startDevServer();
}
