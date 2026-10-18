/**
 * Gift cards = multi-purpose vouchers: 0 % MVA when sold, MVA on the goods when redeemed.
 * Balance lives in a ledger; codes are random, checked case-insensitively, rate-limited.
 */
import { randomBytes } from 'crypto';
import { newId } from './db.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** New gift card code in XXXX-XXXX-XXXX form. */
export function generateCode() {
  const bytes = randomBytes(12);
  let raw = '';
  for (const b of bytes) raw += ALPHABET[b % ALPHABET.length];
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

/** Gift card code as typed by a customer, normalized for lookup. */
export function normalizeGiftcardCode(value) {
  const raw = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return raw.length === 12 ? `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}` : String(value || '').trim().toUpperCase();
}

/** Remaining gift card balance in minor units. */
export function balanceOf(card) {
  return (card.ledger || []).reduce((s, e) => s + Number(e.amountMinor || 0), 0);
}

/** Gift card fields safe to show in the admin and to the holder. */
export function publicGiftcard(card) {
  return {
    id: card.id,
    last4: card.code.slice(-4),
    code: card.code,
    currency: card.currency,
    initialMinor: card.initialMinor,
    balanceMinor: balanceOf(card),
    expiresAt: card.expiresAt,
    active: card.active,
    recipientName: card.recipientName,
    recipientEmail: card.recipientEmail,
    message: card.message,
    orderId: card.orderId,
    orderNumber: card.orderNumber,
    createdAt: card.createdAt,
    ledger: card.ledger,
  };
}

/** Gift card store: issue, look up, redeem, credit back and update. */
export function createGiftcards({ db }) {
  function all() {
    return db.list('giftcards');
  }

  function findByCode(code) {
    const wanted = normalizeGiftcardCode(code);
    return all().find((c) => c.code === wanted) || null;
  }

  /** Shape the pricing engine expects. */
  function forPricing(code) {
    const card = findByCode(code);
    return card ? { id: card.id, code: card.code, balanceMinor: balanceOf(card), active: card.active, expiresAt: card.expiresAt, currency: card.currency } : null;
  }

  function issue({ amountMinor, currency, validityMonths, orderId = '', orderNumber = '', recipientName = '', recipientEmail = '', message = '', by = 'order', test = false }) {
    const cards = all();
    let code = generateCode();
    while (cards.some((c) => c.code === code)) code = generateCode();
    const expires = new Date();
    expires.setMonth(expires.getMonth() + validityMonths);
    const card = {
      id: newId('gc_'),
      code,
      currency,
      initialMinor: amountMinor,
      active: true,
      expiresAt: expires.toISOString(),
      recipientName,
      recipientEmail,
      message,
      orderId,
      orderNumber,
      test,
      createdAt: new Date().toISOString(),
      ledger: [{ at: new Date().toISOString(), amountMinor, type: 'issue', ref: orderNumber || by }],
    };
    cards.push(card);
    db.save('giftcards', cards);
    return card;
  }

  /** Debit at order time. Throws when a balance moved under us (caller refunds/flags). */
  function redeem(payments, { orderId, orderNumber }) {
    const cards = all();
    for (const p of payments) {
      const card = cards.find((c) => c.id === p.id);
      if (!card || balanceOf(card) < p.amountMinor) throw Object.assign(new Error(`Gavekort ${p.last4} har ikke nok saldo.`), { code: 'giftcard_balance' });
      card.ledger.push({ at: new Date().toISOString(), amountMinor: -p.amountMinor, type: 'redeem', ref: orderNumber || orderId });
    }
    db.save('giftcards', cards);
  }

  function credit(id, amountMinor, { type = 'refund', ref = '' } = {}) {
    const cards = all();
    const card = cards.find((c) => c.id === id);
    if (!card) return null;
    card.ledger.push({ at: new Date().toISOString(), amountMinor, type, ref });
    db.save('giftcards', cards);
    return card;
  }

  function update(id, patch) {
    const cards = all();
    const card = cards.find((c) => c.id === id);
    if (!card) return null;
    if (typeof patch.active === 'boolean') card.active = patch.active;
    if (patch.expiresAt && Number.isFinite(Date.parse(patch.expiresAt))) card.expiresAt = new Date(patch.expiresAt).toISOString();
    if (Number.isFinite(Number(patch.adjustMinor)) && Number(patch.adjustMinor) !== 0) {
      card.ledger.push({ at: new Date().toISOString(), amountMinor: Math.round(Number(patch.adjustMinor)), type: 'adjust', ref: String(patch.reason || '').slice(0, 120) });
    }
    db.save('giftcards', cards);
    return card;
  }

  return { all, findByCode, forPricing, issue, redeem, credit, update };
}
