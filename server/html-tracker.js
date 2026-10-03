import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { injectAnalyticsTracker } from './analytics-tracker.js';
import { isPublicAnalyticsEnabled } from './analytics-flag.js';
import { injectSiteRuntimes } from './site-hydrator.js';
import { loadSiteSeed } from './site-seed.js';
import { contentKindFromPath, templateRouteForKind } from './content-pages.js';

export function resolvePublicHtml(publicPath, urlPath) {
  let decoded = String(urlPath || '/').split('?')[0];
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    return null;
  }
  if (!decoded.startsWith('/') || decoded.includes('..')) return null;
  if (/\.[a-z0-9]+$/i.test(decoded) && !decoded.endsWith('.html')) return null;
  const rel = decoded.replace(/^\//, '').replace(/\/$/, '');
  const candidates = [];
  if (!rel) candidates.push(join(publicPath, 'index.html'));
  else {
    candidates.push(join(publicPath, `${rel}.html`));
    candidates.push(join(publicPath, rel, 'index.html'));
    if (decoded.endsWith('.html')) candidates.push(join(publicPath, rel));
  }
  return candidates.find((file) => existsSync(file)) || null;
}

export function isSiteEditorRequest(req) {
  const flag = req?.query?.['asoldi-edit'];
  return flag === '1' || flag === 'true';
}

export function preparePublicHtml(html, { editor = false, analytics = false } = {}) {
  return injectSiteRuntimes(html, {
    editor,
    analytics,
    injectAnalytics: injectAnalyticsTracker,
  });
}

export function mountPublicHtmlTracker(app, publicPath, { siteSeed, siteSeedPath } = {}) {
  if (!publicPath) return;
  const seed = () => loadSiteSeed({ siteSeed, siteSeedPath });
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/admin') || req.path.startsWith('/api')) return next();
    let file = resolvePublicHtml(publicPath, req.path);
    if (!file) {
      const kind = contentKindFromPath(req.path);
      const route = kind ? templateRouteForKind(seed(), kind) : '';
      if (route) file = resolvePublicHtml(publicPath, route);
    }
    if (!file) return next();
    try {
      const editor = isSiteEditorRequest(req);
      const html = preparePublicHtml(readFileSync(file, 'utf8'), {
        editor,
        analytics: !editor && isPublicAnalyticsEnabled(),
      });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch {
      next();
    }
  });
}
