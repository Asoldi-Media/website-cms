/**
 * Shop admin API. adminAuth = staff (employee rank and up); ownerAuth = admin rank only,
 * used for anything that moves money or changes prices/tax rules.
 */
import express from 'express';
import multer from 'multer';
import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { extname, join } from 'path';
import { newId } from './db.js';
import { normalizeDiscount } from './discounts.js';
import { balanceOf, publicGiftcard } from './giftcards.js';
import { exportProducts, importProducts } from './csv.js';
import { ordersCsv, parseRange, salesReport, vatReport } from './reports.js';
import { toMinor } from './money.js';
import { productVariants, variantStockQty } from './product.js';

function clean(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function send(res, err) {
  res.status(err.status || 500).json({ message: err.message || 'Noe gikk galt.' });
}

const PRIVATE_EXT = new Set(['.pdf', '.zip', '.epub', '.mp3', '.wav', '.mp4', '.m4a', '.png', '.jpg', '.jpeg', '.txt', '.csv', '.docx', '.xlsx', '.pptx', '.psd', '.ai', '.svg', '.mobi']);

/** Shop admin API under /shop/*. Money-moving and settings routes need the owner. */
export function mountShopAdmin(router, shop, ops, { adminAuth, ownerAuth, privateDir }) {
  const { store, db, giftcards } = shop;
  const actor = (req) => req.actor?.username || req.actor?.name || 'admin';
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => {
        if (!existsSync(privateDir)) mkdirSync(privateDir, { recursive: true });
        cb(null, privateDir);
      },
      filename: (_req, file, cb) => cb(null, `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}${extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: 200 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => cb(null, PRIVATE_EXT.has(extname(file.originalname).toLowerCase())),
  });

  router.get('/shop/admin/overview', adminAuth, (_req, res) => {
    const orders = store.getAllOrders();
    const settings = db.getSettings();
    const lowStock = [];
    for (const p of store.getAllProducts()) {
      for (const v of productVariants(p)) {
        const qty = variantStockQty(p, v);
        const threshold = typeof p.lowStockAt === 'number' ? p.lowStockAt : settings.checkout.lowStockAt;
        if (typeof qty === 'number' && qty <= threshold) lowStock.push({ productId: p.id, variantId: v.id, name: p.name, variantLabel: Object.values(v.optionValues).join(' / '), qty });
      }
    }
    const now = Date.now();
    res.json({
      toFulfil: orders.filter((o) => o.number && ['paid', 'partially_refunded'].includes(o.paymentStatus) && o.fulfillment.status !== 'fulfilled' && o.status !== 'cancelled').length,
      lowStock,
      upcomingBookings: db.list('bookings').filter((b) => b.status !== 'cancelled' && Date.parse(b.start) > now && Date.parse(b.start) < now + 7 * 86_400_000).length,
      pendingReviews: db.list('reviews').filter((r) => r.status === 'pending').length,
      activeSubscriptions: db.list('subscriptions').filter((s) => ['active', 'trialing'].includes(s.status)).length,
      abandoned: shop.readCheckouts().filter((c) => c.status === 'expired').length,
    });
  });

  router.get('/shop/admin/settings', adminAuth, (_req, res) => res.json(db.getSettings()));
  router.put('/shop/admin/settings', ownerAuth, (req, res) => {
    const saved = db.saveSettings(req.body || {});
    db.audit({ action: 'settings', by: actor(req), sections: Object.keys(req.body || {}) });
    res.json(saved);
  });

  router.get('/shop/admin/discounts', adminAuth, (_req, res) => res.json(db.list('discounts')));
  router.post('/shop/admin/discounts', ownerAuth, (req, res) => {
    const d = normalizeDiscount({ ...req.body, id: newId('dc_'), usedCount: 0, usedBy: {}, createdAt: new Date().toISOString() });
    if (d.method === 'code' && !d.code) return res.status(400).json({ message: 'Rabattkoden mangler.' });
    if (d.method === 'code' && db.list('discounts').some((x) => x.code === d.code)) return res.status(409).json({ message: 'Koden finnes allerede.' });
    res.status(201).json(db.upsert('discounts', d));
  });
  router.put('/shop/admin/discounts/:id', ownerAuth, (req, res) => {
    const current = db.find('discounts', (x) => x.id === req.params.id);
    if (!current) return res.status(404).json({ message: 'Fant ikke rabatten.' });
    const next = normalizeDiscount({ ...current, ...req.body, id: current.id, usedCount: current.usedCount, usedBy: current.usedBy, createdAt: current.createdAt, updatedAt: new Date().toISOString() });
    if (next.method === 'code' && db.list('discounts').some((x) => x.id !== next.id && x.code === next.code)) return res.status(409).json({ message: 'Koden finnes allerede.' });
    res.json(db.upsert('discounts', next));
  });
  router.delete('/shop/admin/discounts/:id', ownerAuth, (req, res) => {
    res.status(db.remove('discounts', req.params.id) ? 200 : 404).json({ ok: true });
  });

  router.get('/shop/admin/giftcards', adminAuth, (_req, res) => res.json(giftcards.all().map(publicGiftcard).reverse()));
  router.post('/shop/admin/giftcards', ownerAuth, (req, res) => {
    const settings = db.getSettings();
    const amountMinor = toMinor(req.body?.amount, settings.currency);
    if (!(amountMinor > 0)) return res.status(400).json({ message: 'Beløpet må være større enn 0.' });
    const card = giftcards.issue({ amountMinor, currency: settings.currency, validityMonths: settings.giftcards.validityMonths, recipientName: clean(req.body?.recipientName, 80), recipientEmail: clean(req.body?.recipientEmail, 160), message: clean(req.body?.message, 300), by: `manuelt: ${actor(req)}`, test: settings.orders.testMode });
    db.audit({ action: 'giftcard-issue', by: actor(req), id: card.id, amountMinor });
    res.status(201).json(publicGiftcard(card));
  });
  router.put('/shop/admin/giftcards/:id', ownerAuth, (req, res) => {
    const settings = db.getSettings();
    const patch = { ...req.body };
    if (req.body?.adjust !== undefined) patch.adjustMinor = toMinor(req.body.adjust, settings.currency);
    const card = giftcards.update(req.params.id, patch);
    if (!card) return res.status(404).json({ message: 'Fant ikke gavekortet.' });
    if (balanceOf(card) < 0) {
      giftcards.update(card.id, { adjustMinor: -balanceOf(card), reason: 'korrigert til 0' });
    }
    db.audit({ action: 'giftcard-update', by: actor(req), id: card.id, patch: { active: req.body?.active, adjust: req.body?.adjust } });
    res.json(publicGiftcard(giftcards.all().find((c) => c.id === card.id)));
  });

  router.get('/shop/admin/customers', adminAuth, (req, res) => {
    const q = clean(req.query.q, 80).toLowerCase();
    const rows = db.list('customers').filter((c) => !q || `${c.email} ${c.name} ${c.phone}`.toLowerCase().includes(q));
    res.json(rows.sort((a, b) => String(b.lastOrderAt).localeCompare(String(a.lastOrderAt))));
  });
  router.get('/shop/admin/customers/:id', adminAuth, (req, res) => {
    const c = db.find('customers', (x) => x.id === req.params.id);
    if (!c) return res.status(404).json({ message: 'Fant ikke kunden.' });
    const orders = store.getAllOrders().filter((o) => o.customerEmail.toLowerCase() === c.email);
    res.json({ ...c, orders, bookings: db.list('bookings').filter((b) => b.customerEmail.toLowerCase() === c.email), subscriptions: db.list('subscriptions').filter((s) => s.email.toLowerCase() === c.email) });
  });
  router.put('/shop/admin/customers/:id', adminAuth, (req, res) => {
    const c = db.find('customers', (x) => x.id === req.params.id);
    if (!c) return res.status(404).json({ message: 'Fant ikke kunden.' });
    if (req.body?.note !== undefined) c.note = clean(req.body.note, 2000);
    if (Array.isArray(req.body?.tags)) c.tags = req.body.tags.map((t) => clean(t, 40)).filter(Boolean).slice(0, 20);
    res.json(db.upsert('customers', c));
  });

  router.get('/shop/admin/bookings', adminAuth, (req, res) => {
    const from = Date.parse(req.query.from) || Date.now() - 86_400_000;
    const to = Date.parse(req.query.to) || from + 60 * 86_400_000;
    res.json(db.list('bookings').filter((b) => Date.parse(b.start) >= from && Date.parse(b.start) <= to).sort((a, b) => a.start.localeCompare(b.start)));
  });
  router.post('/shop/admin/bookings', adminAuth, (req, res) => {
    const product = store.getProductById(clean(req.body?.productId, 80));
    if (!product || product.kind !== 'booking') return res.status(400).json({ message: 'Velg en tjeneste som kan bookes.' });
    const start = Date.parse(req.body?.start);
    if (!Number.isFinite(start)) return res.status(400).json({ message: 'Ugyldig tidspunkt.' });
    const booking = { start: new Date(start).toISOString(), end: new Date(start + product.booking.durationMinutes * 60_000).toISOString(), staffId: clean(req.body?.staffId, 60) };
    if (!req.body?.force) {
      const problem = shop.bookings.check(product, booking, Math.max(1, Number(req.body?.quantity) || 1), { anyTime: true });
      if (problem) return res.status(409).json({ message: problem });
    }
    const staff = db.getSettings().bookings.staff.find((s) => s.id === booking.staffId);
    const row = { id: newId('bk_'), ref: '', orderId: '', orderNumber: '', productId: product.id, productName: product.name, staffId: booking.staffId, staffName: staff?.name || '', start: booking.start, end: booking.end, quantity: Math.max(1, Number(req.body?.quantity) || 1), status: 'confirmed', paid: Boolean(req.body?.paid), amountMinor: 0, customerName: clean(req.body?.customerName, 120), customerEmail: clean(req.body?.customerEmail, 160).toLowerCase(), customerPhone: clean(req.body?.customerPhone, 40), note: clean(req.body?.note, 500), source: 'admin', createdAt: new Date().toISOString() };
    res.status(201).json(db.upsert('bookings', row));
  });
  router.put('/shop/admin/bookings/:id', adminAuth, (req, res) => {
    const rows = db.list('bookings');
    const row = rows.find((b) => b.id === req.params.id);
    if (!row) return res.status(404).json({ message: 'Fant ikke timen.' });
    const body = req.body || {};
    if (['confirmed', 'pending', 'cancelled', 'completed', 'no_show'].includes(body.status)) row.status = body.status;
    if (body.start && Number.isFinite(Date.parse(body.start))) {
      const product = store.getProductById(row.productId);
      const start = Date.parse(body.start);
      const booking = { start: new Date(start).toISOString(), end: new Date(start + (product?.booking.durationMinutes || 60) * 60_000).toISOString(), staffId: clean(body.staffId ?? row.staffId, 60) };
      if (product && !body.force) {
        db.save('bookings', rows.filter((b) => b.id !== row.id));
        const problem = shop.bookings.check(product, booking, row.quantity, { anyTime: true });
        db.save('bookings', rows);
        if (problem) return res.status(409).json({ message: problem });
      }
      Object.assign(row, booking);
    }
    if (body.note !== undefined) row.note = clean(body.note, 500);
    if (typeof body.paid === 'boolean') row.paid = body.paid;
    db.save('bookings', rows);
    res.json(row);
  });

  router.get('/shop/admin/subscriptions', adminAuth, (_req, res) => res.json(db.list('subscriptions').reverse()));
  router.post('/shop/admin/subscriptions/:id/cancel', ownerAuth, async (req, res) => {
    try {
      const result = await shop.cancelSubscription(req.params.id, { atPeriodEnd: req.body?.atPeriodEnd !== false, by: actor(req) });
      if (!result.ok) return res.status(result.status || 400).json({ message: result.message });
      res.json(result.subscription);
    } catch (err) {
      send(res, err);
    }
  });

  router.get('/shop/admin/reviews', adminAuth, (_req, res) => res.json(db.list('reviews').reverse()));
  router.put('/shop/admin/reviews/:id', adminAuth, (req, res) => {
    const row = db.find('reviews', (r) => r.id === req.params.id);
    if (!row) return res.status(404).json({ message: 'Fant ikke omtalen.' });
    if (['approved', 'rejected', 'pending'].includes(req.body?.status)) row.status = req.body.status;
    if (req.body?.reply !== undefined) row.reply = clean(req.body.reply, 1000);
    res.json(db.upsert('reviews', row));
  });
  router.delete('/shop/admin/reviews/:id', adminAuth, (req, res) => res.status(db.remove('reviews', req.params.id) ? 200 : 404).json({ ok: true }));

  router.get('/shop/admin/checkouts', adminAuth, (req, res) => {
    const status = clean(req.query.status, 20);
    res.json(shop.readCheckouts().filter((c) => !status || c.status === status).slice(-200).reverse().map((c) => ({ ref: c.ref, status: c.status, provider: c.provider, email: c.email, consent: c.consent, amountMinor: c.amountMinor, currency: c.currency, items: (c.priced?.lines || []).map((l) => `${l.quantity} × ${l.name}`), createdAt: c.createdAt, reminderSentAt: c.reminderSentAt || '', orderId: c.orderId || '' })));
  });

  const realOrders = () => store.getAllOrders().filter((o) => !o.test);
  router.get('/shop/admin/reports', adminAuth, (req, res) => res.json(salesReport(realOrders(), parseRange(req.query))));
  router.get('/shop/admin/reports/vat', adminAuth, (req, res) => res.json(vatReport(realOrders(), parseRange(req.query))));
  router.get('/shop/admin/reports/orders.csv', adminAuth, (req, res) => {
    res.type('text/csv').set('Content-Disposition', 'attachment; filename="ordrer.csv"').send(ordersCsv(realOrders(), parseRange(req.query)));
  });
  router.post('/shop/admin/test-data/clear', ownerAuth, (req, res) => {
    const counts = shop.clearTestData();
    db.audit({ action: 'test-data-clear', by: actor(req), ...counts });
    res.json(counts);
  });

  router.get('/shop/admin/products/export.csv', adminAuth, (_req, res) => {
    res.type('text/csv').set('Content-Disposition', 'attachment; filename="produkter.csv"').send(exportProducts(store.getAllProducts(), store.getAllCategories()));
  });
  router.post('/shop/admin/products/import', ownerAuth, express.text({ type: ['text/csv', 'text/plain'], limit: '5mb' }), (req, res) => {
    const text = typeof req.body === 'string' ? req.body : String(req.body?.csv || '');
    const dryRun = req.query.dryRun === '1' || req.body?.dryRun === true;
    const parsed = importProducts(text);
    if (!parsed.format) return res.status(400).json(parsed);
    const existing = store.getAllProducts();
    const categories = store.getAllCategories();
    let created = 0;
    let updated = 0;
    const newCategories = new Set();
    for (const row of parsed.products) {
      const match = existing.find((p) => (row.sku && p.sku === row.sku) || (row.importId && p.id === row.importId));
      if (row.category && !categories.some((c) => c.name.toLowerCase() === row.category.toLowerCase())) newCategories.add(row.category);
      if (match) updated += 1;
      else created += 1;
    }
    if (dryRun) return res.json({ format: parsed.format, created, updated, newCategories: [...newCategories], errors: parsed.errors });
    for (const name of newCategories) store.createCategory({ name });
    const cats = store.getAllCategories();
    for (const row of parsed.products) {
      const { importId, category, ...input } = row;
      input.categoryId = category ? cats.find((c) => c.name.toLowerCase() === category.toLowerCase())?.id || '' : '';
      const match = store.getAllProducts().find((p) => (row.sku && p.sku === row.sku) || (importId && p.id === importId));
      if (match) store.updateProduct(match.id, input);
      else store.createProduct(input);
    }
    db.audit({ action: 'csv-import', by: actor(req), format: parsed.format, created, updated });
    res.json({ format: parsed.format, created, updated, newCategories: [...newCategories], errors: parsed.errors });
  });

  router.get('/shop/admin/files', adminAuth, (_req, res) => {
    if (!existsSync(privateDir)) return res.json([]);
    res.json(readdirSync(privateDir).filter((f) => !f.startsWith('.')).map((f) => ({ file: f, size: statSync(join(privateDir, f)).size })));
  });
  router.post('/shop/admin/files', ownerAuth, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'Filtypen er ikke tillatt.' });
    res.status(201).json({ id: newId('f_'), file: req.file.filename, name: req.file.originalname, size: req.file.size });
  });
  router.delete('/shop/admin/files/:file', ownerAuth, (req, res) => {
    const name = clean(req.params.file, 200).replace(/[\\/]/g, '');
    const path = join(privateDir, name);
    if (!name || !existsSync(path)) return res.status(404).json({ message: 'Fant ikke filen.' });
    unlinkSync(path);
    res.json({ ok: true });
  });

  router.get('/orders/:id', adminAuth, (req, res) => {
    const order = store.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Fant ikke ordren.' });
    res.json(order);
  });
  router.post('/orders/:id/ship', adminAuth, async (req, res) => {
    try {
      res.json(await ops.ship(req.params.id, { ...req.body, by: actor(req) }));
    } catch (err) {
      send(res, err);
    }
  });
  router.post('/orders/:id/refund', ownerAuth, async (req, res) => {
    try {
      const body = req.body || {};
      const settings = db.getSettings();
      const amountMinor = body.amount !== undefined && body.amount !== '' ? toMinor(body.amount, settings.currency) : body.amountMinor;
      res.json(await ops.refund(req.params.id, { lines: body.lines || [], shipping: body.shipping, amountMinor, restock: body.restock !== false, reason: body.reason, by: actor(req) }));
    } catch (err) {
      send(res, err);
    }
  });
  router.post('/orders/:id/resend', adminAuth, async (req, res) => {
    try {
      res.json(await ops.resend(req.params.id, clean(req.body?.kind, 30) || 'order'));
    } catch (err) {
      send(res, err);
    }
  });
  router.post('/orders/:id/note', adminAuth, (req, res) => {
    const order = shop.addEvent(req.params.id, 'note', clean(req.body?.text, 500), actor(req));
    if (!order) return res.status(404).json({ message: 'Fant ikke ordren.' });
    res.json(order);
  });
  router.post('/orders/:id/cancel', adminAuth, (req, res) => {
    const order = store.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Fant ikke ordren.' });
    if (['paid', 'partially_refunded'].includes(order.paymentStatus)) return res.status(409).json({ message: 'Ordren er betalt. Refunder den i stedet.' });
    for (const id of order.bookingIds) ops.cancelBookingRow(id, 'ordre kansellert');
    res.json(store.updateOrder(order.id, { status: 'cancelled', events: [...order.events, { at: new Date().toISOString(), type: 'cancelled', text: 'Ordren er kansellert.', by: actor(req) }] }).order);
  });
  router.get('/shop/admin/audit', ownerAuth, (_req, res) => res.json(db.list('audit').slice(-200).reverse()));
}

/** Connecting/disconnecting where money is paid out is owner-only. */
export function mountPayments(router, shop, { adminAuth, ownerAuth, siteOrigin }) {
  const { hub, store } = shop;
  const fail = (res, err) => res.status(err.status || 502).json({ message: err.message, code: err.code || '' });

  router.get('/payments', adminAuth, async (_req, res) => res.json(await shop.adminPayload(true)));

  router.put('/payments', ownerAuth, async (req, res) => {
    const body = req.body || {};
    const patch = {};
    if (body.stripe && typeof body.stripe.enabled === 'boolean') patch.stripe = { enabled: body.stripe.enabled };
    if (body.paypal && typeof body.paypal.enabled === 'boolean') patch.paypal = { enabled: body.paypal.enabled };
    store.writePayments(patch);
    res.json(await shop.adminPayload(false));
  });

  router.post('/payments/stripe/connect', ownerAuth, async (req, res) => {
    try {
      const data = await hub.call('POST', '/api/hub/shop/stripe/connect', { returnUrl: `${siteOrigin(req)}/admin?payments=stripe` });
      hub.resetStatus();
      res.json({ url: data.url });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post('/payments/paypal/connect', ownerAuth, async (req, res) => {
    try {
      const data = await hub.call('POST', '/api/hub/shop/paypal/connect', { returnUrl: `${siteOrigin(req)}/admin?payments=paypal`, email: clean(req.body?.email, 160) });
      hub.resetStatus();
      res.json(data);
    } catch (err) {
      fail(res, err);
    }
  });

  router.post('/payments/disconnect', ownerAuth, async (req, res) => {
    try {
      await hub.call('POST', '/api/hub/shop/disconnect', { provider: clean(req.body?.provider, 20) });
      hub.resetStatus();
      res.json(await shop.adminPayload(true));
    } catch (err) {
      fail(res, err);
    }
  });
}
