/** Signed admin and staff session tokens: HMAC-SHA256, constant-time check, every token expires. */
import { createHmac, timingSafeEqual } from 'crypto';

export const LOGIN_TOKEN_MS = 7 * 24 * 60 * 60 * 1000;
export const LOCAL_TOKEN_MS = 12 * 60 * 60 * 1000;

/** Constant-time string compare; false for empty or different-length input. */
export function safeEqual(left, right) {
    const a = Buffer.from(String(left ?? ''), 'utf8');
    const b = Buffer.from(String(right ?? ''), 'utf8');
    if (!a.length || a.length !== b.length)
        return false;
    return timingSafeEqual(a, b);
}
/** Signer bound to one secret. `now` is injectable for tests. */
export function createTokenSigner(secret, { now = () => Date.now() } = {}) {
    if (!secret)
        throw new Error('Token signer needs a secret.');
    const mac = (data) => createHmac('sha256', secret).update(data).digest('hex');
    /** Sign a payload; `at` and `exp` are filled in (default lifetime 7 days). */
    function sign(payload, ttlMs = LOGIN_TOKEN_MS) {
        const at = Number(payload?.at) || now();
        const exp = Number(payload?.exp) || at + ttlMs;
        const data = JSON.stringify({ ...payload, at, exp });
        return Buffer.from(JSON.stringify({ data, sig: mac(data) })).toString('base64url');
    }
    /** Payload of a valid, unexpired token, or null. A token without `exp` lives 7 days from `at`. */
    function verify(token) {
        let raw;
        try {
            raw = JSON.parse(Buffer.from(String(token || ''), 'base64url').toString('utf8'));
        }
        catch {
            return null;
        }
        if (typeof raw?.data !== 'string' || typeof raw?.sig !== 'string')
            return null;
        if (!safeEqual(mac(raw.data), raw.sig))
            return null;
        let payload;
        try {
            payload = JSON.parse(raw.data);
        }
        catch {
            return null;
        }
        if (!payload || typeof payload !== 'object')
            return null;
        const exp = Number(payload.exp) || Number(payload.at) + LOGIN_TOKEN_MS;
        if (!Number.isFinite(exp) || now() > exp)
            return null;
        return payload;
    }
    return { sign, verify };
}
