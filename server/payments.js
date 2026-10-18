/** Local per-site payment switches. Seller accounts live on the Asoldi hub (Stripe Connect / PayPal partner); see shop-checkout.js. */
function normalizeProvider(raw) {
    const row = raw && typeof raw === 'object' ? raw : {};
    return { enabled: row.enabled !== false };
}
/** Stored per-provider on/off switches. */
export function normalizePayments(raw) {
    const row = raw && typeof raw === 'object' ? raw : {};
    const createdAt = row.createdAt || new Date().toISOString();
    return {
        stripe: normalizeProvider(row.stripe),
        paypal: normalizeProvider(row.paypal),
        createdAt,
        updatedAt: row.updatedAt || createdAt,
    };
}
