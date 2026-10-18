/**
 * The one pricing engine. Pure: cart items + catalog + settings + rules → priced cart.
 * All amounts are integer minor units. Lines are tax-inclusive (gross) internally;
 * tax is extracted per VAT rate. Provider lines always sum to amountDueMinor.
 */
import { allocate, grossFromNet, parseMajor, taxFromGross, toMinor } from './money.js';
import { taxRateFor, zoneForCountry, shippableCountries } from './settings.js';
import { findVariant, requiresShipping, variantLabel, variantPricing, variantStockQty, isBuyable } from './product.js';
import { canCombine, codeBlocker, discountClass, inWindow, lineInScope, normalizeCode } from './discounts.js';

function clean(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function extraMajor(option) {
  const n = parseMajor(option?.price);
  return n == null || n < 0 ? null : n;
}

/** Stable key for a cart line: product, variant, extras, booking and gift card amount. */
export function lineKey(item) {
  const extras = [...(item.extras || [])].sort().join(',');
  return [item.productId, item.variantId || 'default', extras, item.booking?.start || '', item.booking?.staffId || '', item.giftcard?.amount || ''].join('|');
}

function buildLine(item, ctx) {
  const product = ctx.getProduct(item.productId);
  if (!product) return { error: 'Produktet finnes ikke lenger.' };
  if (!isBuyable(product)) return { error: `${product.name} kan ikke kjøpes nå.` };
  const variant = findVariant(product, item.variantId);
  if (!variant) return { error: `Velg en variant av ${product.name}.` };
  const max = Math.min(ctx.settings.checkout.maxQuantity, product.maxPerOrder || Infinity);
  const quantity = Math.floor(Number(item.quantity) || 0);
  if (quantity < 1) return { error: `Ugyldig antall for ${product.name}.` };
  if (quantity > max) return { error: `Du kan kjøpe maks ${max} av ${product.name}.` };

  let unitMajor;
  let onSale = false;
  let regularMajor;
  let giftcard = null;
  if (product.kind === 'giftcard') {
    const amount = parseMajor(item.giftcard?.amount);
    const preset = product.giftcard.amounts.includes(amount);
    const custom = product.giftcard.allowCustom && amount >= product.giftcard.min && amount <= product.giftcard.max;
    if (amount == null || (!preset && !custom)) return { error: `Velg et gyldig beløp for ${product.name}.` };
    unitMajor = amount;
    regularMajor = amount;
    giftcard = {
      amount,
      recipientName: clean(item.giftcard?.recipientName, 80),
      recipientEmail: clean(item.giftcard?.recipientEmail, 160).toLowerCase(),
      message: clean(item.giftcard?.message, 300),
    };
  } else {
    const pricing = variantPricing(product, variant, ctx.now);
    if (typeof pricing.price !== 'number' || pricing.price <= 0) return { error: `${product.name} har ingen pris.` };
    unitMajor = pricing.price;
    regularMajor = pricing.regular;
    onSale = pricing.onSale;
  }

  const stock = variantStockQty(product, variant);
  if (product.backorders !== 'yes' && typeof stock === 'number') {
    const free = ctx.available ? ctx.available(product.id, variant.id) : stock;
    if (free <= 0) return { error: `${product.name}${variant.id !== 'default' ? ` (${variantLabel(variant)})` : ''} er utsolgt.` };
    if (quantity > free) return { error: `Bare ${free} igjen av ${product.name}.`, maxQuantity: free };
  }

  const wanted = new Set((item.extras || []).map((e) => clean(e, 80)));
  const extras = (product.extraOptions || []).filter((o) => wanted.has(o.name) && extraMajor(o) != null);
  unitMajor += extras.reduce((s, o) => s + extraMajor(o), 0);

  let booking = null;
  if (product.kind === 'booking') {
    const start = clean(item.booking?.start, 40);
    if (!Number.isFinite(Date.parse(start))) return { error: `Velg tidspunkt for ${product.name}.` };
    const end = new Date(Date.parse(start) + product.booking.durationMinutes * 60_000).toISOString();
    booking = { start: new Date(Date.parse(start)).toISOString(), end, staffId: clean(item.booking?.staffId, 60) };
    if (ctx.checkBooking) {
      const problem = ctx.checkBooking(product, booking, quantity);
      if (problem) return { error: problem };
    }
  }

  const taxClass = product.kind === 'giftcard' ? 'zero' : product.taxClass || 'standard';
  const rate = product.kind === 'giftcard' ? 0 : taxRateFor(ctx.settings, { country: ctx.country, taxClass });
  const unitMinor = toMinor(unitMajor, ctx.currency);
  const unitGrossMinor = ctx.settings.tax.pricesIncludeTax ? unitMinor : grossFromNet(unitMinor, rate);
  const label = variant.id === 'default' ? '' : variantLabel(variant);
  return {
    line: {
      key: lineKey(item),
      productId: product.id,
      variantId: variant.id,
      categoryId: product.categoryId || '',
      name: product.name,
      variantLabel: label,
      extras: extras.map((o) => o.name),
      sku: variant.sku || product.sku || '',
      kind: product.kind,
      taxClass,
      rate,
      quantity,
      onSale,
      unitRegularMinor: toMinor(regularMajor, ctx.currency),
      unitGrossMinor,
      lineGrossMinor: unitGrossMinor * quantity,
      discountMinor: 0,
      requiresShipping: requiresShipping(product),
      weightGrams: Number(variant.weightGrams || product.weightGrams || 0) * quantity,
      booking,
      giftcard,
      recurring: product.kind === 'subscription' ? { ...product.subscription } : null,
      digital: product.kind === 'digital' && product.digitalFiles.length > 0,
    },
  };
}

/** Standalone effect of one rule on undiscounted lines: { amounts:[per line], freeShipping, error }. */
function evaluate(rule, lines, currency) {
  const scope = rule.appliesTo;
  const eligible = lines.map((l) => lineInScope(scope, l));
  const eligibleSubtotal = lines.reduce((s, l, i) => s + (eligible[i] ? l.remaining : 0), 0);
  const minSub = toMinor(rule.minSubtotal, currency) || 0;
  const maxSub = toMinor(rule.maxSubtotal, currency) || 0;
  const none = lines.map(() => 0);
  if (minSub && eligibleSubtotal < minSub) return { amounts: none, error: `Handle for minst ${rule.minSubtotal} kr for å bruke rabatten.` };
  if (maxSub && eligibleSubtotal > maxSub) return { amounts: none, error: 'Handlekurven er for stor for denne rabatten.' };
  const spread = (amount) => {
    const weights = lines.map((l, i) => (eligible[i] ? l.remaining : 0));
    return allocate(Math.min(amount, eligibleSubtotal), weights);
  };
  switch (rule.type) {
    case 'percent':
      return { amounts: spread(Math.round((eligibleSubtotal * rule.value) / 100)), freeShipping: rule.freeShipping };
    case 'amount':
      return { amounts: spread(toMinor(rule.value, currency)), freeShipping: rule.freeShipping };
    case 'fixed_product': {
      const per = toMinor(rule.value, currency);
      return { amounts: lines.map((l, i) => (eligible[i] ? Math.min(per * l.quantity, l.remaining) : 0)), freeShipping: rule.freeShipping };
    }
    case 'tiered': {
      const qty = lines.reduce((s, l, i) => s + (eligible[i] ? l.quantity : 0), 0);
      const tier = [...rule.tiers].reverse().find((t) => qty >= t.minQty);
      if (!tier) return { amounts: none, error: `Kjøp minst ${rule.tiers[0]?.minQty || 2} for å få rabatten.` };
      return { amounts: spread(Math.round((eligibleSubtotal * tier.percent) / 100)) };
    }
    case 'bxgy': {
      const b = rule.bxgy;
      const buyScope = { productIds: b.buyProductIds, categoryIds: b.buyCategoryIds };
      const sameScope = !b.getProductIds.length && !b.getCategoryIds.length;
      const getScope = sameScope ? buyScope : { productIds: b.getProductIds, categoryIds: b.getCategoryIds };
      const units = [];
      lines.forEach((l, i) => {
        if (!lineInScope(getScope, l)) return;
        for (let k = 0; k < l.quantity; k += 1) units.push({ i, price: l.remaining / l.quantity });
      });
      let freeCount;
      if (sameScope) {
        const groups = Math.floor(units.length / (b.buyQty + b.getQty));
        freeCount = (b.maxUses ? Math.min(groups, b.maxUses) : groups) * b.getQty;
      } else {
        const bought = lines.reduce((s, l) => s + (lineInScope(buyScope, l) ? l.quantity : 0), 0);
        const times = Math.floor(bought / b.buyQty);
        freeCount = (b.maxUses ? Math.min(times, b.maxUses) : times) * b.getQty;
      }
      if (!freeCount || !units.length) return { amounts: none, error: `Kjøp ${b.buyQty} for å få rabatten.` };
      units.sort((x, y) => x.price - y.price);
      const amounts = lines.map(() => 0);
      for (const unit of units.slice(0, freeCount)) amounts[unit.i] += Math.round((unit.price * b.getPercent) / 100);
      return { amounts: amounts.map((a, i) => Math.min(a, lines[i].remaining)) };
    }
    case 'free_shipping':
      return { amounts: none, freeShipping: true };
    default:
      return { amounts: none };
  }
}

function selectDiscounts(lines, ctx, errors) {
  const fresh = () => lines.map((l) => ({ ...l, remaining: l.lineGrossMinor }));
  const automatic = ctx.discounts
    .filter((d) => d.method === 'automatic' && d.active && inWindow(d, ctx.now))
    .map((rule) => ({ rule, effect: evaluate(rule, fresh(), ctx.currency) }))
    .filter(({ effect }) => !effect.error && (effect.freeShipping || effect.amounts.some((a) => a > 0)))
    .sort((a, b) => b.effect.amounts.reduce((s, x) => s + x, 0) - a.effect.amounts.reduce((s, x) => s + x, 0));
  const selected = [];
  for (const candidate of automatic) {
    if (selected.every((s) => canCombine(s.rule, candidate.rule))) selected.push(candidate);
  }
  const appliedCodes = [];
  for (const raw of ctx.codes) {
    const code = normalizeCode(raw);
    if (!code || appliedCodes.includes(code)) continue;
    const rule = ctx.discounts.find((d) => d.method === 'code' && d.code === code);
    const blocker = rule ? codeBlocker(rule, { email: ctx.email, now: ctx.now }) : 'Ugyldig rabattkode.';
    if (blocker) {
      errors.push({ scope: 'code', key: code, message: blocker });
      continue;
    }
    const effect = evaluate(rule, fresh(), ctx.currency);
    if (effect.error || (!effect.freeShipping && !effect.amounts.some((a) => a > 0))) {
      errors.push({ scope: 'code', key: code, message: effect.error || 'Rabattkoden gjelder ikke varene i handlekurven.' });
      continue;
    }
    const clash = selected.find((s) => !canCombine(s.rule, rule));
    if (clash) {
      errors.push({ scope: 'code', key: code, message: `Rabattkoden kan ikke kombineres med «${clash.rule.title || clash.rule.code || 'en annen rabatt'}».` });
      continue;
    }
    selected.push({ rule, effect });
    appliedCodes.push(code);
  }
  return { selected, appliedCodes };
}

function priceShipping(lines, goodsGross, freeShipping, ctx) {
  const required = lines.some((l) => l.requiresShipping);
  const countries = shippableCountries(ctx.settings);
  if (!required) return { required: false, amountMinor: 0, methods: [], countries, method: null };
  const zone = zoneForCountry(ctx.settings, ctx.country);
  const weight = lines.reduce((s, l) => s + (l.requiresShipping ? l.weightGrams : 0), 0);
  const effRate = (() => {
    const total = lines.reduce((s, l) => s + l.lineGrossMinor - l.discountMinor, 0);
    if (!total) return taxRateFor(ctx.settings, { country: ctx.country, taxClass: 'standard' });
    return lines.reduce((s, l) => s + l.rate * (l.lineGrossMinor - l.discountMinor), 0) / total;
  })();
  const toGross = (major) => {
    const minor = toMinor(major, ctx.currency) || 0;
    return ctx.settings.tax.pricesIncludeTax ? minor : Math.round(minor * (1 + effRate / 100));
  };
  const methods = [];
  for (const m of zone?.methods || []) {
    if (!m.enabled) continue;
    let amount;
    if (m.type === 'pickup') amount = 0;
    else if (m.type === 'free') {
      if (goodsGross < toGross(m.minAmount)) continue;
      amount = 0;
    } else if (m.type === 'weight') {
      const tier = m.tiers.find((t) => weight <= t.upToGrams);
      if (!tier) continue;
      amount = toGross(tier.price);
    } else {
      amount = m.freeOver > 0 && goodsGross >= toGross(m.freeOver) ? 0 : toGross(m.price);
    }
    if (freeShipping && m.type !== 'pickup') amount = 0;
    methods.push({ id: m.id, type: m.type, name: m.name, amountMinor: amount, estimateMinDays: m.estimateMinDays, estimateMaxDays: m.estimateMaxDays, pickupAddress: m.pickupAddress });
  }
  const method = methods.find((m) => m.id === ctx.methodId) || methods[0] || null;
  return { required: true, zoneId: zone?.id || '', amountMinor: method ? method.amountMinor : 0, methods, countries, method, blocked: !method };
}

function providerName(line) {
  const parts = [line.name];
  if (line.variantLabel) parts.push(`– ${line.variantLabel}`);
  let name = parts.join(' ');
  if (line.extras.length) name += ` (${line.extras.join(', ')})`;
  if (line.booking) name += ` ${line.booking.start.slice(0, 16).replace('T', ' ')}`;
  return name.slice(0, 200);
}

/** Prices a cart from stored products: discounts, shipping, MVA, gift cards and stock errors. */
export function priceCart(input) {
  const settings = input.settings;
  const currency = settings.currency;
  const ctx = {
    settings,
    currency,
    country: clean(input.country, 2).toUpperCase() || settings.country,
    methodId: clean(input.methodId, 60),
    codes: Array.isArray(input.codes) ? input.codes : [],
    discounts: Array.isArray(input.discounts) ? input.discounts : [],
    email: clean(input.email, 160).toLowerCase(),
    now: input.now ?? Date.now(),
    getProduct: input.getProduct,
    available: input.available,
    checkBooking: input.checkBooking,
  };
  const errors = [];
  const lines = [];
  const merged = new Map();
  for (const item of Array.isArray(input.items) ? input.items : []) {
    const key = lineKey(item);
    const prev = merged.get(key);
    if (prev) prev.quantity += Math.floor(Number(item.quantity) || 0);
    else merged.set(key, { ...item, quantity: Math.floor(Number(item.quantity) || 0) });
  }
  for (const item of merged.values()) {
    const built = buildLine(item, ctx);
    if (built.error) errors.push({ scope: 'item', key: lineKey(item), message: built.error, maxQuantity: built.maxQuantity });
    else lines.push(built.line);
  }

  const recurring = lines.filter((l) => l.recurring);
  if (recurring.length) {
    const sig = (l) => `${l.recurring.interval}:${l.recurring.intervalCount}:${l.recurring.trialDays}`;
    if (new Set(recurring.map(sig)).size > 1) errors.push({ scope: 'cart', key: 'recurring', message: 'Abonnementer med ulik periode må kjøpes hver for seg.' });
  }

  const { selected, appliedCodes } = selectDiscounts(lines, ctx, errors);
  const working = lines.map((l) => ({ ...l, remaining: l.lineGrossMinor }));
  const classOrder = { product: 0, order: 1, shipping: 2 };
  const discounts = [];
  let freeShipping = false;
  for (const { rule } of [...selected].sort((a, b) => classOrder[discountClass(a.rule)] - classOrder[discountClass(b.rule)])) {
    const effect = evaluate(rule, working, currency);
    if (effect.freeShipping) freeShipping = true;
    const total = effect.amounts.reduce((s, a) => s + a, 0);
    effect.amounts.forEach((a, i) => {
      working[i].remaining -= a;
      working[i].discountMinor += a;
    });
    discounts.push({ id: rule.id, code: rule.code, title: rule.title || rule.code, method: rule.method, type: rule.type, amountMinor: total, freeShipping: Boolean(effect.freeShipping) });
  }

  const pricedLines = working.map(({ remaining: _remaining, ...l }) => {
    const lineTotalMinor = l.lineGrossMinor - l.discountMinor;
    const taxMinor = taxFromGross(lineTotalMinor, l.rate);
    return { ...l, lineTotalMinor, taxMinor, netMinor: lineTotalMinor - taxMinor };
  });
  const subtotalMinor = pricedLines.reduce((s, l) => s + l.lineGrossMinor, 0);
  const discountMinor = pricedLines.reduce((s, l) => s + l.discountMinor, 0);
  const goodsMinor = subtotalMinor - discountMinor;

  const shipping = priceShipping(pricedLines, goodsMinor, freeShipping, ctx);
  if (shipping.required && shipping.blocked) errors.push({ scope: 'shipping', key: ctx.country, message: 'Vi sender ikke til dette landet med varene i handlekurven.' });

  // Shipping VAT follows the goods: split by each rate's share of the goods.
  const groups = new Map();
  for (const l of pricedLines) {
    const g = groups.get(l.rate) || { rate: l.rate, grossMinor: 0, taxMinor: 0 };
    g.grossMinor += l.lineTotalMinor;
    g.taxMinor += l.taxMinor;
    groups.set(l.rate, g);
  }
  let shippingTaxMinor = 0;
  if (shipping.amountMinor > 0) {
    const shipGroups = [...groups.values()].filter((g) => g.grossMinor > 0);
    if (!shipGroups.length) {
      const rate = taxRateFor(settings, { country: ctx.country, taxClass: 'standard' });
      shipGroups.push(groups.get(rate) || { rate, grossMinor: 0, taxMinor: 0 });
      groups.set(rate, shipGroups[0]);
    }
    const parts = allocate(shipping.amountMinor, shipGroups.map((g) => g.grossMinor || 1));
    shipGroups.forEach((g, i) => {
      const tax = taxFromGross(parts[i], g.rate);
      g.grossMinor += parts[i];
      g.taxMinor += tax;
      shippingTaxMinor += tax;
    });
  }
  const taxLines = [...groups.values()].filter((g) => g.grossMinor > 0).sort((a, b) => b.rate - a.rate).map((g) => ({ rate: g.rate, netMinor: g.grossMinor - g.taxMinor, taxMinor: g.taxMinor }));
  const taxMinor = taxLines.reduce((s, t) => s + t.taxMinor, 0);
  const totalMinor = goodsMinor + shipping.amountMinor;

  // Gift cards are payments, not discounts (multi-purpose vouchers; VAT stays on the goods).
  const giftcardPayments = [];
  let remaining = totalMinor;
  const hasGiftcardLines = pricedLines.some((l) => l.kind === 'giftcard');
  for (const card of Array.isArray(input.giftcards) ? input.giftcards : []) {
    if (!card) continue;
    if (recurring.length) {
      errors.push({ scope: 'giftcard', key: card.code, message: 'Gavekort kan ikke brukes på abonnement.' });
      continue;
    }
    if (hasGiftcardLines) {
      errors.push({ scope: 'giftcard', key: card.code, message: 'Gavekort kan ikke brukes til å kjøpe gavekort.' });
      continue;
    }
    if (!card.active || (card.expiresAt && ctx.now > Date.parse(card.expiresAt)) || card.balanceMinor <= 0 || (card.currency && card.currency !== currency)) {
      errors.push({ scope: 'giftcard', key: card.code, message: card.balanceMinor <= 0 ? 'Gavekortet er brukt opp.' : 'Gavekortet er ikke gyldig.' });
      continue;
    }
    if (remaining <= 0) break;
    const use = Math.min(card.balanceMinor, remaining);
    remaining -= use;
    giftcardPayments.push({ id: card.id, code: card.code, last4: String(card.code).slice(-4), amountMinor: use, balanceAfterMinor: card.balanceMinor - use });
  }
  const trialFree = recurring.length && recurring[0].recurring.trialDays > 0 ? recurring.reduce((s, l) => s + (pricedLines.find((p) => p.key === l.key)?.lineTotalMinor || 0), 0) : 0;
  const amountDueMinor = remaining - trialFree;

  let providerLines = [];
  let providerShipping = null;
  const recurringLines = [];
  if (recurring.length) {
    for (const l of pricedLines) {
      const target = l.recurring ? recurringLines : providerLines;
      if (l.lineTotalMinor <= 0) continue;
      const even = l.lineTotalMinor % l.quantity === 0;
      target.push({ name: even ? providerName(l) : `${l.quantity} × ${providerName(l)}`.slice(0, 200), unitAmount: even ? l.lineTotalMinor / l.quantity : l.lineTotalMinor, quantity: even ? l.quantity : 1, ...(l.recurring ? { interval: l.recurring.interval, intervalCount: l.recurring.intervalCount } : {}) });
    }
    if (shipping.amountMinor > 0) providerLines.push({ name: `Frakt: ${shipping.method?.name || ''}`.slice(0, 200), unitAmount: shipping.amountMinor, quantity: 1 });
  } else if (giftcardPayments.length) {
    if (amountDueMinor > 0) providerLines = [{ name: 'Bestilling (rest etter gavekort)', unitAmount: amountDueMinor, quantity: 1 }];
  } else {
    for (const l of pricedLines) {
      if (l.lineTotalMinor <= 0) continue;
      const even = l.lineTotalMinor % l.quantity === 0;
      providerLines.push({ name: even ? providerName(l) : `${l.quantity} × ${providerName(l)}`.slice(0, 200), unitAmount: even ? l.lineTotalMinor / l.quantity : l.lineTotalMinor, quantity: even ? l.quantity : 1 });
    }
    if (shipping.amountMinor > 0) providerShipping = { name: shipping.method.name, amountMinor: shipping.amountMinor, estimateMinDays: shipping.method.estimateMinDays, estimateMaxDays: shipping.method.estimateMaxDays };
  }

  const blocking = errors.some((e) => e.scope === 'cart' || e.scope === 'shipping') || !pricedLines.length;
  return {
    ok: !blocking,
    currency,
    country: ctx.country,
    errors,
    lines: pricedLines,
    appliedCodes,
    discounts,
    subtotalMinor,
    discountMinor,
    goodsMinor,
    shipping: { ...shipping, taxMinor: shippingTaxMinor },
    taxLines,
    taxMinor,
    totalMinor,
    giftcardPayments,
    amountDueMinor,
    trialDays: recurring.length ? recurring[0].recurring.trialDays : 0,
    mode: recurring.length ? 'subscription' : 'payment',
    providerLines,
    providerShipping,
    recurringLines,
    requiresStripe: recurring.length > 0,
  };
}
