import React, { useCallback, useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Clock, MapPin, MousePointerClick, ShoppingBag, Smartphone, TrendingUp } from 'lucide-react';

const API = '/api/cms';
const RANGES = [
  { id: '7d', label: '7 dager' },
  { id: '14d', label: '14 dager' },
  { id: '30d', label: '30 dager' },
  { id: '90d', label: '90 dager' },
  { id: '6m', label: '6 måneder' },
  { id: '1y', label: '1 år' },
];

function nb(n, digits = 0) {
  return Number(n || 0).toLocaleString('nb-NO', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function pct(n) {
  return `${nb(n, 1)}%`;
}

function duration(sec) {
  const s = Math.max(0, Number(sec) || 0);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}

function kr(n) {
  return `${nb(n, 0)} kr`;
}

function Sparkline({ points = [], color = '#FF5B00' }) {
  if (!points.length) return <div className="h-16 rounded-lg bg-black/20" />;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const span = Math.max(max - min, 1);
  const w = 160;
  const h = 56;
  const d = points.map((value, i) => {
    const x = (i / Math.max(points.length - 1, 1)) * w;
    const y = h - ((value - min) / span) * (h - 6) - 3;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const area = `${d} L${w},${h} L0,${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-16">
      <path d={area} fill={color} opacity="0.16" />
      <path d={d} fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}

function Kpi({ label, value, hint, points, invert }) {
  const trend = hint;
  return (
    <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-[#2d2d2d] to-[#222] p-4">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
      {trend ? (
        <p className={`mt-1 inline-flex items-center gap-1 text-xs ${trend.positive ? 'text-emerald-400' : 'text-rose-400'}`}>
          {trend.positive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
          {nb(Math.abs(trend.change), 1)}% mot forrige periode
        </p>
      ) : <p className="mt-1 text-xs text-gray-500">Ingen sammenligning ennå</p>}
      {points ? <div className="mt-2"><Sparkline points={points} /></div> : null}
      {invert ? null : null}
    </div>
  );
}

function Funnel({ stages = [] }) {
  const max = Math.max(...stages.map((row) => Number(row.count) || 0), 1);
  if (!stages.length) return <p className="text-sm text-gray-400">Ingen butikkøkter i perioden ennå.</p>;
  return (
    <ol className="space-y-3">
      {stages.map((stage, index) => (
        <li key={stage.id || stage.label}>
          <div className="flex items-end justify-between gap-3 mb-1">
            <p className="text-sm text-white">{stage.label}</p>
            <p className="text-xs text-gray-400">{nb(stage.count)} · {pct(stage.share)}</p>
          </div>
          <div className="h-2.5 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full rounded-full bg-[#FF5B00]" style={{ width: `${Math.max(4, (Number(stage.count) / max) * 100)}%` }} />
          </div>
          {index > 0 && Number(stage.dropoff) > 0 ? (
            <p className="mt-1 text-[11px] text-rose-400">−{pct(stage.dropoff)} frafall fra forrige steg · {pct(stage.kept)} gikk videre</p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function Pack({ queries = [] }) {
  const first = queries.find((row) => row.found) || queries[0];
  const pack = first?.pack || [];
  if (!pack.length) {
    return <p className="text-sm text-gray-400">Ingen Google Maps-treff lagret ennå. Rangering kjøres automatisk hver 14. dag fra bedriftsadressen i kundekortet.</p>;
  }
  return (
    <ol className="space-y-2">
      {pack.slice(0, 8).map((row) => (
        <li
          key={`${row.position}-${row.title}`}
          className={`flex items-center justify-between rounded-xl border px-3 py-2.5 ${row.isSelf ? 'border-[#FF5B00]/60 bg-[#FF5B00]/10' : 'border-white/10 bg-black/20'}`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${row.isSelf ? 'bg-[#FF5B00] text-white' : 'bg-white/10 text-gray-300'}`}>
              {row.position}
            </span>
            <div className="min-w-0">
              <p className="text-sm text-white truncate">{row.title || 'Ukjent'}</p>
              <p className="text-xs text-gray-500 truncate">{row.address}</p>
            </div>
          </div>
          <div className="text-right text-xs text-gray-400 shrink-0 ml-3">
            {row.rating ? <p>{nb(row.rating, 1)} ★</p> : null}
            {row.reviews ? <p>{nb(row.reviews)} anmeldelser</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function AnalyticsPanel({ authHeaders, loading, setLoading }) {
  const [data, setData] = useState(null);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [range, setRange] = useState('30d');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [tab, setTab] = useState('overview');
  const [setupOpen, setSetupOpen] = useState(false);

  const load = useCallback(async (nextRange = range) => {
    const params = new URLSearchParams({ range: nextRange });
    if (nextRange === 'custom' && from && to) {
      params.set('from', from);
      params.set('to', to);
    }
    const [overviewRes, settingsRes] = await Promise.all([
      fetch(`${API}/analytics/overview?${params}`, { headers: authHeaders() }),
      fetch(`${API}/analytics`, { headers: authHeaders() }),
    ]);
    if (overviewRes.ok) setData(await overviewRes.json());
    else {
      const payload = await overviewRes.json().catch(() => ({}));
      setError(payload.message || 'Kunne ikke laste analyse.');
    }
    if (settingsRes.ok) setSettings(await settingsRes.json());
  }, [authHeaders, range, from, to]);

  useEffect(() => {
    load('30d');
  }, []);

  const traffic = data?.traffic || {};
  const maps = data?.maps || {};
  const gbp = data?.gbp || {};
  const cta = data?.cta || {};
  const goals = data?.goals || {};
  const ecommerce = data?.ecommerce;
  const advanced = data?.access?.level === 'advanced' || data?.access?.ecommerce;
  const series = traffic.series || [];
  const visitPoints = series.map((row) => row.visits || 0);
  const viewPoints = series.map((row) => row.pageviews || 0);

  const saveSettings = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/analytics`, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          measurementId: settings.measurementId,
          propertyId: settings.propertyId,
          domain: settings.domain,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.message || 'Could not save');
        return;
      }
      setSettings((current) => ({ ...current, ...payload }));
    } finally {
      setLoading(false);
    }
  };

  const verify = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/analytics/verify`, { method: 'POST', headers: authHeaders() });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.message || 'Verify failed');
        return;
      }
      setSettings((current) => ({ ...current, ...payload }));
    } finally {
      setLoading(false);
    }
  };

  const applyRange = (id) => {
    setRange(id);
    if (id !== 'custom') void load(id);
  };

  const queries = maps.queries || [];

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[#FF5B00]">Analyse</p>
          <h1 className="text-3xl font-bold text-white mt-1">
            {advanced ? 'Nettbutikk-analyse' : 'SEO-analyse'}
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            {data?.subject?.name || 'Denne nettsiden'} · {data?.subject?.address || 'Adresse fra kundekortet'}
          </p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-full bg-black/30 p-1">
          {RANGES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => applyRange(entry.id)}
              className={`px-3 py-1.5 rounded-full text-xs ${range === entry.id ? 'bg-[#FF5B00] text-white' : 'text-gray-400 hover:text-white'}`}
            >
              {entry.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setRange('custom')}
            className={`px-3 py-1.5 rounded-full text-xs ${range === 'custom' ? 'bg-[#FF5B00] text-white' : 'text-gray-400 hover:text-white'}`}
          >
            Egendefinert
          </button>
        </div>
      </div>

      {range === 'custom' ? (
        <div className="mb-5 flex flex-wrap items-end gap-3">
          <label className="text-xs text-gray-400">
            Fra
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 block rounded-lg bg-[#1a1a1a] border border-white/15 px-3 py-2 text-white" />
          </label>
          <label className="text-xs text-gray-400">
            Til
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 block rounded-lg bg-[#1a1a1a] border border-white/15 px-3 py-2 text-white" />
          </label>
          <button type="button" onClick={() => load('custom')} className="px-4 py-2 rounded-lg bg-[#FF5B00] text-white text-sm">Vis periode</button>
        </div>
      ) : null}

      <div className="flex gap-2 mb-5">
        {[
          { id: 'overview', label: 'Trafikk' },
          { id: 'maps', label: 'Google Maps' },
          ...(advanced ? [{ id: 'shop', label: 'Nettbutikk' }] : []),
        ].map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            className={`px-4 py-2 rounded-xl text-sm ${tab === entry.id ? 'bg-white text-black' : 'bg-white/5 text-gray-300'}`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {error ? <p className="text-red-400 text-sm mb-4">{error}</p> : null}
      {!data ? <p className="text-gray-400">Laster analyse…</p> : null}

      {data && tab === 'overview' ? (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Besøk" value={nb(traffic.visits)} points={visitPoints} />
            <Kpi label="Unike visninger" value={nb(traffic.uniqueVisitors)} points={series.map((row) => row.uniqueVisitors || 0)} />
            <Kpi label="Sidevisninger" value={nb(traffic.pageviews)} points={viewPoints} />
            <Kpi label="Avvisningsrate" value={pct(traffic.bounceRate)} invert />
          </div>
          {cta.configured ? (
            <div className="rounded-2xl border border-[#FF5B00]/30 bg-gradient-to-br from-[#FF5B00]/10 to-[#222] p-5">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-[#FF5B00]">Hovedhandling</p>
                  <h3 className="text-white font-semibold mt-1">{goals.label || 'Ønsket side'}</h3>
                  <p className="text-xs text-gray-500 mt-1">Trafikk og klikk til {cta.path}</p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-4">
                <div><p className="text-xs text-gray-500">Visninger av siden</p><p className="text-xl text-white">{nb(cta.pageviews)}</p></div>
                <div><p className="text-xs text-gray-500">Unike besøkende</p><p className="text-xl text-white">{nb(cta.visitors)}</p></div>
                <div><p className="text-xs text-gray-500">Klikk mot siden</p><p className="text-xl text-white">{nb(cta.clicks)}</p></div>
                <div><p className="text-xs text-gray-500">Andel av alle besøk</p><p className="text-xl text-white">{pct(cta.rate)}</p></div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/15 p-4 text-sm text-gray-400">
              Sett hovedhandling og valgfri URL i Website Maker (klientdetaljer) for å måle hvor mange som kommer til den siden.
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-[#222] p-4">
              <p className="text-xs text-gray-500 flex items-center gap-2"><Clock size={14} /> Snitt tid på siden</p>
              <p className="text-xl text-white mt-1">{duration(traffic.avgDurationSec)}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#222] p-4">
              <p className="text-xs text-gray-500 flex items-center gap-2"><MousePointerClick size={14} /> Sider per besøk</p>
              <p className="text-xl text-white mt-1">{nb(traffic.viewRate, 1)}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#222] p-4">
              <p className="text-xs text-gray-500 flex items-center gap-2"><Smartphone size={14} /> Enheter</p>
              <p className="text-sm text-gray-300 mt-2">Mobil {nb(traffic.devices?.mobile || 0)} · Desktop {nb(traffic.devices?.desktop || 0)} · Nettbrett {nb(traffic.devices?.tablet || 0)}</p>
            </div>
          </div>
          {gbp?.insights ? (
            <div className="rounded-2xl border border-white/10 bg-[#222] p-5">
              <h3 className="text-white font-semibold mb-3">Google-bedriftsprofil</h3>
              <div className="grid gap-3 sm:grid-cols-4">
                <div><p className="text-xs text-gray-500">Kartvisninger</p><p className="text-xl text-white">{nb(gbp.insights.mapsViews)}</p></div>
                <div><p className="text-xs text-gray-500">Søkevisninger</p><p className="text-xl text-white">{nb(gbp.insights.searchViews)}</p></div>
                <div><p className="text-xs text-gray-500">Klikk til nettside</p><p className="text-xl text-white">{nb(gbp.insights.websiteClicks)}</p></div>
                <div><p className="text-xs text-gray-500">Veibeskrivelser</p><p className="text-xl text-white">{nb(gbp.insights.directionRequests)}</p></div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/15 p-4 text-sm text-gray-400">
              Koble Google-bedriftsprofil i Asoldi kundeportal → Innstillinger for direkte visninger, klikk og anrop fra Maps.
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-white/10 overflow-hidden">
              <div className="px-4 py-3 border-b border-white/10 text-sm text-white">Mest besøkte sider</div>
              <table className="w-full text-sm">
                <tbody>
                  {(traffic.topPages || []).map((row) => (
                    <tr key={row.path} className="border-t border-white/5">
                      <td className="px-4 py-2 text-gray-300 truncate">{row.path}</td>
                      <td className="px-4 py-2 text-right text-white">{nb(row.count)}</td>
                    </tr>
                  ))}
                  {!(traffic.topPages || []).length ? <tr><td className="px-4 py-6 text-gray-500" colSpan={2}>Ingen sidevisninger i perioden ennå.</td></tr> : null}
                </tbody>
              </table>
            </div>
            <div className="rounded-2xl border border-white/10 overflow-hidden">
              <div className="px-4 py-3 border-b border-white/10 text-sm text-white">Trafikkilder</div>
              <table className="w-full text-sm">
                <tbody>
                  {(traffic.referrers || []).map((row) => (
                    <tr key={row.source} className="border-t border-white/5">
                      <td className="px-4 py-2 text-gray-300 truncate">{row.source}</td>
                      <td className="px-4 py-2 text-right text-white">{nb(row.count)}</td>
                    </tr>
                  ))}
                  {!(traffic.referrers || []).length ? <tr><td className="px-4 py-6 text-gray-500" colSpan={2}>Ingen henvisninger i perioden.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {data && tab === 'maps' ? (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-4">
            <Kpi label="Beste Maps-posisjon" value={maps.summary?.bestPosition ? `#${maps.summary.bestPosition}` : '—'} />
            <Kpi label="Snittposisjon" value={maps.summary?.avgPosition ? nb(maps.summary.avgPosition, 1) : '—'} />
            <Kpi label="Vurdering" value={maps.summary?.rating ? `${nb(maps.summary.rating, 1)} ★` : '—'} />
            <Kpi label="Anmeldelser" value={nb(maps.summary?.reviews || 0)} />
          </div>
          <div className="rounded-2xl border border-white/10 bg-[#222] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-white font-semibold flex items-center gap-2"><MapPin size={16} className="text-[#FF5B00]" /> Lokal Google Maps-pakke</h3>
                <p className="text-xs text-gray-500 mt-1">
                  DataForSEO Google Maps SERP · søkeord fra nøkkelordplanen i Website Maker · {data.subject?.address || 'kundekort-adresse'} · neste kjøring {maps.nextRunAt ? new Date(maps.nextRunAt).toLocaleDateString('nb-NO') : 'når adressen er satt'}
                </p>
              </div>
              <span className="text-xs text-gray-500">{maps.lastRunAt ? `Sist: ${new Date(maps.lastRunAt).toLocaleString('nb-NO')}` : 'Ikke kjørt ennå'}</span>
            </div>
            {maps.lastError ? <p className="text-amber-400 text-sm mb-3">{maps.lastError}</p> : null}
            <Pack queries={queries} />
          </div>
          <div className="rounded-2xl border border-white/10 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 text-sm text-white">Søkeord og posisjon</div>
            <table className="w-full text-sm">
              <thead className="text-gray-500 text-xs">
                <tr><th className="text-left px-4 py-2">Søkeord</th><th className="text-left px-4 py-2">Posisjon</th><th className="text-left px-4 py-2">I trefflisten</th><th className="text-left px-4 py-2">Kategori</th></tr>
              </thead>
              <tbody>
                {queries.map((row) => (
                  <tr key={row.keyword} className="border-t border-white/5">
                    <td className="px-4 py-2 text-white">{row.keyword}</td>
                    <td className="px-4 py-2 text-[#FF5B00] font-semibold">{row.found ? `#${row.position}` : 'Ikke funnet'}</td>
                    <td className="px-4 py-2 text-gray-400">{row.found ? 'Ja' : 'Nei'}</td>
                    <td className="px-4 py-2 text-gray-400">{row.listing?.category || '—'}</td>
                  </tr>
                ))}
                {!queries.length ? <tr><td className="px-4 py-6 text-gray-500" colSpan={4}>Ingen rangering ennå. Fyll inn adresse og nøkkelord i kundekortet.</td></tr> : null}
              </tbody>
            </table>
          </div>
          {maps.history?.length > 1 ? (
            <div className="rounded-2xl border border-white/10 p-5">
              <h3 className="text-white font-semibold mb-3 flex items-center gap-2"><TrendingUp size={16} /> Utvikling hver 14. dag</h3>
              <Sparkline points={maps.history.map((row) => (row.bestPosition ? 21 - row.bestPosition : 0))} />
              <div className="mt-3 grid gap-2 sm:grid-cols-4">
                {maps.history.slice(-4).map((row) => (
                  <div key={row.ranAt} className="rounded-xl bg-black/20 p-3 text-xs text-gray-400">
                    <p>{new Date(row.ranAt).toLocaleDateString('nb-NO')}</p>
                    <p className="text-white text-sm mt-1">#{row.bestPosition || '—'} · {nb(row.rating, 1)} ★</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {data && tab === 'shop' && ecommerce ? (
        <div className="space-y-5">
          <p className="text-sm text-gray-400">
            Salg, kunder og kasse-trakt for perioden. Besøk, avvisning og sider ligger under Trafikk.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Totalt salg" value={kr(ecommerce.revenue)} points={(ecommerce.series || []).map((row) => row.revenue || 0)} />
            <Kpi label="Bestillinger" value={nb(ecommerce.orders)} points={(ecommerce.series || []).map((row) => row.orders || 0)} />
            <Kpi label="Snittbestilling" value={kr(ecommerce.aov)} />
            <Kpi label="Butikkonvertering" value={pct(ecommerce.conversionRate)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-[#222] p-4">
              <p className="text-xs text-gray-500">Enheter solgt</p>
              <p className="text-xl text-white mt-1">{nb(ecommerce.unitsSold)}</p>
              <p className="text-xs text-gray-500 mt-1">{nb(ecommerce.itemsPerOrder, 1)} per ordre</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#222] p-4">
              <p className="text-xs text-gray-500">Tilbakevendende kunder</p>
              <p className="text-xl text-white mt-1">{pct(ecommerce.returningRate)}</p>
              <p className="text-xs text-gray-500 mt-1">{nb(ecommerce.returningCustomers)} av {nb(ecommerce.customers)}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#222] p-4">
              <p className="text-xs text-gray-500">Nye kunder</p>
              <p className="text-xl text-white mt-1">{nb(ecommerce.newCustomers)}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#222] p-4">
              <p className="text-xs text-gray-500">Kansellerte</p>
              <p className="text-xl text-white mt-1">{nb(ecommerce.cancelled)}</p>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-5">
            <div className="lg:col-span-3 rounded-2xl border border-white/10 bg-[#222] p-5">
              <h3 className="text-white font-semibold mb-1">Nettbutikk-trakt</h3>
              <p className="text-xs text-gray-500 mb-4">Hvor kundene faller av mellom produkt, kurv, kasse og kjøp.</p>
              <Funnel stages={ecommerce.funnel || []} />
            </div>
            <div className="lg:col-span-2 space-y-3">
              <div className="rounded-2xl border border-white/10 bg-[#222] p-5">
                <p className="text-xs text-gray-500">Forlatt handlekurv</p>
                <p className="text-3xl text-white mt-1">{pct(ecommerce.abandonment?.cart)}</p>
                <p className="text-xs text-gray-500 mt-2">La i kurv, men startet ikke kasse.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#222] p-5">
                <p className="text-xs text-gray-500">Forlatt kasse</p>
                <p className="text-3xl text-white mt-1">{pct(ecommerce.abandonment?.checkout)}</p>
                <p className="text-xs text-gray-500 mt-2">Startet kasse, men fullførte ikke kjøp.</p>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 text-sm text-white flex items-center gap-2"><ShoppingBag size={14} /> Mest solgte produkter</div>
            <table className="w-full text-sm">
              <thead className="text-gray-500 text-xs">
                <tr>
                  <th className="text-left px-4 py-2">Produkt</th>
                  <th className="text-left px-4 py-2">Solgt</th>
                  <th className="text-right px-4 py-2">Salg</th>
                </tr>
              </thead>
              <tbody>
                {(ecommerce.topProducts || []).map((row) => (
                  <tr key={row.name} className="border-t border-white/5">
                    <td className="px-4 py-2 text-white">{row.name}</td>
                    <td className="px-4 py-2 text-gray-400">{nb(row.count)}</td>
                    <td className="px-4 py-2 text-right text-white">{kr(row.revenue)}</td>
                  </tr>
                ))}
                {!(ecommerce.topProducts || []).length ? <tr><td className="px-4 py-6 text-gray-500" colSpan={3}>Ingen ordre i perioden.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {settings ? (
        <div className="mt-8">
          <button type="button" onClick={() => setSetupOpen((v) => !v)} className="text-xs text-gray-500 hover:text-white">
            {setupOpen ? 'Skjul' : 'Vis'} teknisk oppsett (GA4 DNS)
          </button>
          {setupOpen ? (
            <form onSubmit={saveSettings} className="mt-3 rounded-xl bg-[#2a2a2a] border border-white/10 p-6 space-y-4 max-w-3xl">
              <label className="block text-sm text-gray-400">
                Domain
                <input value={settings.domain || ''} onChange={(e) => setSettings((s) => ({ ...s, domain: e.target.value }))} className="mt-1 w-full px-4 py-2 rounded-lg bg-[#1a1a1a] border border-white/20 text-white" />
              </label>
              <label className="block text-sm text-gray-400">
                GA4 measurement ID
                <input value={settings.measurementId || ''} onChange={(e) => setSettings((s) => ({ ...s, measurementId: e.target.value }))} className="mt-1 w-full px-4 py-2 rounded-lg bg-[#1a1a1a] border border-white/20 text-white" />
              </label>
              <div className="rounded-lg bg-black/30 p-3 text-sm text-gray-300">
                <p className="text-white font-medium mb-1">DNS TXT</p>
                <code className="break-all">{settings.dnsRecord}</code>
              </div>
              <p className="text-sm text-gray-400">Status: {settings.verified ? 'Verifisert' : 'Ikke verifisert'}</p>
              <div className="flex gap-2">
                <button type="submit" disabled={loading} className="px-4 py-2 rounded-lg bg-[#FF5B00] text-white">Lagre</button>
                <button type="button" onClick={verify} disabled={loading} className="px-4 py-2 rounded-lg bg-white/10 text-white">Sjekk DNS</button>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
