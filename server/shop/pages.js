/**
 * Server-rendered storefront pages (work without JavaScript). Norwegian copy.
 * Angrerettloven §8: seller identity, total incl. MVA and delivery, payment, delivery
 * time and withdrawal info + form are shown before the order button.
 */
import { formatMoney } from './money.js';
import { formatLocal } from './bookings.js';
import { productVariants, variantLabel, variantPricing, variantStockQty } from './product.js';

/** HTML-escape a value. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

function money(minor, currency) {
  return esc(formatMoney(minor, currency));
}

function major(value, currency) {
  return money(Math.round(Number(value) * (currency === 'jpy' ? 1 : 100)), currency);
}

const INTERVALS = { day: 'dag', week: 'uke', month: 'måned', year: 'år' };
const TEST_BANNER = '<div class="err"><strong>Testmodus:</strong> bestillinger her er bare tester og blir ikke levert.</div>';

/** Page shell for the storefront pages. */
export function layout({ title, body, siteName, accent = '#111827', cartCount = 0, head = '' }) {
  return `<!doctype html><html lang="nb"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} – ${esc(siteName || 'Butikk')}</title>${head}
<style>
:root{--a:${esc(accent)}}*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f6f4;color:#1b1b1b;line-height:1.45}
header{background:#fff;border-bottom:1px solid #e4e4e0}header .in{max-width:960px;margin:0 auto;padding:12px 16px;display:flex;justify-content:space-between;align-items:center}
header a{color:inherit;text-decoration:none;font-weight:600}.cartlink{border:1px solid #ddd;border-radius:999px;padding:6px 12px;font-size:.92rem}
main{max-width:960px;margin:24px auto;padding:0 16px}.card{background:#fff;border:1px solid #e4e4e0;border-radius:14px;padding:20px;margin-bottom:16px}
.grid{display:grid;gap:20px;grid-template-columns:1fr}@media(min-width:800px){.grid{grid-template-columns:1.1fr .9fr}}
h1{font-size:1.45rem;margin:0 0 6px}h2{font-size:1.1rem;margin:0 0 10px}.muted{color:#666;font-size:.92rem}.small{font-size:.84rem}
.price{font-size:1.3rem;font-weight:700;margin:10px 0}.was{text-decoration:line-through;color:#888;font-weight:400;font-size:1rem;margin-left:8px}.sale{color:#b42318}
img.hero{width:100%;border-radius:12px}label{display:block;margin:12px 0 6px;font-weight:600;font-size:.92rem}
input,select,textarea{width:100%;padding:10px;border:1px solid #ccc;border-radius:8px;font:inherit;background:#fff}textarea{min-height:70px}
input[type=checkbox],input[type=radio]{width:auto;margin-right:8px}.check{display:flex;align-items:flex-start;font-weight:400;margin:8px 0}
.btn{display:inline-block;border:0;border-radius:10px;padding:12px 16px;font-size:1rem;font-weight:600;cursor:pointer;background:var(--a);color:#fff;text-decoration:none;text-align:center}
.btn.block{display:block;width:100%;margin-top:10px}.btn.ghost{background:#fff;color:#1b1b1b;border:1px solid #ccc}.btn.small{padding:6px 10px;font-size:.85rem}
.btn.stripe{background:#635bff}.btn.paypal{background:#ffc439;color:#111}.err{background:#fde8e8;color:#8a1c1c;padding:10px 12px;border-radius:8px;margin:0 0 12px}
.ok{background:#e7f6ec;color:#14532d;padding:10px 12px;border-radius:8px;margin:0 0 12px}table{width:100%;border-collapse:collapse}td,th{padding:8px 4px;border-bottom:1px solid #eee;text-align:left;vertical-align:top}
td.r,th.r{text-align:right;white-space:nowrap}.row{display:flex;gap:8px;align-items:center}.row>*{flex:1}.slots{display:flex;flex-wrap:wrap;gap:8px}.slots label{flex:0 0 auto;margin:0;border:1px solid #ccc;border-radius:8px;padding:8px 10px;font-weight:500}
.tot td{border:0;padding:4px}.tot .big td{font-size:1.15rem;font-weight:700;border-top:1px solid #ddd;padding-top:8px}.seller{font-size:.84rem;color:#555}
.stars{color:#c58b00}.review{border-top:1px solid #eee;padding:10px 0}a{color:var(--a)}
</style></head><body><header><div class="in"><a href="/">${esc(siteName || 'Butikk')}</a><a class="cartlink" href="/api/cms/cart">Handlekurv${cartCount ? ` (${cartCount})` : ''}</a></div></header><main>${body}</main></body></html>`;
}

