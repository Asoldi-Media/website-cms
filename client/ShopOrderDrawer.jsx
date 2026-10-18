/** Order detail drawer: lines, payment, shipping with tracking, refunds and documents. */
import { useState } from 'react';
import { Badge, Btn, Check, Field, inputClass, kr, useAction, useShopApi, when } from './shop-ui.jsx';

const CARRIERS = ['', 'Posten', 'Bring', 'PostNord', 'Helthjem', 'DHL', 'UPS', 'FedEx', 'GLS', 'Annet'];
const PAY_TONE = { paid: 'green', partially_refunded: 'yellow', refunded: 'red', pending: 'yellow', unpaid: 'gray' };
const PAY_LABEL = { paid: 'Betalt', partially_refunded: 'Delvis refundert', refunded: 'Refundert', pending: 'Venter på betaling' };
const FULFIL_LABEL = { unfulfilled: 'Ikke sendt', partial: 'Delvis sendt', fulfilled: 'Sendt' };
const STATUS_LABEL = { new: 'Ny', confirmed: 'Bekreftet', packed: 'Pakket', shipped: 'Sendt', completed: 'Fullført', cancelled: 'Kansellert' };

function lineLabel(l) {
  return `${l.name}${l.variantLabel ? ` – ${l.variantLabel}` : ''}`;
}

