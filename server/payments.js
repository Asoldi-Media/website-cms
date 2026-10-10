/** Stripe Connect and PayPal seller ids stored on the host. Live charges need platform keys. */
export function stripeConfigured() {
    return Boolean(String(process.env.STRIPE_SECRET_KEY || '').trim() && String(process.env.STRIPE_CONNECT_CLIENT_ID || '').trim());
}
/** True when PayPal platform keys are present in the environment. */
export function paypalConfigured() {
    return Boolean(String(process.env.PAYPAL_CLIENT_ID || '').trim() && String(process.env.PAYPAL_SECRET || '').trim());
}
function normalizeProvider(raw, extra = {}) {
    const row = raw && typeof raw === 'object' ? raw : {};
    return {
        enabled: row.enabled === true,
        connected: row.connected === true,
        accountId: String(row.accountId || row.merchantId || '').trim(),
        status: String(row.status || (row.connected ? 'complete' : 'not_started')),
        livemode: row.livemode === true,
        updatedAt: row.updatedAt || '',
        ...extra,
    };
}
/** Stored Stripe Connect and PayPal seller settings. */
export function normalizePayments(raw) {
    const row = raw && typeof raw === 'object' ? raw : {};
    const createdAt = row.createdAt || new Date().toISOString();
    return {
        stripe: normalizeProvider(row.stripe, {
            platformReady: stripeConfigured(),
        }),
        paypal: normalizeProvider(row.paypal, {
            merchantId: String(row.paypal?.merchantId || row.paypal?.accountId || '').trim(),
            platformReady: paypalConfigured(),
        }),
        createdAt,
        updatedAt: row.updatedAt || createdAt,
    };
}
/** Payment settings the admin UI is allowed to see. */
export function publicPayments(settings) {
    const row = normalizePayments(settings);
    return {
        stripe: {
            enabled: row.stripe.enabled,
            connected: row.stripe.connected,
            accountId: row.stripe.accountId,
            status: row.stripe.status,
            platformReady: stripeConfigured(),
            setupHint: stripeConfigured()
                ? 'Stripe Connect Standard is configured on this host. Save the connected account id after onboarding.'
                : 'Create an Asoldi Stripe Connect platform, then set STRIPE_SECRET_KEY and STRIPE_CONNECT_CLIENT_ID on this host.',
        },
        paypal: {
            enabled: row.paypal.enabled,
            connected: row.paypal.connected,
            merchantId: row.paypal.merchantId || row.paypal.accountId,
            status: row.paypal.status,
            platformReady: paypalConfigured(),
            setupHint: paypalConfigured()
                ? 'PayPal partner credentials are present. Save the merchant id after the seller connects.'
                : 'Create an Asoldi PayPal partner account, then set PAYPAL_CLIENT_ID and PAYPAL_SECRET on this host.',
        },
    };
}
