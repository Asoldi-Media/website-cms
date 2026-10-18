/** Shop section of the product editor: kind, MVA, shipping, variants, sale price and stock. */
import { useState } from 'react';
import { Btn, Check, Field, inputClass, useLoad, useShopApi } from './shop-ui.jsx';

export const COMMERCE_KEYS = ['kind', 'taxClass', 'requiresShipping', 'sku', 'barcode', 'brand', 'weightGrams', 'salePrice', 'saleFrom', 'saleTo', 'backorders', 'lowStockAt', 'maxPerOrder', 'options', 'variants', 'digitalFiles', 'downloadLimit', 'downloadDays', 'booking', 'subscription', 'giftcard', 'reviewsEnabled'];

const KINDS = [
  ['physical', 'Fysisk vare (sendes)'],
  ['digital', 'Digital nedlasting'],
  ['service', 'Tjeneste'],
  ['booking', 'Timebestilling'],
  ['subscription', 'Abonnement'],
  ['giftcard', 'Gavekort'],
];

/** Shop fields for a new product of this catalog type. */
export function defaultCommerce(catalogType = 'normal') {
  return {
    kind: catalogType === 'menu' || catalogType === 'tiers' ? 'service' : 'physical',
    taxClass: '',
    requiresShipping: catalogType !== 'menu' && catalogType !== 'tiers',
    sku: '',
    barcode: '',
    brand: '',
    weightGrams: '',
    salePrice: '',
    saleFrom: '',
    saleTo: '',
    backorders: 'no',
    lowStockAt: '',
    maxPerOrder: '',
    options: [],
    variants: [],
    digitalFiles: [],
    downloadLimit: 5,
    downloadDays: 30,
    booking: { durationMinutes: 60, bufferMinutes: 0, capacity: 1, staffIds: [], requiresConfirmation: false },
    subscription: { interval: 'month', intervalCount: 1, trialDays: 0 },
    giftcard: { amounts: [250, 500, 1000], allowCustom: false, min: 100, max: 10000 },
    reviewsEnabled: true,
  };
}

/** Shop fields of a stored product, ready for the form. */
export function commerceFromProduct(product, catalogType) {
  const base = defaultCommerce(catalogType);
  for (const key of COMMERCE_KEYS) if (product?.[key] !== undefined) base[key] = structuredClone(product[key]);
  return base;
}

const keyOf = (values) => Object.keys(values).sort().map((k) => `${k}=${values[k]}`).join('|');

function combos(options) {
  return options.reduce((acc, o) => acc.flatMap((a) => o.values.map((v) => ({ ...a, [o.name]: v }))), [{}]);
}

const local = (iso) => (iso ? String(iso).slice(0, 16) : '');
const isoOrBlank = (v) => (v ? new Date(v).toISOString() : '');

