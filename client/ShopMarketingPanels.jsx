/** Shop admin pages for discounts and gift cards. */
import { useState } from 'react';
import { Badge, Btn, Card, Check, ErrorLine, Field, OwnerNote, inputClass, kr, useAction, useLoad, useShopApi, when } from './shop-ui.jsx';

const TYPES = [
  { id: 'percent', label: 'Prosent av' },
  { id: 'amount', label: 'Kronebeløp av' },
  { id: 'fixed_product', label: 'Kroner av per vare' },
  { id: 'tiered', label: 'Mengderabatt (kjøp flere, spar mer)' },
  { id: 'bxgy', label: 'Kjøp X, få Y' },
  { id: 'free_shipping', label: 'Gratis frakt' },
];

function emptyDiscount() {
  return {
    method: 'code',
    code: '',
    title: '',
    active: true,
    type: 'percent',
    value: 10,
    appliesTo: { productIds: [], categoryIds: [], excludeProductIds: [], excludeSale: false },
    minSubtotal: 0,
    maxSubtotal: 0,
    tiers: [{ minQty: 2, percent: 10 }],
    bxgy: { buyQty: 2, buyProductIds: [], buyCategoryIds: [], getQty: 1, getProductIds: [], getCategoryIds: [], getPercent: 100, maxUses: 0 },
    startsAt: '',
    endsAt: '',
    usageLimit: 0,
    usageLimitPerEmail: 0,
    combinesWith: { product: false, order: false, shipping: true },
  };
}

