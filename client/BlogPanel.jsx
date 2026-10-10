/** Admin blog tab. Author is the signed-in user; posts are draft, scheduled, or published. */
import { useCallback, useEffect, useState } from 'react';
import { MediaPicker } from './MediaPanel.jsx';
const API = '/api/cms';
function emptyPost(authorName) {
    return {
        title: '',
        slug: '',
        status: 'draft',
        scheduledAt: '',
        blocks: [{ id: 'block-1', type: 'text', text: '' }],
        authorName: authorName || '',
    };
}
/** Blog admin tab. */
export function BlogPanel({ authHeaders, loading, setLoading, actor }) {
    const [posts, setPosts] = useState([]);
    const [editing, setEditing] = useState(null);
    const [error, setError] = useState('');
    const [pickerFor, setPickerFor] = useState(null);
    const setBlockImage = (index, url, alt) => {
        setEditing((current) => {
            const blocks = [...(current.blocks || [])];
            blocks[index] = { ...blocks[index], type: 'image', url, alt: alt ?? blocks[index]?.alt ?? '' };
            return { ...current, blocks };
        });
    };
    const fetchPosts = useCallback(async () => {
        const res = await fetch(`${API}/admin/posts`, { headers: authHeaders() });
        if (!res.ok)
            return;
        setPosts(await res.json());
    }, [authHeaders]);
    useEffect(() => {
        fetchPosts();
    }, [fetchPosts]);
    const savePost = async (e) => {
        e.preventDefault();
        if (!editing?.title.trim())
            return;
        setLoading(true);
        setError('');
        try {
            const payload = {
                ...editing,
                scheduledAt: editing.status === 'scheduled' ? editing.scheduledAt : '',
            };
            const isNew = !editing.id;
            const res = await fetch(isNew ? `${API}/admin/posts` : `${API}/admin/posts/${editing.id}`, {
                method: isNew ? 'POST' : 'PUT',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(data.message || 'Could not save post');
                return;
            }
            setEditing(null);
            await fetchPosts();
        }
        finally {
            setLoading(false);
        }
    };
    const uploadBlockImage = async (index, file) => {
        if (!file)
            return;
        const body = new FormData();
        body.append('file', file);
        const res = await fetch(`${API}/upload`, { method: 'POST', headers: authHeaders(), body });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            setError(data.message || 'Upload failed');
            return;
        }
        setBlockImage(index, data.url);
    };
    return (<div className="max-w-5xl">
      <MediaPicker authHeaders={authHeaders} open={pickerFor !== null} onClose={() => setPickerFor(null)} onPick={(item) => {
            if (pickerFor !== null)
                setBlockImage(pickerFor, item.url, item.alt || undefined);
        }} kind="image"/>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Blog</h1>
          <p className="text-gray-400 text-sm mt-1">Text and image blocks. Author is the signed-in user. Schedule or publish.</p>
        </div>
        <button type="button" onClick={() => setEditing(emptyPost(actor?.name || actor?.username))} className="px-4 py-2 rounded-lg bg-[#FF5B00] text-white font-medium">
          New post
        </button>
      </div>

      {editing && (<form onSubmit={savePost} className="rounded-xl bg-[#2a2a2a] border border-white/10 p-6 mb-8 space-y-4">
          <input value={editing.title} onChange={(e) => setEditing((p) => ({ ...p, title: e.target.value }))} placeholder="Title" className="w-full px-4 py-2 rounded-lg bg-[#1a1a1a] border border-white/20 text-white" required/>
          <div className="grid sm:grid-cols-3 gap-3">
            <select value={editing.status} onChange={(e) => setEditing((p) => ({ ...p, status: e.target.value }))} className="px-4 py-2 rounded-lg bg-[#1a1a1a] border border-white/20 text-white">
              <option value="draft">Draft</option>
              <option value="scheduled">Scheduled</option>
              <option value="published">Published</option>
            </select>
            {editing.status === 'scheduled' && (<input type="datetime-local" value={editing.scheduledAt ? editing.scheduledAt.slice(0, 16) : ''} onChange={(e) => setEditing((p) => ({ ...p, scheduledAt: e.target.value ? new Date(e.target.value).toISOString() : '' }))} className="px-4 py-2 rounded-lg bg-[#1a1a1a] border border-white/20 text-white"/>)}
            <p className="text-sm text-gray-400 self-center">Author: {actor?.name || actor?.username || 'you'}</p>
          </div>
          {(editing.blocks || []).map((block, index) => (<div key={block.id || index} className="rounded-lg border border-white/10 p-3 space-y-2">
              <div className="flex gap-2">
                <select value={block.type} onChange={(e) => {
                    const type = e.target.value;
                    setEditing((p) => {
                        const blocks = [...p.blocks];
                        blocks[index] = type === 'image' ? { id: block.id, type: 'image', url: block.url || '', alt: block.alt || '' } : { id: block.id, type: 'text', text: block.text || '' };
                        return { ...p, blocks };
                    });
                }} className="px-3 py-1 rounded bg-[#1a1a1a] border border-white/20 text-white text-sm">
                  <option value="text">Text</option>
                  <option value="image">Image</option>
                </select>
                <button type="button" onClick={() => setEditing((p) => ({ ...p, blocks: p.blocks.filter((_, i) => i !== index) }))} className="text-xs text-red-400">
                  Remove
                </button>
              </div>
              {block.type === 'image' ? (<div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <input type="file" accept="image/*" onChange={(e) => uploadBlockImage(index, e.target.files?.[0])} className="text-sm text-gray-300"/>
                    <button type="button" onClick={() => setPickerFor(index)} className="text-xs text-[#FF5B00] hover:underline">
                      Choose from media library
                    </button>
                  </div>
                  {block.url && <img src={block.url} alt={block.alt || ''} className="max-h-40 rounded"/>}
                  <input value={block.alt || ''} onChange={(e) => setEditing((p) => {
                        const blocks = [...p.blocks];
                        blocks[index] = { ...block, alt: e.target.value };
                        return { ...p, blocks };
                    })} placeholder="Alt text" className="w-full px-3 py-2 rounded bg-[#1a1a1a] border border-white/20 text-white text-sm"/>
                </div>) : (<textarea value={block.text || ''} onChange={(e) => setEditing((p) => {
                        const blocks = [...p.blocks];
                        blocks[index] = { ...block, text: e.target.value };
                        return { ...p, blocks };
                    })} rows={5} className="w-full px-3 py-2 rounded bg-[#1a1a1a] border border-white/20 text-white"/>)}
            </div>))}
          <button type="button" onClick={() => setEditing((p) => ({ ...p, blocks: [...p.blocks, { id: `block-${Date.now()}`, type: 'text', text: '' }] }))} className="text-sm text-[#FF5B00]">
            + Add block
          </button>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={loading} className="px-4 py-2 rounded-lg bg-[#FF5B00] text-white font-medium disabled:opacity-50">Save</button>
            <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg bg-white/10 text-white">Cancel</button>
          </div>
        </form>)}

      <div className="rounded-xl bg-[#2a2a2a] border border-white/10 overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-white/10">
              <th className="px-4 py-3 text-gray-400 font-medium">Title</th>
              <th className="px-4 py-3 text-gray-400 font-medium">Status</th>
              <th className="px-4 py-3 text-gray-400 font-medium">Author</th>
              <th className="px-4 py-3 text-gray-400 font-medium">Updated</th>
              <th className="px-4 py-3 text-gray-400 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {posts.map((post) => (<tr key={post.id} className="border-b border-white/5">
                <td className="px-4 py-3 text-white">{post.title}</td>
                <td className="px-4 py-3 text-gray-400 text-sm">{post.status}</td>
                <td className="px-4 py-3 text-gray-400 text-sm">{post.authorName || '—'}</td>
                <td className="px-4 py-3 text-gray-400 text-sm">{post.updatedAt ? new Date(post.updatedAt).toLocaleString() : '—'}</td>
                <td className="px-4 py-3">
                  <button type="button" onClick={() => setEditing(post)} className="text-xs text-[#FF5B00] mr-3">Edit</button>
                  <button type="button" onClick={async () => {
                if (!confirm('Delete this post?'))
                    return;
                await fetch(`${API}/admin/posts/${post.id}`, { method: 'DELETE', headers: authHeaders() });
                fetchPosts();
            }} className="text-xs text-red-400">
                    Delete
                  </button>
                </td>
              </tr>))}
          </tbody>
        </table>
        {posts.length === 0 && <p className="px-4 py-8 text-gray-400 text-center">No posts yet.</p>}
      </div>
    </div>);
}
