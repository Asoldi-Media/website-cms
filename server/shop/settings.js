/**
 * Shop settings: seller, tax table, shipping zones, checkout texts, bookings, gift cards.
 * Prices are entered in major units (kr) in the admin; the engine converts to øre.
 */
import { normalizeCurrency, parseMajor } from './money.js';

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const DEFAULT_TAX_CLASSES = [
  { id: 'standard', name: 'Standard (25 %)' },
  { id: 'food', name: 'Næringsmidler (15 %)' },
  { id: 'reduced', name: 'Redusert (12 %)' },
  { id: 'zero', name: 'Fritatt (0 %)' },
];

const DEFAULT_RATES = [
  { country: 'NO', taxClass: 'standard', rate: 25 },
  { country: 'NO', taxClass: 'food', rate: 15 },
  { country: 'NO', taxClass: 'reduced', rate: 12 },
  { country: 'NO', taxClass: 'zero', rate: 0 },
];

export const DEFAULT_TERMS = 'Ved å bestille godtar du salgsbetingelsene. Prisene inkluderer merverdiavgift.';
export const DEFAULT_WITHDRAWAL =
  'Du har 14 dagers angrerett fra du mottar varen, jf. angrerettloven. Bruk angreskjemaet eller gi oss en klar melding. Angreretten gjelder ikke tjenester som er levert i sin helhet, varer laget etter dine mål eller tidsbestemte tjenester som bordbestilling og timeavtaler.';

function clean(value, max = 400) {
  return String(value ?? '').trim().slice(0, max);
}

function num(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function countryList(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[,\s]+/);
  const out = [];
  for (const raw of list) {
    const code = String(raw || '').trim().toUpperCase();
    if ((code === '*' || /^[A-Z]{2}$/.test(code)) && !out.includes(code)) out.push(code);
  }
  return out;
}

function money(value) {
  const n = parseMajor(value);
  return n == null || n < 0 ? 0 : n;
}

function id(prefix, value, index) {
  const raw = clean(value, 60).replace(/[^a-zA-Z0-9_-]/g, '');
  return raw || `${prefix}_${index + 1}`;
}

function normalizeMethod(raw, index) {
  const type = ['flat', 'free', 'weight', 'pickup'].includes(raw?.type) ? raw.type : 'flat';
  const tiers = (Array.isArray(raw?.tiers) ? raw.tiers : [])
    .map((t) => ({ upToGrams: num(t?.upToGrams, 0, { min: 0 }), price: money(t?.price) }))
    .filter((t) => t.upToGrams > 0)
    .sort((a, b) => a.upToGrams - b.upToGrams);
  return {
    id: id('m', raw?.id, index),
    type,
    name: clean(raw?.name, 80) || { flat: 'Frakt', free: 'Gratis frakt', weight: 'Frakt', pickup: 'Henting' }[type],
    price: money(raw?.price),
    freeOver: money(raw?.freeOver),
    minAmount: money(raw?.minAmount),
    tiers,
    estimateMinDays: num(raw?.estimateMinDays, 0, { min: 0, max: 90 }),
    estimateMaxDays: num(raw?.estimateMaxDays, 0, { min: 0, max: 90 }),
    pickupAddress: clean(raw?.pickupAddress, 200),
    enabled: raw?.enabled !== false,
  };
}

function normalizeZone(raw, index) {
  const methods = (Array.isArray(raw?.methods) ? raw.methods : []).slice(0, 20).map(normalizeMethod);
  return {
    id: id('zone', raw?.id, index),
    name: clean(raw?.name, 80) || `Sone ${index + 1}`,
    countries: countryList(raw?.countries),
    methods,
  };
}

function normalizeHours(raw) {
  const out = {};
  for (const day of WEEKDAYS) {
    const ranges = Array.isArray(raw?.[day]) ? raw[day] : [];
    out[day] = ranges
      .map((r) => (Array.isArray(r) ? r : [r?.from, r?.to]))
      .map(([from, to]) => [clean(from, 5), clean(to, 5)])
      .filter(([from, to]) => /^\d{2}:\d{2}$/.test(from) && /^\d{2}:\d{2}$/.test(to) && from < to)
      .slice(0, 4);
  }
  return out;
}

const DEFAULT_HOURS = { mon: [['09:00', '17:00']], tue: [['09:00', '17:00']], wed: [['09:00', '17:00']], thu: [['09:00', '17:00']], fri: [['09:00', '17:00']], sat: [], sun: [] };

