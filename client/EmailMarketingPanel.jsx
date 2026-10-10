/** Admin email tab: templates, lists, and which website forms feed each list. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { EmailVisualEditor } from './EmailVisualEditor.jsx';
const API = '/api/cms';
function acceptLabel(value) {
    return value === true ? 'true' : '';
}
/** Email templates, lists, and the forms that feed them. */
export function EmailMarketingPanel({ authHeaders, loading, setLoading }) {
    const [view, setView] = useState('templates');
    const [lists, setLists] = useState([]);
    const [leads, setLeads] = useState([]);
    const [selectedList, setSelectedList] = useState('');
    const [newListName, setNewListName] = useState('');
    const [filters, setFilters] = useState({ email: '', name: '', language: '', marketingAccept: '' });
    const [endpointCopied, setEndpointCopied] = useState(false);
    const [templates, setTemplates] = useState([]);
    const [mergeFields, setMergeFields] = useState([]);
    const [selectedTemplateId, setSelectedTemplateId] = useState('');
    const [templateName, setTemplateName] = useState('');
    const [templateSubject, setTemplateSubject] = useState('');
    const [templatePreheader, setTemplatePreheader] = useState('');
    const [templateHtml, setTemplateHtml] = useState('');
    const [templateHtmlKey, setTemplateHtmlKey] = useState('');
    const [templateProject, setTemplateProject] = useState(null);
    const fileRef = useRef(null);
    const fetchLists = useCallback(async () => {
        const res = await fetch(`${API}/lists`, { headers: authHeaders() });
        if (!res.ok)
            return;
        const data = await res.json();
        setLists(data);
        setSelectedList((current) => current || data[0]?.id || '');
    }, [authHeaders]);
    const fetchLeads = useCallback(async () => {
        const params = new URLSearchParams();
        if (selectedList)
            params.set('listId', selectedList);
        Object.entries(filters).forEach(([key, value]) => {
            if (value)
                params.set(key, value);
        });
        const res = await fetch(`${API}/leads?${params.toString()}`, { headers: authHeaders() });
        if (!res.ok)
            return;
        setLeads(await res.json());
    }, [authHeaders, selectedList, filters]);
    const fetchTemplates = useCallback(async () => {
        const res = await fetch(`${API}/email-templates`, { headers: authHeaders() });
        if (!res.ok)
            return;
        const data = await res.json();
        const rows = data.templates || [];
        setTemplates(rows);
        setMergeFields(data.mergeFields || []);
        setSelectedTemplateId((current) => current || rows[0]?.id || '');
    }, [authHeaders]);
    useEffect(() => {
        fetchLists();
        fetchTemplates();
    }, [fetchLists, fetchTemplates]);
    useEffect(() => {
        fetchLeads();
    }, [fetchLeads]);
    const handleAddList = async (e) => {
        e.preventDefault();
        if (!newListName.trim())
            return;
        setLoading(true);
        try {
            const res = await fetch(`${API}/lists`, {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newListName.trim() }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                alert(data.message || 'Could not create list');
                return;
            }
            setNewListName('');
            await fetchLists();
            setSelectedList(data.id);
        }
        finally {
            setLoading(false);
        }
    };
    const selected = lists.find((list) => list.id === selectedList);
    const endpoint = selected
        ? `${typeof window !== 'undefined' ? window.location.origin : ''}/api/cms/leads`
        : '/api/cms/leads';
    const selectedTemplate = templates.find((row) => row.id === selectedTemplateId) || null;
    useEffect(() => {
        if (!selectedTemplate)
            return;
        setTemplateName(selectedTemplate.name);
        setTemplateSubject(selectedTemplate.subject);
        setTemplatePreheader(selectedTemplate.preheader);
        setTemplateHtml(selectedTemplate.html);
        setTemplateProject(selectedTemplate.grapesProject || null);
        setTemplateHtmlKey(`${selectedTemplate.id}-${selectedTemplate.updatedAt}`);
    }, [selectedTemplateId]);
    const saveTemplate = async () => {
        setLoading(true);
        try {
            const res = await fetch(selectedTemplate ? `${API}/email-templates/${selectedTemplate.id}` : `${API}/email-templates`, {
                method: selectedTemplate ? 'PUT' : 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: templateName,
                    subject: templateSubject,
                    preheader: templatePreheader,
                    html: templateHtml,
                    grapesProject: templateProject,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                alert(data.message || 'Could not save template');
                return;
            }
            await fetchTemplates();
            if (data.template?.id)
                setSelectedTemplateId(data.template.id);
        }
        finally {
            setLoading(false);
        }
    };
    const createTemplate = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API}/email-templates`, {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: 'Ny mal',
                    subject: '',
                    preheader: '',
                    html: '<table width="100%"><tr><td style="padding:24px;font-family:Arial">Hei {{firstName}},</td></tr></table>',
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                alert(data.message || 'Could not create template');
                return;
            }
            await fetchTemplates();
            if (data.template?.id)
                setSelectedTemplateId(data.template.id);
        }
        finally {
            setLoading(false);
        }
    };
    const previewTemplate = () => {
        const blob = new Blob([`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${templateSubject || 'Forhåndsvisning'}</title></head><body style="margin:0">${templateHtml}</body></html>`], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
    };
    const importTemplate = async (file) => {
        const html = await file.text();
        setLoading(true);
        try {
            const res = await fetch(`${API}/email-templates/import`, {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: file.name.replace(/\.[^.]+$/, ''), html }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                alert(data.message || 'Import failed');
                return;
            }
            await fetchTemplates();
            if (data.template?.id)
                setSelectedTemplateId(data.template.id);
        }
        finally {
            setLoading(false);
        }
    };
    return (<div className="max-w-6xl">
      <h1 className="text-2xl font-bold text-white mb-2">Email</h1>
      <div className="flex gap-2 mb-6">
        <button type="button" onClick={() => setView('templates')} className={`px-3 py-1.5 rounded-lg text-sm ${view === 'templates' ? 'bg-[#FF5B00] text-white' : 'bg-white/10 text-gray-300'}`}>Maler</button>
        <button type="button" onClick={() => setView('lists')} className={`px-3 py-1.5 rounded-lg text-sm ${view === 'lists' ? 'bg-[#FF5B00] text-white' : 'bg-white/10 text-gray-300'}`}>Lister</button>
      </div>

      {view === 'templates' && (<div className="grid md:grid-cols-[240px_1fr] gap-6">
          <div>
            <button type="button" onClick={() => fileRef.current?.click()} className="w-full mb-2 px-3 py-2 rounded-lg border border-dashed border-white/20 text-xs text-gray-300">
              Importer HTML
            </button>
            <button type="button" onClick={() => void createTemplate()} className="w-full mb-3 px-3 py-2 rounded-lg bg-white/10 text-xs text-gray-300">
              Ny mal
            </button>
            <input ref={fileRef} type="file" accept=".html,.htm,.txt" className="hidden" onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file)
                    void importTemplate(file);
            }}/>
            <div className="space-y-1">
              {templates.map((template) => (<button key={template.id} type="button" onClick={() => setSelectedTemplateId(template.id)} className={`w-full text-left px-3 py-2 rounded-lg text-sm ${selectedTemplateId === template.id ? 'bg-[#FF5B00] text-white' : 'bg-white/5 text-gray-300'}`}>
                  <div>{template.name}</div>
                  <div className="text-[11px] opacity-70">{template.preset ? 'Asoldi-mal' : 'Egen / importert'}</div>
                </button>))}
              {templates.length === 0 && <p className="text-xs text-gray-500">Ingen maler. Importer HTML for å starte.</p>}
            </div>
          </div>
          <div className="space-y-3">
            <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Navn" className="w-full px-3 py-2 rounded-lg bg-[#1a1a1a] border border-white/20 text-white text-sm"/>
            <input value={templateSubject} onChange={(e) => setTemplateSubject(e.target.value)} placeholder="Emne" className="w-full px-3 py-2 rounded-lg bg-[#1a1a1a] border border-white/20 text-white text-sm"/>
            <input value={templatePreheader} onChange={(e) => setTemplatePreheader(e.target.value)} placeholder="Preheader" className="w-full px-3 py-2 rounded-lg bg-[#1a1a1a] border border-white/20 text-white text-sm"/>
            <EmailVisualEditor html={templateHtml} htmlKey={templateHtmlKey} grapesProject={selectedTemplate?.grapesProject} mergeFields={mergeFields} onHtmlChange={setTemplateHtml} onProjectChange={setTemplateProject}/>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void saveTemplate()} disabled={loading} className="px-4 py-2 rounded-lg bg-[#FF5B00] text-white text-sm disabled:opacity-50">Lagre mal</button>
              <button type="button" onClick={previewTemplate} className="px-4 py-2 rounded-lg bg-white/10 text-white text-sm">Forhåndsvis</button>
            </div>
          </div>
        </div>)}

      {view === 'lists' && (<>
      <p className="text-gray-400 text-sm mb-6">
        Lists live on this client host. Point any Website Creator form or lead magnet at the endpoint below with{' '}
        <code className="text-gray-300">listSlug</code> or <code className="text-gray-300">listId</code>.
      </p>

      <div className="rounded-xl bg-[#2a2a2a] border border-white/10 p-4 mb-6">
        <div className="text-xs text-gray-400 mb-1">Form endpoint</div>
        <div className="flex flex-wrap items-center gap-2">
          <code className="text-white text-sm break-all">{endpoint}</code>
          <button type="button" className="text-xs text-[#FF5B00] hover:underline" onClick={async () => {
                await navigator.clipboard?.writeText(JSON.stringify({
                    listSlug: selected?.slug || 'website-forms',
                    name: '',
                    email: '',
                    sms: '',
                    whatsapp: '',
                    language: '',
                    marketingAccept: true,
                }, null, 2));
                setEndpointCopied(true);
            }}>
            {endpointCopied ? 'Copied POST body' : 'Copy POST example'}
          </button>
        </div>
        {selected && <p className="text-gray-500 text-xs mt-2">Use listSlug: {selected.slug}</p>}
      </div>

      <div className="grid md:grid-cols-[240px_1fr] gap-6">
        <div>
          <h2 className="text-sm font-medium text-white mb-3">Lists</h2>
          <form onSubmit={handleAddList} className="mb-3">
            <input value={newListName} onChange={(e) => setNewListName(e.target.value)} placeholder="New list name" className="w-full px-3 py-2 rounded-lg bg-[#1a1a1a] border border-white/20 text-white text-sm mb-2"/>
            <button type="submit" disabled={loading || !newListName.trim()} className="w-full px-3 py-2 rounded-lg bg-[#FF5B00] text-white text-sm disabled:opacity-50">
              Add list
            </button>
          </form>
          <div className="space-y-1">
            {lists.map((list) => (<button key={list.id} type="button" onClick={() => setSelectedList(list.id)} className={`w-full text-left px-3 py-2 rounded-lg text-sm ${selectedList === list.id ? 'bg-[#FF5B00] text-white' : 'bg-white/5 text-gray-300 hover:bg-white/10'}`}>
                <div>{list.name}</div>
                <div className="text-xs opacity-70">
                  {list.slug} · {list.count || 0}
                </div>
              </button>))}
          </div>
        </div>
        <div>
          {selected && (<div className="rounded-xl bg-[#2a2a2a] border border-white/10 p-4 mb-4">
              <div className="text-xs uppercase text-gray-400 mb-2">Website forms feeding “{selected.name}”</div>
              {Array.isArray(selected.forms) && selected.forms.length ? (<ul className="space-y-1">
                  {selected.forms.map((form) => (<li key={form.id} className="text-sm text-white flex flex-wrap items-center gap-2">
                      <span>{form.label}</span>
                      <span className="text-xs text-gray-400">{form.purpose}</span>
                      {form.pages?.length ? (<span className="text-xs text-gray-500">
                          on {form.pages.slice(0, 3).join(', ')}
                          {form.pages.length > 3 ? ` +${form.pages.length - 3}` : ''}
                        </span>) : null}
                    </li>))}
                </ul>) : (<p className="text-sm text-gray-400">
                  No website form is wired to this list yet. Forms are connected in Website Creator → Step 3 “CMS hookup” before publishing.
                </p>)}
            </div>)}
          <div className="grid md:grid-cols-4 gap-2 mb-4">
            <input placeholder="Name" value={filters.name} onChange={(e) => setFilters((f) => ({ ...f, name: e.target.value }))} className="px-3 py-2 rounded-lg bg-[#1a1a1a] border border-white/20 text-white text-sm"/>
            <input placeholder="Email" value={filters.email} onChange={(e) => setFilters((f) => ({ ...f, email: e.target.value }))} className="px-3 py-2 rounded-lg bg-[#1a1a1a] border border-white/20 text-white text-sm"/>
            <input placeholder="Language" value={filters.language} onChange={(e) => setFilters((f) => ({ ...f, language: e.target.value }))} className="px-3 py-2 rounded-lg bg-[#1a1a1a] border border-white/20 text-white text-sm"/>
            <select value={filters.marketingAccept} onChange={(e) => setFilters((f) => ({ ...f, marketingAccept: e.target.value }))} className="px-3 py-2 rounded-lg bg-[#1a1a1a] border border-white/20 text-white text-sm">
              <option value="">Accept: any</option>
              <option value="true">true</option>
              <option value="false">not accepted</option>
            </select>
          </div>
          <div className="rounded-xl bg-[#2a2a2a] border border-white/10 overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[700px]">
              <thead>
                <tr className="border-b border-white/10 text-xs uppercase text-gray-400">
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">SMS</th>
                  <th className="px-3 py-2">WhatsApp</th>
                  <th className="px-3 py-2">Language</th>
                  <th className="px-3 py-2">Signup</th>
                  <th className="px-3 py-2">Accept</th>
                  <th className="px-3 py-2">Accept time</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (<tr key={lead.id} className="border-b border-white/5">
                    <td className="px-3 py-2 text-white">{lead.name || '—'}</td>
                    <td className="px-3 py-2 text-gray-300">{lead.email}</td>
                    <td className="px-3 py-2 text-gray-400">{lead.sms || '—'}</td>
                    <td className="px-3 py-2 text-gray-400">{lead.whatsapp || '—'}</td>
                    <td className="px-3 py-2 text-gray-400">{lead.language || '—'}</td>
                    <td className="px-3 py-2 text-gray-400">{lead.signupAt ? new Date(lead.signupAt).toLocaleString() : '—'}</td>
                    <td className="px-3 py-2 text-gray-300">{acceptLabel(lead.marketingAccept)}</td>
                    <td className="px-3 py-2 text-gray-400">{lead.marketingAcceptAt ? new Date(lead.marketingAcceptAt).toLocaleString() : ''}</td>
                  </tr>))}
              </tbody>
            </table>
            {leads.length === 0 && <p className="px-4 py-8 text-gray-400 text-center">No contacts in this list yet.</p>}
          </div>
        </div>
      </div>
      </>)}
    </div>);
}
