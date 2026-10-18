/** Shop admin pages: overview, bookings, customers, subscriptions, reviews, abandoned checkouts. */
import { useMemo, useState } from 'react';
import { Badge, Btn, Card, Check, ErrorLine, Field, inputClass, kr, useAction, useLoad, useShopApi, when } from './shop-ui.jsx';

const isoDay = (d) => d.toISOString().slice(0, 10);
const PROVIDER_LABEL = { stripe: 'Kort (Stripe)', paypal: 'PayPal', giftcard: 'Gavekort', reserve: 'Betal på stedet' };

function Stat({ label, value, tone = '' }) {
  return (
    <div className="rounded-xl bg-[#2a2a2a] border border-white/10 p-4">
      <div className="text-xs text-gray-400">{label}</div>
      <div className={`text-2xl font-semibold ${tone || 'text-white'}`}>{value}</div>
    </div>
  );
}

/** Sales, MVA per rate, orders to ship and low stock. */
export function ShopOverviewPanel({ authHeaders, onOpen }) {
  const api = useShopApi(authHeaders);
  const [range, setRange] = useState({ from: isoDay(new Date(Date.now() - 30 * 86_400_000)), to: isoDay(new Date()) });
  const q = `from=${range.from}&to=${range.to}`;
  const [overview, , overviewError] = useLoad(api, '/shop/admin/overview', null);
  const [report] = useLoad(api, `/shop/admin/reports?${q}`, null);
  const [vat] = useLoad(api, `/shop/admin/reports/vat?${q}`, null);
  const download = async () => {
    const res = await api('GET', `/shop/admin/reports/orders.csv?${q}`, undefined, { raw: true });
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: `ordrer-${range.from}-${range.to}.csv` }).click();
    URL.revokeObjectURL(url);
  };
  const max = Math.max(1, ...(report?.byDay || []).map((d) => d.totalMinor));

  return (
    <div>
      <ErrorLine error={overviewError} />
      {overview && (
        <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          <button type="button" className="text-left" onClick={() => onOpen('orders')}><Stat label="Skal sendes" value={overview.toFulfil} tone={overview.toFulfil ? 'text-yellow-200' : ''} /></button>
          <button type="button" className="text-left" onClick={() => onOpen('products')}><Stat label="Lite på lager" value={overview.lowStock.length} tone={overview.lowStock.length ? 'text-red-300' : ''} /></button>
          <button type="button" className="text-left" onClick={() => onOpen('bookings')}><Stat label="Timer neste 7 dager" value={overview.upcomingBookings} /></button>
          <button type="button" className="text-left" onClick={() => onOpen('reviews')}><Stat label="Omtaler til godkjenning" value={overview.pendingReviews} /></button>
          <button type="button" className="text-left" onClick={() => onOpen('subscriptions')}><Stat label="Aktive abonnement" value={overview.activeSubscriptions} /></button>
          <button type="button" className="text-left" onClick={() => onOpen('abandoned')}><Stat label="Forlatte kasser" value={overview.abandoned} /></button>
        </div>
      )}
      {overview?.lowStock?.length > 0 && (
        <Card title="Lite på lager">
          {overview.lowStock.map((s) => (
            <div key={`${s.productId}-${s.variantId}`} className="text-sm text-gray-200">{s.name}{s.variantLabel ? ` – ${s.variantLabel}` : ''}: <span className="text-red-300">{s.qty} igjen</span></div>
          ))}
        </Card>
      )}
      <Card
        title="Salg"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" className={`${inputClass} w-auto`} value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
            <input type="date" className={`${inputClass} w-auto`} value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
            <Btn kind="ghost" onClick={download}>Last ned CSV</Btn>
          </div>
        }
      >
        {report && (
          <>
            <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
              <Stat label="Ordrer" value={report.orders} />
              <Stat label="Omsetning inkl. MVA" value={kr(report.grossMinor)} />
              <Stat label="Eks. MVA" value={kr(report.netMinor)} />
              <Stat label="Snitt" value={kr(report.averageMinor)} />
              <Stat label="Rabatter" value={kr(report.discountMinor)} />
              <Stat label="Refundert" value={kr(report.refundedMinor)} />
            </div>
            <div className="flex items-end gap-1 h-32 mb-4">
              {report.byDay.map((d) => (
                <div key={d.day} title={`${d.day}: ${kr(d.totalMinor)} (${d.orders})`} className="flex-1 bg-[#FF5B00]/70 rounded-t" style={{ height: `${Math.max(2, (d.totalMinor / max) * 100)}%` }} />
              ))}
              {!report.byDay.length && <p className="text-gray-500 text-sm">Ingen salg i perioden.</p>}
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <h4 className="text-sm text-gray-400 mb-2">Mest solgt</h4>
                {report.topProducts.map((p) => (
                  <div key={`${p.productId}-${p.name}`} className="flex justify-between text-sm text-gray-200"><span>{p.quantity} × {p.name}</span><span>{kr(p.totalMinor)}</span></div>
                ))}
              </div>
              <div>
                <h4 className="text-sm text-gray-400 mb-2">Betalingsmåte</h4>
                {report.byProvider.map((p) => (
                  <div key={p.provider} className="flex justify-between text-sm text-gray-200"><span>{PROVIDER_LABEL[p.provider] || p.provider || 'Manuell'} ({p.orders})</span><span>{kr(p.totalMinor)}</span></div>
                ))}
              </div>
            </div>
          </>
        )}
      </Card>
      {vat && (
        <Card title="MVA for perioden (til MVA-meldingen)">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 text-left">
                <th className="py-1">Sats</th><th className="text-right">Salg grunnlag</th><th className="text-right">Kreditert grunnlag</th><th className="text-right">Netto grunnlag</th><th className="text-right">Utgående MVA</th>
              </tr>
            </thead>
            <tbody>
              {vat.rates.map((r) => (
                <tr key={r.rate} className="text-gray-200 border-t border-white/5">
                  <td className="py-1">{r.rate} %</td><td className="text-right">{kr(r.salesNetMinor)}</td><td className="text-right">{kr(r.creditNetMinor)}</td><td className="text-right">{kr(r.netMinor)}</td><td className="text-right">{kr(r.taxMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-right text-white font-semibold mt-2">Sum MVA: {kr(vat.taxMinor)}</p>
        </Card>
      )}
    </div>
  );
}

const BOOKING_TONE = { confirmed: 'green', pending: 'yellow', cancelled: 'red', completed: 'blue', no_show: 'red' };

/** Bookings list with cancel and reschedule. */
export function ShopBookingsPanel({ authHeaders, setLoading }) {
  const api = useShopApi(authHeaders);
  const act = useAction(setLoading);
  const [from, setFrom] = useState(isoDay(new Date()));
  const to = isoDay(new Date(Date.parse(from) + 30 * 86_400_000));
  const [rows, reload, error] = useLoad(api, `/shop/admin/bookings?from=${from}&to=${to}`, []);
  const [products] = useLoad(api, '/products', []);
  const [settings] = useLoad(api, '/shop/admin/settings', null);
  const services = products.filter((p) => p.kind === 'booking');
  const staff = settings?.bookings?.staff || [];
  const [form, setForm] = useState({ productId: '', start: '', staffId: '', customerName: '', customerEmail: '', customerPhone: '', note: '', paid: false, force: false });
  const [moving, setMoving] = useState(null);
  const byDay = useMemo(() => {
    const map = new Map();
    for (const b of rows) {
      const day = new Date(b.start).toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' });
      map.set(day, [...(map.get(day) || []), b]);
    }
    return [...map.entries()];
  }, [rows]);

  const create = () => act(async () => {
    await api('POST', '/shop/admin/bookings', { ...form, start: new Date(form.start).toISOString() });
    setForm((f) => ({ ...f, start: '', customerName: '', customerEmail: '', customerPhone: '', note: '' }));
    await reload();
  });
  const update = (b, patch) => act(async () => {
    await api('PUT', `/shop/admin/bookings/${b.id}`, patch);
    setMoving(null);
    await reload();
  });

  return (
    <div>
      <ErrorLine error={error} />
      <Card title="Ny time (telefon / drop-in)">
        <div className="grid md:grid-cols-3 gap-3">
          <Field label="Tjeneste">
            <select className={inputClass} value={form.productId} onChange={(e) => setForm((f) => ({ ...f, productId: e.target.value }))}>
              <option value="">Velg</option>
              {services.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.booking?.durationMinutes} min)</option>)}
            </select>
          </Field>
          <Field label="Tidspunkt"><input type="datetime-local" className={inputClass} value={form.start} onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))} /></Field>
          <Field label="Ansatt">
            <select className={inputClass} value={form.staffId} onChange={(e) => setForm((f) => ({ ...f, staffId: e.target.value }))}>
              <option value="">Hvem som helst</option>
              {staff.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Navn"><input className={inputClass} value={form.customerName} onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))} /></Field>
          <Field label="E-post"><input className={inputClass} value={form.customerEmail} onChange={(e) => setForm((f) => ({ ...f, customerEmail: e.target.value }))} /></Field>
          <Field label="Telefon"><input className={inputClass} value={form.customerPhone} onChange={(e) => setForm((f) => ({ ...f, customerPhone: e.target.value }))} /></Field>
          <Field label="Notat" className="md:col-span-3"><input className={inputClass} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></Field>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
          <div className="flex gap-4">
            <Check label="Betalt" checked={form.paid} onChange={(v) => setForm((f) => ({ ...f, paid: v }))} />
            <Check label="Overstyr (dobbeltbook)" checked={form.force} onChange={(v) => setForm((f) => ({ ...f, force: v }))} />
          </div>
          <Btn disabled={!form.productId || !form.start} onClick={create}>Legg inn time</Btn>
        </div>
        {!services.length && <p className="text-xs text-gray-500 mt-2">Lag et produkt av typen «Booking» under Produkter først.</p>}
      </Card>
      <Card title="Timer" actions={<input type="date" className={`${inputClass} w-auto`} value={from} onChange={(e) => setFrom(e.target.value)} />}>
        {!rows.length && <p className="text-gray-500 text-sm">Ingen timer de neste 30 dagene.</p>}
        {byDay.map(([day, list]) => (
          <div key={day} className="mb-4">
            <h4 className="text-sm text-gray-400 capitalize mb-2">{day}</h4>
            {list.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center gap-3 py-2 border-b border-white/5 text-sm">
                <span className="text-white w-28">{new Date(b.start).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })}–{new Date(b.end).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })}</span>
                <span className="text-gray-200 flex-1 min-w-[160px]">{b.productName}{b.staffName ? ` · ${b.staffName}` : ''}<br /><span className="text-gray-400">{b.customerName} {b.customerPhone} {b.customerEmail}</span>{b.note && <><br /><span className="text-gray-500">{b.note}</span></>}</span>
                <Badge tone={BOOKING_TONE[b.status]}>{b.status}</Badge>
                {b.paid ? <Badge tone="green">betalt</Badge> : <Badge tone="yellow">ikke betalt</Badge>}
                {b.orderNumber && <span className="text-xs text-gray-500">ordre {b.orderNumber}</span>}
                <select className="bg-[#1a1a1a] border border-white/20 text-white rounded px-2 py-1 text-xs" value={b.status} onChange={(e) => update(b, { status: e.target.value })}>
                  {['confirmed', 'pending', 'completed', 'no_show', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                {!b.paid && <Btn kind="ghost" className="text-xs" onClick={() => update(b, { paid: true })}>Merk betalt</Btn>}
                {moving?.id === b.id ? (
                  <span className="flex gap-2">
                    <input type="datetime-local" className={`${inputClass} w-auto`} value={moving.start} onChange={(e) => setMoving((m) => ({ ...m, start: e.target.value }))} />
                    <Btn className="text-xs" onClick={() => update(b, { start: new Date(moving.start).toISOString() })}>Flytt</Btn>
                  </span>
                ) : (
                  <Btn kind="ghost" className="text-xs" onClick={() => setMoving({ id: b.id, start: b.start.slice(0, 16) })}>Flytt</Btn>
                )}
              </div>
            ))}
          </div>
        ))}
      </Card>
    </div>
  );
}

