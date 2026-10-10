/** Admin orders list. Filter and cancel; nothing is hard-deleted. */
import { useCallback, useEffect, useMemo, useState } from 'react';
const API = '/api/cms';
const RANGES = [
    { id: 'day', label: 'Last day' },
    { id: 'week', label: 'Last week' },
    { id: 'month', label: 'Last month' },
    { id: '6months', label: 'Last 6 months' },
    { id: 'year', label: 'Last year' },
    { id: 'custom', label: 'Custom' },
];
function emptyOrder(preset) {
    return {
        customerName: '',
        customerEmail: '',
        customerPhone: '',
        productId: '',
        productName: '',
        quantity: 1,
        amount: '',
        purchasedAt: new Date().toISOString().slice(0, 16),
        customNote: '',
        additionsText: '',
        additionalServicesText: '',
        status: 'new',
        preset,
        bookingFrom: '',
        bookingTo: '',
        shippingLine: '',
        shippingPostal: '',
        shippingCity: '',
        shippingCountry: '',
    };
}
function linesToChecklist(text) {
    return String(text || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((name) => ({ name, checked: true }));
}
function payloadFromOrderForm(form) {
    return {
        customerName: form.customerName.trim(),
        customerEmail: form.customerEmail.trim(),
        customerPhone: form.customerPhone.trim(),
        productId: form.productId,
        productName: form.productName.trim(),
        quantity: Number(form.quantity) || 1,
        amount: form.amount,
        purchasedAt: form.purchasedAt ? new Date(form.purchasedAt).toISOString() : new Date().toISOString(),
        customNote: form.customNote.trim(),
        additions: linesToChecklist(form.additionsText),
        additionalServices: linesToChecklist(form.additionalServicesText),
        status: form.status,
        preset: form.preset,
        bookingFrom: form.bookingFrom ? new Date(form.bookingFrom).toISOString() : '',
        bookingTo: form.bookingTo ? new Date(form.bookingTo).toISOString() : '',
        shippingAddress: {
            line: form.shippingLine.trim(),
            postal: form.shippingPostal.trim(),
            city: form.shippingCity.trim(),
            country: form.shippingCountry.trim(),
        },
    };
}
function formatMoney(amount, currency = 'NOK') {
    const value = Number(amount) || 0;
    return `${value.toLocaleString('nb-NO')} ${currency}`;
}
function formatWhen(value) {
    if (!value)
        return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        return String(value);
    return date.toLocaleString();
}
/** Orders admin tab. */
export function OrdersPanel({ catalogType, authHeaders, loading, setLoading }) {
    const [orders, setOrders] = useState([]);
    const [products, setProducts] = useState([]);
    const [stats, setStats] = useState({ count: 0, revenue: 0, average: 0 });
    const [preset, setPreset] = useState(catalogType === 'tiers' ? 'service' : 'normal');
    const [range, setRange] = useState('month');
    const [customFrom, setCustomFrom] = useState('');
    const [customTo, setCustomTo] = useState('');
    const [filters, setFilters] = useState({ name: '', letter: '', email: '', minAmount: '', maxAmount: '', product: '', status: '' });
    const [form, setForm] = useState(emptyOrder(catalogType === 'tiers' ? 'service' : 'normal'));
    const [showAdd, setShowAdd] = useState(false);
    const fetchSettings = useCallback(async () => {
        const res = await fetch(`${API}/settings`, { headers: authHeaders() });
        if (!res.ok)
            return;
        const data = await res.json();
        if (data.orderPreset) {
            setPreset(data.orderPreset);
            setForm((current) => ({ ...current, preset: data.orderPreset }));
        }
    }, [authHeaders]);
    const fetchOrders = useCallback(async () => {
        const params = new URLSearchParams();
        Object.entries(filters).forEach(([key, value]) => {
            if (value)
                params.set(key, value);
        });
        const res = await fetch(`${API}/orders?${params.toString()}`, { headers: authHeaders() });
        if (!res.ok)
            return;
        setOrders(await res.json());
    }, [authHeaders, filters]);
    const fetchStats = useCallback(async () => {
        const params = new URLSearchParams({ range });
        if (range === 'custom') {
            if (customFrom)
                params.set('from', customFrom);
            if (customTo)
                params.set('to', customTo);
        }
        const res = await fetch(`${API}/orders/stats?${params.toString()}`, { headers: authHeaders() });
        if (!res.ok)
            return;
        setStats(await res.json());
    }, [authHeaders, range, customFrom, customTo]);
    const fetchProducts = useCallback(async () => {
        const res = await fetch(`${API}/products`, { headers: authHeaders() });
        if (!res.ok)
            return;
        setProducts(await res.json());
    }, [authHeaders]);
    useEffect(() => {
        fetchSettings();
        fetchProducts();
    }, [fetchSettings, fetchProducts]);
    useEffect(() => {
        fetchOrders();
    }, [fetchOrders]);
    useEffect(() => {
        fetchStats();
    }, [fetchStats]);
    const savePreset = async (next) => {
        setPreset(next);
        setForm((current) => ({ ...current, preset: next }));
        await fetch(`${API}/settings`, {
            method: 'PUT',
            headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderPreset: next }),
        });
    };
    const handleCreate = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            const res = await fetch(`${API}/orders`, {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(payloadFromOrderForm({ ...form, preset })),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                alert(data.message || 'Could not save order');
                return;
            }
            setForm(emptyOrder(preset));
            setShowAdd(false);
            await Promise.all([fetchOrders(), fetchStats()]);
        }
        finally {
            setLoading(false);
        }
    };
    const handleStatus = async (order, status) => {
        setLoading(true);
        try {
            const res = await fetch(`${API}/orders/${order.id}`, {
                method: 'PUT',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ status }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                alert(data.message || 'Update failed');
                return;
            }
            await Promise.all([fetchOrders(), fetchStats()]);
        }
        finally {
            setLoading(false);
        }
    };
    const visibleColumns = useMemo(() => {
        if (preset === 'service') {
            return ['who', 'when', 'product', 'booking', 'amount', 'extras', 'note', 'status'];
        }
        return ['who', 'when', 'product', 'qty', 'amount', 'ship', 'extras', 'note', 'status'];
    }, [preset]);
    const inputClass = 'px-3 py-2 rounded-lg bg-[#1a1a1a] border border-white/20 text-white text-sm';
    return (<div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex gap-2">
          {['normal', 'service'].map((id) => (<button key={id} type="button" onClick={() => savePreset(id)} className={`px-4 py-2 rounded-lg text-sm font-medium ${preset === id ? 'bg-[#FF5B00] text-white' : 'bg-white/10 text-gray-300'}`}>
              {id === 'service' ? 'Service / booking' : 'Normal ecommerce'}
            </button>))}
        </div>
        <button type="button" onClick={() => setShowAdd((open) => !open)} className="px-4 py-2 rounded-lg bg-[#FF5B00] text-white font-medium">
          {showAdd ? 'Close' : 'Add order'}
        </button>
      </div>

      <div className="grid sm:grid-cols-3 gap-3 mb-4">
        <div className="rounded-xl bg-[#2a2a2a] border border-white/10 p-4">
          <div className="text-xs text-gray-400">Orders</div>
          <div className="text-2xl text-white font-semibold">{stats.count || 0}</div>
        </div>
        <div className="rounded-xl bg-[#2a2a2a] border border-white/10 p-4">
          <div className="text-xs text-gray-400">Income</div>
          <div className="text-2xl text-white font-semibold">{formatMoney(stats.revenue, 'NOK')}</div>
        </div>
        <div className="rounded-xl bg-[#2a2a2a] border border-white/10 p-4">
          <div className="text-xs text-gray-400">Average</div>
          <div className="text-2xl text-white font-semibold">{formatMoney(stats.average, 'NOK')}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {RANGES.map((item) => (<button key={item.id} type="button" onClick={() => setRange(item.id)} className={`px-3 py-1.5 rounded-lg text-sm ${range === item.id ? 'bg-white text-black' : 'bg-white/10 text-gray-300'}`}>
            {item.label}
          </button>))}
        {range === 'custom' && (<>
            <input type="datetime-local" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className={inputClass}/>
            <input type="datetime-local" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className={inputClass}/>
          </>)}
      </div>

      <div className="grid md:grid-cols-6 gap-2 mb-4">
        <input placeholder="Name" value={filters.name} onChange={(e) => setFilters((f) => ({ ...f, name: e.target.value }))} className={inputClass}/>
        <input placeholder="Letter" maxLength={1} value={filters.letter} onChange={(e) => setFilters((f) => ({ ...f, letter: e.target.value }))} className={inputClass}/>
        <input placeholder="Email" value={filters.email} onChange={(e) => setFilters((f) => ({ ...f, email: e.target.value }))} className={inputClass}/>
        <input placeholder="Min amount" value={filters.minAmount} onChange={(e) => setFilters((f) => ({ ...f, minAmount: e.target.value }))} className={inputClass}/>
        <input placeholder="Max amount" value={filters.maxAmount} onChange={(e) => setFilters((f) => ({ ...f, maxAmount: e.target.value }))} className={inputClass}/>
        <input placeholder="Product" value={filters.product} onChange={(e) => setFilters((f) => ({ ...f, product: e.target.value }))} className={inputClass}/>
      </div>

      {showAdd && (<form onSubmit={handleCreate} className="rounded-xl bg-[#2a2a2a] border border-white/10 p-6 mb-6 grid md:grid-cols-2 gap-4">
          <input required placeholder="Name" value={form.customerName} onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))} className={inputClass}/>
          <input placeholder="Email" type="email" value={form.customerEmail} onChange={(e) => setForm((f) => ({ ...f, customerEmail: e.target.value }))} className={inputClass}/>
          <input placeholder="Phone" value={form.customerPhone} onChange={(e) => setForm((f) => ({ ...f, customerPhone: e.target.value }))} className={inputClass}/>
          <select value={form.productId} onChange={(e) => {
                const product = products.find((item) => item.id === e.target.value);
                setForm((f) => ({
                    ...f,
                    productId: e.target.value,
                    productName: product?.name || f.productName,
                    amount: product?.price && !product.contactInsteadOfPrice ? product.price : f.amount,
                }));
            }} className={inputClass}>
            <option value="">Select product</option>
            {products.map((product) => (<option key={product.id} value={product.id}>
                {product.name}
              </option>))}
          </select>
          <input placeholder="Product name" value={form.productName} onChange={(e) => setForm((f) => ({ ...f, productName: e.target.value }))} className={inputClass}/>
          <input placeholder="Amount" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className={inputClass}/>
          <input type="number" min="1" placeholder="Quantity" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} className={inputClass}/>
          <input type="datetime-local" value={form.purchasedAt} onChange={(e) => setForm((f) => ({ ...f, purchasedAt: e.target.value }))} className={inputClass}/>
          {preset === 'service' && (<>
              <input type="datetime-local" value={form.bookingFrom} onChange={(e) => setForm((f) => ({ ...f, bookingFrom: e.target.value }))} className={inputClass}/>
              <input type="datetime-local" value={form.bookingTo} onChange={(e) => setForm((f) => ({ ...f, bookingTo: e.target.value }))} className={inputClass}/>
              <textarea placeholder="Additional services, one per line" value={form.additionalServicesText} onChange={(e) => setForm((f) => ({ ...f, additionalServicesText: e.target.value }))} className={`${inputClass} md:col-span-2`}/>
            </>)}
          {preset === 'normal' && (<>
              <input placeholder="Address" value={form.shippingLine} onChange={(e) => setForm((f) => ({ ...f, shippingLine: e.target.value }))} className={inputClass}/>
              <input placeholder="Postal" value={form.shippingPostal} onChange={(e) => setForm((f) => ({ ...f, shippingPostal: e.target.value }))} className={inputClass}/>
              <input placeholder="City" value={form.shippingCity} onChange={(e) => setForm((f) => ({ ...f, shippingCity: e.target.value }))} className={inputClass}/>
              <input placeholder="Country" value={form.shippingCountry} onChange={(e) => setForm((f) => ({ ...f, shippingCountry: e.target.value }))} className={inputClass}/>
            </>)}
          <textarea placeholder="Additions checklist, one per line" value={form.additionsText} onChange={(e) => setForm((f) => ({ ...f, additionsText: e.target.value }))} className={`${inputClass} md:col-span-2`}/>
          <textarea placeholder="Custom note" value={form.customNote} onChange={(e) => setForm((f) => ({ ...f, customNote: e.target.value }))} className={`${inputClass} md:col-span-2`}/>
          <button type="submit" disabled={loading} className="px-4 py-2 rounded-lg bg-[#FF5B00] text-white font-medium disabled:opacity-50">
            Save order
          </button>
        </form>)}

      <div className="rounded-xl bg-[#2a2a2a] border border-white/10 overflow-x-auto">
        <table className="w-full text-left min-w-[800px] text-sm">
          <thead>
            <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3">Who</th>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Product</th>
              {visibleColumns.includes('booking') && <th className="px-4 py-3">From – to</th>}
              {visibleColumns.includes('qty') && <th className="px-4 py-3">Qty</th>}
              <th className="px-4 py-3">Amount</th>
              {visibleColumns.includes('ship') && <th className="px-4 py-3">Ship to</th>}
              <th className="px-4 py-3">Extras</th>
              <th className="px-4 py-3">Note</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (<tr key={order.id} className="border-b border-white/5">
                <td className="px-4 py-3 text-white">
                  <div>{order.customerName || '—'}</div>
                  <div className="text-gray-400 text-xs">{order.customerEmail}</div>
                  {order.customerPhone && <div className="text-gray-500 text-xs">{order.customerPhone}</div>}
                </td>
                <td className="px-4 py-3 text-gray-300">{formatWhen(order.purchasedAt)}</td>
                <td className="px-4 py-3 text-gray-300">
                  <div>{order.productName}</div>
                  <div className="text-gray-500 text-xs">{order.productId}</div>
                </td>
                {visibleColumns.includes('booking') && (<td className="px-4 py-3 text-gray-300">
                    {order.bookingFrom || order.bookingTo
                    ? `${formatWhen(order.bookingFrom)} – ${formatWhen(order.bookingTo)}`
                    : '—'}
                  </td>)}
                {visibleColumns.includes('qty') && <td className="px-4 py-3 text-gray-300">{order.quantity}</td>}
                <td className="px-4 py-3 text-gray-300">{formatMoney(order.amount, order.currency)}</td>
                {visibleColumns.includes('ship') && (<td className="px-4 py-3 text-gray-400">
                    {[order.shippingAddress?.line, order.shippingAddress?.postal, order.shippingAddress?.city]
                    .filter(Boolean)
                    .join(', ') || '—'}
                  </td>)}
                <td className="px-4 py-3 text-gray-400">
                  {[...(order.additions || []), ...(order.additionalServices || [])]
                .filter((item) => item.checked)
                .map((item) => item.name)
                .join(', ') || '—'}
                </td>
                <td className="px-4 py-3 text-gray-400">{order.customNote || '—'}</td>
                <td className="px-4 py-3">
                  <select value={order.status} onChange={(e) => handleStatus(order, e.target.value)} className="bg-[#1a1a1a] border border-white/20 text-white rounded px-2 py-1 text-xs">
                    <option value="new">New</option>
                    <option value="confirmed">Confirmed</option>
                    {preset === 'normal' && <option value="packed">Packed</option>}
                    {preset === 'normal' && <option value="shipped">Shipped</option>}
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </td>
              </tr>))}
          </tbody>
        </table>
        {orders.length === 0 && (<p className="px-4 py-8 text-gray-400 text-center">No orders stored yet. Add one to start the log — it stays on this host.</p>)}
      </div>
    </div>);
}
