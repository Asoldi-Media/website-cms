/** Failed sign-ins are limited per username and per client IP (in memory; one Node process per site). */

/** First X-Forwarded-For hop, else the socket address. */
export function clientIp(req) {
    const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    return forwarded || String(req?.socket?.remoteAddress || req?.ip || '').trim();
}
/** Sliding-window limiter: `check` before verifying, `fail` on a wrong password, `succeed` on success. */
export function createLoginLimiter({ windowMs = 15 * 60 * 1000, maxPerAccount = 10, maxPerIp = 50, now = () => Date.now() } = {}) {
    const failures = new Map();
    function recent(key) {
        const t = now();
        const list = (failures.get(key) || []).filter((ts) => t - ts < windowMs);
        if (list.length)
            failures.set(key, list);
        else
            failures.delete(key);
        return list;
    }
    function sweep() {
        if (failures.size < 5000)
            return;
        for (const key of [...failures.keys()])
            recent(key);
    }
    const accountKey = (account) => `a:${String(account || '').trim().toLowerCase()}`;
    const ipKey = (ip) => `i:${String(ip || '').trim()}`;
    function retryAfterSec(list) {
        return Math.max(1, Math.ceil((Math.min(...list) + windowMs - now()) / 1000));
    }
    return {
        check(account, ip) {
            if (account) {
                const list = recent(accountKey(account));
                if (list.length >= maxPerAccount)
                    return { ok: false, retryAfterSec: retryAfterSec(list) };
            }
            if (ip) {
                const list = recent(ipKey(ip));
                if (list.length >= maxPerIp)
                    return { ok: false, retryAfterSec: retryAfterSec(list) };
            }
            return { ok: true };
        },
        fail(account, ip) {
            sweep();
            const t = now();
            for (const key of [account ? accountKey(account) : '', ip ? ipKey(ip) : ''].filter(Boolean)) {
                failures.set(key, [...recent(key), t]);
            }
        },
        succeed(account) {
            if (account)
                failures.delete(accountKey(account));
        },
    };
}
/** Express guard: true when the request may try a password, else sends 429 with Retry-After. */
export function guardLogin(limiter, req, res, account) {
    const verdict = limiter.check(account, clientIp(req));
    if (verdict.ok)
        return true;
    res.set('Retry-After', String(verdict.retryAfterSec));
    res.status(429).json({ message: 'Too many sign-in attempts. Try again later.' });
    return false;
}