/** Shop settings with defaults filled in and values clamped. */
export function normalizeShopSettings(raw = {}) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const tax = input.tax || {};
  const classes = (Array.isArray(tax.classes) && tax.classes.length ? tax.classes : DEFAULT_TAX_CLASSES)
    .map((c, i) => ({ id: id('class', c?.id, i), name: clean(c?.name, 60) || clean(c?.id, 60) }))
    .slice(0, 20);
  const rates = (Array.isArray(tax.rates) && tax.rates.length ? tax.rates : DEFAULT_RATES)
    .map((r) => ({ country: countryList([r?.country])[0] || 'NO', taxClass: clean(r?.taxClass || r?.class, 60) || 'standard', rate: num(r?.rate, 0, { min: 0, max: 100 }) }))
    .slice(0, 200);
  const zones = (Array.isArray(input.shipping?.zones) ? input.shipping.zones : [{ name: 'Norge', countries: ['NO'], methods: [{ type: 'free', name: 'Frakt inkludert' }] }])
    .slice(0, 30)
    .map(normalizeZone);
  const checkout = input.checkout || {};
  const bookings = input.bookings || {};
  const giftcards = input.giftcards || {};
  const seller = input.seller || {};
  return {
    currency: normalizeCurrency(input.currency, 'nok'),
    country: countryList([input.country])[0] || 'NO',
    seller: {
      legalName: clean(seller.legalName, 120),
      orgNumber: clean(seller.orgNumber, 30),
      vatRegistered: seller.vatRegistered !== false,
      foretaksregisteret: Boolean(seller.foretaksregisteret),
      address: clean(seller.address, 200),
      postal: clean(seller.postal, 20),
      city: clean(seller.city, 80),
      email: clean(seller.email, 160),
      phone: clean(seller.phone, 40),
    },
    tax: {
      pricesIncludeTax: tax.pricesIncludeTax !== false,
      exportZeroRated: tax.exportZeroRated !== false,
      classes,
      rates,
    },
    shipping: { zones },
    checkout: {
      buttonText: clean(checkout.buttonText, 60) || 'Bestill med betalingsplikt',
      termsText: clean(checkout.termsText, 4000) || DEFAULT_TERMS,
      withdrawalText: clean(checkout.withdrawalText, 4000) || DEFAULT_WITHDRAWAL,
      termsUrl: clean(checkout.termsUrl, 300),
      holdMinutes: num(checkout.holdMinutes, 60, { min: 30, max: 1440 }),
      reminderConsent: checkout.reminderConsent !== false,
      reminderText: clean(checkout.reminderText, 300) || 'Send meg en påminnelse på e-post hvis jeg ikke fullfører bestillingen.',
      accentColor: /^#[0-9a-f]{3,8}$/i.test(clean(checkout.accentColor, 9)) ? clean(checkout.accentColor, 9) : '#111827',
      lowStockAt: num(checkout.lowStockAt, 3, { min: 0, max: 100000 }),
      maxQuantity: num(checkout.maxQuantity, 99, { min: 1, max: 10000 }),
    },
    orders: {
      numberStart: num(input.orders?.numberStart, 1001, { min: 1, max: 1e9 }),
      prefix: clean(input.orders?.prefix, 10).replace(/[^A-Za-z0-9-]/g, ''),
      testMode: Boolean(input.orders?.testMode),
    },
    bookings: {
      hours: input.bookings?.hours ? normalizeHours(bookings.hours) : DEFAULT_HOURS,
      closedDates: (Array.isArray(bookings.closedDates) ? bookings.closedDates : []).map((d) => clean(d, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 400),
      slotStepMinutes: num(bookings.slotStepMinutes, 15, { min: 5, max: 240 }),
      minNoticeMinutes: num(bookings.minNoticeMinutes, 120, { min: 0, max: 60 * 24 * 30 }),
      maxDaysAhead: num(bookings.maxDaysAhead, 60, { min: 1, max: 365 }),
      cancelHours: num(bookings.cancelHours, 24, { min: 0, max: 24 * 30 }),
      payMode: ['prepay', 'reserve', 'both'].includes(bookings.payMode) ? bookings.payMode : 'prepay',
      timezone: clean(bookings.timezone, 60) || 'Europe/Oslo',
      location: clean(bookings.location, 200),
      staff: (Array.isArray(bookings.staff) ? bookings.staff : [])
        .slice(0, 50)
        .map((s, i) => ({ id: id('staff', s?.id, i), name: clean(s?.name, 80) || `Ansatt ${i + 1}`, hours: s?.hours ? normalizeHours(s.hours) : null, active: s?.active !== false })),
    },
    giftcards: {
      validityMonths: num(giftcards.validityMonths, 36, { min: 1, max: 120 }),
    },
  };
}

/** VAT % for a line, or 0 when not VAT registered / export zero-rating applies. */
export function taxRateFor(settings, { country, taxClass }) {
  if (!settings.seller.vatRegistered) return 0;
  const home = settings.country;
  const buyer = String(country || home).toUpperCase();
  if (settings.tax.exportZeroRated && buyer !== home) return 0;
  const klass = taxClass || 'standard';
  const rates = settings.tax.rates;
  const hit = rates.find((r) => r.country === buyer && r.taxClass === klass)
    || rates.find((r) => r.country === '*' && r.taxClass === klass)
    || rates.find((r) => r.country === home && r.taxClass === klass)
    || rates.find((r) => r.country === home && r.taxClass === 'standard');
  return hit ? hit.rate : 0;
}

/** Shipping zone for a country, the catch-all zone, or null. */
export function zoneForCountry(settings, country) {
  const code = String(country || settings.country).toUpperCase();
  return settings.shipping.zones.find((z) => z.countries.includes(code)) || settings.shipping.zones.find((z) => z.countries.includes('*')) || null;
}

/** Countries a buyer can ship to (zones with at least one enabled non-pickup method). '*' = rest of world. */
export function shippableCountries(settings) {
  const out = new Set();
  for (const zone of settings.shipping.zones) {
    if (!zone.methods.some((m) => m.enabled && m.type !== 'pickup')) continue;
    for (const c of zone.countries) out.add(c);
  }
  if (!out.size) out.add(settings.country);
  return [...out];
}
