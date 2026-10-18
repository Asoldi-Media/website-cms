/** Shop settings and private files for digital products. */
import { useEffect, useRef, useState } from 'react';
import { Btn, Card, Check, ErrorLine, Field, OwnerNote, inputClass, useAction, useLoad, useShopApi, when } from './shop-ui.jsx';

const DAYS = [['mon', 'Man'], ['tue', 'Tir'], ['wed', 'Ons'], ['thu', 'Tor'], ['fri', 'Fre'], ['sat', 'Lør'], ['sun', 'Søn']];
const METHOD_TYPES = [['flat', 'Fast pris'], ['free', 'Gratis'], ['weight', 'Etter vekt'], ['pickup', 'Henting']];

const hoursText = (ranges = []) => ranges.map(([a, b]) => `${a}-${b}`).join(', ');
const parseHours = (text) => String(text).split(',').map((r) => r.trim().split('-').map((x) => x.trim())).filter(([a, b]) => a && b);

function HoursEditor({ hours, onChange }) {
  return (
    <div className="grid grid-cols-7 gap-2">
      {DAYS.map(([day, label]) => (
        <Field key={day} label={label}>
          <input className={inputClass} placeholder="stengt" defaultValue={hoursText(hours?.[day])} onBlur={(e) => onChange({ ...hours, [day]: parseHours(e.target.value) })} />
        </Field>
      ))}
    </div>
  );
}

