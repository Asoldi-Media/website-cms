/** Sales report, MVA summary per rate (sales minus credit notes) and orders CSV. */
import { toCsv } from './csv.js';
import { refundTaxLines } from './documents.js';

function inRange(iso, from, to) {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) && t >= from && t <= to;
}

/** Report range from ?from and ?to. Defaults to the last 30 days. */
export function parseRange(query = {}) {
  const to = Number.isFinite(Date.parse(query.to)) ? Date.parse(query.to) + (String(query.to).length <= 10 ? 86_399_999 : 0) : Date.now();
  const from = Number.isFinite(Date.parse(query.from)) ? Date.parse(query.from) : to - 30 * 86_400_000;
  return { from, to };
}

function counted(order) {
  return ['paid', 'partially_refunded', 'refunded'].includes(order.paymentStatus) && order.number;
}

/** Sales, refunds, MVA per rate and top products for a range. */
export function salesReport(orders, range) {
  const rows = orders.filter((o) => counted(o) && inRange(o.purchasedAt, range.from, range.to));
  const sum = (f) => rows.reduce((s, o) => s + (f(o) || 0), 0);
  const byDay = new Map();
  const byProduct = new Map();
  const byProvider = new Map();
  for (const o of rows) {
    const day = String(o.purchasedAt).slice(0, 10);
    const d = byDay.get(day) || { day, orders: 0, totalMinor: 0 };
    d.orders += 1;
    d.totalMinor += o.totalMinor;
    byDay.set(day, d);
    const pr = byProvider.get(o.paymentProvider) || { provider: o.paymentProvider, orders: 0, totalMinor: 0 };
    pr.orders += 1;
    pr.totalMinor += o.totalMinor;
    byProvider.set(o.paymentProvider, pr);
    for (const l of o.lines) {
      const key = `${l.productId}|${l.variantId}`;
      const p = byProduct.get(key) || { productId: l.productId, name: l.variantLabel ? `${l.name} – ${l.variantLabel}` : l.name, quantity: 0, totalMinor: 0 };
      p.quantity += l.quantity;
      p.totalMinor += l.lineTotalMinor;
      byProduct.set(key, p);
    }
  }
  const refunds = orders.flatMap((o) => o.refunds.filter((r) => inRange(r.at, range.from, range.to)));
  const grossMinor = sum((o) => o.totalMinor);
  return {
    from: new Date(range.from).toISOString(),
    to: new Date(range.to).toISOString(),
    orders: rows.length,
    grossMinor,
    taxMinor: sum((o) => o.taxMinor),
    netMinor: grossMinor - sum((o) => o.taxMinor),
    discountMinor: sum((o) => o.discountMinor),
    shippingMinor: sum((o) => o.shippingMinor),
    refundedMinor: refunds.reduce((s, r) => s + r.amountMinor, 0),
    averageMinor: rows.length ? Math.round(grossMinor / rows.length) : 0,
    byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    topProducts: [...byProduct.values()].sort((a, b) => b.totalMinor - a.totalMinor).slice(0, 20),
    byProvider: [...byProvider.values()],
  };
}

/** For the MVA-melding: output VAT per rate from sales in the period, minus credit notes in the period. */
export function vatReport(orders, range) {
  const rates = new Map();
  const add = (rate, net, tax, sign) => {
    const r = rates.get(rate) || { rate, salesNetMinor: 0, salesTaxMinor: 0, creditNetMinor: 0, creditTaxMinor: 0 };
    if (sign > 0) {
      r.salesNetMinor += net;
      r.salesTaxMinor += tax;
    } else {
      r.creditNetMinor += net;
      r.creditTaxMinor += tax;
    }
    rates.set(rate, r);
  };
  for (const o of orders) {
    if (counted(o) && inRange(o.purchasedAt, range.from, range.to)) for (const t of o.taxLines) add(t.rate, t.netMinor, t.taxMinor, 1);
    for (const r of o.refunds) {
      if (inRange(r.at, range.from, range.to)) for (const t of refundTaxLines(o, r)) add(t.rate, t.netMinor, t.taxMinor, -1);
    }
  }
  const list = [...rates.values()].sort((a, b) => b.rate - a.rate).map((r) => ({ ...r, netMinor: r.salesNetMinor - r.creditNetMinor, taxMinor: r.salesTaxMinor - r.creditTaxMinor }));
  return { from: new Date(range.from).toISOString(), to: new Date(range.to).toISOString(), rates: list, taxMinor: list.reduce((s, r) => s + r.taxMinor, 0) };
}

/** Orders in a range as CSV for the accountant. */
export function ordersCsv(orders, range) {
  const rows = orders
    .filter((o) => o.number && inRange(o.purchasedAt, range.from, range.to))
    .map((o) => [o.number, o.purchasedAt, o.customerName, o.customerEmail, o.status, o.paymentStatus, o.paymentProvider, o.currency, (o.subtotalMinor / 100).toFixed(2), (o.discountMinor / 100).toFixed(2), (o.shippingMinor / 100).toFixed(2), (o.taxMinor / 100).toFixed(2), (o.totalMinor / 100).toFixed(2), (o.refundedMinor / 100).toFixed(2), o.lines.map((l) => `${l.quantity}x ${l.name}${l.variantLabel ? ` (${l.variantLabel})` : ''}`).join('; '), [o.shippingAddress?.line, o.shippingAddress?.postal, o.shippingAddress?.city, o.shippingAddress?.country].filter(Boolean).join(', ')]);
  return toCsv(['Ordrenummer', 'Dato', 'Kunde', 'E-post', 'Status', 'Betaling', 'Betalingsmåte', 'Valuta', 'Delsum', 'Rabatt', 'Frakt', 'MVA', 'Totalt', 'Refundert', 'Varer', 'Adresse'], rows);
}
