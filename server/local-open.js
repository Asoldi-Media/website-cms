/**
 * `CMS_LOCAL_OPEN=1` skips login only for a loopback or private Host.
 * Never read X-Forwarded-Host; a proxy could spoof it. Hostinger must not set the flag.
 */
export const LOCAL_DEV_INBOX_FORM_ID = 'local-dev-inbox';
/** True when CMS_LOCAL_OPEN is 1. */
export function isLocalCmsOpenEnvOn(env = process.env) {
    return String(env.CMS_LOCAL_OPEN || '').trim() === '1';
}
/** Hostname from a Host header, without port. */
export function hostnameFromHostHeader(hostHeader = '') {
    const raw = String(hostHeader || '').trim().split(',')[0].trim();
    if (!raw)
        return '';
    if (raw.startsWith('[')) {
        const end = raw.indexOf(']');
        return end > 0 ? raw.slice(1, end).toLowerCase() : raw.toLowerCase();
    }
    return raw.replace(/:\d+$/, '').toLowerCase();
}
/** localhost, loopback, or a private LAN address. */
export function isLoopbackOrPrivateHostname(host = '') {
    const h = String(host || '')
        .replace(/^\[|\]$/g, '')
        .toLowerCase();
    if (!h)
        return false;
    if (h === 'localhost' || h === '127.0.0.1' || h === '::1')
        return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h))
        return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h))
        return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(h))
        return true;
    return false;
}
/** Open admin login only when the env flag is on and Host is private. */
export function isLocalCmsOpenRequest(req, env = process.env) {
    if (!isLocalCmsOpenEnvOn(env))
        return false;
    const header = req?.headers?.host || (typeof req?.get === 'function' ? req.get('host') : '') || '';
    return isLoopbackOrPrivateHostname(hostnameFromHostHeader(header));
}
/** Synthetic inbox binding for unbound forms on a local test site. */
export function localDevInboxForm(id = LOCAL_DEV_INBOX_FORM_ID) {
    return {
        id: String(id || LOCAL_DEV_INBOX_FORM_ID),
        label: 'Local test form',
        purpose: 'contact',
        destination: { type: 'inbox' },
        fieldMap: {},
        fields: [],
        pages: [],
        reviewed: true,
    };
}
