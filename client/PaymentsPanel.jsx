/** Admin payment setup: connect the seller's Stripe or PayPal account through the Asoldi hub. */
import { useCallback, useEffect, useState } from 'react';

const API = '/api/cms';

function Pill({ tone, children }) {
  const tones = {
    ok: 'bg-green-500/15 text-green-300 border-green-500/30',
    warn: 'bg-yellow-500/15 text-yellow-200 border-yellow-500/30',
    off: 'bg-white/5 text-gray-400 border-white/10',
  };
  return <span className={`inline-block text-xs px-2 py-0.5 rounded-full border ${tones[tone]}`}>{children}</span>;
}

function stripeState(s) {
  if (!s?.available) return { tone: 'off', label: 'Ikke tilgjengelig ennå' };
  if (s.ready) return { tone: 'ok', label: 'Klar – tar imot kortbetaling' };
  if (s.connected) return { tone: 'warn', label: s.detailsSubmitted ? 'Venter på godkjenning fra Stripe' : 'Oppsett ikke fullført' };
  return { tone: 'off', label: 'Ikke koblet til' };
}

function paypalState(p) {
  if (!p?.available) return { tone: 'off', label: 'Ikke tilgjengelig ennå' };
  if (p.ready) return { tone: 'ok', label: p.method === 'email' ? `Klar – betalinger går til ${p.email}` : 'Klar – tar imot PayPal' };
  if (p.connected) return { tone: 'warn', label: 'PayPal-kontoen kan ikke ta imot betalinger ennå' };
  if (p.pending) return { tone: 'warn', label: 'Innlogging startet – fullfør hos PayPal' };
  return { tone: 'off', label: 'Ikke koblet til' };
}