/** Seller details, MVA, shipping zones, checkout and booking settings. */
export function ShopSettingsPanel({ authHeaders, setLoading, isOwner }) {
  const api = useShopApi(authHeaders);
  const act = useAction(setLoading);
  const [saved, reload, error] = useLoad(api, '/shop/admin/settings', null);
  const [s, setS] = useState(null);
  useEffect(() => {
    if (saved) setS(structuredClone(saved));
  }, [saved]);
  if (!s) return <ErrorLine error={error} />;

  const sec = (key, patch) => setS((x) => ({ ...x, [key]: { ...x[key], ...patch } }));
  const save = (...keys) => act(async () => {
    const body = Object.fromEntries(keys.map((k) => [k, s[k]]));
    setS(structuredClone(await api('PUT', '/shop/admin/settings', body)));
    await reload();
  });
  const zones = s.shipping.zones;
  const setZone = (i, patch) => sec('shipping', { zones: zones.map((z, j) => (j === i ? { ...z, ...patch } : z)) });
  const setMethod = (zi, mi, patch) => setZone(zi, { methods: zones[zi].methods.map((m, j) => (j === mi ? { ...m, ...patch } : m)) });
  const SaveBtn = ({ keys }) => <Btn className="mt-4" disabled={!isOwner} onClick={() => save(...keys)}>Lagre</Btn>;

  return (
    <div>
      <OwnerNote isOwner={isOwner} />
      <Card title="Selger (står på kvitteringer)">
        <div className="grid md:grid-cols-3 gap-3">
          <Field label="Juridisk navn"><input className={inputClass} value={s.seller.legalName} onChange={(e) => sec('seller', { legalName: e.target.value })} /></Field>
          <Field label="Org.nr."><input className={inputClass} value={s.seller.orgNumber} onChange={(e) => sec('seller', { orgNumber: e.target.value })} /></Field>
          <Field label="E-post (svar fra kunder)"><input className={inputClass} value={s.seller.email} onChange={(e) => sec('seller', { email: e.target.value })} /></Field>
          <Field label="Adresse"><input className={inputClass} value={s.seller.address} onChange={(e) => sec('seller', { address: e.target.value })} /></Field>
          <Field label="Postnr."><input className={inputClass} value={s.seller.postal} onChange={(e) => sec('seller', { postal: e.target.value })} /></Field>
          <Field label="Sted"><input className={inputClass} value={s.seller.city} onChange={(e) => sec('seller', { city: e.target.value })} /></Field>
          <Field label="Telefon"><input className={inputClass} value={s.seller.phone} onChange={(e) => sec('seller', { phone: e.target.value })} /></Field>
        </div>
        <div className="flex gap-4 mt-3">
          <Check label="MVA-registrert" checked={s.seller.vatRegistered} onChange={(v) => sec('seller', { vatRegistered: v })} />
          <Check label="Registrert i Foretaksregisteret (AS m.fl.)" checked={s.seller.foretaksregisteret} onChange={(v) => sec('seller', { foretaksregisteret: v })} />
        </div>
        <SaveBtn keys={['seller']} />
      </Card>

      <Card title="MVA">
        <div className="flex flex-wrap gap-4 mb-3">
          <Check label="Prisene jeg skriver inn er inkl. MVA" checked={s.tax.pricesIncludeTax} onChange={(v) => sec('tax', { pricesIncludeTax: v })} />
          <Check label="Nullsats ved salg til utlandet (eksport)" checked={s.tax.exportZeroRated} onChange={(v) => sec('tax', { exportZeroRated: v })} />
        </div>
        <table className="w-full text-sm mb-2">
          <thead><tr className="text-xs text-gray-400 text-left"><th>Land</th><th>Klasse</th><th>Sats %</th><th /></tr></thead>
          <tbody>
            {s.tax.rates.map((r, i) => (
              <tr key={i}>
                <td className="pr-2 py-1"><input className={inputClass} value={r.country} onChange={(e) => sec('tax', { rates: s.tax.rates.map((x, j) => (j === i ? { ...x, country: e.target.value.toUpperCase() } : x)) })} /></td>
                <td className="pr-2">
                  <select className={inputClass} value={r.taxClass} onChange={(e) => sec('tax', { rates: s.tax.rates.map((x, j) => (j === i ? { ...x, taxClass: e.target.value } : x)) })}>
                    {s.tax.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </td>
                <td className="pr-2"><input type="number" min="0" max="100" className={inputClass} value={r.rate} onChange={(e) => sec('tax', { rates: s.tax.rates.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)) })} /></td>
                <td><Btn kind="ghost" className="text-xs" onClick={() => sec('tax', { rates: s.tax.rates.filter((_, j) => j !== i) })}>Fjern</Btn></td>
              </tr>
            ))}
          </tbody>
        </table>
        <Btn kind="ghost" className="text-xs" onClick={() => sec('tax', { rates: [...s.tax.rates, { country: s.country, taxClass: 'standard', rate: 25 }] })}>Legg til sats</Btn>
        <p className="text-xs text-gray-500 mt-2">Hvert produkt har en MVA-klasse (standard 25 %, mat 15 %, redusert 12 %, fritatt 0 %). Frakt får samme sats som varene.</p>
        <SaveBtn keys={['tax']} />
      </Card>

      <Card title="Frakt">
        {zones.map((z, zi) => (
          <div key={z.id || zi} className="rounded-lg border border-white/10 p-4 mb-3">
            <div className="grid md:grid-cols-3 gap-3 mb-3">
              <Field label="Sone"><input className={inputClass} value={z.name} onChange={(e) => setZone(zi, { name: e.target.value })} /></Field>
              <Field label="Land (NO, SE … eller * for resten)" className="md:col-span-2"><input className={inputClass} value={z.countries.join(', ')} onChange={(e) => setZone(zi, { countries: e.target.value.split(/[,\s]+/).filter(Boolean).map((c) => c.toUpperCase()) })} /></Field>
            </div>
            {z.methods.map((m, mi) => (
              <div key={m.id || mi} className="grid md:grid-cols-7 gap-2 mb-2 items-end">
                <Field label="Type">
                  <select className={inputClass} value={m.type} onChange={(e) => setMethod(zi, mi, { type: e.target.value })}>
                    {METHOD_TYPES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                  </select>
                </Field>
                <Field label="Navn" className="md:col-span-2"><input className={inputClass} value={m.name} onChange={(e) => setMethod(zi, mi, { name: e.target.value })} /></Field>
                {m.type === 'flat' && <Field label="Pris kr"><input type="number" min="0" className={inputClass} value={m.price} onChange={(e) => setMethod(zi, mi, { price: e.target.value })} /></Field>}
                {m.type === 'weight' && (
                  <Field label="Vekt-trinn (gram:kr, …)">
                    <input className={inputClass} defaultValue={m.tiers.map((t) => `${t.upToGrams}:${t.price}`).join(', ')} onBlur={(e) => setMethod(zi, mi, { tiers: e.target.value.split(',').map((x) => x.split(':').map((y) => y.trim())).filter(([g]) => g).map(([g, p]) => ({ upToGrams: Number(g), price: Number(p) })) })} />
                  </Field>
                )}
                {m.type === 'pickup' && <Field label="Henteadresse"><input className={inputClass} value={m.pickupAddress} onChange={(e) => setMethod(zi, mi, { pickupAddress: e.target.value })} /></Field>}
                {m.type === 'free' && <Field label="Min. handel kr"><input type="number" min="0" className={inputClass} value={m.minAmount} onChange={(e) => setMethod(zi, mi, { minAmount: e.target.value })} /></Field>}
                {['flat', 'weight'].includes(m.type) && <Field label="Gratis over kr"><input type="number" min="0" className={inputClass} value={m.freeOver} onChange={(e) => setMethod(zi, mi, { freeOver: e.target.value })} /></Field>}
                <Field label="Dager (min–maks)">
                  <div className="flex gap-1">
                    <input type="number" min="0" className={inputClass} value={m.estimateMinDays} onChange={(e) => setMethod(zi, mi, { estimateMinDays: e.target.value })} />
                    <input type="number" min="0" className={inputClass} value={m.estimateMaxDays} onChange={(e) => setMethod(zi, mi, { estimateMaxDays: e.target.value })} />
                  </div>
                </Field>
                <div className="flex gap-2 items-center">
                  <Check label="På" checked={m.enabled} onChange={(v) => setMethod(zi, mi, { enabled: v })} />
                  <Btn kind="ghost" className="text-xs" onClick={() => setZone(zi, { methods: z.methods.filter((_, j) => j !== mi) })}>Fjern</Btn>
                </div>
              </div>
            ))}
            <div className="flex gap-2 mt-2">
              <Btn kind="ghost" className="text-xs" onClick={() => setZone(zi, { methods: [...z.methods, { type: 'flat', name: 'Posten', price: 99, freeOver: 0, minAmount: 0, tiers: [], estimateMinDays: 2, estimateMaxDays: 5, pickupAddress: '', enabled: true }] })}>Legg til fraktmåte</Btn>
              <Btn kind="danger" className="text-xs" onClick={() => sec('shipping', { zones: zones.filter((_, j) => j !== zi) })}>Slett sone</Btn>
            </div>
          </div>
        ))}
        <Btn kind="ghost" className="text-xs" onClick={() => sec('shipping', { zones: [...zones, { name: 'Ny sone', countries: [], methods: [] }] })}>Legg til sone</Btn>
        <SaveBtn keys={['shipping']} />
      </Card>

      <Card title="Kasse og ordrer">
        <div className="grid md:grid-cols-3 gap-3">
          <Field label="Tekst på kjøpsknappen" hint="Må gjøre det klart at kunden forplikter seg til å betale."><input className={inputClass} value={s.checkout.buttonText} onChange={(e) => sec('checkout', { buttonText: e.target.value })} /></Field>
          <Field label="Lenke til salgsbetingelser"><input className={inputClass} value={s.checkout.termsUrl} onChange={(e) => sec('checkout', { termsUrl: e.target.value })} /></Field>
          <Field label="Reserver varer i minutter (30–1440)"><input type="number" min="30" max="1440" className={inputClass} value={s.checkout.holdMinutes} onChange={(e) => sec('checkout', { holdMinutes: e.target.value })} /></Field>
          <Field label="Varsle ved lager på eller under"><input type="number" min="0" className={inputClass} value={s.checkout.lowStockAt} onChange={(e) => sec('checkout', { lowStockAt: e.target.value })} /></Field>
          <Field label="Maks antall per vare"><input type="number" min="1" className={inputClass} value={s.checkout.maxQuantity} onChange={(e) => sec('checkout', { maxQuantity: e.target.value })} /></Field>
          <Field label="Knappefarge"><input type="color" className="h-10 w-full rounded" value={s.checkout.accentColor} onChange={(e) => sec('checkout', { accentColor: e.target.value })} /></Field>
          <Field label="Betingelser (vises over kjøpsknappen)" className="md:col-span-3"><textarea rows={2} className={inputClass} value={s.checkout.termsText} onChange={(e) => sec('checkout', { termsText: e.target.value })} /></Field>
          <Field label="Angrerett-tekst (kvittering og kasse)" className="md:col-span-3"><textarea rows={3} className={inputClass} value={s.checkout.withdrawalText} onChange={(e) => sec('checkout', { withdrawalText: e.target.value })} /></Field>
          <Field label="Påminnelsestekst (avkrysning)" className="md:col-span-2"><input className={inputClass} value={s.checkout.reminderText} onChange={(e) => sec('checkout', { reminderText: e.target.value })} /></Field>
          <div className="self-end"><Check label="Tilby én påminnelse om forlatt kasse" checked={s.checkout.reminderConsent} onChange={(v) => sec('checkout', { reminderConsent: v })} /></div>
          <Field label="Ordrenummer starter på"><input type="number" min="1" className={inputClass} value={s.orders.numberStart} onChange={(e) => sec('orders', { numberStart: e.target.value })} /></Field>
          <Field label="Prefiks (valgfritt)"><input className={inputClass} value={s.orders.prefix} onChange={(e) => sec('orders', { prefix: e.target.value })} /></Field>
          <Field label="Gavekort gyldig i måneder" hint="Minst 36 er vanlig (foreldelse)."><input type="number" min="1" className={inputClass} value={s.giftcards.validityMonths} onChange={(e) => sec('giftcards', { validityMonths: e.target.value })} /></Field>
        </div>
        <SaveBtn keys={['checkout', 'orders', 'giftcards']} />
      </Card>

      <Card title="Timebestilling">
        <div className="grid md:grid-cols-4 gap-3 mb-4">
          <Field label="Betaling">
            <select className={inputClass} value={s.bookings.payMode} onChange={(e) => sec('bookings', { payMode: e.target.value })}>
              <option value="prepay">Betal på nett</option>
              <option value="reserve">Betal på stedet</option>
              <option value="both">Kunden velger</option>
            </select>
          </Field>
          <Field label="Tidsluker hvert (min)"><input type="number" min="5" className={inputClass} value={s.bookings.slotStepMinutes} onChange={(e) => sec('bookings', { slotStepMinutes: e.target.value })} /></Field>
          <Field label="Minst varsel (min)"><input type="number" min="0" className={inputClass} value={s.bookings.minNoticeMinutes} onChange={(e) => sec('bookings', { minNoticeMinutes: e.target.value })} /></Field>
          <Field label="Book inntil dager frem"><input type="number" min="1" className={inputClass} value={s.bookings.maxDaysAhead} onChange={(e) => sec('bookings', { maxDaysAhead: e.target.value })} /></Field>
          <Field label="Avbestilling senest (timer før)"><input type="number" min="0" className={inputClass} value={s.bookings.cancelHours} onChange={(e) => sec('bookings', { cancelHours: e.target.value })} /></Field>
          <Field label="Sted (i kalenderinvitasjonen)" className="md:col-span-3"><input className={inputClass} value={s.bookings.location} onChange={(e) => sec('bookings', { location: e.target.value })} /></Field>
        </div>
        <h4 className="text-sm text-gray-400 mb-2">Åpningstider (f.eks. 09:00-12:00, 13:00-17:00)</h4>
        <HoursEditor hours={s.bookings.hours} onChange={(hours) => sec('bookings', { hours })} />
        <Field label="Stengte datoer (ÅÅÅÅ-MM-DD, komma)" className="mt-3"><input className={inputClass} defaultValue={s.bookings.closedDates.join(', ')} onBlur={(e) => sec('bookings', { closedDates: e.target.value.split(/[,\s]+/).filter(Boolean) })} /></Field>
        <h4 className="text-sm text-gray-400 mt-4 mb-2">Ansatte</h4>
        {s.bookings.staff.map((st, i) => (
          <div key={st.id || i} className="rounded-lg border border-white/10 p-3 mb-2">
            <div className="flex flex-wrap gap-3 items-end mb-2">
              <Field label="Navn"><input className={inputClass} value={st.name} onChange={(e) => sec('bookings', { staff: s.bookings.staff.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} /></Field>
              <Check label="Aktiv" checked={st.active} onChange={(v) => sec('bookings', { staff: s.bookings.staff.map((x, j) => (j === i ? { ...x, active: v } : x)) })} />
              <Check label="Egne arbeidstider" checked={Boolean(st.hours)} onChange={(v) => sec('bookings', { staff: s.bookings.staff.map((x, j) => (j === i ? { ...x, hours: v ? structuredClone(s.bookings.hours) : null } : x)) })} />
              <Btn kind="ghost" className="text-xs" onClick={() => sec('bookings', { staff: s.bookings.staff.filter((_, j) => j !== i) })}>Fjern</Btn>
            </div>
            {st.hours && <HoursEditor hours={st.hours} onChange={(hours) => sec('bookings', { staff: s.bookings.staff.map((x, j) => (j === i ? { ...x, hours } : x)) })} />}
          </div>
        ))}
        <Btn kind="ghost" className="text-xs" onClick={() => sec('bookings', { staff: [...s.bookings.staff, { name: '', active: true, hours: null }] })}>Legg til ansatt</Btn>
        <SaveBtn keys={['bookings']} />
      </Card>
    </div>
  );
}

/** Private files that digital products deliver after payment. */
export function ShopFilesPanel({ authHeaders, setLoading, isOwner }) {
  const api = useShopApi(authHeaders);
  const act = useAction(setLoading);
  const [files, reloadFiles] = useLoad(api, '/shop/admin/files', []);
  const [audit] = useLoad(api, isOwner ? '/shop/admin/audit' : '', []);
  const [preview, setPreview] = useState(null);
  const [csv, setCsv] = useState('');
  const fileRef = useRef(null);
  const upload = (file) => act(async () => {
    const data = new FormData();
    data.append('file', file);
    const saved = await api('POST', '/shop/admin/files', data);
    await reloadFiles();
    window.alert(`Lastet opp ${saved.name}. Velg filen på et digitalt produkt.`);
  });
  const removeFile = (f) => act(async () => {
    await api('DELETE', `/shop/admin/files/${encodeURIComponent(f.file)}`);
    await reloadFiles();
  }, { confirm: 'Slette filen? Kjøpte nedlastingslenker slutter å virke.' });
  const exportCsv = async () => {
    const res = await api('GET', '/shop/admin/products/export.csv', undefined, { raw: true });
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: 'produkter.csv' }).click();
    URL.revokeObjectURL(url);
  };
  const runImport = (dryRun) => act(async () => {
    const result = await api('POST', `/shop/admin/products/import${dryRun ? '?dryRun=1' : ''}`, csv, { contentType: 'text/csv' });
    setPreview({ ...result, dryRun });
  });

  return (
    <div>
      <OwnerNote isOwner={isOwner} />
      <Card title="Filer for digitale produkter" actions={isOwner && <Btn onClick={() => fileRef.current?.click()}>Last opp</Btn>}>
        <input ref={fileRef} type="file" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <p className="text-xs text-gray-400 mb-3">Filene ligger privat på serveren. Kunden får en personlig lenke med begrenset antall nedlastinger etter betaling.</p>
        {!files.length && <p className="text-gray-500 text-sm">Ingen filer.</p>}
        {files.map((f) => (
          <div key={f.file} className="flex justify-between py-1 text-sm text-gray-200 border-b border-white/5">
            <span className="font-mono">{f.file}</span>
            <span className="flex gap-3 items-center">{(f.size / 1024 / 1024).toFixed(1)} MB {isOwner && <Btn kind="danger" className="text-xs" onClick={() => removeFile(f)}>Slett</Btn>}</span>
          </div>
        ))}
      </Card>
      <Card title="Importer / eksporter produkter (CSV)" actions={<Btn kind="ghost" onClick={exportCsv}>Last ned CSV</Btn>}>
        <p className="text-xs text-gray-400 mb-2">Lim inn en CSV fra WooCommerce, Shopify eller vår egen eksport. Produkter med samme SKU oppdateres. Sjekk først med «Forhåndsvis».</p>
        <input type="file" accept=".csv,text/csv" className="text-sm text-gray-300 mb-2" onChange={async (e) => setCsv(await e.target.files?.[0]?.text() || '')} />
        <textarea rows={5} className={`${inputClass} font-mono text-xs`} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="Handle,Title,Variant Price,…" />
        <div className="flex gap-2 mt-2">
          <Btn kind="ghost" disabled={!csv.trim()} onClick={() => runImport(true)}>Forhåndsvis</Btn>
          <Btn disabled={!csv.trim() || !isOwner || !preview?.dryRun} onClick={() => runImport(false)}>Importer</Btn>
        </div>
        {preview && (
          <div className="text-sm text-gray-200 mt-3">
            <p>{preview.dryRun ? 'Forhåndsvisning' : 'Importert'} ({preview.format}): {preview.created} nye, {preview.updated} oppdatert{preview.newCategories?.length ? `, nye kategorier: ${preview.newCategories.join(', ')}` : ''}.</p>
            {preview.errors?.map((e, i) => <p key={i} className="text-yellow-200 text-xs">{typeof e === 'string' ? e : JSON.stringify(e)}</p>)}
          </div>
        )}
      </Card>
      {isOwner && (
        <Card title="Endringslogg (penger og innstillinger)">
          {!audit.length && <p className="text-gray-500 text-sm">Ingen endringer logget.</p>}
          {audit.slice(0, 50).map((a, i) => (
            <div key={`${a.at}-${i}`} className="text-sm text-gray-300"><span className="text-gray-500">{when(a.at)}</span> {a.action} · {a.by}{a.sections ? ` · ${a.sections.join(', ')}` : ''}{a.amountMinor ? ` · ${(a.amountMinor / 100).toFixed(2)} kr` : ''}</div>
          ))}
        </Card>
      )}
    </div>
  );
}
