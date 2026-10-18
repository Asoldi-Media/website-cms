/**
 * Kept for imports from 1.x. The shop lives in ./shop/ (cart, checkout, orders, payments).
 */
export { isBuyable } from './shop/product.js';

function clean(value) {
  return String(value ?? '').trim();
}

function isPrivateHost(host) {
  const h = String(host || '').toLowerCase().replace(/:\d+$/, '');
  return h === 'localhost' || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === '[::1]';
}

/** Public origin of this site. Live hosts are always https behind Hostinger's proxy. */
export function siteOrigin(req) {
  const fromEnv = clean(process.env.CMS_PUBLIC_URL).replace(/\/+$/, '');
  if (fromEnv) return fromEnv;
  const host = clean(req.get('x-forwarded-host') || req.get('host')).split(',')[0].trim();
  const forwarded = clean(req.get('x-forwarded-proto')).split(',')[0].trim();
  const proto = isPrivateHost(host) ? forwarded || req.protocol || 'http' : 'https';
  return `${proto}://${host}`;
}
