/** Inject CMS runtimes into public HTML as it is served. */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { injectAnalyticsTracker } from './analytics-tracker.js';
import { isPublicAnalyticsEnabled } from './analytics-flag.js';
import { injectSiteRuntimes } from './site-hydrator.js';
import { loadSiteSeed } from './site-seed.js';
import { contentKindFromPath, templateRouteForKind } from './content-pages.js';
import { fallbackHtmlForKind } from './cms-templates.js';
/** HTML file in the public dir for a URL path, or null. */
export function resolvePublicHtml(publicPath, urlPath) {
    let decoded = String(urlPath || '/').split('?')[0];
    try {
        decoded = decodeURIComponent(decoded);
    }
    catch {
        return null;
    }
    if (!decoded.startsWith('/') || decoded.includes('..'))
        return null;
    if (/\.[a-z0-9]+$/i.test(decoded) && !decoded.endsWith('.html'))
        return null;
    const rel = decoded.replace(/^\//, '').replace(/\/$/, '');
    const candidates = [];
    if (!rel)
        candidates.push(join(publicPath, 'index.html'));
    else {
        candidates.push(join(publicPath, `${rel}.html`));
        candidates.push(join(publicPath, rel, 'index.html'));
        if (decoded.endsWith('.html'))
            candidates.push(join(publicPath, rel));
    }
    return candidates.find((file) => existsSync(file)) || null;
}
/** True when the request is the visual editor preview. */
export function isSiteEditorRequest(req) {
    const flag = req?.query?.['asoldi-edit'];
    return flag === '1' || flag === 'true';
}
/** HTML with the public CMS scripts inserted. */
export function preparePublicHtml(html, { editor = false, analytics = false } = {}) {
    return injectSiteRuntimes(html, {
        editor,
        analytics,
        injectAnalytics: injectAnalyticsTracker,
    });
}
const CONTENT_KINDS = [
    ['blog-index', '/blog'],
    ['blog-post', '/blog/:slug'],
    ['product-index', '/products'],
    ['product-page', '/products/:id'],
];

/** Where /blog and /products render from: the client page, or the CMS template. */
export function contentCoverage(seed, publicPath) {
    return CONTENT_KINDS.map(([kind, path]) => {
        const route = templateRouteForKind(seed, kind);
        const file = route ? resolvePublicHtml(publicPath, route) : null;
        return { kind, path, route: route || '', source: file ? 'client' : 'cms' };
    });
}

/** HTML for a public URL: the file, the client template page, or the CMS fallback. */
export function resolveServedHtml(publicPath, urlPath, seed) {
    const direct = resolvePublicHtml(publicPath, urlPath);
    if (direct)
        return readFileSync(direct, 'utf8');
    const kind = contentKindFromPath(urlPath);
    if (!kind)
        return '';
    const route = templateRouteForKind(seed, kind);
    const client = route ? resolvePublicHtml(publicPath, route) : null;
    if (client)
        return readFileSync(client, 'utf8');
    return fallbackHtmlForKind(kind);
}

/** Serve public HTML through the CMS script injector. */
export function mountPublicHtmlTracker(app, publicPath, { siteSeed, siteSeedPath } = {}) {
    if (!publicPath)
        return;
    const seed = () => loadSiteSeed({ siteSeed, siteSeedPath });
    app.use((req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD')
            return next();
        if (req.path.startsWith('/admin') || req.path.startsWith('/api'))
            return next();
        const raw = resolveServedHtml(publicPath, req.path, seed());
        if (!raw)
            return next();
        try {
            const editor = isSiteEditorRequest(req);
            const html = preparePublicHtml(raw, {
                editor,
                analytics: !editor && isPublicAnalyticsEnabled(),
            });
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
        }
        catch {
            next();
        }
    });
}
