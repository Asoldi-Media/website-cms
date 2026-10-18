/**
 * Builds the structured sales document the hub renders to PDF + email
 * (bokføringsforskriften kap. 5: numbered, seller identity, date, lines, MVA per rate).
 */

function lineTitle(line) {
  let name = line.name;
  if (line.variantLabel) name += ` – ${line.variantLabel}`;
  if (line.extras?.length) name += ` (${line.extras.join(', ')})`;
  return name;
}

/** Legal seller details printed on documents. */
export function sellerBlock(settings, siteName) {
  const s = settings.seller;
  return {
    name: s.legalName || siteName || '',
    orgNumber: s.orgNumber,
    vatRegistered: s.vatRegistered,
    foretaksregisteret: s.foretaksregisteret,
    address: [s.address, [s.postal, s.city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    email: s.email,
    phone: s.phone,
  };
}

/** Structured document the hub turns into the receipt PDF and email. */
export function orderDocument(order, { settings, siteName, origin, kind = 'order', refund = null, shipment = null, extra = {} }) {
  const base = {
    kind,
    number: order.number,
    orderNumber: order.number,
    date: order.purchasedAt,
    currency: String(order.currency || settings.currency).toLowerCase(),
    siteName,
    siteUrl: origin,
    seller: sellerBlock(settings, siteName),
    buyer: {
      name: order.customerName,
      email: order.customerEmail,
      phone: order.customerPhone,
      address: [order.shippingAddress?.line, [order.shippingAddress?.postal, order.shippingAddress?.city].filter(Boolean).join(' '), order.shippingAddress?.country].filter(Boolean).join(', '),
    },
    lines: order.lines.map((l) => ({ name: lineTitle(l), sku: l.sku, quantity: l.quantity, unitMinor: l.unitGrossMinor, discountMinor: l.discountMinor, totalMinor: l.lineTotalMinor, rate: l.rate, booking: l.booking })),
    shipping: order.shippingMethod ? { name: order.shippingMethod.name, amountMinor: order.shippingMinor } : null,
    discounts: order.discounts,
    taxLines: order.taxLines,
    subtotalMinor: order.subtotalMinor,
    totalMinor: order.totalMinor,
    giftcardPayments: order.giftcardPayments,
    amountPaidMinor: order.amountPaidMinor,
    paymentMethod: { stripe: 'Kort (Stripe)', paypal: 'PayPal', giftcard: 'Gavekort', reserve: 'Betales ved oppmøte', manual: 'Manuell' }[order.paymentProvider] || '',
    withdrawal: { text: settings.checkout.withdrawalText, formUrl: `${origin}/api/cms/angreskjema?order=${encodeURIComponent(order.number)}` },
    accountUrl: `${origin}/api/cms/account`,
    provider: order.paymentProvider,
    providerId: order.providerCheckoutId,
    ...extra,
  };
  if (kind === 'credit-note' && refund) {
    const byKey = new Map(order.lines.map((l) => [l.key, l]));
    base.number = refund.creditNoteNumber;
    base.date = refund.at;
    base.creditFor = order.number;
    base.reason = refund.reason;
    base.lines = refund.lines.map((r) => {
      const line = byKey.get(r.key);
      return { name: line ? lineTitle(line) : 'Vare', quantity: r.quantity, unitMinor: r.quantity ? Math.round(r.amountMinor / r.quantity) : r.amountMinor, totalMinor: r.amountMinor, rate: line?.rate || 0 };
    });
    base.shipping = refund.shippingMinor ? { name: 'Frakt', amountMinor: refund.shippingMinor } : null;
    base.discounts = [];
    base.taxLines = refundTaxLines(order, refund);
    base.totalMinor = refund.amountMinor;
    base.giftcardPayments = refund.giftcardMinor ? [{ last4: '', amountMinor: refund.giftcardMinor }] : [];
    base.amountPaidMinor = refund.amountMinor - (refund.giftcardMinor || 0);
  }
  if (kind === 'shipped' && shipment) base.shipment = shipment;
  return base;
}

/** VAT on a credit note follows the refunded lines (shipping split like the original order). */
export function refundTaxLines(order, refund) {
  const byKey = new Map(order.lines.map((l) => [l.key, l]));
  const groups = new Map();
  const add = (rate, gross) => {
    const g = groups.get(rate) || { rate, grossMinor: 0 };
    g.grossMinor += gross;
    groups.set(rate, g);
  };
  for (const r of refund.lines) add(byKey.get(r.key)?.rate || 0, r.amountMinor);
  if (refund.shippingMinor && order.taxLines.length) {
    const goods = order.lines.reduce((s, l) => s + l.lineTotalMinor, 0) || 1;
    let left = refund.shippingMinor;
    const rates = [...new Set(order.lines.map((l) => l.rate))];
    rates.forEach((rate, i) => {
      const share = i === rates.length - 1 ? left : Math.round((refund.shippingMinor * order.lines.filter((l) => l.rate === rate).reduce((s, l) => s + l.lineTotalMinor, 0)) / goods);
      left -= share;
      add(rate, share);
    });
  }
  return [...groups.values()].map((g) => {
    const tax = g.rate ? g.grossMinor - Math.round(g.grossMinor / (1 + g.rate / 100)) : 0;
    return { rate: g.rate, netMinor: g.grossMinor - tax, taxMinor: tax };
  });
}
