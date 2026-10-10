import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Monitor, Smartphone, Tablet, Undo2, Redo2, Globe } from 'lucide-react';
import { MediaPicker } from './MediaPanel.jsx';
import { SiteEditorInspector } from './SiteEditorInspector.jsx';

const API = '/api/cms';
const DEVICES = [
  { id: 'desktop', label: 'PC', width: null, icon: Monitor },
  { id: 'tablet', label: 'Nettbrett', width: 768, icon: Tablet },
  { id: 'phone', label: 'Telefon', width: 390, icon: Smartphone },
];

function mintKey(prefix = 'block') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function remintHtml(html, nextKey) {
  const prevKeys = [...String(html || '').matchAll(/data-asoldi-key="([^"]+)"/g)].map((m) => m[1]);
  const primary = prevKeys[0] || '';
  let out = String(html || '');
  if (primary) out = out.split(primary).join(nextKey);
  out = out.replace(/data-asoldi-inserted="1"/g, 'data-asoldi-inserted="1"');
  if (!/data-asoldi-inserted=/.test(out) && /data-asoldi-key=/.test(out)) {
    out = out.replace(/data-asoldi-key="/, 'data-asoldi-inserted="1" data-asoldi-key="');
  }
  return out;
}

const BLOCKS = [
  {
    id: 'heading',
    label: 'Overskrift',
    html: (key) =>
      `<section data-asoldi-section="content" data-asoldi-key="${key}" data-asoldi-inserted="1" style="padding:2rem 1.25rem"><h2 data-asoldi-text="${key}/heading/1">Ny overskrift</h2></section>`,
  },
  {
    id: 'text',
    label: 'Tekst',
    html: (key) =>
      `<section data-asoldi-section="content" data-asoldi-key="${key}" data-asoldi-inserted="1" style="padding:1.5rem 1.25rem"><p data-asoldi-text="${key}/body/1">Skriv teksten din her.</p></section>`,
  },
  {
    id: 'image',
    label: 'Bilde',
    html: (key) =>
      `<section data-asoldi-section="content" data-asoldi-key="${key}" data-asoldi-inserted="1" style="padding:1.5rem 1.25rem"><img data-asoldi-media="${key}/image/1" alt="" src="data:image/svg+xml,${encodeURIComponent('<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"800\" height=\"400\"><rect fill=\"#e5e7eb\" width=\"100%\" height=\"100%\"/><text x=\"50%\" y=\"50%\" text-anchor=\"middle\" fill=\"#6b7280\" font-size=\"20\">Bilde</text></svg>')}" style="max-width:100%;height:auto;display:block" /></section>`,
  },
  {
    id: 'button',
    label: 'Knapp',
    html: (key) =>
      `<section data-asoldi-section="cta" data-asoldi-key="${key}" data-asoldi-inserted="1" style="padding:1.5rem 1.25rem"><a data-asoldi-text="${key}/cta/1" href="/" style="display:inline-block;padding:0.75rem 1.25rem;background:#111;color:#fff;text-decoration:none;border-radius:8px">Knapp</a></section>`,
  },
  {
    id: 'divider',
    label: 'Skillelinje',
    html: (key) =>
      `<section data-asoldi-section="content" data-asoldi-key="${key}" data-asoldi-inserted="1" style="padding:0.75rem 1.25rem"><hr style="border:0;border-top:1px solid currentColor;opacity:.2" /></section>`,
  },
  {
    id: 'two-col',
    label: '2 kolonner',
    html: (key) =>
      `<section data-asoldi-section="content" data-asoldi-key="${key}" data-asoldi-inserted="1" style="padding:1.5rem 1.25rem;display:grid;grid-template-columns:1fr 1fr;gap:1rem"><p data-asoldi-text="${key}/body/1">Kolonne 1</p><p data-asoldi-text="${key}/body/2">Kolonne 2</p></section>`,
  },
  {
    id: 'cta',
    label: 'CTA-felt',
    html: (key) =>
      `<section data-asoldi-section="cta" data-asoldi-key="${key}" data-asoldi-inserted="1" style="padding:2.5rem 1.25rem;text-align:center"><h2 data-asoldi-text="${key}/heading/1">Klar for neste steg?</h2><p data-asoldi-text="${key}/body/1">Kort oppfordring.</p><a data-asoldi-text="${key}/cta/1" href="/kontakt" style="display:inline-block;margin-top:0.75rem;padding:0.75rem 1.25rem;background:#FF5B00;color:#fff;text-decoration:none;border-radius:8px">Kontakt oss</a></section>`,
  },
];

function routeHref(route) {
  const path = !route || route === '/' ? '/' : route;
  return `${path}${path.includes('?') ? '&' : '?'}asoldi-edit=1`;
}

function patchSignature(patch) {
  const type = patch?.type || '';
  return JSON.stringify({
    type,
    route: patch?.route || '/',
    key: patch?.key || '',
    value: patch?.value == null ? '' : patch.value,
    href: patch?.href || '',
    afterKey: patch?.afterKey || '',
    beforeKey: patch?.beforeKey || '',
    html: typeof patch?.html === 'string' ? patch.html : '',
    hidden: type === 'hide' ? patch?.hidden !== false && patch?.value !== false : false,
  });
}

function patchesLookEqual(a, b) {
  return JSON.stringify((a || []).map(patchSignature)) === JSON.stringify((b || []).map(patchSignature));
}

function upsertPatch(list, patch) {
  const next = [...(list || [])];
  if (patch.type === 'insert' || patch.type === 'remove' || patch.type === 'move' || patch.type === 'hide') {
    if (patch.type === 'hide') {
      const i = next.findIndex((row) => row.type === 'hide' && row.route === patch.route && row.key === patch.key);
      const row = { ...patch, hidden: patch.hidden !== false && patch.value !== false };
      if (i >= 0) {
        if (row.hidden === false) next.splice(i, 1);
        else next[i] = { ...next[i], ...row };
      } else if (row.hidden !== false) next.push(row);
      return next;
    }
    if (patch.type === 'remove') {
      return next.filter((row) => !(row.key === patch.key && row.route === patch.route)).concat([patch]);
    }
    next.push(patch);
    return next;
  }
  const i = next.findIndex((row) => row.type === patch.type && row.route === patch.route && row.key === patch.key);
  if (i >= 0) next[i] = { ...next[i], ...patch };
  else next.push(patch);
  return next;
}

export function SiteEditorPanel({ authHeaders, actor, onOpenTab, catalogType = 'normal' }) {
  const iframeRef = useRef(null);
  const [pages, setPages] = useState([]);
  const [route, setRoute] = useState('/');
  const [device, setDevice] = useState('desktop');
  const [draft, setDraft] = useState([]);
  const [published, setPublished] = useState([]);
  const [history, setHistory] = useState([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [status, setStatus] = useState('');
  const [hasMarkers, setHasMarkers] = useState(true);
  const [selected, setSelected] = useState(null);
  const [selectedSection, setSelectedSection] = useState('');
  const [mediaOpen, setMediaOpen] = useState(false);
  const [mediaTarget, setMediaTarget] = useState(null);
  const [unmarkedTip, setUnmarkedTip] = useState(false);
  const [saving, setSaving] = useState(false);
  const [iframeNonce, setIframeNonce] = useState(0);
  const hydratedRef = useRef(false);
  const draftRef = useRef([]);

  const page = useMemo(() => pages.find((p) => p.route === route) || { route, kind: 'other', isTemplate: false, slots: { hasMarkers: false } }, [pages, route]);
  const dirty = !patchesLookEqual(draft, published);
  const unpublishedCount = dirty
    ? draft.filter((patch) => !(published || []).some((row) => patchSignature(row) === patchSignature(patch))).length || draft.length
    : 0;
  draftRef.current = draft;
  const canPublish = (actor?.rank || 'admin') !== 'writer';
  const width = DEVICES.find((d) => d.id === device)?.width;

  const pushHistory = useCallback((next) => {
    setHistory((prev) => {
      const clipped = prev.slice(0, historyIndex + 1);
      clipped.push(next);
      return clipped.slice(-40);
    });
    setHistoryIndex((i) => Math.min(i + 1, 39));
  }, [historyIndex]);

  const loadState = useCallback(async () => {
    const [siteRes, editsRes] = await Promise.all([
      fetch(`${API}/site`, { headers: authHeaders() }),
      fetch(`${API}/site-edits`, { headers: authHeaders() }),
    ]);
    if (siteRes.ok) {
      const site = await siteRes.json();
      const list = Array.isArray(site.pages) ? site.pages : [];
      setPages(list);
      setRoute((current) => (list.some((p) => p.route === current) ? current : list[0]?.route || '/'));
    }
    if (editsRes.ok) {
      const edits = await editsRes.json();
      const patches = edits.draft?.patches || [];
      setDraft(patches);
      setPublished(edits.published?.patches || []);
      setHistory([patches]);
      setHistoryIndex(0);
      hydratedRef.current = true;
    }
  }, [authHeaders]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  const postToIframe = useCallback((payload) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ source: 'asoldi-cms', ...payload }, window.location.origin);
  }, []);

  const sendInit = useCallback(() => {
    postToIframe({
      type: 'asoldi-editor-init',
      page: {
        route: page.route,
        kind: page.kind,
        isTemplate: page.isTemplate === true || page.kind === 'product-page' || page.kind === 'blog-post',
        catalogType,
      },
      draftPatches: draft.filter((p) => p.route === page.route),
    });
  }, [catalogType, draft, page.isTemplate, page.kind, page.route, postToIframe]);

  useEffect(() => {
    function onMessage(event) {
      if (event.origin !== window.location.origin) return;
      const data = event.data || {};
      if (data.source !== 'asoldi-editor') return;
      if (data.type === 'asoldi-editor-ready') {
        setHasMarkers(data.hasMarkers !== false);
        sendInit();
      }
      if (data.type === 'asoldi-editor-change' && data.patch) {
        setDraft((current) => {
          const next = upsertPatch(current, data.patch);
          pushHistory(next);
          return next;
        });
        setUnmarkedTip(false);
      }
      if (data.type === 'asoldi-editor-open-tab' && data.tab && onOpenTab) onOpenTab(data.tab);
      if (data.type === 'asoldi-editor-pick-media') {
        setMediaTarget({ key: data.key, route: data.route || page.route });
        setMediaOpen(true);
      }
      if (data.type === 'asoldi-editor-select') {
        setSelected(data.selection || null);
        setSelectedSection(data.selection?.sectionKey || '');
        setUnmarkedTip(false);
      }
      if (data.type === 'asoldi-editor-select-section') setSelectedSection(data.key || '');
      if (data.type === 'asoldi-editor-unmarked') {
        setUnmarkedTip(true);
        setTimeout(() => setUnmarkedTip(false), 2200);
      }
      if (data.type === 'asoldi-editor-duplicate' && data.html && data.key) {
        const key = mintKey('copy');
        const html = remintHtml(data.html, key);
        setDraft((current) => {
          const next = upsertPatch(current, { type: 'insert', route: data.route || page.route, key, afterKey: data.key, html });
          pushHistory(next);
          return next;
        });
        setSelected(null);
        setIframeNonce((n) => n + 1);
      }
      if (data.type === 'asoldi-editor-product-put' && data.productId) {
        const field = data.field || 'price';
        const value = field === 'price' ? Number(String(data.value || '0').replace(',', '.')) : data.value;
        fetch(`${API}/products/${data.productId}`, {
          method: 'PUT',
          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ [field]: value }),
        }).then((res) => {
          setStatus(res.ok ? 'Pris lagret i produkter' : 'Kunne ikke lagre produkt');
        });
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [authHeaders, onOpenTab, page.route, pushHistory, sendInit]);

  useEffect(() => {
    postToIframe({ type: 'asoldi-editor-apply', draftPatches: draft.filter((p) => p.route === page.route) });
  }, [draft, page.route, postToIframe]);

  const persistDraft = useCallback(async (patches, { quiet = false } = {}) => {
    const res = await fetch(`${API}/site-edits/draft`, {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ patches }),
    });
    if (!res.ok) throw new Error('Lagring feilet');
    if (!quiet) setStatus('Utkast lagret');
  }, [authHeaders]);

  useEffect(() => {
    if (!hydratedRef.current || !dirty) return undefined;
    const timer = setTimeout(() => {
      persistDraft(draftRef.current, { quiet: true }).catch((err) => setStatus(err.message));
    }, 400);
    return () => clearTimeout(timer);
  }, [dirty, draft, persistDraft]);

  useEffect(() => () => {
    if (!hydratedRef.current) return;
    const patches = draftRef.current || [];
    fetch(`${API}/site-edits/draft`, {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ patches }),
      keepalive: true,
    }).catch(() => {});
  }, [authHeaders]);

  async function saveDraft() {
    setSaving(true);
    setStatus('');
    try {
      await persistDraft(draft);
    } catch (err) {
      setStatus(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!canPublish) return;
    setSaving(true);
    setStatus('');
    try {
      const save = await fetch(`${API}/site-edits/draft`, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ patches: draft }),
      });
      if (!save.ok) throw new Error('Lagring feilet');
      const res = await fetch(`${API}/site-edits/publish`, { method: 'POST', headers: authHeaders() });
      if (res.status === 403) throw new Error('Du kan ikke publisere');
      if (!res.ok) throw new Error('Publisering feilet');
      const data = await res.json();
      const publishedPatches = data.published?.patches || draft;
      setDraft(publishedPatches);
      setPublished(publishedPatches);
      setHistory([publishedPatches]);
      setHistoryIndex(0);
      setStatus('Publisert på nettstedet');
    } catch (err) {
      setStatus(err.message);
    } finally {
      setSaving(false);
    }
  }

  function undo() {
    if (historyIndex <= 0) return;
    const i = historyIndex - 1;
    setHistoryIndex(i);
    setDraft(history[i] || []);
    setSelected(null);
    setIframeNonce((n) => n + 1);
  }

  function redo() {
    if (historyIndex >= history.length - 1) return;
    const i = historyIndex + 1;
    setHistoryIndex(i);
    setDraft(history[i] || []);
    setSelected(null);
    setIframeNonce((n) => n + 1);
  }

  function applyLocalPatch(patch, { history = true } = {}) {
    setDraft((current) => {
      const next = upsertPatch(current, patch);
      if (history) pushHistory(next);
      return next;
    });
    if (selected && patch.key && (patch.type === 'text' || patch.type === 'href' || patch.type === 'media')) {
      setSelected((current) => {
        if (!current || current.key !== patch.key) return current;
        if (patch.type === 'text') return { ...current, value: patch.value };
        if (patch.type === 'href') return { ...current, href: patch.href || patch.value || '' };
        if (patch.type === 'media') return { ...current, mediaUrl: patch.value };
        return current;
      });
    }
  }

  function clearSelection() {
    setSelected(null);
    setSelectedSection('');
    postToIframe({ type: 'asoldi-editor-clear-select' });
  }

  function handleSectionAction(action) {
    const sectionKey = selected?.sectionKey || selectedSection;
    if (!sectionKey) return;
    if (action === 'hide') applyLocalPatch({ type: 'hide', route: page.route, key: sectionKey, hidden: true });
    if (action === 'show') applyLocalPatch({ type: 'hide', route: page.route, key: sectionKey, hidden: false, value: false });
    if (action === 'remove') {
      applyLocalPatch({ type: 'remove', route: page.route, key: sectionKey });
      clearSelection();
      setIframeNonce((n) => n + 1);
    }
    if (action === 'duplicate' || action === 'up' || action === 'down') {
      postToIframe({ type: 'asoldi-editor-section-action', action, key: sectionKey, route: page.route });
    }
  }

  function insertBlock(block) {
    if (!selectedSection) {
      setStatus('Klikk en seksjon først, deretter en blokk');
      return;
    }
    const key = mintKey(block.id);
    setDraft((current) => {
      const next = upsertPatch(current, {
        type: 'insert',
        route: page.route,
        key,
        afterKey: selectedSection,
        html: block.html(key),
      });
      pushHistory(next);
      return next;
    });
    setSelected(null);
    setIframeNonce((n) => n + 1);
  }

  const markerMissing = pages.length > 0 && page.slots && page.slots.hasMarkers === false && !hasMarkers;

  return (
    <div className="h-[100dvh] max-h-[100dvh] flex flex-col bg-neutral-50 text-neutral-900 overflow-hidden">
      <header className="min-h-14 shrink-0 border-b border-neutral-200 bg-white px-3 py-2 flex items-center gap-2 flex-wrap">
        <Globe size={18} className="text-[#FF5B00]" />
        <select
          value={route}
          onChange={(e) => {
            setRoute(e.target.value);
            setSelected(null);
            setSelectedSection('');
            setIframeNonce((n) => n + 1);
          }}
          className="bg-white border border-neutral-200 rounded-md px-2 py-1.5 text-sm max-w-[180px] text-neutral-900"
        >
          {(pages.length ? pages : [{ route: '/', title: 'Hjem' }]).map((p) => (
            <option key={p.route} value={p.route}>
              {p.title || p.navLabel || p.route}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1 ml-1">
          {DEVICES.map((d) => {
            const Icon = d.icon;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => setDevice(d.id)}
                className={`px-2 py-1.5 rounded-md text-xs flex items-center gap-1 ${device === d.id ? 'bg-[#FF5B00] text-white' : 'text-neutral-600 hover:bg-neutral-100'}`}
                title={d.label}
              >
                <Icon size={16} />
                <span className="hidden sm:inline">{d.label}</span>
              </button>
            );
          })}
        </div>
        <button type="button" onClick={undo} className="p-2 rounded-md text-neutral-600 hover:bg-neutral-100" title="Angre">
          <Undo2 size={16} />
        </button>
        <button type="button" onClick={redo} className="p-2 rounded-md text-neutral-600 hover:bg-neutral-100" title="Gjør om">
          <Redo2 size={16} />
        </button>
        <span className={`text-xs px-2 py-1 rounded-md ${dirty ? 'bg-amber-50 text-amber-800' : 'bg-neutral-100 text-neutral-500'}`}>
          {dirty ? 'Utkast' : 'Publisert'}
        </span>
        <span className="text-xs text-neutral-500">{status || (unmarkedTip ? 'Dette feltet kan ikke redigeres' : '')}</span>
        <div className="flex items-center gap-2 ml-auto">
          <button
            type="button"
            onClick={saveDraft}
            disabled={saving}
            className="px-3 py-1.5 rounded-md text-sm border border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50 disabled:opacity-40"
          >
            Lagre utkast
          </button>
          <button
            type="button"
            onClick={publish}
            disabled={saving || !canPublish}
            className="px-3 py-1.5 rounded-md text-sm bg-[#FF5B00] text-white hover:bg-[#e55200] disabled:opacity-40"
          >
            Publiser{unpublishedCount ? ` (${unpublishedCount})` : ''}
          </button>
        </div>
      </header>
      {markerMissing && (
        <div className="px-4 py-2 text-sm bg-amber-50 text-amber-900 border-b border-amber-200">
          Dette nettstedet mangler redigeringsmerker. Publiser på nytt fra Website Creator.
        </div>
      )}
      <div className="flex flex-1 min-h-0">
        <aside className="w-52 shrink-0 border-r border-neutral-200 bg-white p-3 overflow-y-auto">
          <p className="text-xs uppercase tracking-wide text-neutral-500 mb-2">Blokker</p>
          <p className="text-[11px] text-neutral-500 mb-3">Klikk en seksjon på siden, deretter en blokk.</p>
          <div className="space-y-1.5">
            {BLOCKS.map((block) => (
              <button
                key={block.id}
                type="button"
                onClick={() => insertBlock(block)}
                className="w-full text-left px-3 py-2 rounded-md border border-neutral-200 bg-white hover:bg-neutral-50 text-sm"
              >
                {block.label}
              </button>
            ))}
          </div>
        </aside>
        <div className="flex-1 bg-neutral-100 flex justify-center overflow-auto p-3">
          <div
            className="bg-white h-full border border-neutral-200 overflow-hidden"
            style={{ width: width ? `${width}px` : '100%', maxWidth: '100%' }}
          >
            <iframe
              key={`${route}-${iframeNonce}`}
              ref={iframeRef}
              title="Nettstedredigering"
              src={routeHref(route)}
              className="w-full h-full border-0 bg-white"
              onLoad={sendInit}
            />
          </div>
        </div>
        <SiteEditorInspector
          selected={selected}
          onClose={clearSelection}
          onTextChange={(value, { commit }) => {
            if (!selected?.key) return;
            applyLocalPatch({ type: 'text', route: selected.route || page.route, key: selected.key, value }, { history: !!commit });
          }}
          onHrefChange={(nextHref, { commit }) => {
            if (!selected?.key) return;
            applyLocalPatch(
              { type: 'href', route: selected.route || page.route, key: selected.key, href: nextHref, value: nextHref },
              { history: !!commit }
            );
          }}
          onPickMedia={() => {
            if (!selected?.key) return;
            setMediaTarget({ key: selected.key, route: selected.route || page.route });
            setMediaOpen(true);
          }}
          onSectionAction={handleSectionAction}
          onOpenTab={onOpenTab}
          onProductPriceSave={(productId, value) => {
            fetch(`${API}/products/${productId}`, {
              method: 'PUT',
              headers: { ...authHeaders(), 'Content-Type': 'application/json' },
              body: JSON.stringify({ price: Number(String(value || '0').replace(',', '.')) }),
            }).then((res) => {
              setStatus(res.ok ? 'Pris lagret i produkter' : 'Kunne ikke lagre produkt');
            });
          }}
        />
      </div>
      <MediaPicker
        authHeaders={authHeaders}
        open={mediaOpen}
        kind="image"
        title="Velg bilde"
        onClose={() => setMediaOpen(false)}
        onPick={(item) => {
          if (!mediaTarget || !item?.url) return;
          applyLocalPatch({ type: 'media', route: mediaTarget.route, key: mediaTarget.key, value: item.url });
          postToIframe({ type: 'asoldi-editor-set-media', key: mediaTarget.key, url: item.url });
          setMediaOpen(false);
        }}
      />
    </div>
  );
}
