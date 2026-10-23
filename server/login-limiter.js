/**
 * Failed sign-ins are limited per username and client address together, per username overall and per
 * client address (in memory; one Node process per site). Memory stays bounded: usernames are kept as
 * short hashes, addresses are capped, every key keeps at most its limit of timestamps, and the table
 * holds at most `maxKeys` keys (the oldest go first).
 */
import { createHash } from 'node:crypto';

export const MAX_USERNAME_LENGTH = 200;
export const MAX_PASSWORD_LENGTH = 1024;
const MAX_ADDRESS_LENGTH = 64;
const MAX_HASHED_INPUT = 1024;

function normalizeAddress(value) {
    let address = String(value || '').trim();
    if (address.toLowerCase().startsWith('::ffff:'))
        address = address.slice(7);
    return address.slice(0, MAX_ADDRESS_LENGTH);
}

/** True for no address (a Unix socket), loopback, private or link-local: a reverse proxy on this host or network. */
export function isProxyAddress(value) {
    const a = normalizeAddress(value).toLowerCase();
    if (!a || a === '::1' || a === 'localhost')
        return true;
    if (/^(127|10)\./.test(a) || /^192\.168\./.test(a) || /^169\.254\./.test(a))
        return true;
    const private172 = /^172\.(\d{1,3})\./.exec(a);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31)
        return true;
    return /^f[cd][0-9a-f]{0,2}:/.test(a) || /^fe[89ab][0-9a-f]?:/.test(a);
}

/** Proxies in front of the CMS that append to X-Forwarded-For (`CMS_TRUSTED_PROXY_HOPS`, default 1, 0 ignores the header). */
export function trustedProxyHops(env = process.env) {
    const hops = Number.parseInt(String(env.CMS_TRUSTED_PROXY_HOPS ?? ''), 10);
    return Number.isInteger(hops) && hops >= 0 && hops <= 5 ? hops : 1;
}

/**
 * Client address for sign-in limits. A direct connection counts by its socket address. A request from a
 * local reverse proxy counts by the X-Forwarded-For hop that proxy appended (the last one), never by the
 * first hop, which the client writes itself.
 */
export function clientIp(req, { hops = trustedProxyHops() } = {}) {
    const socket = req?.socket?.remoteAddress || '';
    if (!hops || !isProxyAddress(socket))
        return normalizeAddress(socket);
    const forwarded = String(req?.headers?.['x-forwarded-for'] || '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
    if (!forwarded.length)
        return normalizeAddress(socket);
    return normalizeAddress(forwarded[Math.max(0, forwarded.length - hops)]);
}

/** `{ username, password }` from a sign-in body, or `{ error }` when either is missing, not text or too long. */
export function readLoginBody(body) {
    const { username, password } = body && typeof body === 'object' ? body : {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password)
        return { error: 'Username and password required' };
    if (username.length > MAX_USERNAME_LENGTH || password.length > MAX_PASSWORD_LENGTH)
        return { error: 'Username or password is too long' };
    return { username, password };
}

const shortHash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 32);
const accountName = (account) => String(account || '').slice(0, MAX_HASHED_INPUT).trim().toLowerCase();

/**
 * Sliding-window limiter: `check` before verifying, `fail` on a wrong password, `succeed` on success.
 * A username is locked for one address after `maxPerPair` failures, and everywhere after `maxPerAccount`.
 */
export function createLoginLimiter({
    windowMs = 15 * 60 * 1000,
    maxPerPair = 10,
    maxPerAccount = 100,
    maxPerIp = 50,
    maxKeys = 10000,
    sweepEveryMs = 60 * 1000,
    now = () => Date.now(),
} = {}) {
    /** key → ascending failure times, at most the limit for that kind of key. */
    const failures = new Map();
    let lastSweep = now();
    const pairKey = (account, ip) => `p:${shortHash(`${accountName(account)}\n${normalizeAddress(ip)}`)}`;
    const accountKey = (account) => `a:${shortHash(accountName(account))}`;
    const ipKey = (ip) => `i:${normalizeAddress(ip)}`;
    const limitOf = (key) => (key[0] === 'p' ? maxPerPair : key[0] === 'a' ? maxPerAccount : maxPerIp);
    function recent(key) {
        const list = failures.get(key);
        if (!list)
            return [];
        const t = now();
        while (list.length && t - list[0] >= windowMs)
            list.shift();
        if (!list.length)
            failures.delete(key);
        return list;
    }
    /** Drops expired keys, at most once per `sweepEveryMs`, so a failure never scans the table. */
    function sweep() {
        const t = now();
        if (t - lastSweep < sweepEveryMs)
            return;
        lastSweep = t;
        for (const [key, list] of failures) {
            if (!list.length || t - list[list.length - 1] >= windowMs)
                failures.delete(key);
        }
    }
    function record(key, t) {
        const list = recent(key);
        list.push(t);
        const limit = limitOf(key);
        if (list.length > limit)
            list.splice(0, list.length - limit);
        failures.delete(key);
        failures.set(key, list);
    }
    function blocked(key) {
        const list = recent(key);
        if (list.length < limitOf(key))
            return null;
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((list[0] + windowMs - now()) / 1000)) };
    }
    function keysFor(account, ip) {
        const keys = [];
        if (account) {
            keys.push(pairKey(account, ip));
            keys.push(accountKey(account));
        }
        if (normalizeAddress(ip))
            keys.push(ipKey(ip));
        return keys;
    }
    return {
        check(account, ip) {
            for (const key of keysFor(account, ip)) {
                const verdict = blocked(key);
                if (verdict)
                    return verdict;
            }
            return { ok: true };
        },
        fail(account, ip) {
            sweep();
            const t = now();
            for (const key of keysFor(account, ip))
                record(key, t);
            if (failures.size > maxKeys) {
                for (const key of failures.keys()) {
                    if (failures.size <= maxKeys)
                        break;
                    failures.delete(key);
                }
            }
        },
        /** Clears the username's count for this address; the per-username and per-address counts keep running. */
        succeed(account, ip) {
            if (account)
                failures.delete(pairKey(account, ip));
        },
        /** Keys now held (tests and diagnostics). */
        keys() {
            return [...failures.keys()];
        },
    };
}

/** Express guard: true when the request may try a password, else sends 429 with Retry-After. */
export function guardLogin(limiter, req, res, account, ip = clientIp(req)) {
    const verdict = limiter.check(account, ip);
    if (verdict.ok)
        return true;
    res.set('Retry-After', String(verdict.retryAfterSec));
    res.status(429).json({ message: 'Too many sign-in attempts. Try again later.' });
    return false;
}
