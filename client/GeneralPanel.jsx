/** Pages and bound forms from the Step 3 seed, plus the inbox. List signups stay under Email. */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, FileText, Inbox, Mail, MailOpen, Trash2 } from 'lucide-react';
const API = '/api/cms';
const KIND_LABEL = {
    home: 'Home',
    about: 'About',
    services: 'Services',
    menu: 'Menu',
    pricing: 'Pricing',
    gallery: 'Gallery',
    faq: 'FAQ',
    contact: 'Contact',
    'blog-index': 'Blog',
    'blog-post': 'Blog post (template)',
    'product-index': 'Shop / listing',
    'product-page': 'Product page (template)',
    cta: 'CTA / conversion',
    legal: 'Legal',
    other: 'Other',
};
const KIND_ORDER = ['home', 'about', 'services', 'menu', 'pricing', 'gallery', 'faq', 'contact', 'cta', 'blog-index', 'blog-post', 'product-index', 'product-page', 'legal', 'other'];
const PURPOSE_LABEL = {
    newsletter: 'Newsletter signup',
    contact: 'Contact',
    booking: 'Booking',
    order: 'Order',
    search: 'Search',
    login: 'Login',
    other: 'Form',
};
function KindBadge({ kind, isTemplate }) {
    const tone = isTemplate
        ? 'bg-[#FF5B00]/20 text-[#ffb27a] border-[#FF5B00]/40'
        : kind === 'home'
            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
            : 'bg-white/10 text-gray-300 border-white/15';
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${tone}`}>{KIND_LABEL[kind] || kind}</span>;
}
/** Pages, forms, and the inbox from the site seed. */
export function GeneralPanel({ authHeaders, loading, setLoading, siteName = '' }) {
    const [view, setView] = useState('pages');
    const [site, setSite] = useState(null);
    const [submissions, setSubmissions] = useState([]);
    const [formFilter, setFormFilter] = useState('');
    const [error, setError] = useState('');
    const load = useCallback(async () => {
        setError('');
        const [siteRes, subRes] = await Promise.all([
            fetch(`${API}/site`, { headers: authHeaders() }),
            fetch(`${API}/submissions`, { headers: authHeaders() }),
        ]);
        if (siteRes.ok)
            setSite(await siteRes.json());
        else
            setError('Could not load site structure.');
        if (subRes.ok)
            setSubmissions(await subRes.json());
    }, [authHeaders]);
    useEffect(() => {
        load().catch(() => setError('Network error'));
    }, [load]);
    const pages = useMemo(() => {
        const rows = [...(site?.pages || [])];
        rows.sort((a, b) => {
            if (a.route === '/')
                return -1;
            if (b.route === '/')
                return 1;
            const ka = KIND_ORDER.indexOf(a.kind);
            const kb = KIND_ORDER.indexOf(b.kind);
            if (ka !== kb)
                return ka - kb;
            return a.route.localeCompare(b.route);
        });
        return rows;
    }, [site]);
    const forms = site?.forms || [];
    const inboxForms = forms.filter((f) => f.destination?.type === 'inbox');
    const listForms = forms.filter((f) => f.destination?.type === 'list');
    const unreadTotal = submissions.filter((s) => !s.read).length;
    const visibleSubmissions = formFilter ? submissions.filter((s) => s.formId === formFilter) : submissions;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const pageUrl = (route) => `${origin}${route === '/' ? '/' : route}`;
    async function markRead(id, read) {
        setLoading(true);
        try {
            const res = await fetch(`${API}/submissions/${id}`, {
                method: 'PUT',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ read }),
            });
            if (res.ok)
                setSubmissions((rows) => rows.map((r) => (r.id === id ? { ...r, read } : r)));
        }
        finally {
            setLoading(false);
        }
    }
    async function remove(id) {
        if (!confirm('Delete this submission?'))
            return;
        setLoading(true);
        try {
            const res = await fetch(`${API}/submissions/${id}`, { method: 'DELETE', headers: authHeaders() });
            if (res.ok || res.status === 204)
                setSubmissions((rows) => rows.filter((r) => r.id !== id));
        }
        finally {
            setLoading(false);
        }
    }
    return (<div className="max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">General</h1>
          <p className="text-gray-400 text-sm mt-1">
            {siteName || site?.site?.name || 'This site'} — pages and the forms wired to this CMS.
            {site?.generatedAt ? ` Structure from Website Creator, ${new Date(site.generatedAt).toLocaleDateString()}.` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setView('pages')} className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-2 ${view === 'pages' ? 'bg-[#FF5B00] text-white' : 'bg-white/10 text-gray-300'}`}>
            <FileText size={14}/> Pages{pages.length ? ` (${pages.length})` : ''}
          </button>
          <button type="button" onClick={() => setView('forms')} className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-2 ${view === 'forms' ? 'bg-[#FF5B00] text-white' : 'bg-white/10 text-gray-300'}`}>
            <Inbox size={14}/> Forms & inbox{unreadTotal ? ` (${unreadTotal} new)` : ''}
          </button>
        </div>
      </div>

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

      {view === 'pages' && (<>
          <p className="text-gray-400 text-sm mb-4">
            Every page on the website with its role. <span className="text-[#ffb27a]">Template</span> pages (blog post, product page) are the layouts the CMS fills with posts and products.
          </p>
          <div className="rounded-xl bg-[#2a2a2a] border border-white/10 overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-white/10 text-xs uppercase text-gray-400">
                  <th className="px-4 py-3">Page</th>
                  <th className="px-4 py-3">Route</th>
                  <th className="px-4 py-3">Kind</th>
                  <th className="px-4 py-3">In menu</th>
                  <th className="px-4 py-3">Forms</th>
                  <th className="px-4 py-3 w-24"></th>
                </tr>
              </thead>
              <tbody>
                {pages.map((page) => {
                const pageForms = forms.filter((f) => (f.pages || []).includes(page.route));
                return (<tr key={page.route} className="border-b border-white/5">
                      <td className="px-4 py-3 text-white">{page.title || page.navLabel || page.route}</td>
                      <td className="px-4 py-3 text-gray-400 font-mono text-xs">{page.route}</td>
                      <td className="px-4 py-3"><KindBadge kind={page.kind} isTemplate={page.isTemplate}/></td>
                      <td className="px-4 py-3 text-gray-400">{page.inNav ? 'yes' : '—'}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{pageForms.length ? pageForms.map((f) => f.label).join(', ') : '—'}</td>
                      <td className="px-4 py-3">
                        <a href={pageUrl(page.route)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-[#FF5B00] hover:underline">
                          Open <ExternalLink size={12}/>
                        </a>
                      </td>
                    </tr>);
            })}
              </tbody>
            </table>
            {!pages.length && (<p className="px-4 py-8 text-gray-400 text-center text-sm">
                No page map yet. It is generated in Website Creator → Step 3 “CMS hookup” and shipped with the next publish.
              </p>)}
          </div>
        </>)}

      {view === 'forms' && (<>
          <div className="grid md:grid-cols-2 gap-4 mb-6">
            <div className="rounded-xl bg-[#2a2a2a] border border-white/10 p-4">
              <div className="text-xs uppercase text-gray-400 mb-2 flex items-center gap-2"><Mail size={14}/> Signup forms → email lists</div>
              {listForms.length ? (<ul className="space-y-2">
                  {listForms.map((f) => (<li key={f.id} className="text-sm text-white">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{f.label}</span>
                        <span className="text-xs text-gray-400">{PURPOSE_LABEL[f.purpose] || f.purpose}</span>
                        <span className="text-xs text-gray-500">→ {f.destination?.listName || 'list'}</span>
                        <span className="text-xs text-emerald-300">{f.count} signup{f.count === 1 ? '' : 's'}</span>
                      </div>
                      {f.pages?.length ? <div className="text-xs text-gray-500">on {f.pages.join(', ')}</div> : null}
                    </li>))}
                </ul>) : (<p className="text-sm text-gray-400">No signup form is connected. Subscribers are managed under Email marketing.</p>)}
            </div>
            <div className="rounded-xl bg-[#2a2a2a] border border-white/10 p-4">
              <div className="text-xs uppercase text-gray-400 mb-2 flex items-center gap-2"><Inbox size={14}/> Contact forms → inbox</div>
              {inboxForms.length ? (<ul className="space-y-2">
                  {inboxForms.map((f) => (<li key={f.id} className="text-sm text-white">
                      <button type="button" onClick={() => setFormFilter(formFilter === f.id ? '' : f.id)} className={`text-left ${formFilter === f.id ? 'underline' : ''}`}>
                        {f.label}
                      </button>{' '}
                      <span className="text-xs text-gray-400">{PURPOSE_LABEL[f.purpose] || f.purpose}</span>{' '}
                      <span className="text-xs text-gray-500">{f.count} received{f.unread ? ` · ${f.unread} new` : ''}</span>
                      {f.pages?.length ? <div className="text-xs text-gray-500">on {f.pages.join(', ')}</div> : null}
                    </li>))}
                </ul>) : (<p className="text-sm text-gray-400">No contact form is connected to the inbox. Messages still reach you by e-mail.</p>)}
            </div>
          </div>

          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-medium text-white">Inbox {formFilter ? <span className="text-gray-400">· filtered</span> : null}</h2>
            {formFilter && (<button type="button" onClick={() => setFormFilter('')} className="text-xs text-[#FF5B00] hover:underline">Show all</button>)}
          </div>
          <div className="space-y-2">
            {visibleSubmissions.map((s) => (<div key={s.id} className={`rounded-xl border p-4 ${s.read ? 'bg-[#242424] border-white/5' : 'bg-[#2a2a2a] border-[#FF5B00]/30'}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-white text-sm font-medium flex items-center gap-2">
                      {!s.read && <span className="w-2 h-2 rounded-full bg-[#FF5B00]"/>}
                      {s.name || s.email || 'Anonymous'}
                      {s.email && <a href={`mailto:${s.email}`} className="text-xs text-[#FF5B00] hover:underline">{s.email}</a>}
                      {s.sms && <span className="text-xs text-gray-400">{s.sms}</span>}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {s.formLabel || s.formId}{s.page ? ` · ${s.page}` : ''} · {new Date(s.createdAt).toLocaleString()}
                      {s.forwarded ? ' · e-mailed' : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => markRead(s.id, !s.read)} disabled={loading} className="text-gray-400 hover:text-white" title={s.read ? 'Mark unread' : 'Mark read'}>
                      {s.read ? <MailOpen size={16}/> : <Mail size={16}/>}
                    </button>
                    <button type="button" onClick={() => remove(s.id)} disabled={loading} className="text-gray-500 hover:text-red-400" title="Delete">
                      <Trash2 size={16}/>
                    </button>
                  </div>
                </div>
                {s.subject && <div className="text-sm text-gray-300 mt-2 font-medium">{s.subject}</div>}
                {s.message && <p className="text-sm text-gray-300 mt-1 whitespace-pre-wrap">{s.message}</p>}
                {s.extra && Object.keys(s.extra).length ? (<dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                    {Object.entries(s.extra).map(([k, v]) => (<React.Fragment key={k}>
                        <dt className="text-gray-500">{k}</dt>
                        <dd className="text-gray-300 break-words">{String(v)}</dd>
                      </React.Fragment>))}
                  </dl>) : null}
              </div>))}
            {!visibleSubmissions.length && (<p className="rounded-xl bg-[#2a2a2a] border border-white/10 px-4 py-8 text-gray-400 text-center text-sm">No messages yet.</p>)}
          </div>
        </>)}
    </div>);
}