/** Customers built from orders, with order count and total. */
export function ShopCustomersPanel({ authHeaders, setLoading }) {
  const api = useShopApi(authHeaders);
  const act = useAction(setLoading);
  const [q, setQ] = useState('');
  const [rows, reload] = useLoad(api, `/shop/admin/customers?q=${encodeURIComponent(q)}`, []);
  const [open, setOpen] = useState(null);
  const show = (c) => act(async () => setOpen(await api('GET', `/shop/admin/customers/${c.id}`)));
  const save = () => act(async () => {
    await api('PUT', `/shop/admin/customers/${open.id}`, { note: open.note, tags: String(open.tagsText ?? open.tags.join(', ')).split(',') });
    await reload();
    window.alert('Lagret.');
  });

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card title={`Kunder (${rows.length})`} actions={<input className={`${inputClass} w-56`} placeholder="Søk navn, e-post, telefon" value={q} onChange={(e) => setQ(e.target.value)} />}>
        {rows.map((c) => (
          <button key={c.id} type="button" onClick={() => show(c)} className="w-full text-left flex justify-between py-2 border-b border-white/5 text-sm hover:bg-white/5">
            <span className="text-gray-200">{c.name || '—'}<br /><span className="text-gray-400">{c.email}</span></span>
            <span className="text-right text-gray-300">{c.orderIds.length} ordre<br />{kr(c.totalSpentMinor)}</span>
          </button>
        ))}
        {!rows.length && <p className="text-gray-500 text-sm">Kunder dukker opp her etter første bestilling.</p>}
      </Card>
      {open && (
        <Card title={open.name || open.email} actions={<Btn kind="ghost" onClick={() => setOpen(null)}>Lukk</Btn>}>
          <p className="text-sm text-gray-300">{open.email} · {open.phone}</p>
          <p className="text-sm text-gray-400 mb-3">Første kjøp {when(open.firstOrderAt, false)} · sist {when(open.lastOrderAt, false)} · totalt {kr(open.totalSpentMinor)}</p>
          <Field label="Stikkord (komma)"><input className={inputClass} value={open.tagsText ?? open.tags.join(', ')} onChange={(e) => setOpen((o) => ({ ...o, tagsText: e.target.value }))} /></Field>
          <Field label="Notat" className="mt-3"><textarea rows={3} className={inputClass} value={open.note} onChange={(e) => setOpen((o) => ({ ...o, note: e.target.value }))} /></Field>
          <Btn className="mt-3" onClick={save}>Lagre</Btn>
          <h4 className="text-sm text-gray-400 mt-5 mb-2">Ordrer</h4>
          {open.orders.map((o) => <div key={o.id} className="text-sm text-gray-200">{o.number || o.id} · {when(o.purchasedAt, false)} · {kr(o.totalMinor ?? Math.round((o.amount || 0) * 100))} · {o.paymentStatus}</div>)}
          {open.bookings.length > 0 && <h4 className="text-sm text-gray-400 mt-4 mb-2">Timer</h4>}
          {open.bookings.map((b) => <div key={b.id} className="text-sm text-gray-200">{when(b.start)} · {b.productName} · {b.status}</div>)}
          {open.subscriptions.length > 0 && <h4 className="text-sm text-gray-400 mt-4 mb-2">Abonnement</h4>}
          {open.subscriptions.map((s) => <div key={s.id} className="text-sm text-gray-200">{s.lines.map((l) => l.name).join(', ')} · {s.status}</div>)}
        </Card>
      )}
    </div>
  );
}

