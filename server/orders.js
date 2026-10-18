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
const PAYMENT_PROVIDERS = ['stripe', 'paypal', 'giftcard', 'reserve', 'manual'];
const PAYMENT_STATUSES = ['paid', 'pending', 'partially_refunded', 'refunded'];
function minor(value) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? n : 0;
}
function text(value, max = 300) {
    return String(value ?? '').trim().slice(0, max);
}
function rows(value, max = 200) {
    return Array.isArray(value) ? value.filter((r) => r && typeof r === 'object').slice(0, max) : [];
}
function normalizeOrderLine(raw) {
    return {
        key: text(raw.key, 400),
        productId: text(raw.productId, 80),
        variantId: text(raw.variantId, 60) || 'default',
        name: text(raw.name, 200),
        variantLabel: text(raw.variantLabel, 120),
        extras: Array.isArray(raw.extras) ? raw.extras.map((e) => text(e, 80)).filter(Boolean) : [],
        sku: text(raw.sku, 64),
        kind: text(raw.kind, 20) || 'physical',
        quantity: Math.max(1, minor(raw.quantity) || 1),
        rate: Number(raw.rate) || 0,
        unitGrossMinor: minor(raw.unitGrossMinor),
        discountMinor: minor(raw.discountMinor),
        lineTotalMinor: minor(raw.lineTotalMinor),
        taxMinor: minor(raw.taxMinor),
        refundedQty: Math.max(0, minor(raw.refundedQty)),
        fulfilledQty: Math.max(0, minor(raw.fulfilledQty)),
        booking: raw.booking && typeof raw.booking === 'object' ? { start: text(raw.booking.start, 40), end: text(raw.booking.end, 40), staffId: text(raw.booking.staffId, 60), staffName: text(raw.booking.staffName, 80), bookingId: text(raw.booking.bookingId, 60) } : null,
        giftcard: raw.giftcard && typeof raw.giftcard === 'object' ? { amount: Number(raw.giftcard.amount) || 0, recipientName: text(raw.giftcard.recipientName, 80), recipientEmail: text(raw.giftcard.recipientEmail, 160), message: text(raw.giftcard.message, 300), giftcardId: text(raw.giftcard.giftcardId, 60) } : null,
        recurring: raw.recurring && typeof raw.recurring === 'object' ? { interval: text(raw.recurring.interval, 10), intervalCount: minor(raw.recurring.intervalCount) || 1, trialDays: minor(raw.recurring.trialDays) } : null,
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
    const fulfillment = raw.fulfillment && typeof raw.fulfillment === 'object' ? raw.fulfillment : {};
    return {
        number: text(raw.number, 30),
        lines: rows(raw.lines).map(normalizeOrderLine),
        subtotalMinor: minor(raw.subtotalMinor),
        discountMinor: minor(raw.discountMinor),
        shippingMinor: minor(raw.shippingMinor),
        taxMinor: minor(raw.taxMinor),
        totalMinor: minor(raw.totalMinor),
        amountPaidMinor: minor(raw.amountPaidMinor),
        refundedMinor: minor(raw.refundedMinor),
        discounts: rows(raw.discounts, 20).map((d) => ({ id: text(d.id, 60), code: text(d.code, 40), title: text(d.title, 120), amountMinor: minor(d.amountMinor), freeShipping: Boolean(d.freeShipping) })),
        taxLines: rows(raw.taxLines, 10).map((t) => ({ rate: Number(t.rate) || 0, netMinor: minor(t.netMinor), taxMinor: minor(t.taxMinor) })),
        shippingMethod: raw.shippingMethod && typeof raw.shippingMethod === 'object' ? { id: text(raw.shippingMethod.id, 60), name: text(raw.shippingMethod.name, 80), type: text(raw.shippingMethod.type, 20) } : null,
        giftcardPayments: rows(raw.giftcardPayments, 5).map((g) => ({ id: text(g.id, 60), last4: text(g.last4, 4), amountMinor: minor(g.amountMinor) })),
        fulfillment: {
            status: ['unfulfilled', 'partial', 'fulfilled'].includes(fulfillment.status) ? fulfillment.status : 'unfulfilled',
            shipments: rows(fulfillment.shipments, 50).map((s) => ({ id: text(s.id, 60), at: text(s.at, 40), carrier: text(s.carrier, 60), trackingNumber: text(s.trackingNumber, 80), trackingUrl: text(s.trackingUrl, 500), lines: rows(s.lines, 200).map((l) => ({ key: text(l.key, 400), quantity: minor(l.quantity) })) })),
        },
        refunds: rows(raw.refunds, 50).map((r) => ({ id: text(r.id, 60), at: text(r.at, 40), amountMinor: minor(r.amountMinor), shippingMinor: minor(r.shippingMinor), lines: rows(r.lines, 200).map((l) => ({ key: text(l.key, 400), quantity: minor(l.quantity), amountMinor: minor(l.amountMinor) })), reason: text(r.reason, 300), creditNoteNumber: text(r.creditNoteNumber, 30), providerRefundId: text(r.providerRefundId, 120), giftcardMinor: minor(r.giftcardMinor), restocked: Boolean(r.restocked), by: text(r.by, 80) })),
        documents: rows(raw.documents, 50).map((d) => ({ kind: text(d.kind, 30), number: text(d.number, 30), at: text(d.at, 40), ok: d.ok !== false, error: text(d.error, 200) })),
        events: rows(raw.events, 200).map((e) => ({ at: text(e.at, 40), type: text(e.type, 40), text: text(e.text, 500), by: text(e.by, 80) })),
        country: text(raw.country, 2).toUpperCase(),
        consent: Boolean(raw.consent),
        bookingIds: Array.isArray(raw.bookingIds) ? raw.bookingIds.map((b) => text(b, 60)).filter(Boolean) : [],
        subscriptionId: text(raw.subscriptionId, 60),
        downloadIds: Array.isArray(raw.downloadIds) ? raw.downloadIds.map((b) => text(b, 60)).filter(Boolean) : [],
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
        paymentProvider: PAYMENT_PROVIDERS.includes(raw.paymentProvider) ? raw.paymentProvider : '',
        paymentStatus: PAYMENT_STATUSES.includes(raw.paymentStatus) ? raw.paymentStatus : '',
        paymentRef: String(raw.paymentRef || '').trim(),
        checkoutRef: String(raw.checkoutRef || '').trim(),
        providerCheckoutId: text(raw.providerCheckoutId, 200),
        stripeCustomerId: text(raw.stripeCustomerId, 80),
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
            const hay = `${order.productName || ''} ${order.productId || ''} ${order.number || ''} ${(order.lines || []).map((l) => `${l.name} ${l.sku}`).join(' ')}`.toLowerCase();
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
