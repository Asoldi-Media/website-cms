/**
 * Commerce fields on a product (all additive; legacy products keep working).
 * kind: physical | digital | service | booking | subscription | giftcard
 */
import { parseMajor } from './money.js';

export const PRODUCT_KINDS = ['physical', 'digital', 'service', 'booking', 'subscription', 'giftcard'];
const DAY = 24 * 60 * 60 * 1000;

function clean(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function priceOrBlank(value) {
  if (value === '' || value == null) return '';
  const n = parseMajor(value);
  return n == null || n < 0 ? '' : n;
}

function intOrBlank(value, { min = 0, max = 1e9 } = {}) {
  if (value === '' || value == null) return '';
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= min ? Math.min(n, max) : '';
}

function dateOrBlank(value) {
  const raw = clean(value, 40);
  return raw && Number.isFinite(Date.parse(raw)) ? raw : '';
}

function variantKey(optionValues) {
  return Object.keys(optionValues).sort().map((k) => `${k}=${optionValues[k]}`).join('|');
}

function normalizeOptions(raw) {
  return (Array.isArray(raw) ? raw : [])
    .slice(0, 3)
    .map((o) => ({
      name: clean(o?.name, 40),
      values: [...new Set((Array.isArray(o?.values) ? o.values : String(o?.values || '').split(',')).map((v) => clean(v, 60)).filter(Boolean))].slice(0, 50),
    }))
    .filter((o) => o.name && o.values.length);
}

function normalizeVariant(raw, options, index) {
  const optionValues = {};
  for (const option of options) {
    const value = clean(raw?.optionValues?.[option.name], 60);
    if (option.values.includes(value)) optionValues[option.name] = value;
  }
  return {
    id: clean(raw?.id, 60).replace(/[^a-zA-Z0-9_-]/g, '') || `v${index + 1}`,
    optionValues,
    sku: clean(raw?.sku, 64),
    barcode: clean(raw?.barcode, 32),
    price: priceOrBlank(raw?.price),
    salePrice: priceOrBlank(raw?.salePrice),
    stockQty: intOrBlank(raw?.stockQty),
    weightGrams: intOrBlank(raw?.weightGrams),
    imageUrl: clean(raw?.imageUrl, 500),
    enabled: raw?.enabled !== false,
  };
}

function normalizePriceLog(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((e) => ({ at: clean(e?.at, 40), v: clean(e?.v, 60) || 'default', p: Number(e?.p) }))
    .filter((e) => Number.isFinite(Date.parse(e.at)) && Number.isFinite(e.p))
    .slice(-120);
}

/** Fields merged into normalizeProduct(). */
export function normalizeCommerceFields(raw, productType = '') {
  const kindDefault = productType === 'menu' || productType === 'tiers' ? 'service' : 'physical';
  const kind = PRODUCT_KINDS.includes(raw?.kind) ? raw.kind : kindDefault;
  const options = normalizeOptions(raw?.options);
  const seen = new Set();
  const variants = options.length
    ? (Array.isArray(raw?.variants) ? raw.variants : [])
        .slice(0, 100)
        .map((v, i) => normalizeVariant(v, options, i))
        .filter((v) => {
          const key = variantKey(v.optionValues);
          if (Object.keys(v.optionValues).length !== options.length || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
    : [];
  const booking = raw?.booking || {};
  const subscription = raw?.subscription || {};
  const giftcard = raw?.giftcard || {};
  return {
    kind,
    taxClass: clean(raw?.taxClass, 60),
    requiresShipping: typeof raw?.requiresShipping === 'boolean' ? raw.requiresShipping : kind === 'physical',
    sku: clean(raw?.sku, 64),
    barcode: clean(raw?.barcode, 32),
    brand: clean(raw?.brand, 80),
    weightGrams: intOrBlank(raw?.weightGrams),
    salePrice: priceOrBlank(raw?.salePrice),
    saleFrom: dateOrBlank(raw?.saleFrom),
    saleTo: dateOrBlank(raw?.saleTo),
    backorders: raw?.backorders === 'yes' ? 'yes' : 'no',
    lowStockAt: intOrBlank(raw?.lowStockAt),
    maxPerOrder: intOrBlank(raw?.maxPerOrder, { min: 1 }),
    options,
    variants,
    digitalFiles: (Array.isArray(raw?.digitalFiles) ? raw.digitalFiles : [])
      .map((f) => ({ id: clean(f?.id, 60), name: clean(f?.name, 120), file: clean(f?.file, 200).replace(/[\\/]/g, '') }))
      .filter((f) => f.id && f.file)
      .slice(0, 10),
    downloadLimit: intOrBlank(raw?.downloadLimit, { min: 1, max: 100 }) || 5,
    downloadDays: intOrBlank(raw?.downloadDays, { min: 1, max: 3650 }) || 30,
    booking: {
      durationMinutes: intOrBlank(booking.durationMinutes, { min: 5, max: 24 * 60 }) || 60,
      bufferMinutes: intOrBlank(booking.bufferMinutes, { min: 0, max: 240 }) || 0,
      capacity: intOrBlank(booking.capacity, { min: 1, max: 1000 }) || 1,
      staffIds: (Array.isArray(booking.staffIds) ? booking.staffIds : []).map((s) => clean(s, 60)).filter(Boolean).slice(0, 50),
      requiresConfirmation: Boolean(booking.requiresConfirmation),
    },
    subscription: {
      interval: ['day', 'week', 'month', 'year'].includes(subscription.interval) ? subscription.interval : 'month',
      intervalCount: intOrBlank(subscription.intervalCount, { min: 1, max: 12 }) || 1,
      trialDays: intOrBlank(subscription.trialDays, { min: 0, max: 730 }) || 0,
    },
    giftcard: {
      amounts: (Array.isArray(giftcard.amounts) ? giftcard.amounts : String(giftcard.amounts || '').split(','))
        .map((a) => parseMajor(a))
        .filter((a) => a != null && a > 0)
        .slice(0, 12),
      allowCustom: Boolean(giftcard.allowCustom),
      min: parseMajor(giftcard.min) || 100,
      max: parseMajor(giftcard.max) || 10000,
    },
    reviewsEnabled: raw?.reviewsEnabled !== false,
    priceLog: normalizePriceLog(raw?.priceLog),
  };
}

/** Variant option values joined for display. */
export function variantLabel(variant) {
  return Object.values(variant?.optionValues || {}).join(' / ');
}

/** Every purchasable variant; products without options have one implicit "default" variant. */
export function productVariants(product) {
  if (product?.variants?.length) return product.variants.filter((v) => v.enabled);
  return [{ id: 'default', optionValues: {}, sku: product?.sku || '', barcode: product?.barcode || '', price: '', salePrice: '', stockQty: product?.stockQty ?? '', weightGrams: '', imageUrl: '', enabled: true }];
}

/** Variant by id, or the default variant. */
export function findVariant(product, variantId) {
  const list = productVariants(product);
  if (!variantId) return list.length === 1 || !product?.variants?.length ? list[0] : null;
  return list.find((v) => v.id === variantId) || null;
}

/** True when now is inside the product's sale window. */
export function saleActive(product, now = Date.now()) {
  const from = product.saleFrom ? Date.parse(product.saleFrom) : -Infinity;
  const to = product.saleTo ? Date.parse(product.saleTo) : Infinity;
  return now >= from && now <= to;
}

/** Prices in major units (as entered). */
export function variantPricing(product, variant, now = Date.now()) {
  const regular = typeof variant?.price === 'number' ? variant.price : typeof product.price === 'number' ? product.price : null;
  if (regular == null) return { regular: null, price: null, onSale: false, beforePrice: null };
  const inheritsPrice = !variant || variant.price === '';
  const sale = typeof variant?.salePrice === 'number' ? variant.salePrice : inheritsPrice && typeof product.salePrice === 'number' ? product.salePrice : null;
  const onSale = sale != null && sale < regular && saleActive(product, now);
  const price = onSale ? sale : regular;
  return { regular, price, onSale, beforePrice: onSale ? beforePrice(product, variant?.id || 'default', regular, now, sale) : null, saleEndsAt: onSale ? product.saleTo || '' : '' };
}

/**
 * Prisopplysningsforskriften §9a: lowest price in the 30 days before the reduction.
 * Uses the logged price history; the regular price counts when nothing lower is logged.
 * Without saleFrom the reduction started when the current sale price was logged.
 */
export function beforePrice(product, variantId, regular, now = Date.now(), salePrice = null) {
  const log = (product.priceLog || []).filter((e) => e.v === variantId);
  let start = product.saleFrom ? Date.parse(product.saleFrom) : now;
  if (!product.saleFrom && salePrice != null) {
    for (let i = log.length - 1; i >= 0 && log[i].p === salePrice; i -= 1) start = Date.parse(log[i].at);
  }
  const windowStart = start - 30 * DAY;
  let lowest = regular;
  for (const entry of log) {
    const at = Date.parse(entry.at);
    if (at >= windowStart && at < start && entry.p < lowest) lowest = entry.p;
  }
  return lowest;
}

/** Called on save: append effective prices that changed (feeds førpris). */
export function appendPriceLog(previous, next, now = Date.now()) {
  const log = [...(next.priceLog || [])];
  const at = new Date(now).toISOString();
  for (const variant of productVariants(next)) {
    const before = previous ? findVariant(previous, variant.id) : null;
    const was = before ? variantPricing(previous, before, now).price : null;
    const is = variantPricing(next, variant, now).price;
    if (is != null && is !== was) log.push({ at, v: variant.id, p: is });
  }
  return log.slice(-120);
}

/** Stock for a variant; the product's own stock for the default variant. */
export function variantStockQty(product, variant) {
  if (!variant || variant.id === 'default') return product.stockQty;
  return variant.stockQty;
}

/** Can this product be put in the cart at all (ignores live holds)? */
export function isBuyable(product) {
  if (!product) return false;
  if (product.contactInsteadOfPrice || product.soldOut) return false;
  if (product.kind === 'giftcard') return product.giftcard.amounts.length > 0 || product.giftcard.allowCustom;
  const variants = productVariants(product);
  const anyPriced = variants.some((v) => {
    const p = variantPricing(product, v).price;
    return typeof p === 'number' && p > 0;
  });
  if (!anyPriced) return false;
  if (product.backorders === 'yes') return true;
  return variants.some((v) => {
    const qty = variantStockQty(product, v);
    return typeof qty !== 'number' || qty > 0;
  });
}

/** True for physical products that ship. */
export function requiresShipping(product) {
  return product.kind === 'physical' && product.requiresShipping !== false;
}

/** Public, storefront-safe commerce view (no private file names, no price log). */
export function publicCommerce(product, now = Date.now()) {
  const variants = productVariants(product).map((v) => {
    const pricing = variantPricing(product, v, now);
    const qty = variantStockQty(product, v);
    return {
      id: v.id,
      label: variantLabel(v),
      optionValues: v.optionValues,
      sku: v.sku,
      price: pricing.price,
      regularPrice: pricing.regular,
      onSale: pricing.onSale,
      beforePrice: pricing.beforePrice,
      inStock: product.backorders === 'yes' || typeof qty !== 'number' || qty > 0,
      imageUrl: v.imageUrl,
    };
  });
  return {
    kind: product.kind,
    sku: product.sku,
    brand: product.brand,
    options: product.options,
    variants,
    salePrice: product.salePrice,
    saleTo: product.saleTo,
    booking: product.kind === 'booking' ? { durationMinutes: product.booking.durationMinutes } : undefined,
    subscription: product.kind === 'subscription' ? { interval: product.subscription.interval, intervalCount: product.subscription.intervalCount, trialDays: product.subscription.trialDays } : undefined,
    giftcard: product.kind === 'giftcard' ? { amounts: product.giftcard.amounts, allowCustom: product.giftcard.allowCustom, min: product.giftcard.min, max: product.giftcard.max } : undefined,
    reviewsEnabled: product.reviewsEnabled,
  };
}

/** schema.org Product JSON-LD with an Offer per variant. */
export function productJsonLd(product, { origin, currency = 'nok', rating = null, now = Date.now() } = {}) {
  const offers = productVariants(product)
    .map((v) => {
      const pricing = variantPricing(product, v, now);
      if (pricing.price == null) return null;
      const qty = variantStockQty(product, v);
      return {
        '@type': 'Offer',
        sku: v.sku || product.sku || undefined,
        price: pricing.price.toFixed(2),
        priceCurrency: currency.toUpperCase(),
        availability: product.soldOut || (typeof qty === 'number' && qty <= 0 && product.backorders !== 'yes') ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
        url: `${origin}/api/cms/shop/product/${encodeURIComponent(product.id)}${v.id !== 'default' ? `?variant=${encodeURIComponent(v.id)}` : ''}`,
        ...(pricing.onSale && product.saleTo ? { priceValidUntil: product.saleTo.slice(0, 10) } : {}),
      };
    })
    .filter(Boolean);
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: String(product.description || product.subtitle || '').slice(0, 5000) || undefined,
    image: product.imageUrl ? (product.imageUrl.startsWith('http') ? product.imageUrl : `${origin}${product.imageUrl.startsWith('/') ? '' : '/'}${product.imageUrl}`) : undefined,
    sku: product.sku || undefined,
    gtin: product.barcode || undefined,
    brand: product.brand ? { '@type': 'Brand', name: product.brand } : undefined,
    offers: offers.length === 1 ? offers[0] : offers,
  };
  if (rating && rating.count > 0) ld.aggregateRating = { '@type': 'AggregateRating', ratingValue: rating.average.toFixed(1), reviewCount: rating.count };
  return JSON.parse(JSON.stringify(ld));
}
