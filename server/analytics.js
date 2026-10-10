/** Optional GA4 DNS check. The public snippet settings live in analytics.json. */
import { randomBytes } from 'node:crypto';
import { promises as dns } from 'node:dns';
/** Random token the site publishes as a DNS TXT record. */
export function createDnsToken() {
    return `asoldi-site=${randomBytes(12).toString('hex')}`;
}
/** Stored GA4 settings with defaults filled in. */
export function normalizeAnalytics(raw, { domain = '', measurementId = '', propertyId = '' } = {}) {
    const row = raw && typeof raw === 'object' ? raw : {};
    const createdAt = row.createdAt || new Date().toISOString();
    return {
        measurementId: String(row.measurementId || measurementId || process.env.GA4_MEASUREMENT_ID || '').trim(),
        propertyId: String(row.propertyId || propertyId || process.env.GA4_PROPERTY_ID || '').trim(),
        domain: String(row.domain || domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0],
        dnsTxtName: String(row.dnsTxtName || '_asoldi-analytics').trim() || '_asoldi-analytics',
        dnsTxtValue: String(row.dnsTxtValue || '').trim() || createDnsToken(),
        verified: row.verified === true,
        verifiedAt: String(row.verifiedAt || ''),
        lastError: String(row.lastError || ''),
        createdAt,
        updatedAt: row.updatedAt || createdAt,
    };
}
/** Fields the admin UI needs to show the GA4 snippet. */
export function publicAnalyticsSnippet(settings) {
    if (!settings?.verified || !settings.measurementId) {
        return { enabled: false, measurementId: '', gtag: '' };
    }
    return {
        enabled: true,
        measurementId: settings.measurementId,
        gtag: settings.measurementId,
    };
}
/** True when the site DNS TXT contains this CMS token. */
export async function verifyAnalyticsDns(settings, lookupTxt = dns.resolveTxt) {
    const host = `${settings.dnsTxtName}.${settings.domain}`.replace(/^\.+/, '');
    if (!settings.domain) {
        return { ...settings, verified: false, lastError: 'Domain is required for DNS verification', updatedAt: new Date().toISOString() };
    }
    try {
        const records = await lookupTxt(host);
        const flat = records.flat().map((value) => String(value || '').trim());
        const ok = flat.some((value) => value === settings.dnsTxtValue || value.includes(settings.dnsTxtValue));
        const now = new Date().toISOString();
        return {
            ...settings,
            verified: ok,
            verifiedAt: ok ? now : settings.verifiedAt,
            lastError: ok ? '' : `TXT ${host} did not contain ${settings.dnsTxtValue}`,
            updatedAt: now,
        };
    }
    catch (error) {
        return {
            ...settings,
            verified: false,
            lastError: error?.message || 'DNS lookup failed',
            updatedAt: new Date().toISOString(),
        };
    }
}
