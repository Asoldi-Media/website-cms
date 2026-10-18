/** Money helpers. Every amount inside the shop engine is an integer in minor units (øre). */

const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);

/** Lower-case ISO currency, or the fallback. */
export function normalizeCurrency(value, fallback = 'nok') {
  const code = String(value || '').trim().toLowerCase();
  return /^[a-z]{3}$/.test(code) ? code : fallback;
}

/** Minor units per major unit for a currency (1 for zero-decimal currencies). */
export function minorFactor(currency) {
  return ZERO_DECIMAL.has(normalizeCurrency(currency)) ? 1 : 100;
}

/** "1 299,50" | "1299.5" | 1299.5 → 1299.5 ; anything else → null */
export function parseMajor(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value ?? '').trim().replace(/\s/g, '').replace(/kr\.?$/i, '').replace(/^kr\.?/i, '').replace(/,-$/, '');
  if (!raw) return null;
  const normalized = raw.includes(',') && !raw.includes('.') ? raw.replace(',', '.') : raw.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

/** Major amount to integer minor units. */
export function toMinor(major, currency = 'nok') {
  const value = parseMajor(major);
  return value == null ? null : Math.round(value * minorFactor(currency));
}

/** Minor units to a major amount. */
export function fromMinor(minor, currency = 'nok') {
  return Number(minor || 0) / minorFactor(currency);
}

/** Minor units as a nb-NO currency string. */
export function formatMoney(minor, currency = 'nok') {
  const cur = normalizeCurrency(currency);
  const major = fromMinor(minor, cur);
  const digits = minorFactor(cur) === 1 ? 0 : Number.isInteger(major) ? 0 : 2;
  const text = major.toLocaleString('nb-NO', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return cur === 'nok' ? `${text} kr` : `${text} ${cur.toUpperCase()}`;
}

/** Tax contained in a tax-inclusive amount: gross − round(gross / (1 + r)). */
export function taxFromGross(grossMinor, ratePercent) {
  const rate = Number(ratePercent) || 0;
  if (!rate || !grossMinor) return 0;
  return grossMinor - Math.round(grossMinor / (1 + rate / 100));
}

/** Gross for a tax-exclusive amount. */
export function grossFromNet(netMinor, ratePercent) {
  const rate = Number(ratePercent) || 0;
  return netMinor + Math.round((netMinor * rate) / 100);
}

/**
 * Split `amount` across `weights` proportionally; integer parts that sum exactly to `amount`
 * (largest remainder method). Zero weights get zero unless all weights are zero.
 */
export function allocate(amount, weights) {
  const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (!weights.length) return [];
  if (total <= 0) {
    const out = weights.map(() => 0);
    out[0] = amount;
    return out;
  }
  const raw = weights.map((w) => (amount * Math.max(0, w)) / total);
  const out = raw.map((v) => Math.floor(v));
  let rest = amount - out.reduce((s, v) => s + v, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rest > 0 && k < order.length; k += 1, rest -= 1) out[order[k][1]] += 1;
  return out;
}