const SUB_TONE = { active: 'green', trialing: 'blue', past_due: 'yellow', canceled: 'red', cancelled: 'red', unpaid: 'red' };

/** Subscriptions with status and cancel. */
export function ShopSubscriptionsPanel({ authHeaders, setLoading, isOwner }) {
  const api = useShopApi(authHeaders);
  const act = useAction(setLoading);
  const [rows, reload, error] = useLoad(api, '/shop/admin/subscriptions', []);
  const cancel = (s, atPeriodEnd) => act(async () => {
    await api('POST', `/shop/admin/subscriptions/${s.id}/cancel`, { atPeriodEnd });
    await reload();
  }, { confirm: atPeriodEnd ? 'Avslutte ved slutten av perioden?' : 'Avslutte nå? Kunden belastes ikke mer.' });
  return (
    <Card title="Abonnement">
      <ErrorLine error={error} />
      {!rows.length && <p className="text-gray-500 text-sm">Ingen abonnement ennå. Lag et produkt av typen «Abonnement».</p>}
      {rows.map((s) => (
        <div key={s.id} className="flex flex-wrap items-center gap-3 py-2 border-b border-white/5 text-sm">
          <span className="flex-1 min-w-[200px] text-gray-200">{s.lines.map((l) => `${l.quantity} × ${l.name}`).join(', ')}<br /><span className="text-gray-400">{s.name} · {s.email}</span></span>
          <span className="text-gray-300">hver {s.intervalCount > 1 ? `${s.intervalCount}. ` : ''}{{ day: 'dag', week: 'uke', month: 'måned', year: 'år' }[s.interval]}</span>
          <span className="text-gray-400">neste {when(s.currentPeriodEnd, false)}</span>
          <Badge tone={SUB_TONE[s.status]}>{s.status}{s.cancelAtPeriodEnd ? ' (avsluttes)' : ''}</Badge>
          <span className="text-xs text-gray-500">{s.renewals?.length || 0} fornyelser · ordre {s.orderNumber}</span>
          {isOwner && !['canceled', 'cancelled'].includes(s.status) && (
            <>
              {!s.cancelAtPeriodEnd && <Btn kind="ghost" className="text-xs" onClick={() => cancel(s, true)}>Avslutt ved periodeslutt</Btn>}
              <Btn kind="danger" className="text-xs" onClick={() => cancel(s, false)}>Avslutt nå</Btn>
            </>
          )}
        </div>
      ))}
    </Card>
  );
}

