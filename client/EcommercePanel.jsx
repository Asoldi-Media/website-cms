/** Admin ecommerce tab. Switches between products, orders, and payment setup. */
import { useState } from 'react';
import { ProductsPanel } from './ProductsPanel.jsx';
import { OrdersPanel } from './OrdersPanel.jsx';
import { PaymentsPanel } from './PaymentsPanel.jsx';
/** Products, orders, and payment setup. */
export function EcommercePanel({ catalogType, authHeaders, loading, setLoading }) {
    const [page, setPage] = useState('products');
    return (<div className="max-w-6xl">
      <h1 className="text-2xl font-bold text-white mb-2">Ecommerce</h1>
      <div className="flex flex-wrap gap-2 mb-6 border-b border-white/10 pb-3">
        {[
            { id: 'products', label: 'Products' },
            { id: 'orders', label: 'Orders / Ordre' },
            { id: 'payments', label: 'Payment setup' },
        ].map((item) => (<button key={item.id} type="button" onClick={() => setPage(item.id)} className={`px-4 py-2 rounded-t-lg text-sm font-medium ${page === item.id ? 'bg-[#2a2a2a] text-white border border-white/10 border-b-transparent' : 'text-gray-400 hover:text-white'}`}>
            {item.label}
          </button>))}
      </div>
      {page === 'products' && (<ProductsPanel catalogType={catalogType} authHeaders={authHeaders} loading={loading} setLoading={setLoading}/>)}
      {page === 'orders' && (<OrdersPanel catalogType={catalogType} authHeaders={authHeaders} loading={loading} setLoading={setLoading}/>)}
      {page === 'payments' && (<PaymentsPanel authHeaders={authHeaders} loading={loading} setLoading={setLoading}/>)}
    </div>);
}
