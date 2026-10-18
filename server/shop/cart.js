/**
 * Cart in a signed cookie (no server state until checkout). Prices are never stored
 * here; the engine re-prices from the catalog on every request.
 */
import { createHmac, timingSafeEqual } from 'crypto';

export const CART_COOKIE = 'asoldi_cart';
export const COUNT_COOKIE = 'asoldi_cart_count';
const MAX_COOKIE = 3800;
const MAX_ITEMS = 50;

function clean(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

/** A cart with no items, codes or gift cards. */
export function emptyCart() {
  return { items: [], codes: [], giftcards: [], country: '', methodId: '', email: '', consent: false, note: '' };
}

/** Cookie header as a name to value map. */
export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[key] = part.slice(i + 1).trim();
    }
  }
  return out;
}

function sign(secret, body) {
  return createHmac('sha256', `cart:${secret}`).update(body).digest('base64url').slice(0, 32);
}

function normalizeItem(raw) {
  const item = {
    productId: clean(raw?.p ?? raw?.productId, 80),
    variantId: clean(raw?.v ?? raw?.variantId, 60) || 'default',
    quantity: Math.max(1, Math.min(10000, Math.floor(Number(raw?.q ?? raw?.quantity) || 1))),
    extras: (Array.isArray(raw?.x ?? raw?.extras) ? raw.x ?? raw.extras : []).map((e) => clean(e, 80)).filter(Boolean).slice(0, 20),
  };
  const g = raw?.g ?? raw?.giftcard;
  if (g) item.giftcard = { amount: Number(g.a ?? g.amount) || 0, recipientName: clean(g.n ?? g.recipientName, 80), recipientEmail: clean(g.e ?? g.recipientEmail, 160), message: clean(g.m ?? g.message, 300) };
  const b = raw?.b ?? raw?.booking;
  if (b) item.booking = { start: clean(b.s ?? b.start, 40), staffId: clean(b.t ?? b.staffId, 60) };
  return item.productId ? item : null;
}

/** Cart from the signed cookie. Empty when missing or tampered. */
export function readCart(req, secret) {
  const raw = parseCookies(req.headers?.cookie)[CART_COOKIE];
  if (!raw) return emptyCart();
  const dot = raw.lastIndexOf('.');
  if (dot < 0) return emptyCart();
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expect = sign(secret, body);
  if (sig.length !== expect.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return emptyCart();
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return {
      items: (Array.isArray(data.i) ? data.i : []).map(normalizeItem).filter(Boolean).slice(0, MAX_ITEMS),
      codes: (Array.isArray(data.c) ? data.c : []).map((c) => clean(c, 40)).filter(Boolean).slice(0, 5),
      giftcards: (Array.isArray(data.gc) ? data.gc : []).map((c) => clean(c, 40)).filter(Boolean).slice(0, 5),
      country: clean(data.co, 2).toUpperCase(),
      methodId: clean(data.m, 60),
      email: clean(data.e, 160),
      consent: data.k === 1,
      note: clean(data.n, 500),
    };
  } catch {
    return emptyCart();
  }
}

/** Signed cookie value for a cart. */
export function encodeCart(cart, secret) {
  const data = {
    i: cart.items.map((it) => {
      const row = { p: it.productId, q: it.quantity };
      if (it.variantId && it.variantId !== 'default') row.v = it.variantId;
      if (it.extras?.length) row.x = it.extras;
      if (it.giftcard) row.g = { a: it.giftcard.amount, n: it.giftcard.recipientName || undefined, e: it.giftcard.recipientEmail || undefined, m: it.giftcard.message || undefined };
      if (it.booking) row.b = { s: it.booking.start, t: it.booking.staffId || undefined };
      return row;
    }),
  };
  if (cart.codes?.length) data.c = cart.codes;
  if (cart.giftcards?.length) data.gc = cart.giftcards;
  if (cart.country) data.co = cart.country;
  if (cart.methodId) data.m = cart.methodId;
  if (cart.email) data.e = cart.email;
  if (cart.consent) data.k = 1;
  if (cart.note) data.n = cart.note;
  const body = Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${body}.${sign(secret, body)}`;
}

/** Total quantity in the cart. */
export function cartCount(cart) {
  return cart.items.reduce((s, it) => s + it.quantity, 0);
}

/** Returns false when the cart no longer fits in a cookie. */
export function writeCart(res, cart, secret, { secure = false } = {}) {
  const value = encodeCart(cart, secret);
  if (value.length > MAX_COOKIE || cart.items.length > MAX_ITEMS) return false;
  const attrs = `Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax${secure ? '; Secure' : ''}`;
  res.append('Set-Cookie', `${CART_COOKIE}=${value}; HttpOnly; ${attrs}`);
  res.append('Set-Cookie', `${COUNT_COOKIE}=${cartCount(cart)}; ${attrs}`);
  return true;
}

/** Expire the cart and cart-count cookies. */
export function clearCart(res, { secure = false } = {}) {
  const attrs = `Path=/; Max-Age=0; SameSite=Lax${secure ? '; Secure' : ''}`;
  res.append('Set-Cookie', `${CART_COOKIE}=; HttpOnly; ${attrs}`);
  res.append('Set-Cookie', `${COUNT_COOKIE}=0; ${attrs}`);
}