/** Review moderation: approve or hide. */
export function ShopReviewsPanel({ authHeaders, setLoading }) {
  const api = useShopApi(authHeaders);
  const act = useAction(setLoading);
  const [rows, reload] = useLoad(api, '/shop/admin/reviews', []);
  const [replies, setReplies] = useState({});
  const update = (r, patch) => act(async () => {
    await api('PUT', `/shop/admin/reviews/${r.id}`, patch);
    await reload();
  });
  const remove = (r) => act(async () => {
    await api('DELETE', `/shop/admin/reviews/${r.id}`);
    await reload();
  }, { confirm: 'Slette omtalen?' });
  return (
    <Card title="Omtaler">
      <p className="text-xs text-gray-400 mb-3">Nye omtaler vises først når du godkjenner dem. «Verifisert kjøp» betyr at e-posten har kjøpt produktet. Ikke slett ærlige negative omtaler bare fordi de er negative (markedsføringsloven).</p>
      {!rows.length && <p className="text-gray-500 text-sm">Ingen omtaler ennå.</p>}
      {rows.map((r) => (
        <div key={r.id} className="py-3 border-b border-white/5 text-sm">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="text-yellow-300">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
            <span className="text-white">{r.productName}</span>
            <span className="text-gray-400">{r.name} · {r.email} · {when(r.createdAt, false)}</span>
            {r.verified && <Badge tone="green">verifisert kjøp</Badge>}
            <Badge tone={{ approved: 'green', pending: 'yellow', rejected: 'red' }[r.status]}>{r.status}</Badge>
          </div>
          <p className="text-gray-200 mb-2 whitespace-pre-line">{r.text}</p>
          <div className="flex flex-wrap gap-2 items-center">
            {r.status !== 'approved' && <Btn className="text-xs" onClick={() => update(r, { status: 'approved' })}>Godkjenn</Btn>}
            {r.status !== 'rejected' && <Btn kind="ghost" className="text-xs" onClick={() => update(r, { status: 'rejected' })}>Avvis</Btn>}
            <input className={`${inputClass} flex-1 min-w-[200px]`} placeholder="Svar fra butikken (vises under omtalen)" value={replies[r.id] ?? r.reply ?? ''} onChange={(e) => setReplies((x) => ({ ...x, [r.id]: e.target.value }))} />
            <Btn kind="ghost" className="text-xs" onClick={() => update(r, { reply: replies[r.id] ?? r.reply })}>Lagre svar</Btn>
            <Btn kind="danger" className="text-xs" onClick={() => remove(r)}>Slett</Btn>
          </div>
        </div>
      ))}
    </Card>
  );
}

