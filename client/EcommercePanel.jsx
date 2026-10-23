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

/** Shop admin. The shell passes `page`; without it, the old tab row is the fallback. */
export function EcommercePanel({ catalogType, authHeaders, loading, setLoading, isOwner = true, page, onPage }) {
  const [localPage, setLocalPage] = useState(() => (new URLSearchParams(window.location.search).has('payments') ? 'payments' : 'overview'));
  const current = page || localPage;
  const setPage = onPage || setLocalPage;
  const shared = { authHeaders, loading, setLoading, isOwner };
  const title = PAGES.find((item) => item.id === current)?.label || 'Nettbutikk';

  return (
    <div className="max-w-6xl">
      <h1 className="text-xl font-semibold text-[#1a1c1e] mb-4">{title}</h1>
      {!page && (
        <div className="flex flex-wrap gap-1 mb-6 border-b border-[#e3e3e3] pb-3">
          {PAGES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setPage(item.id)}
              className={`px-3 py-2 rounded-lg text-sm font-medium ${
                current === item.id ? 'bg-white text-[#1a1c1e] border border-[#e3e3e3] shadow-sm' : 'text-[#6d7175] hover:text-[#1a1c1e]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      {current === 'overview' && <ShopOverviewPanel {...shared} onOpen={setPage} />}
      {current === 'products' && <ProductsPanel catalogType={catalogType} {...shared} />}
      {current === 'orders' && <OrdersPanel catalogType={catalogType} {...shared} />}
      {current === 'bookings' && <ShopBookingsPanel {...shared} />}
      {current === 'customers' && <ShopCustomersPanel {...shared} />}
      {current === 'discounts' && <ShopDiscountsPanel {...shared} />}
      {current === 'giftcards' && <ShopGiftcardsPanel {...shared} />}
      {current === 'subscriptions' && <ShopSubscriptionsPanel {...shared} />}
      {current === 'reviews' && <ShopReviewsPanel {...shared} />}
      {current === 'abandoned' && <ShopAbandonedPanel {...shared} />}
      {current === 'settings' && <ShopSettingsPanel {...shared} />}
      {current === 'files' && <ShopFilesPanel {...shared} />}
      {current === 'payments' && <PaymentsPanel {...shared} />}
    </div>
  );
}
