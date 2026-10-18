/** Admin shop tab. Switches between overview, products, orders, shop operations, and settings. */
import { useState } from 'react';
import { ProductsPanel } from './ProductsPanel.jsx';
import { OrdersPanel } from './OrdersPanel.jsx';
import { PaymentsPanel } from './PaymentsPanel.jsx';
import { ShopAbandonedPanel, ShopBookingsPanel, ShopCustomersPanel, ShopOverviewPanel, ShopReviewsPanel, ShopSubscriptionsPanel } from './ShopOpsPanels.jsx';
import { ShopDiscountsPanel, ShopGiftcardsPanel } from './ShopMarketingPanels.jsx';
import { ShopFilesPanel, ShopSettingsPanel } from './ShopSettingsPanel.jsx';

const PAGES = [
  { id: 'overview', label: 'Oversikt' },
  { id: 'products', label: 'Produkter' },
  { id: 'orders', label: 'Ordrer' },
  { id: 'bookings', label: 'Timer' },
  { id: 'customers', label: 'Kunder' },
  { id: 'discounts', label: 'Rabatter' },
  { id: 'giftcards', label: 'Gavekort' },
  { id: 'subscriptions', label: 'Abonnement' },
  { id: 'reviews', label: 'Omtaler' },
  { id: 'abandoned', label: 'Forlatte kasser' },
  { id: 'settings', label: 'Butikkinnstillinger' },
  { id: 'files', label: 'Filer og import' },
  { id: 'payments', label: 'Betaling' },
];

/** Shop admin with one sub-page per area. */
export function EcommercePanel({ catalogType, authHeaders, loading, setLoading, isOwner = true }) {
  const [page, setPage] = useState(() => (new URLSearchParams(window.location.search).has('payments') ? 'payments' : 'overview'));
  const shared = { authHeaders, loading, setLoading, isOwner };

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-bold text-white mb-2">Nettbutikk</h1>
      <div className="flex flex-wrap gap-1 mb-6 border-b border-white/10 pb-3">
        {PAGES.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setPage(item.id)}
            className={`px-3 py-2 rounded-t-lg text-sm font-medium ${
              page === item.id ? 'bg-[#2a2a2a] text-white border border-white/10 border-b-transparent' : 'text-gray-400 hover:text-white'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      {page === 'overview' && <ShopOverviewPanel {...shared} onOpen={setPage} />}
      {page === 'products' && <ProductsPanel catalogType={catalogType} {...shared} />}
      {page === 'orders' && <OrdersPanel catalogType={catalogType} {...shared} />}
      {page === 'bookings' && <ShopBookingsPanel {...shared} />}
      {page === 'customers' && <ShopCustomersPanel {...shared} />}
      {page === 'discounts' && <ShopDiscountsPanel {...shared} />}
      {page === 'giftcards' && <ShopGiftcardsPanel {...shared} />}
      {page === 'subscriptions' && <ShopSubscriptionsPanel {...shared} />}
      {page === 'reviews' && <ShopReviewsPanel {...shared} />}
      {page === 'abandoned' && <ShopAbandonedPanel {...shared} />}
      {page === 'settings' && <ShopSettingsPanel {...shared} />}
      {page === 'files' && <ShopFilesPanel {...shared} />}
      {page === 'payments' && <PaymentsPanel {...shared} />}
    </div>
  );
}