/** Abandoned checkouts and whether a reminder was sent. */
export function ShopAbandonedPanel({ authHeaders }) {
  const api = useShopApi(authHeaders);
  const [status, setStatus] = useState('expired');
  const [rows] = useLoad(api, `/shop/admin/checkouts?status=${status}`, []);
  return (
    <Card
      title="Kasser"
      actions={
        <select className={`${inputClass} w-auto`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="expired">Forlatt (utløpt)</option>
          <option value="open">Åpne nå</option>
          <option value="paid">Betalt</option>
          <option value="">Alle</option>
        </select>
      }
    >
      <p className="text-xs text-gray-400 mb-3">Kunder som krysset av for påminnelse får én e-post når kassen utløper (Stripe). Uten samtykke sendes ingenting.</p>
      {!rows.length && <p className="text-gray-500 text-sm">Ingenting her.</p>}
      {rows.map((c) => (
        <div key={c.ref} className="flex flex-wrap gap-3 py-2 border-b border-white/5 text-sm">
          <span className="text-gray-400 w-40">{when(c.createdAt)}</span>
          <span className="flex-1 min-w-[200px] text-gray-200">{c.items.join(', ')}<br /><span className="text-gray-400">{c.email || 'ukjent e-post'} · {c.provider}</span></span>
          <span className="text-white">{kr(c.amountMinor, c.currency)}</span>
          {c.consent ? <Badge tone="blue">samtykke</Badge> : <Badge>ingen påminnelse</Badge>}
          {c.reminderSentAt && <Badge tone="green">påminnet {when(c.reminderSentAt, false)}</Badge>}
        </div>
      ))}
    </Card>
  );
}

