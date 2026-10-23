/** Shop pages a site can switch off, and how the admin menu reads that switch. Plain JS so node tests can import it. */

export const SHOP_EXTRA_PAGES = Object.freeze([
    { id: 'bookings', label: 'Timer' },
    { id: 'discounts', label: 'Rabatter' },
    { id: 'giftcards', label: 'Gavekort' },
    { id: 'subscriptions', label: 'Abonnement' },
    { id: 'reviews', label: 'Omtaler' },
    { id: 'abandoned', label: 'Forlatte kasser' },
]);

/** Before shop settings load, no optional page shows. */
export const NO_SHOP_MODULES = Object.freeze(Object.fromEntries(SHOP_EXTRA_PAGES.map((page) => [page.id, false])));

/** Modules read the way the server reads them: a module never set (absent or null) is on; false or 0 stays off. */
export function shopModulesFrom(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    return Object.fromEntries(SHOP_EXTRA_PAGES.map(({ id }) => [id, input[id] === undefined || input[id] === null ? true : Boolean(input[id])]));
}

/** Optional shop pages the admin menu lists, in menu order. */
export function visibleShopPages(modules) {
    return SHOP_EXTRA_PAGES.filter((page) => Boolean(modules?.[page.id]));
}

/** True when `page` is an optional shop page that is switched off. */
export function shopPageBlocked(page, modules) {
    return SHOP_EXTRA_PAGES.some((item) => item.id === page) && !modules?.[page];
}
