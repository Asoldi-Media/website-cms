export function templateRouteForKind(seed, kind) {
  const want = String(kind || '').trim();
  const pages = Array.isArray(seed?.pages) ? seed.pages : [];
  const hit = pages.find((page) => page.kind === want);
  return hit?.route || '';
}

/** Map /products/:id and /blog/:slug onto listing/detail template kinds. */
export function contentKindFromPath(urlPath) {
  const pathOnly = String(urlPath || '/').split('?')[0];
  if (/^\/products\/[^/]+\/?$/.test(pathOnly)) return 'product-page';
  if (/^\/blog\/[^/]+\/?$/.test(pathOnly)) return 'blog-post';
  if (/^\/products\/?$/.test(pathOnly)) return 'product-index';
  if (/^\/blog\/?$/.test(pathOnly)) return 'blog-index';
  return '';
}
