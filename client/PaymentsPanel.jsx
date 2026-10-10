/** Admin payment setup for Stripe Connect and PayPal. */
import { useCallback, useEffect, useState } from 'react';
const API = '/api/cms';
/** Payment setup admin tab. */
export function PaymentsPanel({ authHeaders, loading, setLoading }) {
    const [payments, setPayments] = useState(null);
    const [error, setError] = useState('');
    const load = useCallback(async () => {
        const res = await fetch(`${API}/payments`, { headers: authHeaders() });
        if (!res.ok)
            return;
        setPayments(await res.json());
    }, [authHeaders]);
    useEffect(() => {
        load();
    }, [load]);
    const save = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            const res = await fetch(`${API}/payments`, {
                method: 'PUT',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    stripe: {
                        enabled: payments.stripe.enabled,
                        connected: payments.stripe.connected,
                        accountId: payments.stripe.accountId,
                        status: payments.stripe.connected ? 'complete' : 'not_started',
                    },
                    paypal: {
                        enabled: payments.paypal.enabled,
                        connected: payments.paypal.connected,
                        merchantId: payments.paypal.merchantId,
                        accountId: payments.paypal.merchantId,
                        status: payments.paypal.connected ? 'complete' : 'not_started',
                    },
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(data.message || 'Could not save');
                return;
            }
            setPayments(data);
        }
        finally {
            setLoading(false);
        }
    };
    if (!payments)
        return <p className="text-gray-400">Loading payments…</p>;
    return (<form onSubmit={save} className="space-y-6">
      <p className="text-gray-400 text-sm">
        Stripe Connect Standard and PayPal partner checkout. Asoldi owns the platform accounts; this client only connects their seller account. Live onboarding URLs appear after platform keys are set on the host.
      </p>
      <section className="rounded-xl bg-[#2a2a2a] border border-white/10 p-6 space-y-3">
        <h2 className="text-lg font-medium text-white">Stripe Connect (Standard)</h2>
        <p className="text-sm text-gray-400">{payments.stripe.setupHint}</p>
        <p className="text-xs text-gray-500">Platform ready: {payments.stripe.platformReady ? 'yes' : 'no'}</p>
        <label className="flex items-center gap-2 text-white text-sm">
          <input type="checkbox" checked={!!payments.stripe.enabled} onChange={(e) => setPayments((p) => ({ ...p, stripe: { ...p.stripe, enabled: e.target.checked } }))}/>
          Enable Stripe for this shop
        </label>
        <input value={payments.stripe.accountId || ''} onChange={(e) => setPayments((p) => ({ ...p, stripe: { ...p.stripe, accountId: e.target.value } }))} placeholder="Connected Stripe account id (acct_…)" className="w-full px-4 py-2 rounded-lg bg-[#1a1a1a] border border-white/20 text-white"/>
        <label className="flex items-center gap-2 text-white text-sm">
          <input type="checkbox" checked={!!payments.stripe.connected} onChange={(e) => setPayments((p) => ({ ...p, stripe: { ...p.stripe, connected: e.target.checked } }))}/>
          Seller account connected
        </label>
      </section>
      <section className="rounded-xl bg-[#2a2a2a] border border-white/10 p-6 space-y-3">
        <h2 className="text-lg font-medium text-white">PayPal</h2>
        <p className="text-sm text-gray-400">{payments.paypal.setupHint}</p>
        <p className="text-xs text-gray-500">Platform ready: {payments.paypal.platformReady ? 'yes' : 'no'}</p>
        <label className="flex items-center gap-2 text-white text-sm">
          <input type="checkbox" checked={!!payments.paypal.enabled} onChange={(e) => setPayments((p) => ({ ...p, paypal: { ...p.paypal, enabled: e.target.checked } }))}/>
          Enable PayPal for this shop
        </label>
        <input value={payments.paypal.merchantId || ''} onChange={(e) => setPayments((p) => ({ ...p, paypal: { ...p.paypal, merchantId: e.target.value } }))} placeholder="PayPal merchant id" className="w-full px-4 py-2 rounded-lg bg-[#1a1a1a] border border-white/20 text-white"/>
        <label className="flex items-center gap-2 text-white text-sm">
          <input type="checkbox" checked={!!payments.paypal.connected} onChange={(e) => setPayments((p) => ({ ...p, paypal: { ...p.paypal, connected: e.target.checked } }))}/>
          Seller account connected
        </label>
      </section>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <button type="submit" disabled={loading} className="px-4 py-2 rounded-lg bg-[#FF5B00] text-white font-medium disabled:opacity-50">Save payment setup</button>
    </form>);
}
