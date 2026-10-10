/** Media library. Files live under `/api/cms/uploads` and are reused by products, posts, and pages. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, FileText, Film, Image as ImageIcon, Music, Trash2, Upload, X } from 'lucide-react';
const API = '/api/cms';
function formatBytes(bytes = 0) {
    if (!bytes)
        return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
function KindIcon({ kind, size = 28 }) {
    if (kind === 'video')
        return <Film size={size}/>;
    if (kind === 'audio')
        return <Music size={size}/>;
    if (kind === 'document')
        return <FileText size={size}/>;
    return <ImageIcon size={size}/>;
}
/** One media tile: preview, name, and kind. */
export function MediaThumb({ item, className = '' }) {
    if (item.kind === 'image') {
        return <img src={item.url} alt={item.alt || ''} loading="lazy" className={`w-full h-full object-cover ${className}`}/>;
    }
    if (item.kind === 'video') {
        return <video src={item.url} muted preload="metadata" className={`w-full h-full object-cover ${className}`}/>;
    }
    return (<div className={`w-full h-full flex items-center justify-center text-gray-500 ${className}`}>
      <KindIcon kind={item.kind}/>
    </div>);
}
/** Shared data hook: list + upload + patch + delete against /api/cms/media. */
export function useMediaLibrary(authHeaders) {
    const [items, setItems] = useState([]);
    const [maxBytes, setMaxBytes] = useState(25 * 1024 * 1024);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const refresh = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const res = await fetch(`${API}/media`, { headers: authHeaders() });
            if (!res.ok)
                throw new Error((await res.json().catch(() => ({}))).message || 'Could not load media');
            const data = await res.json();
            setItems(Array.isArray(data.items) ? data.items : []);
            if (data.maxBytes)
                setMaxBytes(data.maxBytes);
        }
        catch (e) {
            setError(e.message);
        }
        finally {
            setLoading(false);
        }
    }, [authHeaders]);
    useEffect(() => {
        refresh();
    }, [refresh]);
    const uploadFiles = useCallback(async (files) => {
        const list = Array.from(files || []).filter(Boolean);
        if (!list.length)
            return [];
        const tooBig = list.find((f) => f.size > maxBytes);
        if (tooBig) {
            setError(`${tooBig.name} is larger than ${formatBytes(maxBytes)}.`);
            return [];
        }
        setLoading(true);
        setError('');
        try {
            const body = new FormData();
            list.forEach((file) => body.append('files', file));
            const res = await fetch(`${API}/media`, { method: 'POST', headers: authHeaders(), body });
            const data = await res.json().catch(() => ({}));
            if (!res.ok)
                throw new Error(data.message || 'Upload failed');
            setItems((current) => [...(data.items || []), ...current]);
            return data.items || [];
        }
        catch (e) {
            setError(e.message);
            return [];
        }
        finally {
            setLoading(false);
        }
    }, [authHeaders, maxBytes]);
    const patchItem = useCallback(async (name, patch) => {
        const res = await fetch(`${API}/media/${encodeURIComponent(name)}`, {
            method: 'PATCH',
            headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            setError(data.message || 'Update failed');
            return null;
        }
        setItems((current) => current.map((item) => (item.name === name ? data.item : item)));
        return data.item;
    }, [authHeaders]);
    const deleteItem = useCallback(async (name) => {
        const res = await fetch(`${API}/media/${encodeURIComponent(name)}`, { method: 'DELETE', headers: authHeaders() });
        if (!res.ok) {
            setError((await res.json().catch(() => ({}))).message || 'Delete failed');
            return false;
        }
        setItems((current) => current.filter((item) => item.name !== name));
        return true;
    }, [authHeaders]);
    return { items, maxBytes, loading, error, setError, refresh, uploadFiles, patchItem, deleteItem };
}
function Dropzone({ onFiles, disabled, accept, maxBytes, compact = false }) {
    const inputRef = useRef(null);
    const [over, setOver] = useState(false);
    return (<div onDragOver={(e) => {
            e.preventDefault();
            if (!disabled)
                setOver(true);
        }} onDragLeave={() => setOver(false)} onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            if (!disabled)
                onFiles(e.dataTransfer?.files);
        }} onClick={() => !disabled && inputRef.current?.click()} className={`border-2 border-dashed rounded-xl text-center cursor-pointer transition-colors ${compact ? 'p-4' : 'p-8'} ${over ? 'border-[#FF5B00] bg-[#FF5B00]/10' : 'border-white/20 hover:border-white/40 bg-[#1a1a1a]/50'} ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      <input ref={inputRef} type="file" multiple accept={accept} className="hidden" onChange={(e) => {
            onFiles(e.target.files);
            e.target.value = '';
        }}/>
      <Upload size={compact ? 18 : 24} className="mx-auto text-gray-400"/>
      <p className="text-gray-300 text-sm mt-2">Drop files here or click to upload</p>
      <p className="text-gray-500 text-xs mt-1">Images, video, audio, PDF · up to {formatBytes(maxBytes)} each</p>
    </div>);
}
const FILTERS = [
    ['all', 'All'],
    ['image', 'Images'],
    ['video', 'Video'],
    ['audio', 'Audio'],
    ['document', 'Documents'],
];
function MediaGrid({ items, selectedName, onSelect, onDelete, canDelete, cols = 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5' }) {
    if (!items.length)
        return <p className="text-gray-500 text-sm py-8 text-center">No files yet.</p>;
    return (<div className={`grid ${cols} gap-3`}>
      {items.map((item) => {
            const selected = selectedName === item.name;
            return (<button key={item.name} type="button" onClick={() => onSelect(item)} className={`group relative rounded-lg overflow-hidden bg-[#1a1a1a] border text-left aspect-square ${selected ? 'border-[#FF5B00] ring-2 ring-[#FF5B00]/50' : 'border-white/10 hover:border-white/30'}`} title={item.name}>
            <MediaThumb item={item}/>
            <div className="absolute inset-x-0 bottom-0 bg-black/70 px-2 py-1">
              <p className="text-[11px] text-white truncate">{item.name}</p>
              <p className="text-[10px] text-gray-400">{formatBytes(item.size)}</p>
            </div>
            {canDelete && onDelete && item.origin !== 'site' && (<span role="button" tabIndex={-1} onClick={(e) => {
                        e.stopPropagation();
                        onDelete(item);
                    }} className="absolute top-1 right-1 hidden group-hover:flex items-center justify-center w-7 h-7 rounded bg-black/70 text-gray-300 hover:text-red-400" title="Delete">
                <Trash2 size={14}/>
              </span>)}
            {selected && (<span className="absolute top-1 left-1 flex items-center justify-center w-6 h-6 rounded-full bg-[#FF5B00] text-white">
                <Check size={14}/>
              </span>)}
          </button>);
        })}
    </div>);
}
function DetailsPane({ item, onPatch, onDelete, canDelete, onClose }) {
    const [alt, setAlt] = useState(item.alt || '');
    const [name, setName] = useState(item.name);
    const [copied, setCopied] = useState(false);
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        setAlt(item.alt || '');
        setName(item.name);
    }, [item.name, item.alt]);
    const absoluteUrl = typeof window !== 'undefined' ? `${window.location.origin}${item.url}` : item.url;
    return (<div className="rounded-xl bg-[#2a2a2a] border border-white/10 p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-white font-medium text-sm truncate">{item.name}</h3>
        {onClose && (<button type="button" onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={16}/>
          </button>)}
      </div>
      <div className="rounded-lg overflow-hidden bg-[#1a1a1a] aspect-video">
        {item.kind === 'video' ? <video src={item.url} controls className="w-full h-full"/> : item.kind === 'audio' ? <audio src={item.url} controls className="w-full mt-10"/> : <MediaThumb item={item} className="object-contain"/>}
      </div>
      <dl className="text-xs text-gray-400 grid grid-cols-2 gap-y-1">
        <dt>Type</dt>
        <dd className="text-gray-200">{item.mime}</dd>
        <dt>Size</dt>
        <dd className="text-gray-200">{formatBytes(item.size)}</dd>
        <dt>{item.origin === 'site' ? 'From' : 'Uploaded'}</dt>
        <dd className="text-gray-200">{item.origin === 'site' ? 'Original site' : item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '—'}</dd>
        {item.uploadedBy && (<>
            <dt>By</dt>
            <dd className="text-gray-200">{item.uploadedBy}</dd>
          </>)}
      </dl>
      <div>
        <label className="block text-xs text-gray-400 mb-1">URL</label>
        <div className="flex gap-2">
          <input readOnly value={absoluteUrl} className="flex-1 min-w-0 rounded bg-[#1a1a1a] border border-white/10 px-2 py-1.5 text-xs text-gray-200"/>
          <button type="button" onClick={() => {
            navigator.clipboard?.writeText(absoluteUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        }} className="px-2 rounded bg-white/10 text-gray-200 hover:bg-white/20" title="Copy URL">
            {copied ? <Check size={14}/> : <Copy size={14}/>}
          </button>
        </div>
      </div>
      {item.origin === 'site' ? (<p className="text-xs text-gray-500">This file was on the site when it was created. Pick it from the library; rename and delete stay on the live page.</p>) : (<>
      <div>
        <label className="block text-xs text-gray-400 mb-1">File name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded bg-[#1a1a1a] border border-white/10 px-2 py-1.5 text-sm text-white"/>
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Alt text</label>
        <input value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="Describe the image" className="w-full rounded bg-[#1a1a1a] border border-white/10 px-2 py-1.5 text-sm text-white"/>
      </div>
      <div className="flex items-center justify-between gap-2">
        <button type="button" disabled={saving || (alt === (item.alt || '') && name === item.name)} onClick={async () => {
            setSaving(true);
            await onPatch(item.name, { alt, rename: name !== item.name ? name : undefined });
            setSaving(false);
        }} className="px-3 py-1.5 rounded bg-[#FF5B00] text-white text-sm disabled:opacity-40">
          {saving ? 'Saving…' : 'Save'}
        </button>
        {canDelete && (<button type="button" onClick={() => onDelete(item)} className="flex items-center gap-1 text-sm text-red-400 hover:text-red-300">
            <Trash2 size={14}/> Delete
          </button>)}
      </div>
      </>)}
    </div>);
}
/** Media library admin tab. */
export function MediaPanel({ authHeaders, actor }) {
    const lib = useMediaLibrary(authHeaders);
    const [filter, setFilter] = useState('all');
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState(null);
    const canDelete = !actor?.rank || actor.rank === 'admin' || actor.rank === 'employee';
    const visible = useMemo(() => {
        const q = query.trim().toLowerCase();
        return lib.items.filter((item) => (filter === 'all' || item.kind === filter) && (!q || item.name.toLowerCase().includes(q) || (item.alt || '').toLowerCase().includes(q)));
    }, [lib.items, filter, query]);
    const selectedItem = selected ? lib.items.find((i) => i.name === selected) : null;
    const handleDelete = async (item) => {
        if (!window.confirm(`Delete ${item.name}? Pages or products using it will show a broken image.`))
            return;
        const ok = await lib.deleteItem(item.name);
        if (ok && selected === item.name)
            setSelected(null);
    };
    const total = lib.items.reduce((sum, item) => sum + (item.size || 0), 0);
    return (<div className="max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Media</h1>
          <p className="text-gray-400 text-sm mt-1">
            All uploaded files for this site, stored on the server — {lib.items.length} files · {formatBytes(total)}. Reuse them in products, blog posts and pages.
          </p>
        </div>
      </div>

      <Dropzone onFiles={lib.uploadFiles} disabled={lib.loading} maxBytes={lib.maxBytes}/>

      {lib.error && (<div className="mt-4 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-sm text-red-300 flex items-center justify-between">
          <span>{lib.error}</span>
          <button type="button" onClick={() => lib.setError('')} className="text-red-300 hover:text-white">
            <X size={14}/>
          </button>
        </div>)}

      <div className="flex flex-wrap items-center gap-2 mt-6 mb-4">
        {FILTERS.map(([key, label]) => (<button key={key} type="button" onClick={() => setFilter(key)} className={`px-3 py-1 rounded-full text-xs ${filter === key ? 'bg-[#FF5B00] text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}>
            {label}
          </button>))}
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" className="ml-auto rounded bg-[#1a1a1a] border border-white/10 px-3 py-1.5 text-sm text-white w-56"/>
      </div>

      <div className={`grid gap-6 ${selectedItem ? 'lg:grid-cols-[1fr_320px]' : ''}`}>
        <div>
          {lib.loading && !lib.items.length ? <p className="text-gray-500 text-sm">Loading…</p> : <MediaGrid items={visible} selectedName={selected} onSelect={(item) => setSelected(item.name === selected ? null : item.name)} onDelete={handleDelete} canDelete={canDelete}/>}
        </div>
        {selectedItem && (<DetailsPane item={selectedItem} onPatch={async (name, patch) => {
                const next = await lib.patchItem(name, patch);
                if (next?.name)
                    setSelected(next.name);
                return next;
            }} onDelete={handleDelete} canDelete={canDelete} onClose={() => setSelected(null)}/>)}
      </div>
    </div>);
}
/** Modal picker. `onPick` receives the media item; use `item.url`. */
export function MediaPicker({ authHeaders, open, onClose, onPick, kind = 'image', title = 'Choose from media library' }) {
    const lib = useMediaLibrary(authHeaders);
    const [selected, setSelected] = useState(null);
    const [query, setQuery] = useState('');
    useEffect(() => {
        if (open) {
            setSelected(null);
            lib.refresh();
        }
    }, [open]);
    if (!open)
        return null;
    const q = query.trim().toLowerCase();
    const visible = lib.items.filter((item) => (!kind || kind === 'all' || item.kind === kind) && (!q || item.name.toLowerCase().includes(q)));
    const accept = kind === 'image' ? 'image/*' : kind === 'video' ? 'video/*' : kind === 'audio' ? 'audio/*' : undefined;
    return (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-4xl max-h-[85vh] flex flex-col rounded-2xl bg-[#232323] border border-white/10 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h2 className="text-white font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={18}/>
          </button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">
          <Dropzone compact accept={accept} maxBytes={lib.maxBytes} disabled={lib.loading} onFiles={async (files) => {
            const uploaded = await lib.uploadFiles(files);
            if (uploaded[0])
                setSelected(uploaded[0].name);
        }}/>
          {lib.error && <p className="text-sm text-red-300">{lib.error}</p>}
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" className="w-full rounded bg-[#1a1a1a] border border-white/10 px-3 py-1.5 text-sm text-white"/>
          <MediaGrid items={visible} selectedName={selected} onSelect={(item) => setSelected(item.name)} canDelete={false} cols="grid-cols-3 sm:grid-cols-4 lg:grid-cols-6"/>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/10">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded text-sm text-gray-300 hover:bg-white/10">
            Cancel
          </button>
          <button type="button" disabled={!selected} onClick={() => {
            const item = lib.items.find((i) => i.name === selected);
            if (item)
                onPick(item);
            onClose();
        }} className="px-4 py-1.5 rounded bg-[#FF5B00] text-white text-sm disabled:opacity-40">
            Use file
          </button>
        </div>
      </div>
    </div>);
}
