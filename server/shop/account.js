/**
 * Customer-facing extras: magic-link accounts, "Min side", downloads, angreskjema, reviews.
 * Magic links: 256-bit token stored hashed, 15 min, single use, consumed by POST
 * (mail scanners only GET), identical answer for unknown emails, rate-limited.
 */
import express from 'express';
import { randomBytes } from 'crypto';
import { createReadStream, existsSync } from 'fs';
import { join } from 'path';
import { hashToken } from './index.js';
import { newId } from './db.js';
import { parseCookies } from './cart.js';
import { createRateLimiter, clientIp } from './storefront.js';
import { esc, layout, messagePage } from './pages.js';
import { formatMoney } from './money.js';
import { formatLocal, bookingIcs } from './bookings.js';
import { balanceOf } from './giftcards.js';
import { sellerBlock } from './documents.js';

const SESSION_COOKIE = 'asoldi_account';
const LINK_TTL_MS = 15 * 60_000;
const SESSION_TTL_MS = 30 * 86_400_000;

function clean(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Customer account routes: magic-link login, orders, downloads and subscriptions. */
export function mountAccount(router, shop, ops, { siteOrigin, privateDir }) {
  const form = express.urlencoded({ extended: false, limit: '20kb' });
  const ipLimit = createRateLimiter({ max: 5, windowMs: 15 * 60_000 });
  const emailLimit = createRateLimiter({ max: 3, windowMs: 15 * 60_000 });
  const reviewLimit = createRateLimiter({ max: 5, windowMs: 60 * 60_000 });
  const withdrawLimit = createRateLimiter({ max: 5, windowMs: 60 * 60_000 });
  const { store, db } = shop;
  const secure = (req) => siteOrigin(req).startsWith('https:');
  const page = async (opts) => messagePage({ siteName: await shop.getSiteName(), settings: db.getSettings(), ...opts });

  function session(req) {
    const raw = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!raw) return null;
    const hash = hashToken(raw);
    const rows = db.list('sessions');
    const live = rows.filter((s) => Date.parse(s.expiresAt) > Date.now());
    if (live.length !== rows.length) db.save('sessions', live);
    return live.find((s) => s.tokenHash === hash) || null;
  }

  function ordersFor(email) {
    const key = email.toLowerCase();
    return store.getAllOrders().filter((o) => o.number && o.customerEmail.toLowerCase() === key);
  }

  router.get('/account', async (req, res) => {
    shop.rememberOrigin(siteOrigin(req));
    const s = session(req);
    const settings = db.getSettings();
    const siteName = await shop.getSiteName();
    if (!s) {
      return res.type('html').send(layout({ title: 'Min side', siteName, accent: settings.checkout.accentColor, body: `<div class="card"><h1>Min side</h1><p class="muted">Skriv inn e-postadressen du handlet med. Vi sender deg en innloggingslenke.</p>
<form method="post" action="/api/cms/account/login"><label for="email">E-post</label><input id="email" type="email" name="email" required maxlength="160"><button class="btn block" type="submit">Send innloggingslenke</button></form></div>` }));
    }
    const c = settings.currency;
    const orders = ordersFor(s.email);
    const bookings = db.list('bookings').filter((b) => b.customerEmail.toLowerCase() === s.email && b.status !== 'cancelled' && Date.parse(b.end) > Date.now()).sort((a, b) => a.start.localeCompare(b.start));
    const subs = db.list('subscriptions').filter((x) => x.email.toLowerCase() === s.email);
    const cards = shop.giftcards.all().filter((g) => orders.some((o) => o.id === g.orderId));
    const downloads = db.list('downloads').filter((d) => d.email?.toLowerCase() === s.email && Date.parse(d.expiresAt) > Date.now() && d.downloadsLeft > 0);
    const body = `<div class="card"><div class="row"><h1>Min side</h1><form method="post" action="/api/cms/account/logout" style="flex:0 0 auto"><button class="btn ghost small" type="submit">Logg ut</button></form></div><p class="muted">${esc(s.email)}</p></div>
${bookings.length ? `<div class="card"><h2>Kommende timer</h2><table>${bookings.map((b) => `<tr><td>${esc(b.productName)}${b.staffName ? ` hos ${esc(b.staffName)}` : ''}<br><span class="muted small">${esc(formatLocal(b.start, settings.bookings.timezone))}${b.status === 'pending' ? ' · venter på bekreftelse' : ''}</span></td><td class="r"><a class="btn ghost small" href="/api/cms/account/bookings/${esc(b.id)}.ics">Kalender</a> <form method="post" action="/api/cms/account/bookings/${esc(b.id)}/cancel" style="display:inline" onsubmit="return confirm('Avbestille timen?')"><button class="btn ghost small" type="submit">Avbestill</button></form></td></tr>`).join('')}</table><p class="muted small">Avbestilling senest ${settings.bookings.cancelHours} timer før.</p></div>` : ''}
${subs.length ? `<div class="card"><h2>Abonnementer</h2><table>${subs.map((x) => `<tr><td>${esc(x.lines.map((l) => l.name).join(', '))}<br><span class="muted small">${esc({ active: 'Aktivt', trialing: 'Prøveperiode', past_due: 'Betaling feilet', canceled: 'Avsluttet', unpaid: 'Ubetalt' }[x.status] || x.status)}${x.cancelAtPeriodEnd ? ' · avsluttes ved periodens slutt' : ''}${x.currentPeriodEnd ? ` · neste periode ${esc(new Date(x.currentPeriodEnd).toLocaleDateString('nb-NO'))}` : ''}</span></td><td class="r">${['active', 'trialing'].includes(x.status) && !x.cancelAtPeriodEnd ? `<form method="post" action="/api/cms/account/subscriptions/${esc(x.id)}/cancel" onsubmit="return confirm('Si opp abonnementet?')"><button class="btn ghost small" type="submit">Si opp</button></form>` : ''}</td></tr>`).join('')}</table></div>` : ''}
${downloads.length ? `<div class="card"><h2>Nedlastinger</h2><p class="muted small">Lenkene finner du i kvitteringen på e-post.</p><ul>${downloads.map((d) => `<li>${esc(d.fileName)} – ${d.downloadsLeft} nedlastinger igjen, til ${esc(new Date(d.expiresAt).toLocaleDateString('nb-NO'))}</li>`).join('')}</ul></div>` : ''}
${cards.length ? `<div class="card"><h2>Gavekort du har kjøpt</h2><ul>${cards.map((g) => `<li>••••${esc(g.code.slice(-4))}: ${esc(formatMoney(balanceOf(g), g.currency))} igjen, gyldig til ${esc(new Date(g.expiresAt).toLocaleDateString('nb-NO'))}</li>`).join('')}</ul></div>` : ''}
<div class="card"><h2>Bestillinger</h2>${orders.length ? `<table>${orders.map((o) => `<tr><td><a href="/api/cms/account/orders/${esc(o.number)}">#${esc(o.number)}</a><br><span class="muted small">${esc(new Date(o.purchasedAt).toLocaleDateString('nb-NO'))} · ${esc(o.productName)}</span></td><td class="r">${esc(formatMoney(o.totalMinor, c))}</td></tr>`).join('')}</table>` : '<p class="muted">Ingen bestillinger ennå.</p>'}</div>`;
    res.type('html').send(layout({ title: 'Min side', siteName, accent: settings.checkout.accentColor, body }));
  });

  router.post('/account/login', form, async (req, res) => {
    const email = clean(req.body?.email, 160).toLowerCase();
    const answer = async () => res.type('html').send(await page({ title: 'Sjekk e-posten din', text: 'Hvis vi finner bestillinger på denne adressen, har vi sendt en innloggingslenke. Den virker i 15 minutter.' }));
    if (!EMAIL_RE.test(email)) return res.status(400).type('html').send(await page({ title: 'Ugyldig e-post', text: 'Skriv inn en gyldig e-postadresse.', ok: false }));
    if (ipLimit(clientIp(req)) || emailLimit(email)) return answer();
    const known = ordersFor(email).length > 0 || db.list('bookings').some((b) => b.customerEmail.toLowerCase() === email);
    if (!known) return answer();
    const token = randomBytes(32).toString('base64url');
    const rows = db.list('loginTokens').filter((t) => Date.parse(t.expiresAt) > Date.now() && !t.usedAt);
    rows.push({ id: newId('lt_'), email, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + LINK_TTL_MS).toISOString(), createdAt: new Date().toISOString() });
    db.save('loginTokens', rows.slice(-500));
    try {
      const siteName = await shop.getSiteName();
      await shop.hub.call('POST', '/api/hub/shop/document', { to: email, document: { kind: 'magic-link', siteName, seller: sellerBlock(db.getSettings(), siteName), siteUrl: siteOrigin(req), link: `${siteOrigin(req)}/api/cms/account/verify?token=${token}` } });
    } catch {
      /* same answer either way; never reveal whether the address exists */
    }
    return answer();
  });

  router.get('/account/verify', async (req, res) => {
    const token = clean(req.query.token, 100);
    res.set('Referrer-Policy', 'no-referrer');
    res.type('html').send(await page({ title: 'Logg inn', text: '', html: `<form method="post" action="/api/cms/account/verify"><input type="hidden" name="token" value="${esc(token)}"><button class="btn" type="submit">Logg inn på Min side</button></form>` }));
  });

  router.post('/account/verify', form, async (req, res) => {
    const hash = hashToken(clean(req.body?.token, 100));
    const rows = db.list('loginTokens');
    const row = rows.find((t) => t.tokenHash === hash);
    if (!row || row.usedAt || Date.parse(row.expiresAt) < Date.now()) {
      return res.status(401).type('html').send(await page({ title: 'Lenken er utløpt', text: 'Be om en ny innloggingslenke.', ok: false, html: '<p><a class="btn" href="/api/cms/account">Ny lenke</a></p>' }));
    }
    row.usedAt = new Date().toISOString();
    db.save('loginTokens', rows);
    const token = randomBytes(32).toString('base64url');
    const sessions = db.list('sessions').filter((s) => Date.parse(s.expiresAt) > Date.now());
    sessions.push({ id: newId('ses_'), email: row.email, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(), createdAt: new Date().toISOString() });
    db.save('sessions', sessions.slice(-2000));
    res.append('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; SameSite=Lax${secure(req) ? '; Secure' : ''}`);
    res.redirect(303, '/api/cms/account');
  });

  router.post('/account/logout', form, (req, res) => {
    const s = session(req);
    if (s) db.remove('sessions', s.id);
    res.append('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secure(req) ? '; Secure' : ''}`);
    res.redirect(303, '/api/cms/account');
  });

  router.get('/account/orders/:number', async (req, res) => {
    const s = session(req);
    if (!s) return res.redirect(303, '/api/cms/account');
    const order = ordersFor(s.email).find((o) => o.number === clean(req.params.number, 30));
    if (!order) return res.status(404).type('html').send(await page({ title: 'Fant ikke bestillingen', text: '', ok: false }));
    const c = order.currency.toLowerCase();
    const settings = db.getSettings();
    const body = `<div class="card"><h1>Bestilling #${esc(order.number)}</h1><p class="muted">${esc(new Date(order.purchasedAt).toLocaleString('nb-NO'))} · ${esc({ new: 'Mottatt', confirmed: 'Bekreftet', packed: 'Pakkes', shipped: 'Sendt', completed: 'Fullført', cancelled: 'Kansellert' }[order.status] || order.status)}</p>
<table>${order.lines.map((l) => `<tr><td>${l.quantity} × ${esc(l.name)}${l.variantLabel ? ` – ${esc(l.variantLabel)}` : ''}${l.refundedQty ? ` <span class="muted small">(${l.refundedQty} refundert)</span>` : ''}</td><td class="r">${esc(formatMoney(l.lineTotalMinor, c))}</td></tr>`).join('')}
${order.shippingMinor ? `<tr><td>Frakt</td><td class="r">${esc(formatMoney(order.shippingMinor, c))}</td></tr>` : ''}<tr><td><strong>Totalt</strong></td><td class="r"><strong>${esc(formatMoney(order.totalMinor, c))}</strong></td></tr>
${order.refundedMinor ? `<tr><td>Refundert</td><td class="r">−${esc(formatMoney(order.refundedMinor, c))}</td></tr>` : ''}</table>
${order.fulfillment.shipments.map((sh) => `<p>Sendt ${esc(new Date(sh.at).toLocaleDateString('nb-NO'))}${sh.carrier ? ` med ${esc(sh.carrier)}` : ''}${sh.trackingUrl ? ` – <a href="${esc(sh.trackingUrl)}" target="_blank" rel="noopener">spor pakken</a>` : sh.trackingNumber ? ` (${esc(sh.trackingNumber)})` : ''}</p>`).join('')}
<p class="muted small">Ombestemt deg? <a href="/api/cms/angreskjema?order=${esc(order.number)}">Angreskjema</a></p><p><a href="/api/cms/account">← Min side</a></p></div>`;
    res.type('html').send(layout({ title: `Bestilling ${order.number}`, siteName: await shop.getSiteName(), accent: settings.checkout.accentColor, body }));
  });

  router.get('/account/bookings/:id.ics', (req, res) => {
    const s = session(req);
    const b = s && db.find('bookings', (x) => x.id === clean(req.params.id, 60) && x.customerEmail.toLowerCase() === s.email);
    if (!b) return res.status(404).send('Not found');
    const settings = db.getSettings();
    res.type('text/calendar').set('Content-Disposition', `attachment; filename="time-${b.id}.ics"`).send(bookingIcs({ id: b.id, start: b.start, end: b.end, title: b.productName, location: settings.bookings.location || settings.seller.address, host: new URL(siteOrigin(req)).host }));
  });

  router.post('/account/bookings/:id/cancel', form, async (req, res) => {
    const s = session(req);
    if (!s) return res.redirect(303, '/api/cms/account');
    try {
      await ops.cancelBookingByCustomer(clean(req.params.id, 60), s.email);
      res.type('html').send(await page({ title: 'Timen er avbestilt', text: 'Du får bekreftelse på e-post. Er timen betalt, refunderes beløpet til samme betalingsmåte.', html: '<p><a href="/api/cms/account">← Min side</a></p>' }));
    } catch (err) {
      res.status(err.status || 500).type('html').send(await page({ title: 'Kunne ikke avbestille', text: err.message, ok: false, html: '<p><a href="/api/cms/account">← Min side</a></p>' }));
    }
  });

  router.post('/account/subscriptions/:id/cancel', form, async (req, res) => {
    const s = session(req);
    if (!s) return res.redirect(303, '/api/cms/account');
    const sub = db.find('subscriptions', (x) => x.id === clean(req.params.id, 60) && x.email.toLowerCase() === s.email);
    if (!sub) return res.status(404).type('html').send(await page({ title: 'Fant ikke abonnementet', text: '', ok: false }));
    try {
      const result = await shop.cancelSubscription(sub.id, { atPeriodEnd: true, by: 'kunde' });
      if (!result.ok) throw Object.assign(new Error(result.message), { status: result.status });
      void shop.notifyOwner(null, { message: `Abonnement sagt opp av kunden: ${sub.lines.map((l) => l.name).join(', ')} (${sub.email})` }).catch(() => {});
      res.type('html').send(await page({ title: 'Abonnementet er sagt opp', text: 'Det avsluttes ved slutten av perioden du har betalt for.', html: '<p><a href="/api/cms/account">← Min side</a></p>' }));
    } catch (err) {
      res.status(err.status || 502).type('html').send(await page({ title: 'Kunne ikke si opp', text: err.message, ok: false }));
    }
  });

  router.get('/downloads/:token', async (req, res) => {
    const hash = hashToken(clean(req.params.token, 100));
    const rows = db.list('downloads');
    const grant = rows.find((d) => d.tokenHash === hash);
    if (!grant || Date.parse(grant.expiresAt) < Date.now() || grant.downloadsLeft <= 0) {
      return res.status(410).type('html').send(await page({ title: 'Lenken er utløpt', text: 'Ta kontakt med butikken hvis du trenger filen på nytt.', ok: false }));
    }
    const product = store.getProductById(grant.productId);
    const file = product?.digitalFiles.find((f) => f.id === grant.fileId);
    const path = file ? join(privateDir, file.file) : '';
    if (!file || !existsSync(path)) return res.status(404).type('html').send(await page({ title: 'Filen finnes ikke lenger', text: 'Ta kontakt med butikken.', ok: false }));
    grant.downloadsLeft -= 1;
    db.save('downloads', rows);
    res.set({ 'Content-Disposition': `attachment; filename="${encodeURIComponent(file.name || file.file)}"`, 'Cache-Control': 'no-store' });
    createReadStream(path).pipe(res);
  });

  router.get('/angreskjema', async (req, res) => {
    const settings = db.getSettings();
    const seller = settings.seller;
    const body = `<div class="card"><h1>Angreskjema</h1><p class="muted small">Fyll ut og send dette skjemaet dersom du ønsker å gå fra avtalen (angrerettloven). Du får bekreftelse på e-post.</p>
<p class="small">Til: ${esc(seller.legalName || (await shop.getSiteName()))}${seller.address ? `, ${esc(seller.address)} ${esc(seller.postal)} ${esc(seller.city)}` : ''}${seller.email ? `, ${esc(seller.email)}` : ''}</p>
<form method="post" action="/api/cms/angreskjema"><label for="order">Ordrenummer</label><input id="order" name="order" value="${esc(clean(req.query.order, 30))}" maxlength="30" required>
<label for="email">E-post du bestilte med</label><input id="email" type="email" name="email" maxlength="160" required><label for="name">Navn</label><input id="name" name="name" maxlength="120" required>
<label for="text">Jeg/vi meddeler herved at jeg/vi ønsker å gå fra min/vår avtale om kjøp av følgende varer/tjenester:</label><textarea id="text" name="text" maxlength="2000" required></textarea>
<label for="received">Bestilt dato / mottatt dato</label><input id="received" name="received" maxlength="60">
<button class="btn block" type="submit">Send angreskjema</button></form></div>`;
    res.type('html').send(layout({ title: 'Angreskjema', siteName: await shop.getSiteName(), accent: settings.checkout.accentColor, body }));
  });

  router.post('/angreskjema', form, async (req, res) => {
    if (withdrawLimit(clientIp(req))) return res.status(429).type('html').send(await page({ title: 'For mange forsøk', text: 'Prøv igjen senere, eller send oss en e-post.', ok: false }));
    const b = req.body || {};
    if (!EMAIL_RE.test(clean(b.email, 160)) || !clean(b.text, 2000)) return res.status(400).type('html').send(await page({ title: 'Mangler opplysninger', text: 'Fyll inn e-post og hva du vil returnere.', ok: false }));
    const result = await ops.withdraw({ orderNumber: clean(b.order, 30), email: clean(b.email, 160), name: clean(b.name, 120), text: `${clean(b.text, 2000)}${b.received ? ` (dato: ${clean(b.received, 60)})` : ''}`, ip: clientIp(req) });
    res.type('html').send(await page({ title: 'Angreskjemaet er mottatt', text: result.matched ? 'Vi har sendt deg en bekreftelse på e-post. Butikken tar kontakt om retur og tilbakebetaling.' : 'Butikken har mottatt meldingen og tar kontakt. Fant vi ikke ordrenummeret, svarer butikken deg direkte.' }));
  });

  router.post('/reviews', form, async (req, res) => {
    const b = req.body || {};
    const product = store.getProductById(clean(b.productId || b.product, 80));
    const back = product ? `/api/cms/shop/product/${encodeURIComponent(product.id)}` : '/';
    const json = clean(req.get('content-type')).includes('application/json');
    const reply = async (status, title, text) => (json ? res.status(status).json({ ok: status < 300, message: text }) : res.status(status).type('html').send(await page({ title, text, ok: status < 300, html: `<p><a href="${esc(back)}">← Tilbake til produktet</a></p>` })));
    if (!product || !product.reviewsEnabled) return reply(404, 'Fant ikke produktet', 'Omtaler er ikke åpne for dette produktet.');
    if (reviewLimit(clientIp(req))) return reply(429, 'For mange omtaler', 'Prøv igjen senere.');
    const rating = Math.round(Number(b.rating));
    const email = clean(b.email, 160).toLowerCase();
    if (!(rating >= 1 && rating <= 5) || !clean(b.name, 80) || !clean(b.text, 2000) || !EMAIL_RE.test(email)) return reply(400, 'Mangler opplysninger', 'Fyll inn vurdering, navn, e-post og tekst.');
    const verified = store.getAllOrders().some((o) => o.customerEmail.toLowerCase() === email && ['paid', 'partially_refunded'].includes(o.paymentStatus) && o.lines.some((l) => l.productId === product.id));
    db.upsert('reviews', { id: newId('rv_'), productId: product.id, productName: product.name, rating, name: clean(b.name, 80), email, text: clean(b.text, 2000), verified, status: 'pending', reply: '', createdAt: new Date().toISOString() });
    return reply(201, 'Takk for omtalen!', 'Omtalen publiseres når butikken har godkjent den.');
  });
}