function Picker({ label, items, value, onChange }) {
  return (
    <Field label={label}>
      <select multiple className={`${inputClass} h-28`} value={value} onChange={(e) => onChange([...e.target.selectedOptions].map((o) => o.value))}>
        {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
      </select>
    </Field>
  );
}

function describe(d) {
  const v = { percent: `${d.value} %`, amount: `${d.value} kr`, fixed_product: `${d.value} kr per vare`, tiered: d.tiers.map((t) => `${t.minQty}+: ${t.percent} %`).join(', '), bxgy: `kjøp ${d.bxgy.buyQty} få ${d.bxgy.getQty} (${d.bxgy.getPercent} % av)`, free_shipping: 'gratis frakt' }[d.type];
  return `${v}${d.minSubtotal ? ` · min ${d.minSubtotal} kr` : ''}`;
}

/** Discount codes and automatic discounts. Only the owner can edit. */
export function ShopDiscountsPanel({ authHeaders, setLoading, isOwner }) {
  const api = useShopApi(authHeaders);
  const act = useAction(setLoading);
  const [rows, reload, error] = useLoad(api, '/shop/admin/discounts', []);
  const [products] = useLoad(api, '/products', []);
  const [categories] = useLoad(api, '/categories', []);
  const [form, setForm] = useState(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setIn = (key, patch) => setForm((f) => ({ ...f, [key]: { ...f[key], ...patch } }));
  const save = () => act(async () => {
    const body = { ...form, startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : '', endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : '' };
    if (form.id) await api('PUT', `/shop/admin/discounts/${form.id}`, body);
    else await api('POST', '/shop/admin/discounts', body);
    setForm(null);
    await reload();
  });
  const toggle = (d) => act(async () => {
    await api('PUT', `/shop/admin/discounts/${d.id}`, { active: !d.active });
    await reload();
  });
  const remove = (d) => act(async () => {
    await api('DELETE', `/shop/admin/discounts/${d.id}`);
    await reload();
  }, { confirm: `Slette ${d.code || d.title}?` });

  return (
    <div>
      <ErrorLine error={error} />
      <OwnerNote isOwner={isOwner} />
      {!form && (
        <Card title="Rabatter" actions={isOwner && <Btn onClick={() => setForm(emptyDiscount())}>Ny rabatt</Btn>}>
          {!rows.length && <p className="text-gray-500 text-sm">Ingen rabatter. Lag en kode (f.eks. HOST10) eller en automatisk rabatt (f.eks. kjøp 3 betal for 2).</p>}
          {rows.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-3 py-2 border-b border-white/5 text-sm">
              <span className="font-mono text-white w-32">{d.method === 'code' ? d.code : 'Automatisk'}</span>
              <span className="flex-1 min-w-[200px] text-gray-200">{d.title || '—'}<br /><span className="text-gray-400">{describe(d)}</span></span>
              <span className="text-gray-400">brukt {d.usedCount}{d.usageLimit ? ` / ${d.usageLimit}` : ''}</span>
              {d.endsAt && <span className="text-gray-500 text-xs">til {when(d.endsAt, false)}</span>}
              <Badge tone={d.active ? 'green' : 'gray'}>{d.active ? 'aktiv' : 'av'}</Badge>
              {isOwner && (
                <>
                  <Btn kind="ghost" className="text-xs" onClick={() => toggle(d)}>{d.active ? 'Slå av' : 'Slå på'}</Btn>
                  <Btn kind="ghost" className="text-xs" onClick={() => setForm({ ...d, startsAt: d.startsAt?.slice(0, 16) || '', endsAt: d.endsAt?.slice(0, 16) || '' })}>Rediger</Btn>
                  <Btn kind="danger" className="text-xs" onClick={() => remove(d)}>Slett</Btn>
                </>
              )}
            </div>
          ))}
        </Card>
      )}
      {form && (
        <Card title={form.id ? 'Rediger rabatt' : 'Ny rabatt'} actions={<Btn kind="ghost" onClick={() => setForm(null)}>Avbryt</Btn>}>
          <div className="grid md:grid-cols-3 gap-3">
            <Field label="Hvordan">
              <select className={inputClass} value={form.method} onChange={(e) => set({ method: e.target.value })}>
                <option value="code">Kunden skriver en kode</option>
                <option value="automatic">Automatisk i handlekurven</option>
              </select>
            </Field>
            {form.method === 'code' && <Field label="Kode"><input className={`${inputClass} font-mono uppercase`} value={form.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} /></Field>}
            <Field label="Navn (vises i kurven og på kvitteringen)"><input className={inputClass} value={form.title} onChange={(e) => set({ title: e.target.value })} /></Field>
            <Field label="Type">
              <select className={inputClass} value={form.type} onChange={(e) => set({ type: e.target.value })}>
                {TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </Field>
            {['percent', 'amount', 'fixed_product'].includes(form.type) && <Field label={form.type === 'percent' ? 'Prosent' : 'Kroner'}><input type="number" min="0" className={inputClass} value={form.value} onChange={(e) => set({ value: e.target.value })} /></Field>}
            <Field label="Minste handlebeløp (kr)"><input type="number" min="0" className={inputClass} value={form.minSubtotal} onChange={(e) => set({ minSubtotal: e.target.value })} /></Field>
          </div>

          {form.type === 'tiered' && (
            <div className="mt-4">
              <h4 className="text-sm text-gray-400 mb-2">Trinn (antall av samme utvalg → prosent av)</h4>
              {form.tiers.map((t, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <input type="number" min="1" className={`${inputClass} w-28`} value={t.minQty} onChange={(e) => set({ tiers: form.tiers.map((x, j) => (j === i ? { ...x, minQty: e.target.value } : x)) })} />
                  <span className="text-gray-400 self-center">stk →</span>
                  <input type="number" min="0" max="100" className={`${inputClass} w-28`} value={t.percent} onChange={(e) => set({ tiers: form.tiers.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)) })} />
                  <span className="text-gray-400 self-center">%</span>
                  <Btn kind="ghost" className="text-xs" onClick={() => set({ tiers: form.tiers.filter((_, j) => j !== i) })}>Fjern</Btn>
                </div>
              ))}
              <Btn kind="ghost" className="text-xs" onClick={() => set({ tiers: [...form.tiers, { minQty: (Number(form.tiers.at(-1)?.minQty) || 1) + 1, percent: 15 }] })}>Legg til trinn</Btn>
            </div>
          )}

          {form.type === 'bxgy' && (
            <div className="grid md:grid-cols-3 gap-3 mt-4">
              <Field label="Kjøp antall"><input type="number" min="1" className={inputClass} value={form.bxgy.buyQty} onChange={(e) => setIn('bxgy', { buyQty: e.target.value })} /></Field>
              <Field label="Få antall"><input type="number" min="1" className={inputClass} value={form.bxgy.getQty} onChange={(e) => setIn('bxgy', { getQty: e.target.value })} /></Field>
              <Field label="Prosent av på det man får" hint="100 = gratis"><input type="number" min="1" max="100" className={inputClass} value={form.bxgy.getPercent} onChange={(e) => setIn('bxgy', { getPercent: e.target.value })} /></Field>
              <Picker label="Kjøp: produkter (tom = alle)" items={products} value={form.bxgy.buyProductIds} onChange={(v) => setIn('bxgy', { buyProductIds: v })} />
              <Picker label="Få: produkter (tom = samme som kjøp)" items={products} value={form.bxgy.getProductIds} onChange={(v) => setIn('bxgy', { getProductIds: v })} />
              <Field label="Maks ganger per ordre (0 = ubegrenset)"><input type="number" min="0" className={inputClass} value={form.bxgy.maxUses} onChange={(e) => setIn('bxgy', { maxUses: e.target.value })} /></Field>
            </div>
          )}

          {!['bxgy', 'free_shipping'].includes(form.type) && (
            <div className="grid md:grid-cols-3 gap-3 mt-4">
              <Picker label="Gjelder produkter (tom = alle)" items={products} value={form.appliesTo.productIds} onChange={(v) => setIn('appliesTo', { productIds: v })} />
              <Picker label="Gjelder kategorier" items={categories} value={form.appliesTo.categoryIds} onChange={(v) => setIn('appliesTo', { categoryIds: v })} />
              <Picker label="Unntatt produkter" items={products} value={form.appliesTo.excludeProductIds} onChange={(v) => setIn('appliesTo', { excludeProductIds: v })} />
            </div>
          )}

          <div className="grid md:grid-cols-4 gap-3 mt-4">
            <Field label="Starter"><input type="datetime-local" className={inputClass} value={form.startsAt} onChange={(e) => set({ startsAt: e.target.value })} /></Field>
            <Field label="Slutter"><input type="datetime-local" className={inputClass} value={form.endsAt} onChange={(e) => set({ endsAt: e.target.value })} /></Field>
            <Field label="Maks bruk totalt (0 = ubegrenset)"><input type="number" min="0" className={inputClass} value={form.usageLimit} onChange={(e) => set({ usageLimit: e.target.value })} /></Field>
            <Field label="Maks per kunde (e-post)"><input type="number" min="0" className={inputClass} value={form.usageLimitPerEmail} onChange={(e) => set({ usageLimitPerEmail: e.target.value })} /></Field>
          </div>
          <div className="flex flex-wrap gap-4 mt-4">
            <Check label="Aktiv" checked={form.active} onChange={(v) => set({ active: v })} />
            {!['bxgy', 'free_shipping'].includes(form.type) && <Check label="Ikke på varer som allerede er på salg" checked={form.appliesTo.excludeSale} onChange={(v) => setIn('appliesTo', { excludeSale: v })} />}
            <span className="text-xs text-gray-400 self-center">Kan kombineres med:</span>
            <Check label="produktrabatter" checked={form.combinesWith.product} onChange={(v) => setIn('combinesWith', { product: v })} />
            <Check label="ordrerabatter" checked={form.combinesWith.order} onChange={(v) => setIn('combinesWith', { order: v })} />
            <Check label="fraktrabatter" checked={form.combinesWith.shipping} onChange={(v) => setIn('combinesWith', { shipping: v })} />
          </div>
          <Btn className="mt-4" disabled={!isOwner} onClick={save}>Lagre rabatt</Btn>
        </Card>
      )}
    </div>
  );
}

