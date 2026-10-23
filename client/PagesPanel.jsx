/** Published pages and which blog/product URLs use the client page or the CMS template. */
import { useEffect, useState } from 'react';

const API = '/api/cms';

/** Pages list: open a page in the Website editor. */
export function PagesPanel({ authHeaders, onOpenPage }) {
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [query, setQuery] = useState('');
    useEffect(() => {
        fetch(`${API}/content-pages`, { headers: authHeaders() })
            .then(async (res) => {
            if (!res.ok)
                throw new Error('Could not load pages');
            setData(await res.json());
        })
            .catch((err) => setError(err.message));
    }, [authHeaders]);
    if (error)
        return <p className="text-[#b42318] text-sm">{error}</p>;
    if (!data)
        return <p className="text-[#6d7175] text-sm">Loading…</p>;
    const pages = Array.isArray(data.pages) ? data.pages : [];
    const content = Array.isArray(data.content) ? data.content : [];
    return (<div className="max-w-4xl">
      <h1 className="text-xl font-semibold text-[#1a1c1e] mb-1">Pages</h1>
      <p className="text-sm text-[#6d7175] mb-4">These are the pages on the website. Edit opens the page editor. View opens the live page. Blog posts are a separate list.</p>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search pages" className="mb-4 px-3 py-2 rounded-lg bg-white border border-[#c9cccf] text-sm text-[#1a1c1e] w-64"/>
      <div className="rounded-xl bg-white border border-[#e3e3e3] overflow-hidden mb-6">
        <table className="w-full text-sm text-left">
          <thead><tr className="text-[#6d7175] text-xs"><th className="px-4 py-2">Title</th><th className="px-4 py-2">Kind</th><th className="px-4 py-2">Menu</th><th className="px-4 py-2"></th></tr></thead>
          <tbody>
            {pages.filter((page) => !query.trim() || `${page.title} ${page.route} ${page.kind}`.toLowerCase().includes(query.trim().toLowerCase())).map((page) => (<tr key={page.route} className="border-t border-[#f1f2f4]">
                <td className="px-4 py-2"><button type="button" onClick={() => onOpenPage?.(page.route)} className="font-medium text-[#1a1c1e] hover:text-[#FF5B00]">{page.title || page.route}</button><div className="text-xs text-[#6d7175]">{page.route}</div></td>
                <td className="px-4 py-2">{page.kind}</td>
                <td className="px-4 py-2">{page.inNav ? 'Yes' : '—'}</td>
                <td className="px-4 py-2 text-right space-x-3">
                  <a href={page.route || '/'} className="text-xs text-[#FF5B00]">View</a>
                  <button type="button" onClick={() => onOpenPage?.(page.route)} className="text-xs text-[#FF5B00]">Edit</button>
                </td>
              </tr>))}
            {!pages.length && <tr><td className="px-4 py-6 text-[#6d7175]" colSpan={4}>No pages in this site.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="rounded-xl bg-white border border-[#e3e3e3] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#e3e3e3] text-sm font-medium">Blog and products</div>
        <table className="w-full text-sm text-left">
          <thead><tr className="text-[#6d7175] text-xs"><th className="px-4 py-2">URL</th><th className="px-4 py-2">Kind</th><th className="px-4 py-2">Renders from</th></tr></thead>
          <tbody>
            {content.map((row) => (<tr key={row.kind} className="border-t border-[#f1f2f4]">
                <td className="px-4 py-2">{row.path}</td>
                <td className="px-4 py-2">{row.kind}</td>
                <td className="px-4 py-2">{row.source === 'client' ? `Client page ${row.route}` : 'CMS template'}</td>
              </tr>))}
          </tbody>
        </table>
      </div>
    </div>);
}
