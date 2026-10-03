/**
 * @asoldi/client-cms – Client CMS UI. Use: <Route path="/admin" element={<ClientCMS />} />
 * Server must mount createCmsRoutes at /api/cms (see README).
 */
import React, { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { Users, LogOut, LayoutDashboard, BarChart3, ShoppingBag, Newspaper, Share2, Mail, Layers, Image as ImageIcon, Pencil } from 'lucide-react';
import { Helmet } from 'react-helmet-async';
import { EcommercePanel } from './EcommercePanel.jsx';
import { BlogPanel } from './BlogPanel.jsx';
import { AnalyticsPanel } from './AnalyticsPanel.jsx';
import { GeneralPanel } from './GeneralPanel.jsx';
import { MediaPanel } from './MediaPanel.jsx';
import { SiteEditorPanel } from './SiteEditorPanel.jsx';

const EmailMarketingPanel = lazy(() => import('./EmailMarketingPanel.jsx').then((m) => ({ default: m.EmailMarketingPanel })));

const API = '/api/cms';

function getToken() {
  return localStorage.getItem('adminToken');
}

function setToken(t) {
  localStorage.setItem('adminToken', t);
}

function clearToken() {
  localStorage.removeItem('adminToken');
}

function authHeaders() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

const DEFAULT_FEATURES = { users: true, analytics: false, ecommerce: false, blog: false, socialSync: false, emailMarketing: false, general: false };

function firstEnabledTab(features, rank = 'admin') {
  const can = (tab) => {
    if (rank === 'member') return false;
    if (rank === 'writer') return tab === 'blog';
    return true;
  };
  if (can('website')) return 'website';
  if (features.users !== false && can('users')) return 'users';
  if (features.ecommerce && can('ecommerce')) return 'ecommerce';
  if (features.emailMarketing && can('email')) return 'email';
  if (features.blog && can('blog')) return 'blog';
  if (features.socialSync && can('social')) return 'social';
  if (features.analytics && can('analytics')) return 'analytics';
  return rank === 'writer' && features.blog ? 'blog' : 'users';
}

export function ClientCMS() {
  const [loggedIn, setLoggedIn] = useState(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [tab, setTab] = useState('website');
  const [features, setFeatures] = useState(DEFAULT_FEATURES);
  const [catalogType, setCatalogType] = useState('normal');
  const [siteName, setSiteName] = useState('');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [userForm, setUserForm] = useState({ username: '', password: '', rank: 'employee' });
  const [editingId, setEditingId] = useState(null);
  const [editPassword, setEditPassword] = useState('');
  const [actor, setActor] = useState({ rank: 'admin', username: '', name: '' });
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changePasswordError, setChangePasswordError] = useState('');

  const fetchUsers = useCallback(async () => {
    const res = await fetch(`${API}/admin/users`, { headers: authHeaders() });
    if (res.status === 401) {
      clearToken();
      setLoggedIn(false);
      return;
    }
    if (!res.ok) return;
    setUsers(await res.json());
  }, []);

  useEffect(() => {
    fetch(`${API}/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const nextFeatures = data?.features ? { ...DEFAULT_FEATURES, ...data.features } : DEFAULT_FEATURES;
        setFeatures(nextFeatures);
        setCatalogType(data?.ecommerceCatalogType === 'menu' || data?.ecommerceCatalogType === 'tiers' ? data.ecommerceCatalogType : 'normal');
        if (data?.name) setSiteName(data.name);
        setTab((current) => {
          if (current === 'users' && nextFeatures.users === false) return firstEnabledTab(nextFeatures, actor.rank);
          return current;
        });
      })
      .catch(() => setFeatures(DEFAULT_FEATURES));
  }, []);

  useEffect(() => {
    const t = getToken();
    if (!t) {
      setLoggedIn(false);
      return;
    }
    fetch(`${API}/admin/me`, { headers: authHeaders() })
      .then(async (res) => {
        if (res.status === 401) {
          clearToken();
          setLoggedIn(false);
          return;
        }
        if (!res.ok) {
          setLoggedIn(false);
          return;
        }
        const me = await res.json();
        setActor({ rank: me.rank || 'admin', username: me.username || '', name: me.name || me.username || '' });
        setLoggedIn(true);
        if (me.rank === 'admin' || me.rank === 'employee') fetchUsers();
        setTab((current) => {
          if (me.rank === 'writer') return 'blog';
          if (me.rank === 'member') return 'users';
          return current;
        });
      })
      .catch(() => setLoggedIn(false));
  }, [fetchUsers]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoginError(data.message || 'Invalid credentials');
        return;
      }
      setToken(data.token);
      const nextActor = { rank: data.rank || 'admin', username: data.username || username, name: data.name || data.username || username };
      setActor(nextActor);
      setLoggedIn(true);
      setTab(firstEnabledTab(features, nextActor.rank));
      if (nextActor.rank === 'admin' || nextActor.rank === 'employee') fetchUsers();
    } catch {
      setLoginError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    clearToken();
    setLoggedIn(false);
  };

  const handleAddUser = async (e) => {
    e.preventDefault();
    if (!userForm.username.trim() || !userForm.password) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/admin/users`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(userForm),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || 'Failed to create user');
        return;
      }
      setUserForm({ username: '', password: '', rank: 'employee' });
      fetchUsers();
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateUser = async (id, newUsername, newPassword, newRank) => {
    setLoading(true);
    try {
      const body = {};
      if (newUsername !== undefined && newUsername !== null) body.username = newUsername;
      if (newPassword !== undefined && newPassword !== '') body.password = newPassword;
      if (newRank !== undefined) body.rank = newRank;
      const res = await fetch(`${API}/admin/users/${id}`, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || 'Update failed');
        return;
      }
      setEditingId(null);
      setEditPassword('');
      fetchUsers();
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (id) => {
    if (!confirm('Delete this user? They will no longer be able to log in.')) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/admin/users/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.message || 'Delete failed');
        return;
      }
      fetchUsers();
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setChangePasswordError('');
    const res = await fetch(`${API}/admin/change-password`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: currentPassword, newPassword: newPassword }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setChangePasswordError(data.message || 'Failed');
      return;
    }
    setChangePasswordOpen(false);
    setCurrentPassword('');
    setNewPassword('');
  };

  if (loggedIn === null) {
    return (
      <div className="min-h-screen bg-[#1e1e1e] flex items-center justify-center">
        <p className="text-gray-400">Loading…</p>
      </div>
    );
  }

  if (!loggedIn) {
    return (
      <>
        <Helmet><title>Admin</title><meta name="robots" content="noindex,nofollow" /></Helmet>
        <div className="min-h-screen bg-[#050505] flex items-center justify-center p-6">
          <div className="w-full max-w-sm rounded-2xl bg-[#1a1a1a] border border-white/10 p-8">
            <h1 className="text-xl font-bold text-white mb-6">Admin</h1>
            <form onSubmit={handleLogin} className="space-y-4">
              <input
                type="text"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-[#0a0a0a] border border-white/20 text-white placeholder-gray-500 focus:outline-none focus:border-[#FF5B00]"
                required
              />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-[#0a0a0a] border border-white/20 text-white placeholder-gray-500 focus:outline-none focus:border-[#FF5B00]"
                required
              />
              {loginError && <p className="text-red-400 text-sm">{loginError}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-lg font-medium text-white bg-[#FF5B00] hover:bg-[#e55200] disabled:opacity-50"
              >
                {loading ? 'Logging in…' : 'Log in'}
              </button>
            </form>
            <p className="mt-4 text-center">
              <a href="/" className="text-sm text-gray-400 hover:text-white">← Back to site</a>
            </p>
          </div>
        </div>
      </>
    );
  }

  const rank = actor.rank || 'admin';
  const isStaffManager = rank === 'admin' || rank === 'employee';
  const canBlog = rank === 'admin' || rank === 'employee' || rank === 'writer';
  const canDeleteStaff = rank === 'admin';

  return (
    <>
      <Helmet><title>Admin</title><meta name="robots" content="noindex,nofollow" /></Helmet>
      <div className="min-h-screen bg-[#1e1e1e] flex">
        <aside className="w-56 bg-[#23282d] text-white flex flex-col fixed inset-y-0 left-0">
          <div className="p-4 border-b border-white/10">
            <a href="/" className="text-lg font-semibold text-white">{siteName || 'Admin'}</a>
            <p className="text-xs text-gray-400 mt-1">Client CMS{rank && rank !== 'admin' ? ` · ${rank}` : ''}</p>
          </div>
          <nav className="flex-1 p-2">
            {isStaffManager && (
              <button
                type="button"
                onClick={() => setTab('website')}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm font-medium transition-colors ${tab === 'website' ? 'bg-[#FF5B00] text-white' : 'text-gray-300 hover:bg-white/10'}`}
              >
                <Pencil size={18} /> Website
              </button>
            )}
            {features.users !== false && isStaffManager && (
              <button
                type="button"
                onClick={() => setTab('users')}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm font-medium transition-colors ${tab === 'users' ? 'bg-[#FF5B00] text-white' : 'text-gray-300 hover:bg-white/10'}`}
              >
                <Users size={18} /> Users
              </button>
            )}
            {features.ecommerce && isStaffManager && (
              <button
                type="button"
                onClick={() => setTab('ecommerce')}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm font-medium transition-colors ${tab === 'ecommerce' ? 'bg-[#FF5B00] text-white' : 'text-gray-300 hover:bg-white/10'}`}
              >
                <ShoppingBag size={18} /> Ecommerce
              </button>
            )}
            {features.emailMarketing && isStaffManager && (
              <button
                type="button"
                onClick={() => setTab('email')}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm font-medium transition-colors ${tab === 'email' ? 'bg-[#FF5B00] text-white' : 'text-gray-300 hover:bg-white/10'}`}
              >
                <Mail size={18} /> Email marketing
              </button>
            )}
            {features.blog && canBlog && (
              <button
                type="button"
                onClick={() => setTab('blog')}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm font-medium transition-colors ${tab === 'blog' ? 'bg-[#FF5B00] text-white' : 'text-gray-300 hover:bg-white/10'}`}
              >
                <Newspaper size={18} /> Blog
              </button>
            )}
            {canBlog && (
              <button
                type="button"
                onClick={() => setTab('media')}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm font-medium transition-colors ${tab === 'media' ? 'bg-[#FF5B00] text-white' : 'text-gray-300 hover:bg-white/10'}`}
              >
                <ImageIcon size={18} /> Media
              </button>
            )}
            {isStaffManager && (
              <button
                type="button"
                onClick={() => setTab('general')}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm font-medium transition-colors ${tab === 'general' ? 'bg-[#FF5B00] text-white' : 'text-gray-300 hover:bg-white/10'}`}
              >
                <Layers size={18} /> General
              </button>
            )}
            {features.socialSync && isStaffManager && (
              <button
                type="button"
                onClick={() => setTab('social')}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm font-medium transition-colors ${tab === 'social' ? 'bg-[#FF5B00] text-white' : 'text-gray-300 hover:bg-white/10'}`}
              >
                <Share2 size={18} /> Social sync
              </button>
            )}
            {features.analytics && isStaffManager && (
              <button
                type="button"
                onClick={() => setTab('analytics')}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm font-medium transition-colors ${tab === 'analytics' ? 'bg-[#FF5B00] text-white' : 'text-gray-300 hover:bg-white/10'}`}
              >
                <BarChart3 size={18} /> Analytics
              </button>
            )}
            <div className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm font-medium text-gray-400 opacity-70">
              <LayoutDashboard size={18} /> Dashboard (soon)
            </div>
          </nav>
          <div className="p-2 border-t border-white/10 space-y-1">
            <button type="button" onClick={() => setChangePasswordOpen(true)} className="w-full px-3 py-2 text-left text-sm text-gray-400 hover:text-white">Change my password</button>
            <button type="button" onClick={handleLogout} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-400 hover:bg-white/10 hover:text-white">
              <LogOut size={18} /> Log out
            </button>
          </div>
        </aside>
        <main className={`flex-1 ml-56 ${tab === 'website' ? 'p-0 overflow-hidden' : 'p-8'}`}>
          {tab === 'website' && isStaffManager && (
            <SiteEditorPanel
              authHeaders={authHeaders}
              actor={actor}
              catalogType={catalogType}
              onOpenTab={setTab}
            />
          )}
          {tab === 'analytics' && features.analytics && isStaffManager && (
            <AnalyticsPanel authHeaders={authHeaders} loading={loading} setLoading={setLoading} />
          )}
          {tab === 'blog' && features.blog && canBlog && (
            <BlogPanel authHeaders={authHeaders} loading={loading} setLoading={setLoading} actor={actor} />
          )}
          {tab === 'general' && isStaffManager && (
            <GeneralPanel authHeaders={authHeaders} loading={loading} setLoading={setLoading} siteName={siteName} />
          )}
          {tab === 'media' && canBlog && <MediaPanel authHeaders={authHeaders} actor={actor} />}
          {tab === 'social' && (
            <div className="max-w-4xl">
              <h1 className="text-2xl font-bold text-white mb-6">Social sync</h1>
              <p className="text-gray-400">Reviews and social media sync. Coming soon.</p>
            </div>
          )}
          {tab === 'ecommerce' && features.ecommerce && isStaffManager && (
            <EcommercePanel catalogType={catalogType} authHeaders={authHeaders} loading={loading} setLoading={setLoading} />
          )}
          {tab === 'ecommerce' && !features.ecommerce && isStaffManager && (
            <div className="max-w-4xl">
              <h1 className="text-2xl font-bold text-white mb-4">Products</h1>
              <p className="text-gray-400">Ecommerce is not enabled for this site. Turn it on in the hub, or edit marketing pages under Website.</p>
              <button type="button" onClick={() => setTab('website')} className="mt-4 px-3 py-2 rounded-lg bg-[#FF5B00] text-white text-sm">Back to Website</button>
            </div>
          )}
          {tab === 'blog' && !features.blog && canBlog && (
            <div className="max-w-4xl">
              <h1 className="text-2xl font-bold text-white mb-4">Blog</h1>
              <p className="text-gray-400">Blog is not enabled for this site.</p>
              <button type="button" onClick={() => setTab('website')} className="mt-4 px-3 py-2 rounded-lg bg-[#FF5B00] text-white text-sm">Back to Website</button>
            </div>
          )}
          {tab === 'email' && features.emailMarketing && isStaffManager && (
            <Suspense fallback={<p className="text-gray-400">Laster e-posteditor…</p>}>
              <EmailMarketingPanel authHeaders={authHeaders} loading={loading} setLoading={setLoading} />
            </Suspense>
          )}
          {rank === 'member' && (
            <div className="max-w-4xl">
              <h1 className="text-2xl font-bold text-white mb-6">Member</h1>
              <p className="text-gray-400">This login has no CMS modules. Ask an admin if you need access.</p>
            </div>
          )}
          {tab === 'users' && features.users !== false && isStaffManager && (
            <div className="max-w-4xl">
              <h1 className="text-2xl font-bold text-white mb-6">Users</h1>
              <p className="text-gray-400 text-sm mb-6">Staff logins for this site. Passwords are encrypted.{features.general ? ' Ranks: employee (no delete users), writer (blog only), member (no modules).' : ''}</p>
              <div className="rounded-xl bg-[#2a2a2a] border border-white/10 p-6 mb-8">
                <h2 className="text-lg font-medium text-white mb-4">Add user</h2>
                <form onSubmit={handleAddUser} className="flex flex-wrap gap-4 items-end">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Username</label>
                    <input type="text" value={userForm.username} onChange={(e) => setUserForm((f) => ({ ...f, username: e.target.value }))} placeholder="username" className="px-4 py-2 rounded-lg bg-[#1a1a1a] border border-white/20 text-white placeholder-gray-500 w-56" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Password</label>
                    <input type="password" value={userForm.password} onChange={(e) => setUserForm((f) => ({ ...f, password: e.target.value }))} placeholder="New password" className="px-4 py-2 rounded-lg bg-[#1a1a1a] border border-white/20 text-white placeholder-gray-500 w-48" />
                  </div>
                  {features.general && (
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Rank</label>
                      <select value={userForm.rank || 'employee'} onChange={(e) => setUserForm((f) => ({ ...f, rank: e.target.value }))} className="px-4 py-2 rounded-lg bg-[#1a1a1a] border border-white/20 text-white">
                        <option value="employee">Employee</option>
                        <option value="writer">Writer</option>
                        <option value="member">Member</option>
                      </select>
                    </div>
                  )}
                  <button type="submit" disabled={loading || !userForm.username.trim() || !userForm.password} className="px-4 py-2 rounded-lg bg-[#FF5B00] text-white font-medium hover:bg-[#e55200] disabled:opacity-50">Add user</button>
                </form>
              </div>
              <div className="rounded-xl bg-[#2a2a2a] border border-white/10 overflow-hidden">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-4 py-3 text-gray-400 font-medium">Username</th>
                      {features.general && <th className="px-4 py-3 text-gray-400 font-medium">Rank</th>}
                      <th className="px-4 py-3 text-gray-400 font-medium">Created</th>
                      <th className="px-4 py-3 text-gray-400 font-medium w-48">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id} className="border-b border-white/5">
                        <td className="px-4 py-3 text-white">
                          {editingId === u.id ? (
                            <input
                              type="text"
                              defaultValue={u.username}
                              onBlur={(e) => {
                                const v = e.target.value.trim();
                                if (v && v !== u.username) handleUpdateUser(u.id, v);
                                setEditingId(null);
                              }}
                              onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
                              className="px-2 py-1 rounded bg-[#1a1a1a] border border-white/20 text-white w-48"
                            />
                          ) : (
                            <span onClick={() => setEditingId(u.id)} className="cursor-pointer hover:underline">{u.username}</span>
                          )}
                        </td>
                        {features.general && (
                          <td className="px-4 py-3">
                            <select
                              value={u.rank || 'employee'}
                              onChange={(e) => handleUpdateUser(u.id, undefined, undefined, e.target.value)}
                              className="px-2 py-1 rounded bg-[#1a1a1a] border border-white/20 text-white text-sm"
                            >
                              <option value="employee">Employee</option>
                              <option value="writer">Writer</option>
                              <option value="member">Member</option>
                            </select>
                          </td>
                        )}
                        <td className="px-4 py-3 text-gray-400 text-sm">{new Date(u.createdAt).toLocaleDateString()}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {editingId === u.id ? (
                              <>
                                <input type="password" placeholder="New password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} className="px-2 py-1 rounded bg-[#1a1a1a] border border-white/20 text-white w-32 text-sm" />
                                <button type="button" onClick={() => editPassword && handleUpdateUser(u.id, null, editPassword)} className="text-xs px-2 py-1 rounded bg-[#FF5B00] text-white">Set password</button>
                                <button type="button" onClick={() => { setEditingId(null); setEditPassword(''); }} className="text-gray-400 hover:text-white text-xs">Cancel</button>
                              </>
                            ) : (
                              <>
                                <button type="button" onClick={() => setEditingId(u.id)} className="text-xs text-[#FF5B00] hover:underline">Edit</button>
                                {canDeleteStaff && (
                                  <button type="button" onClick={() => handleDeleteUser(u.id)} className="text-xs text-red-400 hover:underline">Delete</button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {users.length === 0 && <p className="px-4 py-8 text-gray-400 text-center">No users yet.</p>}
              </div>
            </div>
          )}
        </main>
      </div>
      {changePasswordOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-[#2a2a2a] rounded-xl border border-white/10 p-6 max-w-sm w-full">
            <h2 className="text-lg font-semibold text-white mb-4">Change my password</h2>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <input type="password" placeholder="Current password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="w-full px-4 py-2 rounded-lg bg-[#1a1a1a] border border-white/20 text-white" required />
              <input type="password" placeholder="New password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full px-4 py-2 rounded-lg bg-[#1a1a1a] border border-white/20 text-white" required />
              {changePasswordError && <p className="text-red-400 text-sm">{changePasswordError}</p>}
              <div className="flex gap-2">
                <button type="submit" className="px-4 py-2 rounded-lg bg-[#FF5B00] text-white font-medium">Save</button>
                <button type="button" onClick={() => { setChangePasswordOpen(false); setChangePasswordError(''); setCurrentPassword(''); setNewPassword(''); }} className="px-4 py-2 rounded-lg bg-white/10 text-white">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