/** Gift cards: issue, balance, ledger and deactivate. */
export function ShopGiftcardsPanel({ authHeaders, setLoading, isOwner }) {
  const api = useShopApi(authHeaders);
  const act = useAction(setLoading);
  const [rows, reload, error] = useLoad(api, '/shop/admin/giftcards', []);
  const [form, setForm] = useState({ amount: '', recipientName: '', recipientEmail: '', message: '' });
  const [q, setQ] = useState('');
  const issue = () => act(async () => {
    const card = await api('POST', '/shop/admin/giftcards', form);
    setForm({ amount: '', recipientName: '', recipientEmail: '', message: '' });
    await reload();
    window.alert(`Gavekort laget: ${card.code}`);
  });
  const adjust = (c) => {
    const value = window.prompt('Juster saldo i kr (negativt tall trekker fra):', '');
    if (!value) return null;
    const reason = window.prompt('Årsak:', '') || '';
    return act(async () => {
      await api('PUT', `/shop/admin/giftcards/${c.id}`, { adjust: value, reason });
      await reload();
    });
  };
  const toggle = (c) => act(async () => {
    await api('PUT', `/shop/admin/giftcards/${c.id}`, { active: !c.active });
    await reload();
  });
  const list = rows.filter((c) => !q || `${c.code} ${c.recipientName} ${c.recipientEmail} ${c.orderNumber}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <ErrorLine error={error} />
      <OwnerNote isOwner={isOwner} />
      {isOwner && (
        <Card title="Lag gavekort manuelt">
          <div className="grid md:grid-cols-4 gap-3">
            <Field label="Beløp (kr)"><input type="number" min="1" className={inputClass} value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} /></Field>
            <Field label="Til (navn)"><input className={inputClass} value={form.recipientName} onChange={(e) => setForm((f) => ({ ...f, recipientName: e.target.value }))} /></Field>
            <Field label="Til (e-post, valgfri)"><input className={inputClass} value={form.recipientEmail} onChange={(e) => setForm((f) => ({ ...f, recipientEmail: e.target.value }))} /></Field>
            <Field label="Hilsen"><input className={inputClass} value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} /></Field>
          </div>
          <Btn className="mt-3" disabled={!(Number(form.amount) > 0)} onClick={issue}>Lag gavekort</Btn>
          <p className="text-xs text-gray-500 mt-2">Gavekort som selges i nettbutikken lages automatisk og sendes på e-post.</p>
        </Card>
      )}
      <Card title={`Gavekort (${rows.length})`} actions={<input className={`${inputClass} w-56`} placeholder="Søk kode, navn, ordre" value={q} onChange={(e) => setQ(e.target.value)} />}>
        {!list.length && <p className="text-gray-500 text-sm">Ingen gavekort.</p>}
        {list.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-3 py-2 border-b border-white/5 text-sm">
            <span className="font-mono text-white w-44">{c.code}</span>
            <span className="text-gray-200 flex-1 min-w-[160px]">{c.recipientName || '—'} {c.recipientEmail && <span className="text-gray-400">· {c.recipientEmail}</span>}<br /><span className="text-gray-500">{c.orderNumber ? `ordre ${c.orderNumber}` : 'manuelt'} · utløper {when(c.expiresAt, false)}</span></span>
            <span className="text-white">{kr(c.balanceMinor, c.currency)} <span className="text-gray-500">/ {kr(c.initialMinor, c.currency)}</span></span>
            <Badge tone={c.active ? 'green' : 'gray'}>{c.active ? 'aktiv' : 'sperret'}</Badge>
            {isOwner && (
              <>
                <Btn kind="ghost" className="text-xs" onClick={() => adjust(c)}>Juster</Btn>
                <Btn kind="ghost" className="text-xs" onClick={() => toggle(c)}>{c.active ? 'Sperr' : 'Aktiver'}</Btn>
              </>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}
