/**
 * Failed sign-ins are limited per username and client address together, per username overall and per
 * client address (in memory; one Node process per site). An attempt is counted when it starts, before
 * the password check, and only a correct password takes it back, so parallel requests cannot pass the
 * limits together. At most `maxInFlight` password checks run at once per username and per address.
 * Memory stays bounded: usernames are kept as short hashes, addresses are capped, every key keeps at
 * most its limit of timestamps, and the table holds at most `maxKeys` keys (the oldest go first).
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

function readClientAddress(req, hops) {
    const socket = req?.socket?.remoteAddress || '';
    const forwarded = String(req?.headers?.['x-forwarded-for'] || '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
    const forwardedFor = forwarded.length > 0;
    if (!isProxyAddress(socket))
        return { address: normalizeAddress(socket), mode: 'direct', forwardedFor };
    if (!hops || !forwardedFor)
        return { address: normalizeAddress(socket), mode: 'shared-proxy', forwardedFor };
    return { address: normalizeAddress(forwarded[Math.max(0, forwarded.length - hops)]), mode: 'forwarded', forwardedFor };
}

/**
 * Client address for sign-in limits. A direct connection counts by its socket address. A request from a
 * local reverse proxy counts by the X-Forwarded-For hop that proxy appended (the last one), never by the
 * first hop, which the client writes itself.
 */
export function clientIp(req, { hops = trustedProxyHops() } = {}) {
    return readClientAddress(req, hops).address;
}

/**
 * Where the sign-in limits take the client address from, without the address itself (for the hub heartbeat):
 * `direct` (the connecting address is not local, so it counts as the client), `forwarded` (the hop a local
 * proxy appended) or `shared-proxy` (a local proxy that sent no usable header, so every visitor counts as one
 * address). `forwardedFor` says whether the request carried X-Forwarded-For; `direct` with the header usually
 * means a proxy on a public address, and then every visitor shares that address too.
 */
export function clientAddressMode(req, { hops = trustedProxyHops() } = {}) {
    const { mode, forwardedFor } = readClientAddress(req, hops);
    return { mode, forwardedFor };
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
 * Sliding-window limiter. `begin(account, ip)` runs before the password check, with no await in between:
 * it refuses when a limit is reached or `maxInFlight` checks for that username or address are already
 * running, and otherwise counts the attempt at once and returns a ticket. Settle the ticket once:
 * `ticket.fail()` keeps the attempt counted, `ticket.succeed()` takes it back and clears the username's
 * count for that address. A username is locked for one address after `maxPerPair` attempts, and
 * everywhere after `maxPerAccount`. `check`, `fail` and `succeed` are the same steps without a ticket.
 */
export function createLoginLimiter({
    windowMs = 15 * 60 * 1000,
    maxPerPair = 10,
    maxPerAccount = 100,
    maxPerIp = 50,
    maxKeys = 10000,
    maxInFlight = 2,
    sweepEveryMs = 60 * 1000,
    now = () => Date.now(),
} = {}) {
    /** key → ascending attempt times (failed, or still being checked), at most the limit for that kind of key. */
    const failures = new Map();
    /** username or address key → password checks running now; a key leaves when its last check settles. */
    const running = new Map();
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
    /** Drops expired keys, at most once per `sweepEveryMs`, so an attempt never scans the table. */
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
    /** Takes back one attempt counted at `t` (it may already have left the window or the table). */
    function unrecord(key, t) {
        const list = failures.get(key);
        if (!list)
            return;
        const at = list.lastIndexOf(t);
        if (at >= 0)
            list.splice(at, 1);
        if (!list.length)
            failures.delete(key);
    }
    function capKeys() {
        for (const key of failures.keys()) {
            if (failures.size <= maxKeys)
                break;
            failures.delete(key);
        }
    }
    function blocked(key) {
        const list = recent(key);
        if (list.length < limitOf(key))
            return null;
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((list[0] + windowMs - now()) / 1000)) };
    }
    function firstBlock(keys) {
        for (const key of keys) {
            const verdict = blocked(key);
            if (verdict)
                return verdict;
        }
        return null;
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
    /** Keys whose running checks are capped: the username and the address. */
    const runKeysFor = (account, ip) => keysFor(account, ip).filter((key) => key[0] !== 'p');
    function release(keys) {
        for (const key of keys) {
            const n = (running.get(key) || 0) - 1;
            if (n > 0)
                running.set(key, n);
            else
                running.delete(key);
        }
    }
    return {
        /** Counts the attempt now, or refuses with `{ ok: false, retryAfterSec }`. */
        begin(account, ip) {
            sweep();
            const keys = keysFor(account, ip);
            const verdict = firstBlock(keys);
            if (verdict)
                return verdict;
            const runKeys = runKeysFor(account, ip);
            if (runKeys.some((key) => (running.get(key) || 0) >= maxInFlight))
                return { ok: false, retryAfterSec: 1, busy: true };
            const t = now();
            for (const key of keys)
                record(key, t);
            capKeys();
            for (const key of runKeys)
                running.set(key, (running.get(key) || 0) + 1);
            let settled = false;
            const settle = () => {
                if (settled)
                    return false;
                settled = true;
                release(runKeys);
                return true;
            };
            return {
                ok: true,
                ticket: {
                    /** Wrong password, or the check broke off: the attempt stays counted. No-op once settled. */
                    fail() {
                        settle();
                    },
                    /** Right password: the attempt is taken back and the username's count for this address is cleared. */
                    succeed() {
                        if (!settle())
                            return;
                        for (const key of keys)
                            unrecord(key, t);
                        if (account)
                            failures.delete(pairKey(account, ip));
                    },
                },
            };
        },
        check(account, ip) {
            return firstBlock(keysFor(account, ip)) || { ok: true };
        },
        fail(account, ip) {
            sweep();
            const t = now();
            for (const key of keysFor(account, ip))
                record(key, t);
            capKeys();
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
        /** Usernames and addresses with a password check running now (tests and diagnostics). */
        running() {
            return running.size;
        },
    };
}

/**
 * Express guard, called before any await: returns a ticket when the request may try a password, else sends
 * 429 with Retry-After and returns null. Settle the ticket with `succeed()` or `fail()`, and also call
 * `fail()` in a `finally` so an error never leaves a check running (it is a no-op after a settle).
 */
export function guardLogin(limiter, req, res, account, ip = clientIp(req)) {
    const verdict = limiter.begin(account, ip);
    if (verdict.ok)
        return verdict.ticket;
    res.set('Retry-After', String(verdict.retryAfterSec));
    res.status(429).json({ message: 'Too many sign-in attempts. Try again later.' });
    return null;
}
