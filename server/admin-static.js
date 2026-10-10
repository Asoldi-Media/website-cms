/** Serve the built admin SPA at /admin and inject CMS runtimes into public HTML. */
import express from 'express';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { mountPublicHtmlTracker } from './html-tracker.js';
import { isLocalCmsOpenEnvOn } from './local-open.js';
const LOCAL_OPEN_BOOT = `<script>
(function(){
  try {
    if (localStorage.getItem('adminToken')) return;
    fetch('/api/cms/admin/local-session', { credentials: 'same-origin' })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(d){
        if (d && d.token) {
          localStorage.setItem('adminToken', d.token);
          location.reload();
        }
      })
      .catch(function(){});
  } catch (e) {}
})();
</script>`;
/** Absolute path of the built admin SPA (admin-dist). */
export function getAdminDistDir() {
    return join(dirname(fileURLToPath(import.meta.url)), '..', 'admin-dist');
}
/** Serve /admin from admin-dist and run the public HTML tracker. */
export function mountCmsAdmin(app, { publicPath, siteSeed, siteSeedPath } = {}) {
    const resolvedPublic = publicPath || join(process.cwd(), 'public');
    mountPublicHtmlTracker(app, resolvedPublic, { siteSeed, siteSeedPath });
    const dist = getAdminDistDir();
    if (!existsSync(join(dist, 'index.html'))) {
        console.warn('[client-cms] admin-dist/index.html missing; /admin will 404 until the admin SPA is built.');
    }
    app.use('/admin', express.static(dist, { index: false }));
    app.get(/^\/admin(?:\/.*)?$/, (_req, res) => {
        const indexPath = join(dist, 'index.html');
        if (!existsSync(indexPath)) {
            res.status(500).send('CMS admin UI is not built.');
            return;
        }
        if (!isLocalCmsOpenEnvOn()) {
            res.sendFile(indexPath);
            return;
        }
        try {
            const html = readFileSync(indexPath, 'utf8');
            const injected = html.includes('admin/local-session')
                ? html
                : html.replace(/<head>/i, `<head>${LOCAL_OPEN_BOOT}`);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(injected);
            return;
        }
        catch {
            res.sendFile(indexPath);
            return;
        }
    });
}
