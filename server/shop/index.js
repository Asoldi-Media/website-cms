/**
 * Shop service: prices carts, runs checkouts through the hub (Stripe Connect / PayPal),
 * and finalizes paid checkouts into numbered orders with every side effect in one place.
 */
import { createHash, randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createShopDb, newId } from './db.js';
import { createStock } from './stock.js';
import { createBookings } from './bookings.js';
import { createGiftcards } from './giftcards.js';
import { createHubClient } from './hub-client.js';
import { priceCart } from './pricing.js';
import { orderDocument, sellerBlock } from './documents.js';
import { normalizeGiftcardCode } from './giftcards.js';

const PENDING_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_CHECKOUTS = 3000;

/** SHA-256 of a one-time token. Only the hash is stored. */
export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

/** Shop engine shared by the storefront, account and admin routes. */
export function createShop({ store, dataPath, hubUrl, siteKey, adminSecret, getSiteName = async () => '', notifyOwner = async () => {} }) {
  const db = createShopDb(dataPath);
  const stock = createStock({ db, store });
  const bookings = createBookings({ db, getSettings: () => db.getSettings(), heldSlots: (exceptRef) => stock.heldSlots(exceptRef) });
  const giftcards = createGiftcards({ db });
  const hub = createHubClient({ hubUrl, siteKey });
  const checkoutsPath = join(dataPath, 'cms', 'checkouts.json');
  const finalizing = new Map();

  function rememberOrigin(origin) {
    if (!origin) return;
    const meta = db.read('meta', {}) || {};
    if (meta.origin !== origin) db.write('meta', { ...meta, origin });
  }

  function origin() {
    const fromEnv = String(process.env.CMS_PUBLIC_URL || '').trim().replace(/\/+$/, '');
    return fromEnv || (db.read('meta', {}) || {}).origin || '';
  }

  function readCheckouts() {
    if (!existsSync(checkoutsPath)) return [];
    try {
      const rows = JSON.parse(readFileSync(checkoutsPath, 'utf8'));
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  function writeCheckouts(rows) {
    const dir = join(dataPath, 'cms');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const now = Date.now();
    const kept = rows.filter((row) => row.status !== 'pending' || now - Date.parse(row.createdAt || 0) < PENDING_TTL_MS).slice(-MAX_CHECKOUTS);
    writeFileSync(checkoutsPath, JSON.stringify(kept, null, 2), 'utf8');
  }

  function getCheckout(ref) {
    return readCheckouts().find((row) => row.ref === ref) || null;
  }

  function addCheckout(row) {
    const rows = readCheckouts();
    rows.push(row);
    writeCheckouts(rows);
  }

  function patchCheckout(ref, patch) {
    const rows = readCheckouts();
    const i = rows.findIndex((row) => row.ref === ref);
    if (i === -1) return null;
    rows[i] = { ...rows[i], ...patch, updatedAt: new Date().toISOString() };
    writeCheckouts(rows);
    return rows[i];
  }

  function heldGiftcardMinor(cardId, exceptRef) {
    let sum = 0;
    for (const hold of stock.activeHolds()) if (hold.ref !== exceptRef) for (const g of hold.giftcards || []) if (g.id === cardId) sum += g.amountMinor;
    return sum;
  }

  /** Re-price a cart from the live catalog, stock, holds and rules. */
  function priceFor(cart, { exceptRef = '', now } = {}) {
    const settings = db.getSettings();
    const products = new Map(store.getAllProducts().map((p) => [p.id, p]));
    const errors = [];
    const cards = [];
    for (const code of cart.giftcards || []) {
      const card = giftcards.forPricing(code);
      if (!card) errors.push({ scope: 'giftcard', key: normalizeGiftcardCode(code), message: 'Ukjent gavekort.' });
      else cards.push({ ...card, balanceMinor: card.balanceMinor - heldGiftcardMinor(card.id, exceptRef) });
    }
    const priced = priceCart({
      items: cart.items,
      settings,
      country: cart.country || settings.country,
      methodId: cart.methodId,
      codes: cart.codes,
      discounts: db.list('discounts'),
      giftcards: cards,
      email: cart.email,
      now,
      getProduct: (id) => products.get(id) || null,
      available: (productId, variantId) => stock.available(productId, variantId, exceptRef),
      checkBooking: (product, booking, qty) => bookings.check(product, booking, qty, { exceptRef }),
    });
    priced.errors.unshift(...errors);
    return priced;
  }

  async function readyProviders() {
    const status = await hub.status();
    const local = store.getPayments();
    const list = [];
    if (status?.stripe?.ready && local.stripe.enabled) list.push('stripe');
    if (status?.paypal?.ready && local.paypal.enabled) list.push('paypal');
    return list;
  }

  async function adminPayload(fresh = true) {
    const status = await hub.status({ fresh });
    const local = store.getPayments();
    return {
      linked: hub.linked,
      currency: db.getSettings().currency,
      stripe: { ...(status?.stripe || { available: false, connected: false, ready: false }), enabled: local.stripe.enabled },
      paypal: { ...(status?.paypal || { available: false, connected: false, ready: false }), enabled: local.paypal.enabled },
      hubReachable: Boolean(status),
    };
  }

  function addEvent(orderId, type, text, by = '') {
    const order = store.getOrderById(orderId);
    if (!order) return null;
    return store.updateOrder(orderId, { events: [...order.events, { at: new Date().toISOString(), type, text, by }] }).order;
  }

  /** Ask the hub to render + email a sales document; result is logged on the order. */
  async function sendDocument(order, kind, extra = {}) {
    const settings = db.getSettings();
    const doc = orderDocument(order, { settings, siteName: await getSiteName(), origin: origin(), kind, ...extra });
    let entry;
    try {
      const sent = await hub.call('POST', '/api/hub/shop/document', { document: doc, to: extra.to || undefined, resend: Boolean(extra.resend) }, 40_000);
      entry = { kind, number: doc.number, at: new Date().toISOString(), ok: true, error: sent.skipped ? 'allerede sendt' : '' };
    } catch (err) {
      entry = { kind, number: doc.number, at: new Date().toISOString(), ok: false, error: String(err.message || err).slice(0, 200) };
    }
    const fresh = store.getOrderById(order.id);
    if (fresh) store.updateOrder(order.id, { documents: [...fresh.documents, entry] });
    return entry;
  }

  function upsertCustomer(order) {
    const email = String(order.customerEmail || '').toLowerCase();
    if (!email) return;
    const rows = db.list('customers');
    const now = new Date().toISOString();
    let row = rows.find((c) => c.email === email);
    if (!row) {
      row = { id: newId('cus_'), email, name: '', phone: '', orderIds: [], totalSpentMinor: 0, firstOrderAt: now, lastOrderAt: now, address: null, tags: [], note: '' };
      rows.push(row);
    }
    row.name = order.customerName || row.name;
    row.phone = order.customerPhone || row.phone;
    if (order.shippingAddress?.line) row.address = order.shippingAddress;
    if (!row.orderIds.includes(order.id)) row.orderIds.push(order.id);
    row.totalSpentMinor = (row.totalSpentMinor || 0) + (order.totalMinor || 0);
    row.lastOrderAt = now;
    db.save('customers', rows);
  }

  function recordCodeUse(codes, email) {
    if (!codes?.length) return;
    const rows = db.list('discounts');
    const key = String(email || '').toLowerCase();
    for (const d of rows) {
      if (d.method !== 'code' || !codes.includes(d.code)) continue;
      d.usedCount += 1;
      if (key) d.usedBy[key] = (d.usedBy[key] || 0) + 1;
    }
    db.save('discounts', rows);
  }

  /** Next number in the real gap-free series, or in the separate TEST- series so test orders never use real numbers. */
  function nextOrderNumber(test = db.getSettings().orders.testMode) {
    if (test) return `TEST-${db.nextNumber('test', 1)}`;
    const settings = db.getSettings();
    return `${settings.orders.prefix}${db.nextNumber('order', settings.orders.numberStart)}`;
  }

  /** Create the order + every side effect. `payment` = verified provider result (or {} for gift card / reserve). */
  async function createOrderFromCheckout(checkout, payment) {
    const settings = db.getSettings();
    const priced = checkout.priced;
    const email = payment.customerEmail || checkout.email || '';
    const test = settings.orders.testMode;
    const number = nextOrderNumber(test);
    const lines = priced.lines.map((l) => ({ ...l, unitGrossMinor: l.unitGrossMinor }));
    const events = [{ at: new Date().toISOString(), type: 'created', text: `Bestilling ${number} opprettet (${checkout.provider}).` }];
    const created = store.createOrder({
      number,
      test,
      lines,
      productId: lines[0]?.productId || '',
      productName: lines.length > 1 ? `${lines[0].name} + ${lines.length - 1} til` : lines[0]?.name || 'Bestilling',
      quantity: lines.reduce((s, l) => s + l.quantity, 0),
      amount: priced.totalMinor / (settings.currency === 'jpy' ? 1 : 100),
      currency: priced.currency.toUpperCase(),
      subtotalMinor: priced.subtotalMinor,
      discountMinor: priced.discountMinor,
      shippingMinor: priced.shipping.amountMinor,
      taxMinor: priced.taxMinor,
      totalMinor: priced.totalMinor,
      amountPaidMinor: priced.amountDueMinor,
      discounts: priced.discounts,
      taxLines: priced.taxLines,
      shippingMethod: priced.shipping.method ? { id: priced.shipping.method.id, name: priced.shipping.method.name, type: priced.shipping.method.type } : null,
      giftcardPayments: priced.giftcardPayments,
      customerName: payment.customerName || checkout.name || (email ? '' : 'Nettkunde'),
      customerEmail: email,
      customerPhone: payment.customerPhone || checkout.phone || '',
      customNote: checkout.note || '',
      shippingAddress: payment.shippingAddressParts || { line: payment.shippingAddress || '' },
      country: checkout.country,
      consent: Boolean(checkout.consent),
      status: 'new',
      preset: lines.every((l) => l.booking) ? 'service' : 'normal',
      bookingFrom: lines.find((l) => l.booking)?.booking.start || '',
      bookingTo: lines.find((l) => l.booking)?.booking.end || '',
      paymentProvider: checkout.provider,
      paymentStatus: checkout.provider === 'reserve' ? 'pending' : 'paid',
      paymentRef: payment.paymentRef || '',
      providerCheckoutId: checkout.providerId || '',
      stripeCustomerId: payment.customerId || '',
      checkoutRef: checkout.ref,
      fulfillment: { status: lines.some((l) => l.requiresShipping) ? 'unfulfilled' : 'fulfilled', shipments: [] },
      events,
    });
    if (!created.ok) throw new Error(created.error);
    let order = created.order;

    const low = stock.commit(checkout.ref, lines, settings.checkout.lowStockAt);
    recordCodeUse(priced.appliedCodes, email);
    if (priced.giftcardPayments.length) {
      try {
        giftcards.redeem(priced.giftcardPayments, { orderId: order.id, orderNumber: number });
      } catch (err) {
        order = addEvent(order.id, 'warning', `${err.message} Sjekk og refunder differansen.`) || order;
      }
    }

    const bookingIds = [];
    const bookingByLine = new Map();
    for (const line of lines.filter((l) => l.booking)) {
      const staff = settings.bookings.staff.find((s) => s.id === line.booking.staffId);
      const product = store.getProductById(line.productId);
      const row = {
        id: newId('bk_'),
        ref: checkout.ref,
        orderId: order.id,
        orderNumber: number,
        productId: line.productId,
        productName: line.name,
        staffId: line.booking.staffId,
        staffName: staff?.name || '',
        start: line.booking.start,
        end: line.booking.end,
        quantity: line.quantity,
        status: product?.booking.requiresConfirmation ? 'pending' : 'confirmed',
        paid: checkout.provider !== 'reserve',
        amountMinor: line.lineTotalMinor,
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        customerPhone: order.customerPhone,
        note: order.customNote,
        source: 'online',
        createdAt: new Date().toISOString(),
      };
      db.upsert('bookings', row);
      bookingIds.push(row.id);
      bookingByLine.set(line.key, { id: row.id, staffName: row.staffName });
    }

    const issued = [];
    const issuedByLine = new Map();
    for (const line of lines.filter((l) => l.giftcard)) {
      for (let k = 0; k < line.quantity; k += 1) {
        const card = giftcards.issue({ amountMinor: line.unitGrossMinor, currency: priced.currency, validityMonths: settings.giftcards.validityMonths, orderId: order.id, orderNumber: number, recipientName: line.giftcard.recipientName, recipientEmail: line.giftcard.recipientEmail, message: line.giftcard.message });
        issued.push(card);
        if (!issuedByLine.has(line.key)) issuedByLine.set(line.key, card.id);
      }
    }

    const downloadIds = [];
    const downloadLinks = [];
    for (const line of lines.filter((l) => l.digital)) {
      const product = store.getProductById(line.productId);
      for (const file of product?.digitalFiles || []) {
        const token = randomBytes(24).toString('base64url');
        const grant = { id: newId('dl_'), orderId: order.id, productId: product.id, fileId: file.id, fileName: file.name, tokenHash: hashToken(token), downloadsLeft: product.downloadLimit, expiresAt: new Date(Date.now() + product.downloadDays * 86_400_000).toISOString(), email };
        db.upsert('downloads', grant);
        downloadIds.push(grant.id);
        downloadLinks.push({ name: file.name || product.name, url: `${origin()}/api/cms/downloads/${token}` });
      }
    }

    let subscriptionId = '';
    if (priced.mode === 'subscription') {
      const sub = {
        id: newId('sub_'),
        orderId: order.id,
        orderNumber: number,
        stripeSubscriptionId: payment.subscriptionId || '',
        stripeCustomerId: payment.customerId || '',
        status: payment.subscriptionStatus || (priced.trialDays ? 'trialing' : 'active'),
        email,
        name: order.customerName,
        lines: lines.filter((l) => l.recurring),
        currency: priced.currency,
        interval: lines.find((l) => l.recurring)?.recurring.interval || 'month',
        intervalCount: lines.find((l) => l.recurring)?.recurring.intervalCount || 1,
        currentPeriodEnd: payment.currentPeriodEnd || '',
        renewals: [],
        createdAt: new Date().toISOString(),
      };
      db.upsert('subscriptions', sub);
      subscriptionId = sub.id;
    }

    order = store.updateOrder(order.id, { bookingIds, downloadIds, subscriptionId, lines: lines.map((l) => {
      if (l.giftcard) return { ...l, giftcard: { ...l.giftcard, giftcardId: issuedByLine.get(l.key) || '' } };
      if (l.booking) return { ...l, booking: { ...l.booking, bookingId: bookingByLine.get(l.key)?.id || '', staffName: bookingByLine.get(l.key)?.staffName || '' } };
      return l;
    }) }).order;
    upsertCustomer(order);
    patchCheckout(checkout.ref, { status: 'paid', orderId: order.id, paidAt: new Date().toISOString() });

    const kind = checkout.provider === 'reserve' || lines.every((l) => l.booking) ? 'booking' : 'order';
    await sendDocument(order, kind, { extra: { downloads: downloadLinks, bookings: bookingIds.map((id) => db.find('bookings', (b) => b.id === id)) } });
    for (const card of issued) {
      await sendDocument(order, 'giftcard', { extra: { giftcard: { code: card.code, amountMinor: card.initialMinor, expiresAt: card.expiresAt, recipientName: card.recipientName, message: card.message } }, to: card.recipientEmail || undefined });
    }
    void notifyOwner(order, { lowStock: low }).catch(() => {});
    return order;
  }

  async function finalize(ref, { providerId } = {}) {
    if (finalizing.has(ref)) return finalizing.get(ref);
    const run = (async () => {
      const checkout = getCheckout(ref);
      if (!checkout) return { ok: false, message: 'Fant ikke bestillingen.' };
      if (checkout.status === 'paid') return { ok: true, checkout, order: store.getOrderById(checkout.orderId) };
      if (checkout.provider === 'giftcard' || checkout.provider === 'reserve') {
        const order = await createOrderFromCheckout(checkout, {});
        return { ok: true, checkout: getCheckout(ref), order };
      }
      const id = String(providerId || '').trim() || checkout.providerId;
      if (!id || (checkout.providerId && id !== checkout.providerId)) return { ok: false, message: 'Ukjent betaling.' };
      const result = checkout.provider === 'stripe'
        ? await hub.call('GET', `/api/hub/shop/stripe/session/${encodeURIComponent(id)}`)
        : await hub.call('POST', '/api/hub/shop/paypal/capture', { orderId: id });
      if (result.ref !== ref) return { ok: false, message: 'Betalingen hører ikke til denne bestillingen.' };
      if (!result.paid) return { ok: false, pending: true, message: 'Betalingen er ikke fullført ennå.' };
      if (Number(result.amountMinor) !== Number(checkout.amountMinor) || String(result.currency || '').toLowerCase() !== checkout.currency) {
        patchCheckout(ref, { status: 'mismatch', providerResult: { amountMinor: result.amountMinor, currency: result.currency } });
        return { ok: false, message: 'Beløpet stemmer ikke. Butikken er varslet.' };
      }
      const order = await createOrderFromCheckout(checkout, result);
      return { ok: true, checkout: getCheckout(ref), order };
    })();
    finalizing.set(ref, run);
    try {
      return await run;
    } finally {
      finalizing.delete(ref);
    }
  }

  /** Stripe session expired: free the hold; one reminder only with explicit consent (markedsføringsloven §15). */
  async function handleExpired(sessionId) {
    const rows = readCheckouts();
    const row = rows.find((r) => r.providerId === sessionId);
    // "cancelled" = the buyer clicked back on the payment page; that is still an abandoned cart.
    if (!row || !['pending', 'cancelled'].includes(row.status)) return { ok: true, skipped: true };
    const session = await hub.call('GET', `/api/hub/shop/stripe/session/${encodeURIComponent(sessionId)}`);
    if (session.ref !== row.ref || session.status !== 'expired') return { ok: false, message: 'Session is not expired.' };
    stock.release(row.ref);
    patchCheckout(row.ref, { status: 'expired', expiredAt: new Date().toISOString() });
    const email = String(row.email || '').toLowerCase();
    const triedAgain = rows.some((r) => r.ref !== row.ref && String(r.email || '').toLowerCase() === email && Date.parse(r.createdAt) > Date.parse(row.createdAt));
    if (!row.consent || !email || row.reminderSentAt || triedAgain) return { ok: true, reminded: false };
    const token = randomBytes(24).toString('base64url');
    const base = origin();
    try {
      const siteName = await getSiteName();
      await hub.call('POST', '/api/hub/shop/document', {
        document: { kind: 'cart-reminder', provider: 'stripe', providerId: sessionId, siteName, seller: sellerBlock(db.getSettings(), siteName), siteUrl: base, recoveryUrl: base ? `${base}/api/cms/cart/recover?token=${token}` : '', currency: row.currency, totalMinor: row.priced?.totalMinor || 0, lines: (row.priced?.lines || []).map((l) => ({ name: l.name, quantity: l.quantity, totalMinor: l.lineTotalMinor })) },
      });
      patchCheckout(row.ref, { reminderSentAt: new Date().toISOString(), recoverTokenHash: hashToken(token) });
      return { ok: true, reminded: true };
    } catch (err) {
      return { ok: true, reminded: false, error: String(err.message || err).slice(0, 200) };
    }
  }

  /** Renewal invoice paid → a new numbered order + receipt. The first invoice is the checkout itself. */
  async function handleInvoicePaid(invoiceId) {
    const invoice = await hub.call('GET', `/api/hub/shop/stripe/invoice/${encodeURIComponent(invoiceId)}`);
    if (!invoice.paid) return { ok: false, message: 'Invoice is not paid.' };
    const subs = db.list('subscriptions');
    const sub = subs.find((s) => s.stripeSubscriptionId && s.stripeSubscriptionId === invoice.subscriptionId);
    if (!sub) return { ok: false, message: 'Unknown subscription.' };
    sub.currentPeriodEnd = invoice.periodEnd || sub.currentPeriodEnd;
    sub.status = 'active';
    if (invoice.billingReason === 'subscription_create' || sub.renewals.some((r) => r.invoiceId === invoiceId)) {
      db.save('subscriptions', subs);
      return { ok: true, skipped: true };
    }
    const settings = db.getSettings();
    const test = Boolean(store.getOrderById(sub.orderId)?.test);
    const number = nextOrderNumber(test);
    const lines = sub.lines.map((l) => ({ ...l, key: `${l.key}|renewal|${invoiceId}` }));
    const taxByRate = new Map();
    for (const l of lines) {
      const t = taxByRate.get(l.rate) || { rate: l.rate, netMinor: 0, taxMinor: 0 };
      t.taxMinor += l.taxMinor;
      t.netMinor += l.lineTotalMinor - l.taxMinor;
      taxByRate.set(l.rate, t);
    }
    const created = store.createOrder({
      number,
      test,
      lines,
      productId: lines[0]?.productId || '',
      productName: `${lines[0]?.name || 'Abonnement'} (fornyelse)`,
      quantity: lines.reduce((s, l) => s + l.quantity, 0),
      amount: invoice.amountMinor / (settings.currency === 'jpy' ? 1 : 100),
      currency: String(invoice.currency || sub.currency).toUpperCase(),
      subtotalMinor: invoice.amountMinor,
      totalMinor: invoice.amountMinor,
      amountPaidMinor: invoice.amountMinor,
      taxMinor: [...taxByRate.values()].reduce((s, t) => s + t.taxMinor, 0),
      taxLines: [...taxByRate.values()],
      customerName: sub.name,
      customerEmail: invoice.customerEmail || sub.email,
      status: 'completed',
      paymentProvider: 'stripe',
      paymentStatus: 'paid',
      paymentRef: invoice.paymentRef || invoiceId,
      providerCheckoutId: invoiceId,
      subscriptionId: sub.id,
      fulfillment: { status: 'fulfilled', shipments: [] },
      events: [{ at: new Date().toISOString(), type: 'renewal', text: `Fornyelse av abonnement (${sub.orderNumber}).` }],
    });
    if (!created.ok) throw new Error(created.error);
    sub.renewals.push({ invoiceId, orderId: created.order.id, orderNumber: number, at: new Date().toISOString(), amountMinor: invoice.amountMinor });
    db.save('subscriptions', subs);
    upsertCustomer(created.order);
    await sendDocument(created.order, 'renewal', { extra: { provider: 'stripe-invoice', providerId: invoiceId } });
    return { ok: true, orderId: created.order.id };
  }

  async function handleSubscriptionUpdated(subscriptionId) {
    const remote = await hub.call('GET', `/api/hub/shop/stripe/subscription/${encodeURIComponent(subscriptionId)}`);
    const subs = db.list('subscriptions');
    const sub = subs.find((s) => s.stripeSubscriptionId === subscriptionId);
    if (!sub) return { ok: false, message: 'Unknown subscription.' };
    Object.assign(sub, { status: remote.status, currentPeriodEnd: remote.currentPeriodEnd || sub.currentPeriodEnd, cancelAtPeriodEnd: Boolean(remote.cancelAtPeriodEnd) });
    db.save('subscriptions', subs);
    return { ok: true, status: sub.status };
  }

  async function cancelSubscription(id, { atPeriodEnd = true, by = '' } = {}) {
    const subs = db.list('subscriptions');
    const sub = subs.find((s) => s.id === id);
    if (!sub) return { ok: false, status: 404, message: 'Fant ikke abonnementet.' };
    if (!sub.stripeSubscriptionId) return { ok: false, status: 409, message: 'Abonnementet mangler Stripe-kobling.' };
    const remote = await hub.call('POST', `/api/hub/shop/stripe/subscription/${encodeURIComponent(sub.stripeSubscriptionId)}/cancel`, { atPeriodEnd });
    Object.assign(sub, { status: remote.status, cancelAtPeriodEnd: Boolean(remote.cancelAtPeriodEnd), currentPeriodEnd: remote.currentPeriodEnd || sub.currentPeriodEnd, cancelledBy: by, cancelledAt: new Date().toISOString() });
    db.save('subscriptions', subs);
    return { ok: true, subscription: sub };
  }

  /** Owner reset after testing: deletes test orders and what they created, returns their stock, restarts the TEST- series. */
  function clearTestData() {
    const orders = store.getAllOrders().filter((o) => o.test);
    const ids = new Set(orders.map((o) => o.id));
    const back = [];
    for (const o of orders) {
      for (const l of o.lines) {
        if (l.booking || l.kind === 'giftcard') continue;
        const restocked = l.kind === 'physical' ? o.refunds.filter((r) => r.restocked).reduce((s, r) => s + (r.lines.find((x) => x.key === l.key)?.quantity || 0), 0) : 0;
        back.push({ productId: l.productId, variantId: l.variantId, quantity: l.quantity - restocked });
      }
    }
    stock.restock(back);
    const counts = { orders: store.deleteOrders([...ids]) };
    for (const name of ['bookings', 'downloads', 'subscriptions']) {
      const rows = db.list(name);
      const kept = rows.filter((r) => !ids.has(r.orderId));
      counts[name] = rows.length - kept.length;
      db.save(name, kept);
    }
    const cards = giftcards.all();
    const keptCards = cards.filter((c) => !c.test && !ids.has(c.orderId));
    counts.giftcards = cards.length - keptCards.length;
    db.save('giftcards', keptCards);
    const remaining = new Map(store.getAllOrders().map((o) => [o.id, o]));
    const customers = db.list('customers');
    const keptCustomers = customers
      .map((c) => {
        if (!c.orderIds.some((id) => ids.has(id))) return c;
        const orderIds = c.orderIds.filter((id) => remaining.has(id));
        return { ...c, orderIds, totalSpentMinor: orderIds.reduce((s, id) => s + remaining.get(id).totalMinor, 0) };
      })
      .filter((c) => c.orderIds.length || c.note || c.tags?.length);
    counts.customers = customers.length - keptCustomers.length;
    db.save('customers', keptCustomers);
    writeCheckouts(readCheckouts().filter((c) => !ids.has(c.orderId)));
    const counters = db.read('counters', {}) || {};
    delete counters.test;
    delete counters['test-credit'];
    db.write('counters', counters);
    return counts;
  }

  return {
    clearTestData,
    handleExpired,
    handleInvoicePaid,
    handleSubscriptionUpdated,
    cancelSubscription,
    db,
    stock,
    bookings,
    giftcards,
    hub,
    adminSecret,
    getSiteName,
    notifyOwner,
    rememberOrigin,
    origin,
    readCheckouts,
    getCheckout,
    addCheckout,
    patchCheckout,
    priceFor,
    readyProviders,
    adminPayload,
    addEvent,
    sendDocument,
    nextOrderNumber,
    upsertCustomer,
    finalize,
    store,
  };
}
