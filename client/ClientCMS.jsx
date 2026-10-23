/** Client CMS UI. Mount on `<Route path="/admin" />` with the API at `/api/cms`. */
import { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { Users, LogOut, LayoutDashboard, BarChart3, ShoppingBag, ShoppingCart, Package, Newspaper, Mail, Inbox, Image as ImageIcon, Pencil, Calendar, Percent, Gift, RefreshCw, Star, Settings, FileText } from 'lucide-react';
import { PagesPanel } from './PagesPanel.jsx';
import { NO_SHOP_MODULES, shopModulesFrom, shopPageBlocked, visibleShopPages } from './shop-modules.js';
import { Helmet } from 'react-helmet-async';
import './cms-look.css';
import { ShopFilesPanel, ShopSettingsPanel } from './ShopSettingsPanel.jsx';
import { PaymentsPanel } from './PaymentsPanel.jsx';
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
const SHOP_MAIN = [
    { id: 'overview', label: 'Oversikt', icon: LayoutDashboard },
    { id: 'orders', label: 'Ordrer', icon: ShoppingCart },
    { id: 'products', label: 'Produkter', icon: Package },
    { id: 'customers', label: 'Kunder', icon: Users },
];
const SHOP_EXTRA_ICONS = { bookings: Calendar, discounts: Percent, giftcards: Gift, subscriptions: RefreshCw, reviews: Star, abandoned: ShoppingBag };
function SideLink({ icon: Icon, label, active, onClick }) {
    return (<button type="button" onClick={onClick} className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-[13px] font-medium ${active ? 'bg-[#f1f2f4] text-[#111]' : 'text-[#303030] hover:bg-[#f6f6f7]'}`}>
      <Icon size={16} strokeWidth={1.75} className={active ? 'text-[#FF5B00] shrink-0' : 'text-[#6d7175] shrink-0'}/>
      <span className="truncate">{label}</span>
    </button>);
}
function SideLabel({ children }) {
    return <p className="px-2.5 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[#8a8f98]">{children}</p>;
}
function firstEnabledTab(features, rank = 'admin') {
    const can = (tab) => {
        if (rank === 'member')
            return false;
        if (rank === 'writer')
            return tab === 'blog';
        return true;
    };
    if (can('website'))
        return 'website';
    if (features.users !== false && can('users'))
        return 'users';
    if (features.ecommerce && can('ecommerce'))
        return 'ecommerce';
    if (features.emailMarketing && can('email'))
        return 'email';
    if (features.blog && can('blog'))
        return 'blog';
    if (features.socialSync && can('social'))
        return 'social';
    if (features.analytics && can('analytics'))
        return 'analytics';
    return rank === 'writer' && features.blog ? 'blog' : 'users';
}
/** Client CMS shell. Log in, then the tabs the hub and rank allow. */
export function ClientCMS() {
    const [loggedIn, setLoggedIn] = useState(null);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loginError, setLoginError] = useState('');
    // Stripe/PayPal onboarding returns to /admin?payments=… — open the Payments page.
    const [tab, setTab] = useState(() => (new URLSearchParams(window.location.search).has('payments') ? 'settings' : 'website'));
    const [shopPage, setShopPage] = useState('overview');
    const [settingsPage, setSettingsPage] = useState(() => (new URLSearchParams(window.location.search).has('payments') ? 'payments' : 'features'));
    const [editorRoute, setEditorRoute] = useState('');
    const [modules, setModules] = useState(NO_SHOP_MODULES);
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
        if (!res.ok)
            return;
        setUsers(await res.json());
    }, []);
    useEffect(() => {
        fetch(`${API}/config`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
            const nextFeatures = data?.features ? { ...DEFAULT_FEATURES, ...data.features } : DEFAULT_FEATURES;
            setFeatures(nextFeatures);
            setCatalogType(data?.ecommerceCatalogType === 'menu' || data?.ecommerceCatalogType === 'tiers' ? data.ecommerceCatalogType : 'normal');
            if (data?.name)
                setSiteName(data.name);
            setTab((current) => {
                if (current === 'users' && nextFeatures.users === false)
                    return firstEnabledTab(nextFeatures, actor.rank);
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
            if (me.rank === 'admin' || me.rank === 'employee')
                fetchUsers();
            setTab((current) => {
                if (me.rank === 'writer')
                    return 'blog';
                if (me.rank === 'member')
                    return 'users';
                return current;
            });
        })
            .catch(() => setLoggedIn(false));
    }, [fetchUsers]);
    useEffect(() => {
        if (!loggedIn || !features.ecommerce)
            return;
        fetch(`${API}/shop/admin/settings`, { headers: authHeaders() })
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
            if (data && typeof data === 'object')
                setModules(shopModulesFrom(data.modules));
        })
            .catch(() => {});
    }, [loggedIn, features.ecommerce]);
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
            if (nextActor.rank === 'admin' || nextActor.rank === 'employee')
                fetchUsers();
        }
        catch {
            setLoginError('Network error');
        }
        finally {
            setLoading(false);
        }
    };
    const handleLogout = () => {
        clearToken();
        setLoggedIn(false);
    };
    const handleAddUser = async (e) => {
        e.preventDefault();
        if (!userForm.username.trim() || !userForm.password)
            return;
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
        }
        finally {
            setLoading(false);
        }
    };
    const handleUpdateUser = async (id, newUsername, newPassword, newRank) => {
        setLoading(true);
        try {
            const body = {};
            if (newUsername !== undefined && newUsername !== null)
                body.username = newUsername;
            if (newPassword !== undefined && newPassword !== '')
                body.password = newPassword;
            if (newRank !== undefined)
                body.rank = newRank;
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
        }
        finally {
            setLoading(false);
        }
    };
    const handleDeleteUser = async (id) => {
        if (!confirm('Delete this user? They will no longer be able to log in.'))
            return;
        setLoading(true);
        try {
            const res = await fetch(`${API}/admin/users/${id}`, { method: 'DELETE', headers: authHeaders() });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                alert(data.message || 'Delete failed');
                return;
            }
            fetchUsers();
        }
        finally {
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
        return (<div className="cms-app min-h-screen flex items-center justify-center">
        <p className="text-[#6d7175]">Loading…</p>
      </div>);
    }
    if (!loggedIn) {
        return (<>
        <Helmet><title>Admin</title><meta name="robots" content="noindex,nofollow"/></Helmet>
        <div className="cms-app min-h-screen flex items-center justify-center p-6">
          <div className="w-full max-w-sm rounded-2xl bg-white border border-[#e3e3e3] shadow-sm p-8">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#8a8f98] mb-1">{siteName || 'Admin'}</p>
            <h1 className="text-xl font-semibold text-[#1a1c1e] mb-6">Log in</h1>
            <form onSubmit={handleLogin} className="space-y-4">
              <input type="text" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} className="w-full px-4 py-3 rounded-lg bg-white border border-[#c9cccf] text-[#1a1c1e] placeholder:text-[#8c9196] focus:outline-none focus:border-[#FF5B00] focus:ring-2 focus:ring-[#FF5B00]/20" required/>
              <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-4 py-3 rounded-lg bg-white border border-[#c9cccf] text-[#1a1c1e] placeholder:text-[#8c9196] focus:outline-none focus:border-[#FF5B00] focus:ring-2 focus:ring-[#FF5B00]/20" required/>
              {loginError && <p className="text-[#b42318] text-sm">{loginError}</p>}
              <button type="submit" disabled={loading} className="w-full py-3 rounded-lg font-medium text-white bg-[#FF5B00] hover:bg-[#e55200] disabled:opacity-50">
                {loading ? 'Logging in…' : 'Log in'}
              </button>
            </form>
            <p className="mt-4 text-center">
              <a href="/" className="text-sm text-[#6d7175] hover:text-[#1a1c1e]">← Back to site</a>
            </p>
          </div>
        </div>
      </>);
    }
    const rank = actor.rank || 'admin';
    const isStaffManager = rank === 'admin' || rank === 'employee';
    const canBlog = rank === 'admin' || rank === 'employee' || rank === 'writer';
    const canDeleteStaff = rank === 'admin';
    const openShop = (id) => {
        setTab('ecommerce');
        setShopPage(id);
    };
    const shopBlocked = shopPageBlocked(shopPage, modules);
    const settingsItems = [
        features.ecommerce && ['features', 'Features'],
        features.ecommerce && ['store', 'Store'],
        features.ecommerce && ['payments', 'Payments'],
        features.ecommerce && ['shipping', 'Shipping'],
        features.ecommerce && ['tax', 'Tax'],
        features.ecommerce && ['checkout', 'Checkout'],
        features.ecommerce && modules.bookings && ['bookings', 'Booking setup'],
        features.ecommerce && ['files', 'Files'],
        features.ecommerce && rank === 'admin' && ['test', 'Test mode'],
        features.users !== false && ['staff', 'Staff'],
        features.general && ['general', 'Forms'],
        features.socialSync && ['social', 'Social'],
    ].filter(Boolean);
    return (<>
      <Helmet><title>Admin</title><meta name="robots" content="noindex,nofollow"/></Helmet>
      <div className="cms-app min-h-screen flex">
        <aside className="w-[240px] bg-white text-[#1a1c1e] flex flex-col fixed inset-y-0 left-0 border-r border-[#e3e3e3]">
          <div className="px-4 py-4 border-b border-[#e3e3e3]">
            <a href="/" className="block truncate text-[15px] font-semibold text-[#1a1c1e]">{siteName || 'Admin'}</a>
            <a href="/" className="text-xs text-[#FF5B00] hover:underline">View store</a>
          </div>
          <nav className="flex-1 overflow-y-auto px-2 py-2">
            {features.ecommerce && isStaffManager && (<>
              <SideLabel>Shop</SideLabel>
              {SHOP_MAIN.map((item) => (<SideLink key={item.id} icon={item.icon} label={item.label} active={tab === 'ecommerce' && shopPage === item.id} onClick={() => openShop(item.id)}/>))}
              {visibleShopPages(modules).map((item) => (<SideLink key={item.id} icon={SHOP_EXTRA_ICONS[item.id]} label={item.label} active={tab === 'ecommerce' && shopPage === item.id} onClick={() => openShop(item.id)}/>))}
            </>)}
            {(isStaffManager || canBlog || (features.blog && canBlog) || (features.emailMarketing && isStaffManager)) ? <SideLabel>Content</SideLabel> : null}
            {isStaffManager && <SideLink icon={Pencil} label="Website" active={tab === 'website'} onClick={() => setTab('website')}/>}
            {isStaffManager && <SideLink icon={FileText} label="Pages" active={tab === 'pages'} onClick={() => setTab('pages')}/>}
            {features.blog && canBlog && <SideLink icon={Newspaper} label="Blog" active={tab === 'blog'} onClick={() => setTab('blog')}/>}
            {canBlog && <SideLink icon={ImageIcon} label="Media" active={tab === 'media'} onClick={() => setTab('media')}/>}
            {features.emailMarketing && isStaffManager && <SideLink icon={Mail} label="Email" active={tab === 'email'} onClick={() => setTab('email')}/>}
            {features.general && isStaffManager && <SideLink icon={Inbox} label="Forms" active={tab === 'forms'} onClick={() => setTab('forms')}/>}
            {features.analytics && isStaffManager && <SideLink icon={BarChart3} label="Analytics" active={tab === 'analytics'} onClick={() => setTab('analytics')}/>}
          </nav>
          <div className="p-2 border-t border-[#e3e3e3]">
            {isStaffManager && <SideLink icon={Settings} label="Settings" active={tab === 'settings'} onClick={() => { setTab('settings'); setSettingsPage(features.ecommerce ? 'features' : 'staff'); }}/>}
            <p className="px-2.5 pt-2 text-xs text-[#6d7175] truncate">{actor.name || actor.username}{rank && rank !== 'admin' ? ` · ${rank}` : ''}</p>
            <button type="button" onClick={() => setChangePasswordOpen(true)} className="w-full px-2.5 py-1.5 text-left text-[13px] text-[#6d7175] hover:text-[#1a1c1e] rounded-lg hover:bg-[#f6f6f7]">Change password</button>
            <button type="button" onClick={handleLogout} className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[13px] text-[#6d7175] hover:bg-[#f6f6f7] hover:text-[#1a1c1e]">
              <LogOut size={16}/> Log out
            </button>
          </div>
        </aside>
        <main className={`flex-1 ml-[240px] min-w-0 ${tab === 'website' ? 'p-0 overflow-hidden' : 'p-6'}`}>
          {tab === 'website' && isStaffManager && (<SiteEditorPanel authHeaders={authHeaders} actor={actor} catalogType={catalogType} onOpenTab={setTab} openRoute={editorRoute}/>)}
          {tab === 'pages' && isStaffManager && (<PagesPanel authHeaders={authHeaders} onOpenPage={(route) => { setEditorRoute(route); setTab('website'); }}/>)}
          {tab === 'analytics' && features.analytics && isStaffManager && (<AnalyticsPanel authHeaders={authHeaders} loading={loading} setLoading={setLoading}/>)}
          {tab === 'blog' && features.blog && canBlog && (<BlogPanel authHeaders={authHeaders} loading={loading} setLoading={setLoading} actor={actor}/>)}
          {tab === 'media' && canBlog && <MediaPanel authHeaders={authHeaders} actor={actor}/>}
          {tab === 'forms' && features.general && isStaffManager && (<GeneralPanel authHeaders={authHeaders} loading={loading} setLoading={setLoading} siteName={siteName} start="forms"/>)}
          {tab === 'ecommerce' && features.ecommerce && isStaffManager && !shopBlocked && (<EcommercePanel catalogType={catalogType} authHeaders={authHeaders} loading={loading} setLoading={setLoading} isOwner={actor.rank === 'admin'} page={shopPage} onPage={openShop}/>)}
          {tab === 'ecommerce' && shopBlocked && (<div className="max-w-lg rounded-xl bg-white border border-[#e3e3e3] p-6">
              <h1 className="text-xl font-semibold text-[#1a1c1e] mb-2">This is turned off</h1>
              <p className="text-sm text-[#6d7175] mb-4">Turn it on under Settings → Features. The tools stay in the product; this client just does not see them until then.</p>
              <button type="button" onClick={() => { setTab('settings'); setSettingsPage('features'); }} className="px-3 py-2 rounded-lg bg-[#FF5B00] text-white text-sm">Open features</button>
            </div>)}
          {tab === 'settings' && isStaffManager && (<div className="max-w-6xl flex gap-8 items-start">
              <nav className="w-44 shrink-0 sticky top-6">
                {settingsItems.map(([id, label]) => (<button key={id} type="button" onClick={() => setSettingsPage(id)} className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[13px] font-medium ${settingsPage === id ? 'bg-[#f1f2f4] text-[#111]' : 'text-[#4a4a4a] hover:bg-[#f6f6f7]'}`}>{label}</button>))}
              </nav>
              <div className="flex-1 min-w-0">
                {features.ecommerce && ['features', 'store', 'shipping', 'tax', 'checkout', 'bookings', 'test'].includes(settingsPage) && (<ShopSettingsPanel authHeaders={authHeaders} setLoading={setLoading} isOwner={rank === 'admin'} section={settingsPage} onSaved={(next) => next?.modules && setModules(shopModulesFrom(next.modules))}/>)}
                {settingsPage === 'payments' && <PaymentsPanel authHeaders={authHeaders} loading={loading} setLoading={setLoading} isOwner={rank === 'admin'}/>}
                {settingsPage === 'files' && <ShopFilesPanel authHeaders={authHeaders} setLoading={setLoading} isOwner={rank === 'admin'}/>}
                {settingsPage === 'general' && <GeneralPanel authHeaders={authHeaders} loading={loading} setLoading={setLoading} siteName={siteName}/>}
                {settingsPage === 'social' && (<div className="max-w-4xl">
                  <h1 className="text-xl font-semibold text-[#1a1c1e] mb-2">Social sync</h1>
                  <p className="text-[#6d7175]">Reviews and social media sync. Coming soon.</p>
                </div>)}
              </div>
            </div>)}
          {tab === 'ecommerce' && !features.ecommerce && isStaffManager && (<div className="max-w-4xl">
              <h1 className="text-2xl font-bold text-white mb-4">Products</h1>
              <p className="text-gray-400">Ecommerce is not enabled for this site. Turn it on in the hub, or edit marketing pages under Website.</p>
              <button type="button" onClick={() => setTab('website')} className="mt-4 px-3 py-2 rounded-lg bg-[#FF5B00] text-white text-sm">Back to Website</button>
            </div>)}
          {tab === 'email' && features.emailMarketing && isStaffManager && (<Suspense fallback={<p className="text-gray-400">Laster e-posteditor…</p>}>
              <EmailMarketingPanel authHeaders={authHeaders} loading={loading} setLoading={setLoading}/>
            </Suspense>)}
          {rank === 'member' && (<div className="max-w-4xl">
              <h1 className="text-2xl font-bold text-white mb-6">Member</h1>
              <p className="text-gray-400">This login has no CMS modules. Ask an admin if you need access.</p>
            </div>)}
          {tab === 'settings' && settingsPage === 'staff' && features.users !== false && isStaffManager && (<div className="max-w-4xl">
              <h1 className="text-2xl font-bold text-white mb-6">Users</h1>
              <p className="text-gray-400 text-sm mb-6">Staff logins for this site. Passwords are encrypted.{features.general ? ' Ranks: employee (no delete users), writer (blog only), member (no modules).' : ''}</p>
              <div className="rounded-xl bg-[#2a2a2a] border border-white/10 p-6 mb-8">
                <h2 className="text-lg font-medium text-white mb-4">Add user</h2>
                <form onSubmit={handleAddUser} className="flex flex-wrap gap-4 items-end">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Username</label>
                    <input type="text" value={userForm.username} onChange={(e) => setUserForm((f) => ({ ...f, username: e.target.value }))} placeholder="username" className="px-4 py-2 rounded-lg bg-[#1a1a1a] border border-white/20 text-white placeholder-gray-500 w-56"/>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Password</label>
                    <input type="password" value={userForm.password} onChange={(e) => setUserForm((f) => ({ ...f, password: e.target.value }))} placeholder="New password" className="px-4 py-2 rounded-lg bg-[#1a1a1a] border border-white/20 text-white placeholder-gray-500 w-48"/>
                  </div>
                  {features.general && (<div>
                      <label className="block text-xs text-gray-400 mb-1">Rank</label>
                      <select value={userForm.rank || 'employee'} onChange={(e) => setUserForm((f) => ({ ...f, rank: e.target.value }))} className="px-4 py-2 rounded-lg bg-[#1a1a1a] border border-white/20 text-white">
                        <option value="employee">Employee</option>
                        <option value="writer">Writer</option>
                        <option value="member">Member</option>
                      </select>
                    </div>)}
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
                    {users.map((u) => (<tr key={u.id} className="border-b border-white/5">
                        <td className="px-4 py-3 text-white">
                          {editingId === u.id ? (<input type="text" defaultValue={u.username} onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== u.username)
                            handleUpdateUser(u.id, v);
                        setEditingId(null);
                    }} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} className="px-2 py-1 rounded bg-[#1a1a1a] border border-white/20 text-white w-48"/>) : (<span onClick={() => setEditingId(u.id)} className="cursor-pointer hover:underline">{u.username}</span>)}
                        </td>
                        {features.general && (<td className="px-4 py-3">
                            <select value={u.rank || 'employee'} onChange={(e) => handleUpdateUser(u.id, undefined, undefined, e.target.value)} className="px-2 py-1 rounded bg-[#1a1a1a] border border-white/20 text-white text-sm">
                              <option value="employee">Employee</option>
                              <option value="writer">Writer</option>
                              <option value="member">Member</option>
                            </select>
                          </td>)}
                        <td className="px-4 py-3 text-gray-400 text-sm">{new Date(u.createdAt).toLocaleDateString()}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {editingId === u.id ? (<>
                                <input type="password" placeholder="New password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} className="px-2 py-1 rounded bg-[#1a1a1a] border border-white/20 text-white w-32 text-sm"/>
                                <button type="button" onClick={() => editPassword && handleUpdateUser(u.id, null, editPassword)} className="text-xs px-2 py-1 rounded bg-[#FF5B00] text-white">Set password</button>
                                <button type="button" onClick={() => { setEditingId(null); setEditPassword(''); }} className="text-gray-400 hover:text-white text-xs">Cancel</button>
                              </>) : (<>
                                <button type="button" onClick={() => setEditingId(u.id)} className="text-xs text-[#FF5B00] hover:underline">Edit</button>
                                {canDeleteStaff && (<button type="button" onClick={() => handleDeleteUser(u.id)} className="text-xs text-red-400 hover:underline">Delete</button>)}
                              </>)}
                          </div>
                        </td>
                      </tr>))}
                  </tbody>
                </table>
                {users.length === 0 && <p className="px-4 py-8 text-gray-400 text-center">No users yet.</p>}
              </div>
            </div>)}
        </main>
      </div>
      {changePasswordOpen && (<div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl border border-[#e3e3e3] shadow-lg p-6 max-w-sm w-full">
            <h2 className="text-lg font-semibold text-[#1a1c1e] mb-4">Change password</h2>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <input type="password" placeholder="Current password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="w-full px-4 py-2 rounded-lg bg-white border border-[#c9cccf] text-[#1a1c1e]" required/>
              <input type="password" placeholder="New password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full px-4 py-2 rounded-lg bg-white border border-[#c9cccf] text-[#1a1c1e]" required/>
              {changePasswordError && <p className="text-[#b42318] text-sm">{changePasswordError}</p>}
              <div className="flex gap-2">
                <button type="submit" className="px-4 py-2 rounded-lg bg-[#FF5B00] text-white font-medium">Save</button>
                <button type="button" onClick={() => { setChangePasswordOpen(false); setChangePasswordError(''); setCurrentPassword(''); setNewPassword(''); }} className="px-4 py-2 rounded-lg border border-[#c9cccf] text-[#1a1c1e]">Cancel</button>
              </div>
            </form>
          </div>
        </div>)}
    </>);
}