/** Payment setup admin tab. */
export function PaymentsPanel({ authHeaders, loading, setLoading }) {
  const [payments, setPayments] = useState(null);
  const [error, setError] = useState('');
  const [paypalEmail, setPaypalEmail] = useState('');
  const [showEmail, setShowEmail] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`${API}/payments`, { headers: authHeaders() });
    if (!res.ok) return;
    setPayments(await res.json());
  }, [authHeaders]);

  useEffect(() => {
    load();
    if (new URLSearchParams(window.location.search).has('payments')) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [load]);

  const post = async (path, body) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}${path}`, {
        method: path === '/payments' ? 'PUT' : 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'paypal_partner_missing' || data.code === 'paypal_partner_not_approved') setShowEmail(true);
        setError(res.status === 403 ? 'Bare eieren (admin) kan koble til betalingskontoer.' : data.message || 'Noe gikk galt');
        return null;
      }
      return data;
    } finally {
      setLoading(false);
    }
  };

  const connectStripe = async () => {
    const data = await post('/payments/stripe/connect');
    if (data?.url) window.location.href = data.url;
  };

  const connectPaypal = async () => {
    const data = await post('/payments/paypal/connect');
    if (data?.url) window.location.href = data.url;
    else if (data) load();
  };

  const savePaypalEmail = async (e) => {
    e.preventDefault();
    const data = await post('/payments/paypal/connect', { email: paypalEmail });
    if (data) {
      setShowEmail(false);
      load();
    }
  };

  const disconnect = async (provider) => {
    if (!window.confirm(provider === 'stripe' ? 'Koble fra Stripe? Kunder kan ikke betale med kort før du kobler til igjen.' : 'Koble fra PayPal?')) return;
    const data = await post('/payments/disconnect', { provider });
    if (data) setPayments(data);
  };

  const toggle = async (provider, enabled) => {
    const data = await post('/payments', { [provider]: { enabled } });
    if (data) setPayments(data);
  };

  if (!payments) return <p className="text-gray-400">Laster betalinger…</p>;

  if (!payments.linked) {
    return (
      <p className="text-gray-400 text-sm">
        Denne nettsiden er ikke koblet til Asoldi ennå, så nettbetaling kan ikke settes opp her. Ta kontakt med Asoldi.
      </p>
    );
  }

  const s = payments.stripe;
  const p = payments.paypal;
  const sState = stripeState(s);
  const pState = paypalState(p);

  return (
    <div className="space-y-6">
      <p className="text-gray-400 text-sm">
        Koble til din egen Stripe- eller PayPal-konto. Pengene går rett til deg. Kundene betaler på en sikker side hos Stripe/PayPal, og betalte bestillinger dukker opp under Ordrer.
      </p>
      {!payments.hubReachable && <p className="text-yellow-300 text-sm">Fikk ikke kontakt med Asoldi akkurat nå. Prøv igjen om litt.</p>}

      <section className="rounded-xl bg-[#2a2a2a] border border-white/10 p-6 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-lg font-medium text-white">Kort (Stripe)</h2>
          <Pill tone={sState.tone}>{sState.label}</Pill>
        </div>
        {s.mode === 'test' && <p className="text-xs text-yellow-300">Testmodus: bruk testkort 4242 4242 4242 4242.</p>}
        {s.connected && s.displayName && <p className="text-sm text-gray-300">Konto: {s.displayName}{s.email ? ` (${s.email})` : ''}</p>}
        {s.connected && !s.ready && s.currentlyDue > 0 && <p className="text-sm text-yellow-200">Stripe trenger {s.currentlyDue} opplysning(er) til før du kan ta betalt.</p>}
        <div className="flex flex-wrap gap-2">
          {s.available && !s.ready && (
            <button type="button" disabled={loading} onClick={connectStripe} className="px-4 py-2 rounded-lg bg-[#635bff] text-white font-medium disabled:opacity-50">
              {s.connected ? 'Fullfør Stripe-oppsett' : 'Koble til Stripe'}
            </button>
          )}
          {s.ready && (
            <a href="https://dashboard.stripe.com" target="_blank" rel="noreferrer" className="px-4 py-2 rounded-lg bg-white/10 text-white text-sm">
              Åpne Stripe
            </a>
          )}
          {s.connected && (
            <button type="button" disabled={loading} onClick={() => disconnect('stripe')} className="px-4 py-2 rounded-lg text-sm text-gray-300 hover:text-white">
              Koble fra
            </button>
          )}
        </div>
        {s.ready && (
          <label className="flex items-center gap-2 text-white text-sm">
            <input type="checkbox" checked={!!s.enabled} disabled={loading} onChange={(e) => toggle('stripe', e.target.checked)} />
            Vis kortbetaling i nettbutikken
          </label>
        )}
      </section>

      <section className="rounded-xl bg-[#2a2a2a] border border-white/10 p-6 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-lg font-medium text-white">PayPal</h2>
          <Pill tone={pState.tone}>{pState.label}</Pill>
        </div>
        {p.mode === 'sandbox' && p.available && <p className="text-xs text-yellow-300">Testmodus (PayPal sandbox).</p>}
        <div className="flex flex-wrap gap-2">
          {p.available && p.loginAvailable && !p.ready && (
            <button type="button" disabled={loading} onClick={connectPaypal} className="px-4 py-2 rounded-lg bg-[#ffc439] text-black font-medium disabled:opacity-50">
              {p.pending ? 'Fortsett hos PayPal' : 'Logg inn med PayPal'}
            </button>
          )}
          {p.available && !p.ready && (
            <button type="button" onClick={() => setShowEmail((v) => !v)} className="px-4 py-2 rounded-lg bg-white/10 text-white text-sm">
              {p.loginAvailable ? 'Bruk PayPal-e-post i stedet' : 'Koble til med PayPal-e-post'}
            </button>
          )}
          {p.connected && (
            <button type="button" disabled={loading} onClick={() => disconnect('paypal')} className="px-4 py-2 rounded-lg text-sm text-gray-300 hover:text-white">
              Koble fra
            </button>
          )}
        </div>
        {showEmail && p.available && !p.ready && (
          <form onSubmit={savePaypalEmail} className="flex flex-wrap gap-2">
            <input
              type="email"
              required
              value={paypalEmail}
              onChange={(e) => setPaypalEmail(e.target.value)}
              placeholder="E-posten til PayPal Business-kontoen din"
              className="flex-1 min-w-[240px] px-4 py-2 rounded-lg bg-[#1a1a1a] border border-white/20 text-white"
            />
            <button type="submit" disabled={loading} className="px-4 py-2 rounded-lg bg-[#FF5B00] text-white font-medium disabled:opacity-50">Lagre</button>
          </form>
        )}
        {p.ready && (
          <label className="flex items-center gap-2 text-white text-sm">
            <input type="checkbox" checked={!!p.enabled} disabled={loading} onChange={(e) => toggle('paypal', e.target.checked)} />
            Vis PayPal i nettbutikken
          </label>
        )}
      </section>

      {error && <p className="text-red-400 text-sm">{error}</p>}
      <button type="button" onClick={load} className="text-sm text-gray-400 hover:text-white">Oppdater status</button>
    </div>
  );
}
