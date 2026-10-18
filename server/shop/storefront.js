/** Public storefront routes: product page, cart, checkout, return, hub notifications. */
import express from 'express';
import { randomBytes } from 'crypto';
import { clearCart, cartCount, emptyCart, readCart, writeCart } from './cart.js';
import { hashToken } from './index.js';
import { lineKey } from './pricing.js';
import { normalizeCode } from './discounts.js';
import { normalizeGiftcardCode } from './giftcards.js';
import { productJsonLd } from './product.js';
import { sellerBlock } from './documents.js';
import { cartPage, productPage, resultPage } from './pages.js';

const RECOVER_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function clean(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function list(value) {
  return Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
}

/** In-memory per-key rate limiter. */
export function createRateLimiter({ max, windowMs }) {
  const hits = new Map();
  return function limited(key) {
    const now = Date.now();
    const row = (hits.get(key) || []).filter((t) => now - t < windowMs);
    row.push(now);
    hits.set(key, row);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    return row.length > max;
  };
}

/** Caller IP from x-forwarded-for or the socket. */
export function clientIp(req) {
  return clean(String(req.get('x-forwarded-for') || req.ip || '').split(',')[0], 60);
}

/** Cart summary JSON for the storefront. */
export function summary(priced, cart) {
  return {
    count: cartCount(cart),
    currency: priced.currency,
    items: priced.lines.map((l) => ({ key: l.key, productId: l.productId, variantId: l.variantId, name: l.name, variantLabel: l.variantLabel, quantity: l.quantity, lineTotalMinor: l.lineTotalMinor, discountMinor: l.discountMinor })),
    codes: priced.appliedCodes,
    subtotalMinor: priced.subtotalMinor,
    discountMinor: priced.discountMinor,
    shippingMinor: priced.shipping.amountMinor,
    taxMinor: priced.taxMinor,
    totalMinor: priced.totalMinor,
    amountDueMinor: priced.amountDueMinor,
    errors: priced.errors,
    checkoutUrl: '/api/cms/cart',
  };
}

/** Public storefront routes: product page, cart, checkout, return and hub notifications. */
export function mountStorefront(router, shop, { siteOrigin }) {
  const form = express.urlencoded({ extended: false, limit: '20kb' });
  const giftcardLimit = createRateLimiter({ max: 10, windowMs: 15 * 60_000 });
  const secret = shop.adminSecret;
  const { store, db } = shop;

  const isJson = (req) => clean(req.get('content-type')).includes('application/json');
  const secure = (req) => siteOrigin(req).startsWith('https:');
  const siteName = () => shop.getSiteName();

  function loadCart(req) {
    return readCart(req, secret);
  }

  function saveCart(req, res, cart) {
    return writeCart(res, cart, secret, { secure: secure(req) });
  }

  async function renderCart(req, res, cart, { status = 200, errors = [], notice = '' } = {}) {
    shop.rememberOrigin(siteOrigin(req));
    const settings = db.getSettings();
    const priced = shop.priceFor(cart);
    if (isJson(req)) return res.status(status).json({ ...summary(priced, cart), errors: [...errors, ...priced.errors] });
    const html = cartPage({ priced, cart, settings, providers: await shop.readyProviders(), siteName: await siteName(), cartCount: cartCount(cart), errors: [...errors, ...priced.errors], notice, seller: sellerBlock(settings, await siteName()) });
    return res.status(status).type('html').send(html);
  }

  function done(req, res, cart) {
    if (isJson(req)) return renderCart(req, res, cart);
    return res.redirect(303, '/api/cms/cart');
  }

  async function renderProduct(req, res, productId, { status = 200, error = '' } = {}) {
    shop.rememberOrigin(siteOrigin(req));
    const settings = db.getSettings();
    const product = store.getProductById(clean(productId, 80));
    const date = /^\d{4}-\d{2}-\d{2}$/.test(clean(req.query.date)) ? clean(req.query.date) : '';
    const slots = product?.kind === 'booking' && date ? shop.bookings.slotsFor(product, date) : null;
    const reviews = product ? db.list('reviews').filter((r) => r.productId === product.id && r.status === 'approved').slice(-50).reverse() : [];
    const rating = reviews.length ? { average: reviews.reduce((s, r) => s + r.rating, 0) / reviews.length, count: reviews.length } : null;
    const origin = siteOrigin(req);
    const html = productPage({
      product,
      settings,
      providers: await shop.readyProviders(),
      siteName: await siteName(),
      cartCount: cartCount(loadCart(req)),
      error,
      variantId: clean(req.query.variant || req.body?.variant, 60),
      date,
      slots,
      reviews,
      rating,
      jsonLd: product ? productJsonLd(product, { origin, currency: settings.currency, rating }) : null,
      origin,
    });
    return res.status(product ? status : 404).type('html').send(html);
  }

  router.get('/shop/product/:id', (req, res) => renderProduct(req, res, req.params.id));
  router.get('/checkout', (req, res) => renderProduct(req, res, req.query.product));

  router.get('/shop/slots', (req, res) => {
    const product = store.getProductById(clean(req.query.product, 80));
    if (!product || product.kind !== 'booking') return res.status(404).json({ message: 'Fant ikke tjenesten.' });
    res.json({ date: clean(req.query.date, 10), slots: shop.bookings.slotsFor(product, clean(req.query.date, 10)) });
  });

  router.post('/cart/add', form, async (req, res) => {
    const body = req.body || {};
    const productId = clean(body.productId || body.product, 80);
    const product = store.getProductById(productId);
    if (!product) return isJson(req) ? res.status(404).json({ message: 'Fant ikke produktet.' }) : renderProduct(req, res, productId, { status: 404 });
    const item = {
      productId,
      variantId: clean(body.variantId || body.variant, 60) || 'default',
      quantity: Math.max(1, Math.floor(Number(body.quantity) || 1)),
      extras: list(body.extras).map((e) => clean(e, 80)).filter(Boolean),
    };
    if (product.kind === 'giftcard') {
      const raw = body.giftcard?.amount ?? (body.giftcardAmount === 'custom' ? body.giftcardCustom : body.giftcardAmount);
      item.giftcard = { amount: Number(String(raw ?? '').replace(',', '.')) || 0, recipientName: clean(body.giftcard?.recipientName ?? body.recipientName, 80), recipientEmail: clean(body.giftcard?.recipientEmail ?? body.recipientEmail, 160), message: clean(body.giftcard?.message ?? body.giftcardMessage, 300) };
      item.quantity = 1;
    }
    if (product.kind === 'booking') {
      item.booking = { start: clean(body.booking?.start ?? body.slot, 40), staffId: clean(body.booking?.staffId ?? body.staffId, 60) };
      if (product.booking.capacity <= 1) item.quantity = 1;
    }
    if (product.kind === 'subscription') item.quantity = 1;
    const cart = loadCart(req);
    const key = lineKey(item);
    const existing = cart.items.find((it) => lineKey(it) === key);
    if (existing) existing.quantity += item.quantity;
    else cart.items.push(item);
    const priced = shop.priceFor(cart);
    const problem = priced.errors.find((e) => e.scope === 'item' && e.key === key) || priced.errors.find((e) => e.scope === 'cart');
    if (problem) {
      if (isJson(req)) return res.status(400).json({ message: problem.message });
      req.query.date = req.query.date || clean(body.date, 10);
      return renderProduct(req, res, productId, { status: 400, error: problem.message });
    }
    if (!saveCart(req, res, cart)) {
      const message = 'Handlekurven er full. Fullfør bestillingen eller fjern noe først.';
      return isJson(req) ? res.status(413).json({ message }) : renderProduct(req, res, productId, { status: 413, error: message });
    }
    return done(req, res, cart);
  });

  router.post('/cart/update', form, (req, res) => {
    const cart = loadCart(req);
    const key = clean(req.body?.key, 400);
    const qty = Math.floor(Number(req.body?.quantity));
    const item = cart.items.find((it) => lineKey(it) === key);
    if (item) {
      if (!Number.isFinite(qty) || qty <= 0) cart.items = cart.items.filter((it) => it !== item);
      else if (!item.booking && !item.giftcard) {
        item.quantity = qty;
        const problem = shop.priceFor(cart).errors.find((e) => e.scope === 'item' && e.key === key);
        if (problem?.maxQuantity) item.quantity = problem.maxQuantity;
      }
    }
    saveCart(req, res, cart);
    return done(req, res, cart);
  });

  router.post('/cart/remove', form, (req, res) => {
    const cart = loadCart(req);
    const key = clean(req.body?.key, 400);
    cart.items = cart.items.filter((it) => lineKey(it) !== key);
    saveCart(req, res, cart);
    return done(req, res, cart);
  });

  router.post('/cart/code', form, (req, res) => {
    const cart = loadCart(req);
    const code = normalizeCode(req.body?.code);
    if (!code) return done(req, res, cart);
    if (req.body?.email) cart.email = clean(req.body.email, 160);
    if (!cart.codes.includes(code)) cart.codes.push(code);
    const problem = shop.priceFor(cart).errors.find((e) => e.scope === 'code' && e.key === code);
    if (problem) {
      cart.codes = cart.codes.filter((c) => c !== code);
      saveCart(req, res, cart);
      return renderCart(req, res, cart, { status: 400, errors: [problem] });
    }
    saveCart(req, res, cart);
    return done(req, res, cart);
  });

  router.post('/cart/code/remove', form, (req, res) => {
    const cart = loadCart(req);
    const code = normalizeCode(req.body?.code);
    cart.codes = cart.codes.filter((c) => c !== code);
    saveCart(req, res, cart);
    return done(req, res, cart);
  });

  router.post('/cart/giftcard', form, (req, res) => {
    const cart = loadCart(req);
    if (giftcardLimit(clientIp(req))) return renderCart(req, res, cart, { status: 429, errors: [{ message: 'For mange forsøk. Vent litt og prøv igjen.' }] });
    const code = normalizeGiftcardCode(req.body?.code);
    if (!code) return done(req, res, cart);
    if (!cart.giftcards.includes(code)) cart.giftcards.push(code);
    const problem = shop.priceFor(cart).errors.find((e) => e.scope === 'giftcard' && e.key === code);
    if (problem) {
      cart.giftcards = cart.giftcards.filter((c) => c !== code);
      saveCart(req, res, cart);
      return renderCart(req, res, cart, { status: 400, errors: [problem] });
    }
    saveCart(req, res, cart);
    return done(req, res, cart);
  });

  router.post('/cart/giftcard/remove', form, (req, res) => {
    const cart = loadCart(req);
    const code = normalizeGiftcardCode(req.body?.code);
    cart.giftcards = cart.giftcards.filter((c) => c !== code);
    saveCart(req, res, cart);
    return done(req, res, cart);
  });

  router.post('/cart/options', form, (req, res) => {
    const cart = loadCart(req);
    const body = req.body || {};
    if (body.country !== undefined) cart.country = clean(body.country, 2).toUpperCase();
    if (body.method !== undefined) cart.methodId = clean(body.method, 60);
    if (body.email !== undefined) cart.email = clean(body.email, 160);
    if (body.note !== undefined) cart.note = clean(body.note, 500);
    if (body.consent !== undefined) cart.consent = body.consent === '1' || body.consent === true;
    saveCart(req, res, cart);
    return done(req, res, cart);
  });

  router.get('/cart', (req, res) => renderCart(req, res, loadCart(req)));
  // Link in the one abandoned-cart reminder: rebuild the cart so prices, stock and the legal checkout run again.
  router.get('/cart/recover', (req, res) => {
    const hash = hashToken(clean(req.query.token, 100));
    const row = shop.readCheckouts().find((r) => r.recoverTokenHash === hash);
    if (row?.status === 'expired' && Date.now() - Date.parse(row.createdAt) < RECOVER_TTL_MS) {
      saveCart(req, res, { ...emptyCart(), items: row.cart?.items || [], codes: row.cart?.codes || [], giftcards: row.cart?.giftcards || [], country: row.country || '', methodId: row.priced?.shipping?.method?.id || '', email: row.email || '', note: row.note || '' });
    }
    res.redirect(303, '/api/cms/cart');
  });
  router.get('/cart.json', (req, res) => {
    const cart = loadCart(req);
    res.json(summary(shop.priceFor(cart), cart));
  });

  router.post('/checkout', form, async (req, res) => {
    const body = req.body || {};
    const cart = loadCart(req);
    if (body.productId || body.product) {
      // Legacy single-product form: add to cart, then continue to the cart page.
      return res.redirect(303, `/api/cms/checkout?product=${encodeURIComponent(clean(body.productId || body.product, 80))}`);
    }
    cart.email = clean(body.email, 160) || cart.email;
    cart.note = body.note !== undefined ? clean(body.note, 500) : cart.note;
    cart.consent = body.consent === '1' || body.consent === true;
    saveCart(req, res, cart);
    const settings = db.getSettings();
    const fail = (status, message) => renderCart(req, res, cart, { status, errors: [{ message }] });
    if (!(body.terms === '1' || body.terms === true)) return fail(400, 'Du må godta salgsbetingelsene for å bestille.');
    const priced = shop.priceFor(cart);
    if (!priced.ok || priced.errors.length) return renderCart(req, res, cart, { status: 409 });
    const provider = clean(body.provider, 20);
    const onlyBookings = priced.lines.every((l) => l.booking);
    const email = cart.email;
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const consent = Boolean(settings.checkout.reminderConsent && cart.consent && validEmail);
    const ship = priced.shipping;
    const collectShipping = ship.required && ship.method?.type !== 'pickup';
    // Card and PayPal collect the delivery address on their own page; nothing else does.
    const address = provider === 'giftcard' && collectShipping ? { line: clean(body.line, 160), postal: clean(body.postal, 12), city: clean(body.city, 80), country: priced.country } : null;
    if (provider === 'giftcard') {
      if (priced.amountDueMinor > 0 || !priced.giftcardPayments.length) return fail(400, 'Gavekortet dekker ikke hele beløpet.');
      if (!validEmail) return fail(400, 'Skriv inn e-postadressen din.');
      if (address && !(clean(body.name, 120) && address.line && address.postal && address.city)) return fail(400, 'Skriv inn navn og leveringsadresse.');
    } else if (provider === 'reserve') {
      if (!onlyBookings || settings.bookings.payMode === 'prepay') return fail(400, 'Denne bestillingen må betales på nett.');
      if (!validEmail) return fail(400, 'Skriv inn e-postadressen din.');
    } else {
      const providers = await shop.readyProviders();
      if (!providers.includes(provider)) return fail(409, 'Denne betalingsmåten er ikke tilgjengelig.');
      if (priced.requiresStripe && provider !== 'stripe') return fail(409, 'Abonnement kan bare betales med kort.');
      if (onlyBookings && settings.bookings.payMode === 'reserve') return fail(409, 'Timer reserveres uten forhåndsbetaling.');
      if (priced.amountDueMinor <= 0 && !priced.trialDays) return fail(400, 'Ingenting å betale.');
    }
    const ref = `chk_${randomBytes(12).toString('hex')}`;
    const origin = siteOrigin(req);
    shop.rememberOrigin(origin);
    const holdExpiresAt = shop.stock.hold(ref, priced.lines, settings.checkout.holdMinutes, priced.giftcardPayments);
    shop.addCheckout({
      ref,
      provider,
      mode: priced.mode,
      status: 'pending',
      currency: priced.currency,
      amountMinor: priced.amountDueMinor,
      priced,
      cart: { items: cart.items, codes: priced.appliedCodes, giftcards: cart.giftcards },
      country: priced.country,
      email,
      name: clean(body.name, 120),
      phone: clean(body.phone, 40),
      address,
      consent,
      note: cart.note,
      createdAt: new Date().toISOString(),
      holdExpiresAt,
    });
    if (provider === 'giftcard' || provider === 'reserve') return res.redirect(303, `/api/cms/checkout/return?ref=${ref}`);
    try {
      const created = await shop.hub.call('POST', provider === 'stripe' ? '/api/hub/shop/stripe/checkout' : '/api/hub/shop/paypal/order', {
        ref,
        currency: priced.currency,
        mode: priced.mode,
        lineItems: priced.providerLines,
        recurringLines: priced.recurringLines,
        trialDays: priced.trialDays,
        shipping: priced.providerShipping,
        collectShipping,
        // Shipping and VAT were priced for this country, so the buyer's address must be there too.
        allowedCountries: collectShipping ? [priced.country] : [],
        customerEmail: validEmail ? email : undefined,
        reminderConsent: consent,
        expiresInMinutes: settings.checkout.holdMinutes,
        locale: 'nb',
        giftcardRecipients: priced.lines.map((l) => l.giftcard?.recipientEmail).filter(Boolean),
        successUrl: `${origin}/api/cms/checkout/return?ref=${ref}&provider=${provider}`,
        cancelUrl: `${origin}/api/cms/checkout/cancel?ref=${ref}`,
      });
      shop.patchCheckout(ref, { providerId: created.id });
      if (isJson(req)) return res.json({ url: created.url, ref });
      return res.redirect(303, created.url);
    } catch (err) {
      shop.stock.release(ref);
      shop.patchCheckout(ref, { status: 'failed', error: clean(err.message, 300) });
      return fail(err.status && err.status < 500 ? err.status : 502, 'Kunne ikke åpne betalingen. Prøv igjen om litt.');
    }
  });

  router.get('/checkout/return', async (req, res) => {
    const name = await siteName();
    const settings = db.getSettings();
    const ref = clean(req.query.ref, 80);
    try {
      const result = await shop.finalize(ref, { providerId: clean(req.query.session_id || req.query.token, 200) });
      if (result.ok) clearCart(res, { secure: secure(req) });
      res.status(result.ok ? 200 : result.pending ? 202 : 400).type('html').send(resultPage({ ok: result.ok, pending: result.pending, siteName: name, settings, message: result.ok ? '' : result.message, order: result.order }));
    } catch {
      res.status(502).type('html').send(resultPage({ ok: false, siteName: name, settings, message: 'Vi fikk ikke bekreftet betalingen. Hvis beløpet er trukket, ta kontakt med butikken.' }));
    }
  });

  router.get('/checkout/cancel', (req, res) => {
    const ref = clean(req.query.ref, 80);
    const row = shop.getCheckout(ref);
    if (row && row.status === 'pending') {
      shop.patchCheckout(ref, { status: 'cancelled' });
      shop.stock.release(ref);
    }
    res.redirect(303, '/api/cms/cart');
  });

  // The hub relays provider webhooks. Every handler re-verifies with the hub, so the body is only a hint.
  router.post('/checkout/notify', async (req, res) => {
    const body = req.body || {};
    const type = clean(body.type, 60) || 'checkout.completed';
    try {
      if (type === 'checkout.completed') {
        const id = clean(body.id, 200);
        const row = id ? shop.readCheckouts().find((r) => r.providerId === id) : null;
        if (!row) return res.status(404).json({ ok: false });
        const result = await shop.finalize(row.ref, { providerId: id });
        return res.json({ ok: result.ok });
      }
      if (type === 'checkout.expired') return res.json(await shop.handleExpired(clean(body.id, 200)));
      if (type === 'invoice.paid') return res.json(await shop.handleInvoicePaid(clean(body.id, 200)));
      if (type === 'subscription.updated') return res.json(await shop.handleSubscriptionUpdated(clean(body.id, 200)));
      return res.json({ ok: true, ignored: type });
    } catch (err) {
      return res.status(502).json({ ok: false, message: clean(err.message, 200) });
    }
  });
}
