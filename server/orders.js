/** Order log on the client host. Cancel with a status; rows are not deleted. */
export const ORDER_PRESETS = ['normal', 'service'];
export const ORDER_STATUSES = ['new', 'confirmed', 'packed', 'shipped', 'completed', 'cancelled'];
/** normal or service. */
export function normalizeOrderPreset(value, fallback = 'normal') {
    return value === 'service' ? 'service' : fallback === 'service' ? 'service' : 'normal';
}
/** Known order status, or new. */
export function normalizeOrderStatus(value, _preset = 'normal') {
    const raw = String(value || '').trim().toLowerCase();
    if (ORDER_STATUSES.includes(raw))
        return raw;
    return 'new';
}
/** Non-negative amount, or 0. */
export function normalizeAmount(value) {
    if (value == null || value === '')
        return 0;
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    const asString = String(value).trim().replace(/\s/g, '').replace(',', '.');
    const numeric = Number(asString.replace(/[^\d.-]/g, ''));
    return Number.isFinite(numeric) ? numeric : 0;
}
/** Service-order checklist rows. */
export function normalizeChecklist(value) {
    if (!Array.isArray(value))
        return [];
    return value
        .map((item) => {
        if (typeof item === 'string') {
            const name = item.trim();
            return name ? { name, checked: true, price: '' } : null;
        }
        if (!item || typeof item !== 'object')
            return null;
        const name = String(item.name || item.label || '').trim();
        if (!name)
            return null;
        return {
            name,
            checked: item.checked !== false,
            price: item.price == null || item.price === '' ? '' : String(item.price).trim(),
        };
    })
        .filter(Boolean);
}
/** Shipping address fields, empty strings when missing. */
export function normalizeShippingAddress(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    return {
        line: String(input.line || input.address || '').trim(),
        postal: String(input.postal || input.zip || '').trim(),
        city: String(input.city || '').trim(),
        country: String(input.country || '').trim(),
    };
}
/** One stored order. Incomplete rows are rejected by the caller. */
export function normalizeOrder(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const createdAt = raw.createdAt || new Date().toISOString();
    const preset = normalizeOrderPreset(raw.preset);
    const quantityRaw = Number(raw.quantity);
    const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? quantityRaw : 1;
    return {
        id: String(raw.id || ''),
        customerName: String(raw.customerName || raw.name || '').trim(),
        customerEmail: String(raw.customerEmail || raw.email || '').trim(),
        customerPhone: String(raw.customerPhone || raw.phone || raw.sms || '').trim(),
        productId: String(raw.productId || '').trim(),
        productName: String(raw.productName || '').trim(),
        quantity,
        amount: normalizeAmount(raw.amount ?? raw.income),
        currency: String(raw.currency || 'NOK').trim() || 'NOK',
        purchasedAt: String(raw.purchasedAt || raw.date || createdAt),
        customNote: String(raw.customNote || raw.note || '').trim(),
        additions: normalizeChecklist(raw.additions),
        additionalServices: normalizeChecklist(raw.additionalServices),
        status: normalizeOrderStatus(raw.status, preset),
        preset,
        bookingFrom: String(raw.bookingFrom || '').trim(),
        bookingTo: String(raw.bookingTo || '').trim(),
        shippingAddress: normalizeShippingAddress(raw.shippingAddress),
        createdAt,
        updatedAt: raw.updatedAt || createdAt,
    };
}
/** Resolve a dashboard range preset to concrete from/to dates. */
export function rangeFromPreset(range, customFrom = '', customTo = '') {
    const now = Date.now();
    const to = new Date(now);
    const from = new Date(now);
    switch (String(range || 'month')) {
        case 'day':
            from.setDate(from.getDate() - 1);
            break;
        case 'week':
            from.setDate(from.getDate() - 7);
            break;
        case 'month':
            from.setMonth(from.getMonth() - 1);
            break;
        case '6months':
            from.setMonth(from.getMonth() - 6);
            break;
        case 'year':
            from.setFullYear(from.getFullYear() - 1);
            break;
        case 'custom': {
            const start = Date.parse(customFrom);
            const end = Date.parse(customTo);
            return {
                from: Number.isFinite(start) ? new Date(start) : new Date(0),
                to: Number.isFinite(end) ? new Date(end) : to,
            };
        }
        default:
            from.setMonth(from.getMonth() - 1);
    }
    return { from, to };
}
/** purchasedAt or createdAt as epoch ms, else 0. */
export function orderPurchasedMs(order) {
    const ms = Date.parse(order?.purchasedAt || order?.createdAt || '');
    return Number.isFinite(ms) ? ms : 0;
}
/** Orders matching the admin filters and date range. */
export function filterOrders(orders, query = {}) {
    const rows = Array.isArray(orders) ? orders : [];
    const email = String(query.email || '').trim().toLowerCase();
    const name = String(query.name || '').trim().toLowerCase();
    const nameLetter = String(query.letter || '').trim().toLowerCase();
    const product = String(query.product || '').trim().toLowerCase();
    const status = String(query.status || '').trim().toLowerCase();
    const preset = String(query.preset || '').trim().toLowerCase();
    const minAmount = query.minAmount === '' || query.minAmount == null ? null : Number(query.minAmount);
    const maxAmount = query.maxAmount === '' || query.maxAmount == null ? null : Number(query.maxAmount);
    const { from, to } = rangeFromPreset(query.range || 'all', query.from, query.to);
    const useRange = query.range && query.range !== 'all';
    return rows.filter((order) => {
        if (email && !String(order.customerEmail || '').toLowerCase().includes(email))
            return false;
        if (name && !String(order.customerName || '').toLowerCase().includes(name))
            return false;
        if (nameLetter) {
            const first = String(order.customerName || '').trim().toLowerCase().slice(0, 1);
            if (first !== nameLetter.slice(0, 1))
                return false;
        }
        if (product) {
            const hay = `${order.productName || ''} ${order.productId || ''}`.toLowerCase();
            if (!hay.includes(product))
                return false;
        }
        if (status && order.status !== status)
            return false;
        if (preset && order.preset !== preset)
            return false;
        if (minAmount != null && Number.isFinite(minAmount) && Number(order.amount) < minAmount)
            return false;
        if (maxAmount != null && Number.isFinite(maxAmount) && Number(order.amount) > maxAmount)
            return false;
        if (useRange) {
            const ms = orderPurchasedMs(order);
            if (ms < from.getTime() || ms > to.getTime())
                return false;
        }
        return true;
    });
}
/** Count, revenue, and average for a list of orders. */
export function summarizeOrders(orders) {
    const rows = Array.isArray(orders) ? orders : [];
    const count = rows.length;
    const revenue = rows.reduce((sum, order) => sum + (Number(order.amount) || 0), 0);
    return {
        count,
        revenue,
        average: count ? revenue / count : 0,
    };
}
/** Orders view preset stored in settings.json. */
export function normalizeSettings(raw, fallbackPreset = 'normal') {
    const input = raw && typeof raw === 'object' ? raw : {};
    return {
        orderPreset: normalizeOrderPreset(input.orderPreset, fallbackPreset),
    };
}
