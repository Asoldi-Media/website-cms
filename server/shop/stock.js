/**
 * Stock holds: a checkout reserves its quantities (and booking slots) for holdMinutes.
 * Stock is decremented only when the payment is confirmed.
 */
import { findVariant, variantStockQty } from './product.js';

/** Stock availability, checkout holds and release, decrement on payment, restock on refund. */
export function createStock({ db, store }) {
  function activeHolds(now = Date.now()) {
    const holds = db.list('holds');
    const live = holds.filter((h) => Date.parse(h.expiresAt) > now);
    if (live.length !== holds.length) db.save('holds', live);
    return live;
  }

  function heldQty(productId, variantId, exceptRef = '') {
    let qty = 0;
    for (const hold of activeHolds()) {
      if (hold.ref === exceptRef) continue;
      for (const item of hold.items || []) if (item.productId === productId && item.variantId === variantId) qty += item.quantity;
    }
    return qty;
  }

  /** Free units right now (Infinity when stock is not tracked or backorders are allowed). */
  function available(productId, variantId = 'default', exceptRef = '') {
    const product = store.getProductById(productId);
    if (!product) return 0;
    if (product.backorders === 'yes') return Infinity;
    const variant = findVariant(product, variantId);
    const qty = variantStockQty(product, variant);
    if (typeof qty !== 'number') return Infinity;
    return Math.max(0, qty - heldQty(productId, variant?.id || 'default', exceptRef));
  }

  function heldSlots(exceptRef = '') {
    const out = [];
    for (const hold of activeHolds()) if (hold.ref !== exceptRef) out.push(...(hold.slots || []));
    return out;
  }

  function hold(ref, lines, minutes, giftcardPayments = []) {
    const items = lines.filter((l) => !l.booking).map((l) => ({ productId: l.productId, variantId: l.variantId, quantity: l.quantity }));
    const slots = lines.filter((l) => l.booking).map((l) => ({ productId: l.productId, staffId: l.booking.staffId, start: l.booking.start, end: l.booking.end, quantity: l.quantity }));
    const giftcards = giftcardPayments.map((g) => ({ id: g.id, amountMinor: g.amountMinor }));
    const expiresAt = new Date(Date.now() + minutes * 60_000).toISOString();
    const holds = activeHolds().filter((h) => h.ref !== ref);
    holds.push({ ref, items, slots, giftcards, expiresAt });
    db.save('holds', holds);
    return expiresAt;
  }

  function release(ref) {
    const holds = db.list('holds');
    const next = holds.filter((h) => h.ref !== ref);
    if (next.length !== holds.length) db.save('holds', next);
  }

  function adjust(productId, variantId, delta) {
    const product = store.getProductById(productId);
    if (!product) return null;
    if (variantId && variantId !== 'default' && product.variants?.length) {
      const variants = product.variants.map((v) => (v.id === variantId && typeof v.stockQty === 'number' ? { ...v, stockQty: Math.max(0, v.stockQty + delta) } : v));
      const updated = store.updateProduct(product.id, { variants }).product;
      return { product: updated, qty: variants.find((v) => v.id === variantId)?.stockQty };
    }
    if (typeof product.stockQty !== 'number') return { product, qty: '' };
    const qty = Math.max(0, product.stockQty + delta);
    const updated = store.updateProduct(product.id, { stockQty: qty, soldOut: false }).product;
    return { product: updated, qty };
  }

  /** Payment confirmed: decrement tracked stock and drop the hold. Returns items that hit the low-stock line. */
  function commit(ref, lines, lowStockDefault = 3) {
    const low = [];
    for (const line of lines) {
      if (line.booking || line.kind === 'giftcard') continue;
      const result = adjust(line.productId, line.variantId, -line.quantity);
      if (!result || typeof result.qty !== 'number') continue;
      const threshold = typeof result.product.lowStockAt === 'number' ? result.product.lowStockAt : lowStockDefault;
      if (result.qty <= threshold) low.push({ productId: line.productId, variantId: line.variantId, name: line.name, variantLabel: line.variantLabel, qty: result.qty });
    }
    release(ref);
    return low;
  }

  function restock(items) {
    for (const item of items) if (item.quantity > 0) adjust(item.productId, item.variantId, item.quantity);
  }

  return { available, heldSlots, hold, release, commit, restock, activeHolds };
}
