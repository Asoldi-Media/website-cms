/**
 * Order operations: fulfilment + tracking, refunds with credit notes, resend documents,
 * withdrawal (angrerett) receipts, booking cancellation.
 */
import { newId } from './db.js';
import { balanceOf } from './giftcards.js';
import { formatMoney } from './money.js';

const CARRIERS = {
  posten: (n) => `https://sporing.posten.no/sporing/${encodeURIComponent(n)}`,
  bring: (n) => `https://sporing.bring.no/sporing/${encodeURIComponent(n)}`,
  postnord: (n) => `https://tracking.postnord.com/no/?id=${encodeURIComponent(n)}`,
  helthjem: (n) => `https://www.helthjem.no/sporing?trackingNumber=${encodeURIComponent(n)}`,
  dhl: (n) => `https://www.dhl.com/no-no/home/tracking.html?tracking-id=${encodeURIComponent(n)}`,
  ups: (n) => `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}`,
  dao: (n) => `https://www.dao.as/privat/find-din-pakke?stregkode=${encodeURIComponent(n)}`,
};

/** Carrier tracking link for a number, or '' for an unknown carrier. */
export function trackingUrlFor(carrier, number) {
  const key = String(carrier || '').toLowerCase().replace(/[^a-z]/g, '');
  const build = CARRIERS[key] || (key.includes('posten') ? CARRIERS.posten : key.includes('postnord') ? CARRIERS.postnord : null);
  return build && number ? build(number) : '';
}

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

/** Amount already refunded per line key across earlier refunds. */
function refundedByLine(order) {
  const map = new Map();
  for (const r of order.refunds) for (const l of r.lines) map.set(l.key, (map.get(l.key) || 0) + l.amountMinor);
  return map;
}

/**
 * Pure refund maths. lines: [{key, quantity}], shipping: true → remaining shipping.
 * amountMinor (optional) replaces the computed total and is spread over the remaining value.
 */
export function computeRefund(order, { lines = [], shipping = false, amountMinor = null } = {}) {
  const already = refundedByLine(order);
  const out = [];
  for (const req of lines) {
    const line = order.lines.find((l) => l.key === req.key);
    if (!line) throw fail(400, 'Ukjent ordrelinje.');
    const qty = Math.floor(Number(req.quantity) || 0);
    if (qty <= 0) continue;
    const left = line.quantity - line.refundedQty;
    if (qty > left) throw fail(400, `Kan refundere maks ${left} av ${line.name}.`);
    const amount = qty === left ? line.lineTotalMinor - (already.get(line.key) || 0) : Math.round((line.lineTotalMinor * qty) / line.quantity);
    out.push({ key: line.key, quantity: qty, amountMinor: amount });
  }
  const shippingRefunded = order.refunds.reduce((s, r) => s + r.shippingMinor, 0);
  const shippingMinor = shipping === true ? order.shippingMinor - shippingRefunded : Math.max(0, Math.min(Math.round(Number(shipping) || 0), order.shippingMinor - shippingRefunded));
  let total = out.reduce((s, l) => s + l.amountMinor, 0) + shippingMinor;
  const remaining = order.totalMinor - order.refundedMinor;
  if (amountMinor != null && amountMinor !== '') {
    const custom = Math.round(Number(amountMinor));
    if (!(custom > 0)) throw fail(400, 'Beløpet må være større enn 0.');
    if (custom > remaining) throw fail(400, 'Beløpet er større enn det som kan refunderes.');
    if (!out.length && !shippingMinor) {
      // Amount-only refund: spread over the value still unrefunded, for correct MVA on the credit note.
      const weights = order.lines.map((l) => l.lineTotalMinor - (already.get(l.key) || 0));
      const sum = weights.reduce((s, w) => s + w, 0) || 1;
      let left = custom;
      order.lines.forEach((l, i) => {
        const part = i === order.lines.length - 1 ? left : Math.round((custom * weights[i]) / sum);
        left -= part;
        if (part > 0) out.push({ key: l.key, quantity: 0, amountMinor: part });
      });
    }
    total = custom;
  }
  if (total <= 0) throw fail(400, 'Velg hva som skal refunderes.');
  if (total > remaining) throw fail(400, 'Beløpet er større enn det som kan refunderes.');
  return { lines: out, shippingMinor, amountMinor: total };
}