/** Product editor section for kind, MVA, shipping, variants, sale and stock. */
export function CommerceFields({ value, onChange, authHeaders }) {
  const api = useShopApi(authHeaders);
  const [settings] = useLoad(api, '/shop/admin/settings', null);
  const [files] = useLoad(api, '/shop/admin/files', []);
  const [optionsText, setOptionsText] = useState(() => value.options.map((o) => `${o.name}: ${o.values.join(', ')}`).join('\n'));
  const c = value;
  const set = (patch) => onChange({ ...c, ...patch });
  const setIn = (key, patch) => onChange({ ...c, [key]: { ...c[key], ...patch } });
  const classes = settings?.tax?.classes || [];
  const staff = settings?.bookings?.staff || [];

  const buildVariants = () => {
    const options = optionsText
      .split('\n')
      .map((line) => {
        const [name, rest = ''] = line.split(':');
        return { name: name.trim(), values: [...new Set(rest.split(',').map((v) => v.trim()).filter(Boolean))] };
      })
      .filter((o) => o.name && o.values.length)
      .slice(0, 3);
    const existing = new Map(c.variants.map((v) => [keyOf(v.optionValues), v]));
    const variants = combos(options).map((optionValues, i) => existing.get(keyOf(optionValues)) || { id: `v${Date.now().toString(36)}${i}`, optionValues, sku: '', barcode: '', price: '', salePrice: '', stockQty: '', weightGrams: '', imageUrl: '', enabled: true });
    set({ options, variants: options.length ? variants : [] });
  };
  const setVariant = (i, patch) => set({ variants: c.variants.map((v, j) => (j === i ? { ...v, ...patch } : v)) });

  return (
    <div className="md:col-span-2 rounded-xl border border-white/10 p-4 mt-2">
      <h3 className="text-white font-semibold mb-3">Salg i nettbutikken</h3>
      <div className="grid md:grid-cols-3 gap-3">
        <Field label="Type">
          <select className={inputClass} value={c.kind} onChange={(e) => set({ kind: e.target.value, requiresShipping: e.target.value === 'physical' })}>
            {KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </Field>
        <Field label="MVA-klasse">
          <select className={inputClass} value={c.taxClass} onChange={(e) => set({ taxClass: e.target.value })}>
            <option value="">Standard</option>
            {classes.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
        </Field>
        <Field label="SKU / varenummer"><input className={inputClass} value={c.sku} onChange={(e) => set({ sku: e.target.value })} /></Field>
        <Field label="Salgspris (kr)" hint="Førpris (laveste pris siste 30 dager) vises automatisk."><input className={inputClass} value={c.salePrice} onChange={(e) => set({ salePrice: e.target.value })} /></Field>
        <Field label="Salg fra"><input type="datetime-local" className={inputClass} value={local(c.saleFrom)} onChange={(e) => set({ saleFrom: isoOrBlank(e.target.value) })} /></Field>
        <Field label="Salg til"><input type="datetime-local" className={inputClass} value={local(c.saleTo)} onChange={(e) => set({ saleTo: isoOrBlank(e.target.value) })} /></Field>
        {c.kind === 'physical' && (
          <>
            <Field label="Vekt (gram)"><input type="number" min="0" className={inputClass} value={c.weightGrams} onChange={(e) => set({ weightGrams: e.target.value })} /></Field>
            <Field label="Strekkode (EAN/GTIN)"><input className={inputClass} value={c.barcode} onChange={(e) => set({ barcode: e.target.value })} /></Field>
            <Field label="Merke"><input className={inputClass} value={c.brand} onChange={(e) => set({ brand: e.target.value })} /></Field>
          </>
        )}
        <Field label="Varsle ved lager under"><input type="number" min="0" className={inputClass} value={c.lowStockAt} placeholder="butikkens standard" onChange={(e) => set({ lowStockAt: e.target.value })} /></Field>
        <Field label="Maks per ordre"><input type="number" min="1" className={inputClass} value={c.maxPerOrder} onChange={(e) => set({ maxPerOrder: e.target.value })} /></Field>
        <div className="flex flex-col gap-2 justify-end">
          <Check label="Kan bestilles når tomt (restordre)" checked={c.backorders === 'yes'} onChange={(v) => set({ backorders: v ? 'yes' : 'no' })} />
          <Check label="Tillat omtaler" checked={c.reviewsEnabled} onChange={(v) => set({ reviewsEnabled: v })} />
        </div>
      </div>

      {['physical', 'digital', 'service'].includes(c.kind) && (
        <div className="mt-4">
          <Field label="Varianter: én egenskap per linje, «Navn: verdi, verdi» (maks 3)" hint="F.eks. «Størrelse: S, M, L» og «Farge: Svart, Hvit». Trykk «Lag varianter» etter endring.">
            <textarea rows={2} className={inputClass} value={optionsText} onChange={(e) => setOptionsText(e.target.value)} />
          </Field>
          <Btn kind="ghost" className="text-xs mt-2" onClick={buildVariants}>Lag varianter</Btn>
          {c.variants.length > 0 && (
            <table className="w-full text-sm mt-3">
              <thead><tr className="text-xs text-gray-400 text-left"><th>Variant</th><th>SKU</th><th>Pris kr</th><th>Salg kr</th><th>Lager</th><th>Vekt g</th><th>På</th></tr></thead>
              <tbody>
                {c.variants.map((v, i) => (
                  <tr key={v.id}>
                    <td className="text-gray-200 pr-2">{Object.values(v.optionValues).join(' / ')}</td>
                    <td className="pr-1"><input className={inputClass} value={v.sku} onChange={(e) => setVariant(i, { sku: e.target.value })} /></td>
                    <td className="pr-1"><input className={inputClass} value={v.price} placeholder="som produktet" onChange={(e) => setVariant(i, { price: e.target.value })} /></td>
                    <td className="pr-1"><input className={inputClass} value={v.salePrice} onChange={(e) => setVariant(i, { salePrice: e.target.value })} /></td>
                    <td className="pr-1"><input type="number" min="0" className={inputClass} value={v.stockQty} placeholder="∞" onChange={(e) => setVariant(i, { stockQty: e.target.value })} /></td>
                    <td className="pr-1"><input type="number" min="0" className={inputClass} value={v.weightGrams} onChange={(e) => setVariant(i, { weightGrams: e.target.value })} /></td>
                    <td><input type="checkbox" checked={v.enabled} onChange={(e) => setVariant(i, { enabled: e.target.checked })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {c.kind === 'digital' && (
        <div className="grid md:grid-cols-3 gap-3 mt-4">
          <Field label="Filer kunden får" className="md:col-span-3" hint="Last opp filer under «Filer og import» først.">
            <select multiple className={`${inputClass} h-24`} value={c.digitalFiles.map((f) => f.file)} onChange={(e) => set({ digitalFiles: [...e.target.selectedOptions].map((o) => ({ id: o.value, name: '', file: o.value })) })}>
              {files.map((f) => <option key={f.file} value={f.file}>{f.file}</option>)}
            </select>
          </Field>
          <Field label="Antall nedlastinger"><input type="number" min="1" className={inputClass} value={c.downloadLimit} onChange={(e) => set({ downloadLimit: e.target.value })} /></Field>
          <Field label="Lenken virker i dager"><input type="number" min="1" className={inputClass} value={c.downloadDays} onChange={(e) => set({ downloadDays: e.target.value })} /></Field>
        </div>
      )}

      {c.kind === 'booking' && (
        <div className="grid md:grid-cols-4 gap-3 mt-4">
          <Field label="Varighet (min)"><input type="number" min="5" className={inputClass} value={c.booking.durationMinutes} onChange={(e) => setIn('booking', { durationMinutes: e.target.value })} /></Field>
          <Field label="Pause etter (min)"><input type="number" min="0" className={inputClass} value={c.booking.bufferMinutes} onChange={(e) => setIn('booking', { bufferMinutes: e.target.value })} /></Field>
          <Field label="Plasser per tid"><input type="number" min="1" className={inputClass} value={c.booking.capacity} onChange={(e) => setIn('booking', { capacity: e.target.value })} /></Field>
          <div className="self-end"><Check label="Må bekreftes manuelt" checked={c.booking.requiresConfirmation} onChange={(v) => setIn('booking', { requiresConfirmation: v })} /></div>
          <Field label="Hvem kan utføre (tom = alle)" className="md:col-span-4">
            <select multiple className={`${inputClass} h-24`} value={c.booking.staffIds} onChange={(e) => setIn('booking', { staffIds: [...e.target.selectedOptions].map((o) => o.value) })}>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        </div>
      )}

      {c.kind === 'subscription' && (
        <div className="grid md:grid-cols-3 gap-3 mt-4">
          <Field label="Trekkes hver">
            <select className={inputClass} value={c.subscription.interval} onChange={(e) => setIn('subscription', { interval: e.target.value })}>
              <option value="week">uke</option>
              <option value="month">måned</option>
              <option value="year">år</option>
            </select>
          </Field>
          <Field label="Hver X. periode"><input type="number" min="1" max="12" className={inputClass} value={c.subscription.intervalCount} onChange={(e) => setIn('subscription', { intervalCount: e.target.value })} /></Field>
          <Field label="Gratis prøvedager"><input type="number" min="0" className={inputClass} value={c.subscription.trialDays} onChange={(e) => setIn('subscription', { trialDays: e.target.value })} /></Field>
          <p className="text-xs text-gray-500 md:col-span-3">Abonnement betales med kort (Stripe). Kunden kan si opp på Min side.</p>
        </div>
      )}

      {c.kind === 'giftcard' && (
        <div className="grid md:grid-cols-4 gap-3 mt-4">
          <Field label="Faste beløp (kr, komma)" className="md:col-span-2"><input className={inputClass} defaultValue={c.giftcard.amounts.join(', ')} onBlur={(e) => setIn('giftcard', { amounts: e.target.value.split(',').map((x) => Number(x.trim())).filter((n) => n > 0) })} /></Field>
          <Field label="Min kr"><input type="number" min="1" className={inputClass} value={c.giftcard.min} onChange={(e) => setIn('giftcard', { min: e.target.value })} /></Field>
          <Field label="Maks kr"><input type="number" min="1" className={inputClass} value={c.giftcard.max} onChange={(e) => setIn('giftcard', { max: e.target.value })} /></Field>
          <div className="md:col-span-4"><Check label="Kunden kan velge eget beløp" checked={c.giftcard.allowCustom} onChange={(v) => setIn('giftcard', { allowCustom: v })} /></div>
          <p className="text-xs text-gray-500 md:col-span-4">Gavekort har 0 % MVA ved salg; MVA beregnes når kortet brukes.</p>
        </div>
      )}
    </div>
  );
}
