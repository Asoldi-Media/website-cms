/**
 * Discount rules: codes (coupons) and automatic discounts share one shape.
 * type: percent | amount | fixed_product | tiered | bxgy | free_shipping
 * Class (Shopify model): product | order | shipping. Two discounts stack only when
 * each one's combinesWith allows the other's class.
 */
import { parseMajor } from './money.js';

export const DISCOUNT_TYPES = ['percent', 'amount', 'fixed_product', 'tiered', 'bxgy', 'free_shipping'];

function clean(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function ids(value) {
  return [...new Set((Array.isArray(value) ? value : String(value || '').split(',')).map((v) => clean(v, 80)).filter(Boolean))].slice(0, 500);
}

function int(value, fallback = 0, min = 0) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= min ? n : fallback;
}

function major(value) {
  const n = parseMajor(value);
  return n == null || n < 0 ? 0 : n;
}

function date(value) {
  const raw = clean(value, 40);
  return raw && Number.isFinite(Date.parse(raw)) ? raw : '';
}

/** Discount code in its stored form: upper case without spaces. */
export function normalizeCode(value) {
  return clean(value, 40).toUpperCase().replace(/\s+/g, '');
}

/** One discount rule with defaults filled in. */
export function normalizeDiscount(raw = {}) {
  const type = DISCOUNT_TYPES.includes(raw.type) ? raw.type : 'percent';
  const method = raw.method === 'automatic' ? 'automatic' : 'code';
  const combines = raw.combinesWith || {};
  const usedBy = {};
  for (const [email, count] of Object.entries(raw.usedBy || {})) {
    const key = clean(email, 160).toLowerCase();
    if (key) usedBy[key] = int(count);
  }
  return {
    id: clean(raw.id, 60),
    method,
    code: method === 'code' ? normalizeCode(raw.code) : '',
    title: clean(raw.title || raw.name, 120),
    active: raw.active !== false,
    type,
    value: type === 'percent' || type === 'tiered' ? Math.min(100, major(raw.value)) : major(raw.value),
    appliesTo: {
      productIds: ids(raw.appliesTo?.productIds),
      categoryIds: ids(raw.appliesTo?.categoryIds),
      excludeProductIds: ids(raw.appliesTo?.excludeProductIds),
      excludeSale: Boolean(raw.appliesTo?.excludeSale),
    },
    freeShipping: type === 'free_shipping' || Boolean(raw.freeShipping),
    minSubtotal: major(raw.minSubtotal),
    maxSubtotal: major(raw.maxSubtotal),
    tiers: (Array.isArray(raw.tiers) ? raw.tiers : [])
      .map((t) => ({ minQty: int(t?.minQty, 0, 1), percent: Math.min(100, major(t?.percent)) }))
      .filter((t) => t.minQty > 0 && t.percent > 0)
      .sort((a, b) => a.minQty - b.minQty)
      .slice(0, 10),
    bxgy: {
      buyQty: int(raw.bxgy?.buyQty, 1, 1),
      buyProductIds: ids(raw.bxgy?.buyProductIds),
      buyCategoryIds: ids(raw.bxgy?.buyCategoryIds),
      getQty: int(raw.bxgy?.getQty, 1, 1),
      getProductIds: ids(raw.bxgy?.getProductIds),
      getCategoryIds: ids(raw.bxgy?.getCategoryIds),
      getPercent: raw.bxgy?.getPercent === undefined ? 100 : Math.min(100, major(raw.bxgy.getPercent)),
      maxUses: int(raw.bxgy?.maxUses, 0),
    },
    startsAt: date(raw.startsAt),
    endsAt: date(raw.endsAt),
    usageLimit: int(raw.usageLimit),
    usageLimitPerEmail: int(raw.usageLimitPerEmail),
    usedCount: int(raw.usedCount),
    usedBy,
    combinesWith: {
      product: Boolean(combines.product),
      order: Boolean(combines.order),
      shipping: combines.shipping !== false,
    },
    createdAt: clean(raw.createdAt, 40) || new Date().toISOString(),
    updatedAt: clean(raw.updatedAt, 40) || new Date().toISOString(),
  };
}

/** 'shipping', 'product' or 'order'; used for combination rules. */
export function discountClass(d) {
  if (d.type === 'free_shipping') return 'shipping';
  if (['fixed_product', 'tiered', 'bxgy'].includes(d.type)) return 'product';
  return d.appliesTo.productIds.length || d.appliesTo.categoryIds.length ? 'product' : 'order';
}

/** True when both discounts allow each other's class. */
export function canCombine(a, b) {
  return Boolean(a.combinesWith[discountClass(b)] && b.combinesWith[discountClass(a)]);
}

/** True when the discount is active and inside its start and end dates. */
export function inWindow(d, now = Date.now()) {
  if (d.startsAt && now < Date.parse(d.startsAt)) return false;
  if (d.endsAt && now > Date.parse(d.endsAt)) return false;
  return true;
}

/** True when a cart line is eligible for the discount scope. Gift cards and subscriptions never are. */
export function lineInScope(scope, line) {
  if (line.kind === 'giftcard' || line.kind === 'subscription') return false;
  if (scope.excludeProductIds?.includes(line.productId)) return false;
  if (scope.excludeSale && line.onSale) return false;
  const hasScope = scope.productIds?.length || scope.categoryIds?.length;
  if (!hasScope) return true;
  return scope.productIds?.includes(line.productId) || (line.categoryId && scope.categoryIds?.includes(line.categoryId));
}

/** Why a code can't be used right now (before looking at the cart), or ''. */
export function codeBlocker(d, { email = '', now = Date.now() } = {}) {
  if (!d || !d.active) return 'Ugyldig rabattkode.';
  if (!inWindow(d, now)) return d.endsAt && now > Date.parse(d.endsAt) ? 'Rabattkoden er utløpt.' : 'Rabattkoden er ikke aktiv ennå.';
  if (d.usageLimit && d.usedCount >= d.usageLimit) return 'Rabattkoden er brukt opp.';
  if (d.usageLimitPerEmail) {
    const key = String(email || '').trim().toLowerCase();
    if (!key) return 'Skriv inn e-postadressen din for å bruke denne koden.';
    if ((d.usedBy[key] || 0) >= d.usageLimitPerEmail) return 'Du har allerede brukt denne rabattkoden.';
  }
  return '';
}