/** Order detail with ship, refund and resend actions. */
export function ShopOrderDrawer({ order: initial, authHeaders, setLoading, isOwner, onClose, onChanged }) {
  const api = useShopApi(authHeaders);
  const act = useAction(setLoading);
  const [order, setOrder] = useState(initial);
  const [ship, setShip] = useState({ carrier: '', trackingNumber: '', trackingUrl: '', notify: true });
  const [refund, setRefund] = useState({ lines: {}, shipping: false, amount: '', restock: true, reason: '' });
  const [note, setNote] = useState('');
  const cur = order.currency || 'nok';
  const lines = order.lines || [];
  const physical = lines.filter((l) => l.kind === 'physical' && l.quantity - (l.fulfilledQty || 0) - (l.refundedQty || 0) > 0);
  const paid = ['paid', 'partially_refunded'].includes(order.paymentStatus);
  const refundable = order.totalMinor - (order.refundedMinor || 0);

  const done = (next) => {
    if (!next) return;
    setOrder(next);
    onChanged?.(next);
  };

  const doShip = () => act(async () => done(await api('POST', `/orders/${order.id}/ship`, ship)));
  const doRefund = () => {
    const body = {
      lines: Object.entries(refund.lines).filter(([, q]) => Number(q) > 0).map(([key, quantity]) => ({ key, quantity: Number(quantity) })),
      shipping: refund.shipping,
      restock: refund.restock,
      reason: refund.reason,
    };
    if (refund.amount !== '') body.amount = refund.amount;
    if (!body.lines.length && !body.shipping && refund.amount === '') return window.alert('Velg varer, frakt eller et beløp.');
    return act(async () => {
      done((await api('POST', `/orders/${order.id}/refund`, body))?.order);
      setRefund({ lines: {}, shipping: false, amount: '', restock: true, reason: '' });
    }, { confirm: 'Refundere til kunden nå? Pengene trekkes fra din Stripe/PayPal-konto.' });
  };
  const doResend = (kind) => act(async () => {
    const entry = await api('POST', `/orders/${order.id}/resend`, { kind });
    window.alert(entry.ok ? 'Sendt på nytt.' : `Kunne ikke sende: ${entry.error}`);
    done(await api('GET', `/orders/${order.id}`).catch(() => order));
  });
  const doNote = () => note.trim() && act(async () => {
    done(await api('POST', `/orders/${order.id}/note`, { text: note }));
    setNote('');
  });
  const doCancel = () => act(async () => done(await api('POST', `/orders/${order.id}/cancel`, {})), { confirm: 'Kansellere ordren? Bookinger frigjøres.' });

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose}>
      <div className="w-full max-w-3xl h-full overflow-y-auto bg-[#1e1e1e] border-l border-white/10 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-xl font-bold text-white">Ordre {order.number || order.id}</h2>
            <p className="text-sm text-gray-400">{when(order.purchasedAt)} · {order.paymentProvider || 'manuell'}</p>
            <div className="flex gap-2 mt-2">
              <Badge tone={PAY_TONE[order.paymentStatus] || 'gray'}>{PAY_LABEL[order.paymentStatus] || order.paymentStatus || 'ukjent'}</Badge>
              <Badge tone={order.fulfillment?.status === 'fulfilled' ? 'green' : 'yellow'}>{FULFIL_LABEL[order.fulfillment?.status] || '—'}</Badge>
              <Badge>{STATUS_LABEL[order.status] || order.status}</Badge>
            </div>
          </div>
          <Btn kind="ghost" onClick={onClose}>Lukk</Btn>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-4 text-sm">
          <div className="rounded-lg bg-[#2a2a2a] p-4">
            <div className="text-xs text-gray-400 mb-1">Kunde</div>
            <div className="text-white">{order.customerName || '—'}</div>
            <div className="text-gray-300">{order.customerEmail}</div>
            <div className="text-gray-400">{order.customerPhone}</div>
          </div>
          <div className="rounded-lg bg-[#2a2a2a] p-4">
            <div className="text-xs text-gray-400 mb-1">Levering</div>
            <div className="text-gray-200">{order.shippingMethod?.name || '—'}</div>
            <div className="text-gray-400">{[order.shippingAddress?.line, order.shippingAddress?.postal, order.shippingAddress?.city, order.shippingAddress?.country].filter(Boolean).join(', ') || '—'}</div>
          </div>
        </div>

        <table className="w-full text-sm mb-4">
          <thead>
            <tr className="text-xs text-gray-400 border-b border-white/10">
              <th className="text-left py-2">Vare</th>
              <th className="text-right">Antall</th>
              <th className="text-right">Sendt</th>
              <th className="text-right">Refundert</th>
              <th className="text-right">MVA</th>
              <th className="text-right">Sum</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key} className="border-b border-white/5 text-gray-200">
                <td className="py-2">
                  {lineLabel(l)}
                  {l.booking?.start && <div className="text-xs text-gray-400">{when(l.booking.start)}{l.booking.staffName ? ` · ${l.booking.staffName}` : ''}</div>}
                  {l.sku && <div className="text-xs text-gray-500">{l.sku}</div>}
                </td>
                <td className="text-right">{l.quantity}</td>
                <td className="text-right">{l.kind === 'physical' ? l.fulfilledQty || 0 : '—'}</td>
                <td className="text-right">{l.refundedQty || 0}</td>
                <td className="text-right">{l.rate} %</td>
                <td className="text-right">{kr(l.lineTotalMinor, cur)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-sm text-gray-300 space-y-1 mb-6 ml-auto max-w-xs">
          {order.discountMinor > 0 && <div className="flex justify-between"><span>Herav rabatt</span><span>{kr(order.discountMinor, cur)}</span></div>}
          <div className="flex justify-between"><span>Frakt</span><span>{kr(order.shippingMinor, cur)}</span></div>
          {(order.taxLines || []).map((t) => (
            <div key={t.rate} className="flex justify-between text-gray-400"><span>MVA {t.rate} %</span><span>{kr(t.taxMinor, cur)}</span></div>
          ))}
          <div className="flex justify-between text-white font-semibold"><span>Totalt</span><span>{kr(order.totalMinor, cur)}</span></div>
          {(order.giftcardPayments || []).map((g) => (
            <div key={g.id || g.last4} className="flex justify-between text-gray-400"><span>Gavekort …{g.last4}</span><span>-{kr(g.amountMinor, cur)}</span></div>
          ))}
          {order.refundedMinor > 0 && <div className="flex justify-between text-red-300"><span>Refundert</span><span>-{kr(order.refundedMinor, cur)}</span></div>}
        </div>

        {physical.length > 0 && order.status !== 'cancelled' && (
          <div className="rounded-lg bg-[#2a2a2a] p-4 mb-4">
            <h3 className="text-white font-semibold mb-3">Send varer</h3>
            <div className="grid md:grid-cols-3 gap-3">
              <Field label="Fraktfirma">
                <select className={inputClass} value={ship.carrier} onChange={(e) => setShip((s) => ({ ...s, carrier: e.target.value }))}>
                  {CARRIERS.map((c) => <option key={c} value={c}>{c || 'Velg'}</option>)}
                </select>
              </Field>
              <Field label="Sporingsnummer"><input className={inputClass} value={ship.trackingNumber} onChange={(e) => setShip((s) => ({ ...s, trackingNumber: e.target.value }))} /></Field>
              <Field label="Sporingslenke (valgfri)"><input className={inputClass} value={ship.trackingUrl} placeholder="Lages automatisk for kjente firma" onChange={(e) => setShip((s) => ({ ...s, trackingUrl: e.target.value }))} /></Field>
            </div>
            <div className="flex items-center justify-between mt-3">
              <Check label="Send e-post til kunden" checked={ship.notify} onChange={(v) => setShip((s) => ({ ...s, notify: v }))} />
              <Btn onClick={doShip}>Merk som sendt</Btn>
            </div>
          </div>
        )}

        {paid && (
          <div className="rounded-lg bg-[#2a2a2a] p-4 mb-4">
            <h3 className="text-white font-semibold mb-1">Refunder</h3>
            <p className="text-xs text-gray-400 mb-3">Kan refundere opptil {kr(refundable, cur)}. Kunden får kreditnota på e-post.</p>
            {!isOwner && <p className="text-yellow-200/80 text-xs mb-2">Bare eier (admin) kan refundere.</p>}
            <div className="space-y-2 mb-3">
              {lines.filter((l) => l.quantity - (l.refundedQty || 0) > 0).map((l) => (
                <div key={l.key} className="flex items-center gap-3 text-sm text-gray-200">
                  <input type="number" min="0" max={l.quantity - (l.refundedQty || 0)} className={`${inputClass} w-20`} value={refund.lines[l.key] || ''} placeholder="0" onChange={(e) => setRefund((r) => ({ ...r, lines: { ...r.lines, [l.key]: e.target.value } }))} />
                  <span>av {l.quantity - (l.refundedQty || 0)} × {lineLabel(l)}</span>
                </div>
              ))}
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="Eller et fritt beløp (kr)" hint="Brukes alene for prisavslag; MVA fordeles automatisk."><input className={inputClass} value={refund.amount} onChange={(e) => setRefund((r) => ({ ...r, amount: e.target.value }))} /></Field>
              <Field label="Årsak (vises på kreditnota)"><input className={inputClass} value={refund.reason} onChange={(e) => setRefund((r) => ({ ...r, reason: e.target.value }))} /></Field>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
              <div className="flex gap-4">
                {order.shippingMinor > 0 && <Check label="Refunder frakt" checked={refund.shipping} onChange={(v) => setRefund((r) => ({ ...r, shipping: v }))} />}
                <Check label="Legg varene tilbake på lager" checked={refund.restock} onChange={(v) => setRefund((r) => ({ ...r, restock: v }))} />
              </div>
              <Btn kind="danger" disabled={!isOwner} onClick={doRefund}>Refunder</Btn>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 mb-6">
          {order.number && <Btn kind="ghost" onClick={() => doResend('order')}>Send kvittering på nytt</Btn>}
          {(order.fulfillment?.shipments || []).length > 0 && <Btn kind="ghost" onClick={() => doResend('shipped')}>Send sporing på nytt</Btn>}
          {(order.refunds || []).length > 0 && <Btn kind="ghost" onClick={() => doResend('credit-note')}>Send kreditnota på nytt</Btn>}
          {!paid && order.status !== 'cancelled' && order.paymentStatus !== 'refunded' && <Btn kind="danger" onClick={doCancel}>Kanseller ordre</Btn>}
        </div>

        {(order.fulfillment?.shipments || []).length > 0 && (
          <div className="mb-4">
            <h3 className="text-white font-semibold mb-2">Forsendelser</h3>
            {order.fulfillment.shipments.map((s) => (
              <div key={s.id} className="text-sm text-gray-300">
                {when(s.at)} · {s.carrier || 'Ukjent'} {s.trackingNumber}
                {s.trackingUrl && /^https?:/.test(s.trackingUrl) && <a href={s.trackingUrl} target="_blank" rel="noreferrer" className="ml-2 text-[#FF5B00]">Spor</a>}
              </div>
            ))}
          </div>
        )}

        {(order.refunds || []).length > 0 && (
          <div className="mb-4">
            <h3 className="text-white font-semibold mb-2">Refusjoner</h3>
            {order.refunds.map((r) => (
              <div key={r.id} className="text-sm text-gray-300">
                {when(r.at)} · {kr(r.amountMinor, cur)} · kreditnota {r.creditNoteNumber}{r.reason ? ` · ${r.reason}` : ''}
              </div>
            ))}
          </div>
        )}

        {(order.documents || []).length > 0 && (
          <div className="mb-4">
            <h3 className="text-white font-semibold mb-2">E-post og dokumenter</h3>
            {order.documents.map((d, i) => (
              <div key={`${d.kind}-${i}`} className="text-sm text-gray-300">
                {when(d.at)} · {d.kind} {d.number} · {d.ok ? <span className="text-green-300">sendt{d.error ? ` (${d.error})` : ''}</span> : <span className="text-red-300">feilet: {d.error}</span>}
              </div>
            ))}
          </div>
        )}

        <div className="mb-4">
          <h3 className="text-white font-semibold mb-2">Logg</h3>
          <div className="space-y-1 mb-3">
            {(order.events || []).slice().reverse().map((e, i) => (
              <div key={`${e.at}-${i}`} className="text-sm text-gray-300">
                <span className="text-gray-500">{when(e.at)}</span> {e.text}{e.by ? <span className="text-gray-500"> · {e.by}</span> : null}
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input className={inputClass} placeholder="Intern notat" value={note} onChange={(e) => setNote(e.target.value)} />
            <Btn kind="ghost" onClick={doNote}>Legg til</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}