function errorList(errors) {
  return (errors || []).map((e) => `<div class="err">${esc(e.message || e)}</div>`).join('');
}

function priceBlock(product, variant, currency, now) {
  const p = variantPricing(product, variant, now);
  if (p.price == null) return '';
  const suffix = product.kind === 'subscription' ? ` / ${INTERVALS[product.subscription.interval] || 'måned'}` : '';
  if (!p.onSale) return `<p class="price">${major(p.price, currency)}${suffix}</p>`;
  return `<p class="price sale">${major(p.price, currency)}${suffix}<span class="was">${major(p.regular, currency)}</span></p><p class="muted small">Førpris (laveste pris siste 30 dager): ${major(p.beforePrice, currency)}${product.saleTo ? ` · Tilbudet varer til ${esc(new Date(product.saleTo).toLocaleDateString('nb-NO'))}` : ''}</p>`;
}

/** Product page with variants, booking slots, reviews and add to cart. */
export function productPage({ product, settings, providers, siteName, cartCount, error = '', variantId = '', date = '', slots = null, reviews = [], rating = null, jsonLd = null, now = Date.now() }) {
  const currency = settings.currency;
  const accent = settings.checkout.accentColor;
  if (!product) return layout({ title: 'Fant ikke produktet', siteName, accent, cartCount, body: '<div class="card"><h1>Fant ikke produktet</h1><p class="muted">Produktet finnes ikke lenger.</p></div>' });
  const variants = productVariants(product);
  const chosen = variants.find((v) => v.id === variantId) || variants[0];
  const head = jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : '';
  let buy;
  if (product.contactInsteadOfPrice || typeof product.price === 'string') {
    buy = '<p class="muted">Ta kontakt for å bestille dette produktet.</p>';
  } else if (!providers.length && !(product.kind === 'booking' && settings.bookings.payMode !== 'prepay')) {
    buy = '<p class="muted">Nettbestilling er ikke satt opp ennå. Ta kontakt for å bestille.</p>';
  } else {
    const fields = [];
    if (product.variants?.length) {
      fields.push(`<label for="variant">${esc(product.options.map((o) => o.name).join(' / '))}</label><select id="variant" name="variant" required>${variants
        .map((v) => {
          const p = variantPricing(product, v, now);
          const qty = variantStockQty(product, v);
          const out = product.backorders !== 'yes' && typeof qty === 'number' && qty <= 0;
          return `<option value="${esc(v.id)}"${v.id === chosen.id ? ' selected' : ''}${out ? ' disabled' : ''}>${esc(variantLabel(v))} – ${major(p.price, currency)}${out ? ' (utsolgt)' : ''}</option>`;
        })
        .join('')}</select>`);
    }
    if (product.kind === 'giftcard') {
      const amounts = product.giftcard.amounts;
      fields.push(`<label for="gcamount">Beløp</label><select id="gcamount" name="giftcardAmount">${amounts.map((a) => `<option value="${a}">${major(a, currency)}</option>`).join('')}${product.giftcard.allowCustom ? '<option value="custom">Valgfritt beløp</option>' : ''}</select>`);
      if (product.giftcard.allowCustom) fields.push(`<label for="gccustom">Valgfritt beløp (${esc(product.giftcard.min)}–${esc(product.giftcard.max)})</label><input id="gccustom" name="giftcardCustom" inputmode="decimal">`);
      fields.push('<label for="gcname">Til (navn, valgfritt)</label><input id="gcname" name="recipientName" maxlength="80"><label for="gcemail">Mottakers e-post (valgfritt)</label><input id="gcemail" type="email" name="recipientEmail" maxlength="160"><label for="gcmsg">Hilsen (valgfritt)</label><textarea id="gcmsg" name="giftcardMessage" maxlength="300"></textarea>');
    }
    if (product.kind === 'booking') {
      const staff = settings.bookings.staff.filter((s) => s.active && (!product.booking.staffIds.length || product.booking.staffIds.includes(s.id)));
      const slotHtml = slots === null
        ? '<p class="muted">Velg en dato for å se ledige tider.</p>'
        : slots.length
          ? `<div class="slots">${slots.map((s, i) => `<label><input type="radio" name="slot" value="${esc(s.start)}"${i === 0 ? ' required' : ''}> ${esc(s.time)}</label>`).join('')}</div>`
          : '<p class="muted">Ingen ledige tider denne dagen.</p>';
      fields.push(`<label for="date">Dato</label><input id="date" type="date" name="date" value="${esc(date)}" onchange="var u=new URL(location.href);u.searchParams.set('date',this.value);location.href=u"><noscript><button class="btn ghost small" formaction="" formmethod="get">Vis tider</button></noscript>`);
      fields.push(`<label>Ledige tider${product.booking.durationMinutes ? ` (${product.booking.durationMinutes} min)` : ''}</label>${slotHtml}`);
      if (staff.length > 1) fields.push(`<label for="staff">Behandler</label><select id="staff" name="staffId"><option value="">Første ledige</option>${staff.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select>`);
    }
    if (product.kind !== 'giftcard' && product.kind !== 'subscription' && !(product.kind === 'booking' && product.booking.capacity <= 1)) {
      const qty = variantStockQty(product, chosen);
      const max = Math.min(settings.checkout.maxQuantity, product.maxPerOrder || Infinity, product.backorders !== 'yes' && typeof qty === 'number' ? Math.max(1, qty) : Infinity);
      fields.push(`<label for="qty">${product.kind === 'booking' ? 'Antall plasser' : 'Antall'}</label><input id="qty" type="number" name="quantity" min="1" max="${max}" value="1" required>`);
    }
    const extras = (product.extraOptions || []).filter((o) => String(o.price ?? '').trim() !== '' && !Number.isNaN(Number(String(o.price).replace(',', '.'))));
    if (extras.length) fields.push(`<label>Tillegg</label>${extras.map((o) => `<label class="check"><input type="checkbox" name="extras" value="${esc(o.name)}"> ${esc(o.name)} (+${major(Number(String(o.price).replace(',', '.')), currency)})</label>`).join('')}`);
    const canBuy = product.kind !== 'booking' || (slots && slots.length);
    buy = `<form method="post" action="/api/cms/cart/add"><input type="hidden" name="product" value="${esc(product.id)}">${fields.join('')}
<button class="btn block" type="submit"${canBuy ? '' : ' disabled'}>${product.kind === 'booking' ? 'Velg time' : 'Legg i handlekurven'}</button></form>`;
  }
  const reviewHtml = product.reviewsEnabled
    ? `<div class="card"><h2>Omtaler${rating && rating.count ? ` <span class="stars">${'★'.repeat(Math.round(rating.average))}</span> <span class="muted small">${rating.average.toFixed(1)} av 5 (${rating.count})</span>` : ''}</h2>
${reviews.map((r) => `<div class="review"><span class="stars">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span> <strong>${esc(r.name)}</strong>${r.verified ? ' <span class="muted small">Verifisert kjøp</span>' : ''}<p>${esc(r.text)}</p>${r.reply ? `<p class="muted small">Svar fra butikken: ${esc(r.reply)}</p>` : ''}</div>`).join('') || '<p class="muted">Ingen omtaler ennå.</p>'}
<details><summary>Skriv en omtale</summary><form method="post" action="/api/cms/reviews"><input type="hidden" name="product" value="${esc(product.id)}">
<label for="rv-r">Vurdering</label><select id="rv-r" name="rating">${[5, 4, 3, 2, 1].map((n) => `<option value="${n}">${n} ★</option>`).join('')}</select>
<label for="rv-n">Navn</label><input id="rv-n" name="name" maxlength="80" required><label for="rv-e">E-post (vises ikke)</label><input id="rv-e" type="email" name="email" maxlength="160" required>
<label for="rv-t">Omtale</label><textarea id="rv-t" name="text" maxlength="2000" required></textarea><p class="muted small">Omtaler publiseres etter at butikken har godkjent dem.</p><button class="btn" type="submit">Send omtale</button></form></details></div>`
    : '';
  const body = `${settings.orders.testMode ? TEST_BANNER : ''}${error ? `<div class="err">${esc(error)}</div>` : ''}<div class="grid"><div>${product.imageUrl ? `<img class="hero" src="${esc(chosen.imageUrl || product.imageUrl)}" alt="${esc(product.name)}">` : ''}</div>
<div><div class="card"><h1>${esc(product.name)}</h1>${product.subtitle ? `<p class="muted">${esc(product.subtitle)}</p>` : ''}
${product.kind === 'giftcard' ? '' : priceBlock(product, chosen, currency, now)}
${product.kind === 'subscription' && product.subscription.trialDays ? `<p class="muted">${product.subscription.trialDays} dager gratis prøveperiode. Kan sies opp når som helst.</p>` : product.kind === 'subscription' ? '<p class="muted">Fornyes automatisk. Kan sies opp når som helst.</p>' : ''}
${buy}
${product.description ? `<p>${esc(product.description)}</p>` : ''}
${product.included?.length ? `<ul>${product.included.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
${product.allergens ? `<p class="muted small">Allergener: ${esc(product.allergens)}</p>` : ''}
<p class="muted small">Alle priser inkluderer merverdiavgift.</p></div></div></div>${reviewHtml}`;
  return layout({ title: product.name, siteName, accent, cartCount, body, head });
}

function lineName(line) {
  let s = esc(line.name);
  if (line.variantLabel) s += ` <span class="muted">– ${esc(line.variantLabel)}</span>`;
  if (line.extras?.length) s += `<br><span class="muted small">${esc(line.extras.join(', '))}</span>`;
  if (line.booking) s += `<br><span class="muted small">${esc(formatLocal(line.booking.start))}</span>`;
  if (line.giftcard?.recipientName) s += `<br><span class="muted small">Til ${esc(line.giftcard.recipientName)}</span>`;
  if (line.recurring) s += `<br><span class="muted small">Fornyes hver ${esc(INTERVALS[line.recurring.interval] || 'måned')}</span>`;
  return s;
}

/** Subtotal, discounts, shipping, MVA and total rows. */
export function totalsTable(priced) {
  const c = priced.currency;
  const rows = [`<tr><td>Delsum</td><td class="r">${money(priced.subtotalMinor, c)}</td></tr>`];
  for (const d of priced.discounts) if (d.amountMinor) rows.push(`<tr><td>Rabatt: ${esc(d.title || d.code)}</td><td class="r">−${money(d.amountMinor, c)}</td></tr>`);
  if (priced.shipping.required) rows.push(`<tr><td>Frakt${priced.shipping.method ? `: ${esc(priced.shipping.method.name)}` : ''}</td><td class="r">${priced.shipping.amountMinor ? money(priced.shipping.amountMinor, c) : 'Gratis'}</td></tr>`);
  rows.push(`<tr class="big"><td>Totalt</td><td class="r">${money(priced.totalMinor, c)}</td></tr>`);
  for (const t of priced.taxLines) if (t.taxMinor) rows.push(`<tr><td class="muted small">Herav MVA ${esc(t.rate)} %</td><td class="r muted small">${money(t.taxMinor, c)}</td></tr>`);
  for (const g of priced.giftcardPayments) rows.push(`<tr><td>Gavekort ••••${esc(g.last4)}</td><td class="r">−${money(g.amountMinor, c)}</td></tr>`);
  if (priced.giftcardPayments.length || priced.trialDays) rows.push(`<tr class="big"><td>Å betale nå</td><td class="r">${money(priced.amountDueMinor, c)}</td></tr>`);
  return `<table class="tot">${rows.join('')}</table>`;
}

/** Cart and checkout page with the legal seller details. */
export function cartPage({ priced, cart, settings, providers, siteName, cartCount, errors = [], notice = '', seller }) {
  const c = settings.currency;
  const accent = settings.checkout.accentColor;
  if (!priced.lines.length) {
    return layout({ title: 'Handlekurv', siteName, accent, cartCount, body: `${errorList(errors)}<div class="card"><h1>Handlekurven er tom</h1><p class="muted">Legg til produkter for å bestille.</p><a class="btn" href="/">Fortsett å handle</a></div>` });
  }
  const linesHtml = priced.lines
    .map((l) => `<tr><td>${lineName(l)}</td><td class="r"><form method="post" action="/api/cms/cart/update" class="row" style="justify-content:flex-end"><input type="hidden" name="key" value="${esc(l.key)}"><input type="number" name="quantity" min="0" value="${l.quantity}" style="width:70px;flex:0 0 70px"${l.booking || l.giftcard || l.recurring ? ' readonly' : ''}><button class="btn ghost small" type="submit">Oppdater</button></form></td>
<td class="r">${l.discountMinor ? `<span class="was" style="margin:0">${money(l.lineGrossMinor, c)}</span><br>` : ''}${money(l.lineTotalMinor, c)}</td>
<td class="r"><form method="post" action="/api/cms/cart/remove"><input type="hidden" name="key" value="${esc(l.key)}"><button class="btn ghost small" type="submit" aria-label="Fjern">✕</button></form></td></tr>`)
    .join('');
  const codes = priced.appliedCodes.map((code) => `<form method="post" action="/api/cms/cart/code/remove" style="display:inline"><input type="hidden" name="code" value="${esc(code)}"><button class="btn ghost small" type="submit">${esc(code)} ✕</button></form>`).join(' ');
  const cards = priced.giftcardPayments.map((g) => `<form method="post" action="/api/cms/cart/giftcard/remove" style="display:inline"><input type="hidden" name="code" value="${esc(g.code)}"><button class="btn ghost small" type="submit">Gavekort ••••${esc(g.last4)} ✕</button></form>`).join(' ');
  const ship = priced.shipping;
  const countryNames = new Intl.DisplayNames(['nb'], { type: 'region' });
  const shipHtml = ship.required
    ? `<div class="card"><h2>Levering</h2><form method="post" action="/api/cms/cart/options"><label for="country">Land</label><select id="country" name="country" onchange="this.form.submit()">${ship.countries
        .filter((cc) => cc !== '*')
        .map((cc) => `<option value="${esc(cc)}"${cc === priced.country ? ' selected' : ''}>${esc(countryNames.of(cc) || cc)}</option>`)
        .join('')}${ship.countries.includes('*') ? `<option value="${esc(priced.country)}" selected>${esc(countryNames.of(priced.country) || priced.country)}</option>` : ''}</select>
${ship.methods.length ? `<label>Fraktmåte</label>${ship.methods.map((m) => `<label class="check"><input type="radio" name="method" value="${esc(m.id)}"${ship.method?.id === m.id ? ' checked' : ''} onchange="this.form.submit()"> <span>${esc(m.name)} – ${m.amountMinor ? money(m.amountMinor, c) : 'Gratis'}${m.estimateMaxDays ? ` <span class="muted small">(${m.estimateMinDays || 1}–${m.estimateMaxDays} virkedager)</span>` : ''}${m.pickupAddress ? `<br><span class="muted small">${esc(m.pickupAddress)}</span>` : ''}</span></label>`).join('')}` : '<p class="err">Vi sender ikke til dette landet.</p>'}
<noscript><button class="btn ghost small" type="submit">Oppdater frakt</button></noscript></form></div>`
    : '';
  const zeroToPay = priced.amountDueMinor <= 0 && !priced.trialDays && priced.giftcardPayments.length > 0;
  const onlyBookings = priced.lines.every((l) => l.booking);
  const reserveOk = onlyBookings && settings.bookings.payMode !== 'prepay';
  const prepayOk = !(onlyBookings && settings.bookings.payMode === 'reserve');
  const usable = providers.filter((p) => !(priced.requiresStripe && p !== 'stripe'));
  const buttonText = settings.checkout.buttonText;
  const buttons = [];
  if (zeroToPay) buttons.push(`<button class="btn block" type="submit" name="provider" value="giftcard">${esc(buttonText)}</button>`);
  else {
    if (prepayOk && usable.includes('stripe')) buttons.push(`<button class="btn block stripe" type="submit" name="provider" value="stripe">${esc(buttonText)} – kort${priced.mode === 'subscription' ? ' (abonnement)' : ''}</button>`);
    if (prepayOk && usable.includes('paypal')) buttons.push(`<button class="btn block paypal" type="submit" name="provider" value="paypal">${esc(buttonText)} – PayPal</button>`);
    if (reserveOk) buttons.push(`<button class="btn block ghost" type="submit" name="provider" value="reserve">Reserver time (betal ved oppmøte)</button>`);
  }
  const needsEmail = zeroToPay || reserveOk;
  const needsAddress = zeroToPay && ship.required && ship.method?.type !== 'pickup';
  const checkout = priced.ok && buttons.length
    ? `<form method="post" action="/api/cms/checkout">
<label for="email">E-post${needsEmail ? '' : ' (valgfritt – fylles ellers inn på betalingssiden)'}</label><input id="email" type="email" name="email" value="${esc(cart.email)}" maxlength="160"${needsEmail ? ' required' : ''}>
${reserveOk || needsAddress ? `<label for="name">Navn</label><input id="name" name="name" maxlength="120"${needsAddress ? ' required' : ''}>` : ''}
${reserveOk ? '<label for="phone">Telefon</label><input id="phone" name="phone" maxlength="40">' : ''}
${needsAddress ? '<label for="line">Leveringsadresse</label><input id="line" name="line" maxlength="160" autocomplete="street-address" required><label for="postal">Postnummer</label><input id="postal" name="postal" maxlength="12" autocomplete="postal-code" required><label for="city">Sted</label><input id="city" name="city" maxlength="80" autocomplete="address-level2" required>' : ''}
<label for="note">Melding til butikken (valgfritt)</label><textarea id="note" name="note" maxlength="500">${esc(cart.note)}</textarea>
${settings.checkout.reminderConsent ? `<label class="check"><input type="checkbox" name="consent" value="1"${cart.consent ? ' checked' : ''}> <span class="small">${esc(settings.checkout.reminderText)}</span></label>` : ''}
<div class="card" style="background:#fafaf8;margin:12px 0 0"><p class="small">${esc(settings.checkout.termsText)}${settings.checkout.termsUrl ? ` <a href="${esc(settings.checkout.termsUrl)}" target="_blank" rel="noopener">Les salgsbetingelsene</a>` : ''}</p>
<p class="small"><strong>Angrerett:</strong> ${esc(settings.checkout.withdrawalText)} <a href="/api/cms/angreskjema" target="_blank" rel="noopener">Angreskjema</a></p>
<label class="check"><input type="checkbox" name="terms" value="1" required> <span class="small">Jeg har lest og godtar salgsbetingelsene og informasjonen om angrerett.</span></label></div>
${buttons.join('')}</form>`
    : !priced.ok
      ? '<p class="err">Rett opp feilene over før du bestiller.</p>'
      : '<p class="muted">Nettbetaling er ikke satt opp ennå. Ta kontakt for å bestille.</p>';
  const body = `${settings.orders.testMode ? TEST_BANNER : ''}${notice ? `<div class="ok">${esc(notice)}</div>` : ''}${errorList(errors)}
<div class="grid"><div><div class="card"><h1>Handlekurv</h1><table><thead><tr><th>Vare</th><th class="r">Antall</th><th class="r">Sum</th><th></th></tr></thead><tbody>${linesHtml}</tbody></table>
<div class="row" style="margin-top:12px"><form method="post" action="/api/cms/cart/code" class="row"><input name="code" placeholder="Rabattkode" maxlength="40" aria-label="Rabattkode"><button class="btn ghost small" type="submit" style="flex:0 0 auto">Bruk</button></form>
<form method="post" action="/api/cms/cart/giftcard" class="row"><input name="code" placeholder="Gavekortkode" maxlength="40" aria-label="Gavekortkode"><button class="btn ghost small" type="submit" style="flex:0 0 auto">Bruk</button></form></div>
<p>${codes} ${cards}</p></div>${shipHtml}</div>
<div><div class="card"><h2>Oppsummering</h2>${totalsTable(priced)}${checkout}</div>
${seller ? `<p class="seller">${esc(seller.name)}${seller.orgNumber ? ` · Org.nr. ${esc(seller.orgNumber)}${seller.vatRegistered ? ' MVA' : ''}` : ''}${seller.address ? ` · ${esc(seller.address)}` : ''}${seller.email ? ` · ${esc(seller.email)}` : ''}${seller.phone ? ` · ${esc(seller.phone)}` : ''}</p>` : ''}</div></div>`;
  return layout({ title: 'Handlekurv', siteName, accent, cartCount, body });
}

/** Thank-you or failed-payment page after checkout. */
export function resultPage({ ok, siteName, settings, message = '', order = null, pending = false }) {
  const accent = settings?.checkout?.accentColor;
  if (!ok) {
    return layout({
      title: pending ? 'Venter på betaling' : 'Betalingen ble ikke fullført',
      siteName,
      accent,
      body: `<div class="card"><h1>${pending ? 'Venter på bekreftelse' : 'Betalingen ble ikke fullført'}</h1><p class="muted">${esc(message || 'Ingen penger er trukket. Prøv igjen eller ta kontakt.')}</p>${pending ? '<p><a class="btn" href="">Sjekk igjen</a></p>' : '<a class="btn ghost" href="/api/cms/cart">Tilbake til handlekurven</a>'}</div>`,
    });
  }
  const c = String(order?.currency || 'nok').toLowerCase();
  const lines = (order?.lines || []).map((l) => `<tr><td>${l.quantity} × ${lineName(l)}</td><td class="r">${money(l.lineTotalMinor, c)}</td></tr>`).join('');
  return layout({
    title: 'Takk for bestillingen',
    siteName,
    accent,
    body: `<div class="card"><h1>Takk for bestillingen!</h1><p>Ordrenummer <strong>${esc(order?.number || '')}</strong>. ${esc(message || (order?.paymentProvider === 'reserve' ? 'Timen er reservert. Du får bekreftelse på e-post.' : 'Betalingen er mottatt. Du får kvittering på e-post.'))}</p>
${lines ? `<table>${lines}${order.shippingMinor ? `<tr><td>Frakt${order.shippingMethod?.name ? `: ${esc(order.shippingMethod.name)}` : ''}</td><td class="r">${money(order.shippingMinor, c)}</td></tr>` : ''}<tr><td><strong>Totalt</strong></td><td class="r"><strong>${money(order.totalMinor, c)}</strong></td></tr></table>` : ''}
<p class="muted small">Ombestemt deg? Bruk <a href="/api/cms/angreskjema?order=${esc(order?.number || '')}">angreskjemaet</a>. Se bestillingene dine på <a href="/api/cms/account">Min side</a>.</p><a class="btn" href="/">Tilbake til butikken</a></div>`,
  });
}

/** Simple message page in the storefront style. */
export function messagePage({ title, text, siteName, settings, ok = true, html = '' }) {
  return layout({ title, siteName, accent: settings?.checkout?.accentColor, body: `<div class="card"><h1>${esc(title)}</h1>${text ? `<p class="${ok ? '' : 'err'}">${esc(text)}</p>` : ''}${html}<p><a href="/">Tilbake til forsiden</a></p></div>` });
}