/** Order operations: ship, refund with credit note, resend documents, withdrawal and booking cancellation. */
export function createOps(shop) {
  const { store, db, stock, giftcards, hub } = shop;

  async function ship(orderId, { lines = null, carrier = '', trackingNumber = '', trackingUrl = '', notify = true, by = '' } = {}) {
    const order = store.getOrderById(orderId);
    if (!order) throw fail(404, 'Fant ikke ordren.');
    const shippable = order.lines.filter((l) => l.kind === 'physical');
    const wanted = lines?.length ? lines : shippable.map((l) => ({ key: l.key, quantity: l.quantity - l.fulfilledQty - l.refundedQty }));
    const shipped = [];
    const nextLines = order.lines.map((l) => {
      const req = wanted.find((w) => w.key === l.key);
      if (!req) return l;
      const qty = Math.min(Math.floor(Number(req.quantity) || 0), l.quantity - l.fulfilledQty - l.refundedQty);
      if (qty <= 0) return l;
      shipped.push({ key: l.key, quantity: qty });
      return { ...l, fulfilledQty: l.fulfilledQty + qty };
    });
    if (!shipped.length && shippable.length) throw fail(400, 'Ingenting igjen å sende.');
    const url = String(trackingUrl || '').trim() || trackingUrlFor(carrier, trackingNumber);
    const shipment = { id: newId('shp_'), at: new Date().toISOString(), carrier: String(carrier).slice(0, 60), trackingNumber: String(trackingNumber).slice(0, 80), trackingUrl: url.slice(0, 500), lines: shipped };
    const allDone = nextLines.filter((l) => l.kind === 'physical').every((l) => l.fulfilledQty + l.refundedQty >= l.quantity);
    const updated = store.updateOrder(orderId, {
      lines: nextLines,
      fulfillment: { status: allDone ? 'fulfilled' : 'partial', shipments: [...order.fulfillment.shipments, shipment] },
      status: allDone ? 'shipped' : order.status === 'new' ? 'packed' : order.status,
      events: [...order.events, { at: shipment.at, type: 'shipped', text: `Sendt${carrier ? ` med ${carrier}` : ''}${trackingNumber ? ` (${trackingNumber})` : ''}.`, by }],
    }).order;
    if (notify && updated.customerEmail) await shop.sendDocument(updated, 'shipped', { shipment });
    return store.getOrderById(orderId);
  }

  async function refund(orderId, { lines = [], shipping = false, amountMinor = null, restock = true, reason = '', by = '' } = {}) {
    const order = store.getOrderById(orderId);
    if (!order) throw fail(404, 'Fant ikke ordren.');
    if (order.paymentStatus === 'refunded') throw fail(409, 'Ordren er allerede refundert i sin helhet.');
    if (!['paid', 'partially_refunded'].includes(order.paymentStatus)) throw fail(409, 'Ordren er ikke betalt, så det er ingenting å refundere. Kanseller den i stedet.');
    const calc = computeRefund(order, { lines, shipping, amountMinor });

    for (const r of calc.lines) {
      const line = order.lines.find((l) => l.key === r.key);
      if (line?.giftcard?.giftcardId && r.quantity) {
        const card = giftcards.all().find((c) => c.id === line.giftcard.giftcardId);
        if (card && balanceOf(card) < card.initialMinor) throw fail(409, 'Gavekortet er allerede brukt og kan ikke refunderes.');
      }
    }

    const providerPaid = order.amountPaidMinor - order.refunds.reduce((s, r) => s + (r.amountMinor - r.giftcardMinor), 0);
    const toProvider = ['stripe', 'paypal'].includes(order.paymentProvider) ? Math.min(calc.amountMinor, Math.max(0, providerPaid)) : 0;
    const toGiftcard = calc.amountMinor - toProvider;
    let providerRefundId = '';
    if (toProvider > 0) {
      const result = await hub.call('POST', '/api/hub/shop/refund', { provider: order.paymentProvider, providerId: order.providerCheckoutId, paymentRef: order.paymentRef, amountMinor: toProvider, currency: order.currency.toLowerCase(), ref: order.number });
      providerRefundId = result.id || '';
    }
    if (toGiftcard > 0) {
      let left = toGiftcard;
      for (const g of order.giftcardPayments) {
        if (left <= 0) break;
        const back = Math.min(left, g.amountMinor);
        giftcards.credit(g.id, back, { type: 'refund', ref: order.number });
        left -= back;
      }
    }

    const restocked = [];
    const nextLines = order.lines.map((l) => {
      const r = calc.lines.find((x) => x.key === l.key && x.quantity > 0);
      if (!r) return l;
      if (restock && l.kind === 'physical') restocked.push({ productId: l.productId, variantId: l.variantId, quantity: r.quantity });
      if (l.giftcard?.giftcardId) giftcards.update(l.giftcard.giftcardId, { active: false });
      return { ...l, refundedQty: l.refundedQty + r.quantity };
    });
    if (restocked.length) stock.restock(restocked);
    for (const l of order.lines) {
      const r = calc.lines.find((x) => x.key === l.key && x.quantity > 0);
      if (r && l.booking?.bookingId) cancelBookingRow(l.booking.bookingId, 'refund');
    }

    const settings = db.getSettings();
    const creditNoteNumber = `${settings.orders.prefix}K${db.nextNumber('credit', 1)}`;
    const entry = { id: newId('rf_'), at: new Date().toISOString(), amountMinor: calc.amountMinor, shippingMinor: calc.shippingMinor, lines: calc.lines, reason: String(reason).slice(0, 300), creditNoteNumber, providerRefundId, giftcardMinor: toGiftcard, restocked: restocked.length > 0, by };
    const refundedMinor = order.refundedMinor + calc.amountMinor;
    const full = refundedMinor >= order.totalMinor;
    const updated = store.updateOrder(orderId, {
      lines: nextLines,
      refunds: [...order.refunds, entry],
      refundedMinor,
      paymentStatus: full ? 'refunded' : 'partially_refunded',
      status: full && order.fulfillment.status === 'unfulfilled' ? 'cancelled' : order.status,
      events: [...order.events, { at: entry.at, type: 'refund', text: `Refundert ${formatMoney(calc.amountMinor, order.currency)} (${creditNoteNumber})${reason ? `: ${reason}` : ''}.`, by }],
    }).order;
    if (updated.customerEmail) await shop.sendDocument(updated, 'credit-note', { refund: entry });
    return { order: store.getOrderById(orderId), refund: entry };
  }

  function cancelBookingRow(id, reason = '') {
    const rows = db.list('bookings');
    const row = rows.find((b) => b.id === id);
    if (!row || row.status === 'cancelled') return row;
    row.status = 'cancelled';
    row.cancelledAt = new Date().toISOString();
    row.cancelReason = reason;
    db.save('bookings', rows);
    return row;
  }

  /** Customer cancels inside the policy window: free the slot, refund the line if paid. */
  async function cancelBookingByCustomer(id, email) {
    const row = db.find('bookings', (b) => b.id === id);
    if (!row || row.customerEmail.toLowerCase() !== String(email).toLowerCase()) throw fail(404, 'Fant ikke timen.');
    if (row.status === 'cancelled') return row;
    const settings = db.getSettings();
    if (Date.parse(row.start) - Date.now() < settings.bookings.cancelHours * 3_600_000) throw fail(409, `Timer kan avbestilles senest ${settings.bookings.cancelHours} timer før. Ta kontakt med oss.`);
    const order = row.orderId ? store.getOrderById(row.orderId) : null;
    const line = order?.lines.find((l) => l.booking?.bookingId === row.id && l.refundedQty < l.quantity);
    if (order && line && ['paid', 'partially_refunded'].includes(order.paymentStatus)) {
      await refund(order.id, { lines: [{ key: line.key, quantity: line.quantity - line.refundedQty }], restock: false, reason: 'Avbestilt av kunden', by: 'kunde' });
    }
    const cancelled = cancelBookingRow(id, 'kunde');
    if (order) {
      shop.addEvent(order.id, 'booking-cancelled', `Time ${row.productName} avbestilt av kunden.`, 'kunde');
      await shop.sendDocument(store.getOrderById(order.id), 'booking-cancelled', { extra: { bookings: [cancelled] } });
    }
    void shop.notifyOwner(null, { message: `Time avbestilt: ${row.productName} ${row.start} (${row.customerName || row.customerEmail})` }).catch(() => {});
    return cancelled;
  }

  async function resend(orderId, kind = 'order') {
    const order = store.getOrderById(orderId);
    if (!order) throw fail(404, 'Fant ikke ordren.');
    if (kind === 'credit-note') {
      const last = order.refunds[order.refunds.length - 1];
      if (!last) throw fail(400, 'Ordren har ingen kreditnota.');
      return shop.sendDocument(order, 'credit-note', { refund: last, resend: true });
    }
    if (kind === 'shipped') {
      const last = order.fulfillment.shipments[order.fulfillment.shipments.length - 1];
      if (!last) throw fail(400, 'Ordren er ikke sendt.');
      return shop.sendDocument(order, 'shipped', { shipment: last, resend: true });
    }
    return shop.sendDocument(order, order.lines.every((l) => l.booking) ? 'booking' : 'order', { resend: true });
  }

  /** Angrerettloven §21: confirm a withdrawal on a durable medium without delay. */
  async function withdraw({ orderNumber, email, name, text, ip }) {
    const order = store.getAllOrders().find((o) => o.number && o.number === String(orderNumber || '').trim());
    const matches = order && order.customerEmail && order.customerEmail.toLowerCase() === String(email || '').trim().toLowerCase();
    const entry = { at: new Date().toISOString(), type: 'withdrawal', text: `Angrerett brukt${name ? ` av ${name}` : ''}: ${String(text || '').slice(0, 400)}`, by: 'kunde' };
    db.audit({ action: 'withdrawal', orderNumber: String(orderNumber || '').slice(0, 30), email: String(email || '').slice(0, 160), matched: Boolean(matches), ip });
    if (matches) {
      store.updateOrder(order.id, { events: [...order.events, entry] });
      await shop.sendDocument(store.getOrderById(order.id), 'withdrawal', { extra: { withdrawal: { at: entry.at, text: String(text || '').slice(0, 1000), name: String(name || '').slice(0, 120) } } });
    }
    void shop.notifyOwner(null, { message: `Angreskjema mottatt for ordre ${orderNumber || '(uten nummer)'} fra ${name || ''} ${email || ''}:\n${String(text || '').slice(0, 1000)}` }).catch(() => {});
    return { matched: Boolean(matches) };
  }

  return { ship, refund, resend, withdraw, cancelBookingByCustomer, cancelBookingRow };
}
