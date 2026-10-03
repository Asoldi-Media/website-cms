import express from 'express';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { mountPublicHtmlTracker } from './html-tracker.js';

export function getAdminDistDir() {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'admin-dist');
}

export function mountCmsAdmin(app, { publicPath, siteSeed, siteSeedPath } = {}) {
  const resolvedPublic = publicPath || join(process.cwd(), 'public');
  mountPublicHtmlTracker(app, resolvedPublic, { siteSeed, siteSeedPath });
  const dist = getAdminDistDir();
  if (!existsSync(join(dist, 'index.html'))) {
    console.warn('[client-cms] admin-dist/index.html missing; /admin will 404 until the admin SPA is built.');
  }
  app.use('/admin', express.static(dist, { index: 'index.html' }));
  app.get(/^\/admin(?:\/.*)?$/, (_req, res) => {
    const indexPath = join(dist, 'index.html');
    if (!existsSync(indexPath)) {
      return res.status(500).send('CMS admin UI is not built.');
    }
    res.sendFile(indexPath);
  });
}
