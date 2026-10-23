/**
 * Admin sign-in hardening for the client CMS.
 *
 * - Tokens: HMAC compared in constant time; every token carries `exp`.
 * - Logins: the username and password must be text of a bounded length. Attempts
 *   are limited per account and per client IP. The client IP is the
 *   X-Forwarded-For hop the local proxy appended (CMS_TRUSTED_PROXY_HOPS).
 * - Public config: only an explicit list of keys reaches GET /api/cms/config.
 * - First admin: never a built-in password; a random one is written to
 *   <data>/cms/private/initial-admin.json until the hub sets the real one.
 * - New passwords: 8 to 1024 characters (not counting spaces at the ends) and not a known default.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { join } from 'path';
import { ensurePrivateDir, writePrivateFile } from './secret.js';

export const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

export function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ''), 'utf8');
  const b = Buffer.from(String(right ?? ''), 'utf8');
  if (!a.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** A token is live until `exp`; a token without `exp` lives `ttlMs` from `at`. */
export function isTokenLive(payload, now = Date.now(), ttlMs = TOKEN_TTL_MS) {
  if (!payload || typeof payload !== 'object') return false;
  const at = Number(payload.at);
  const exp = payload.exp === undefined ? at + ttlMs : Number(payload.exp);
  if (!Number.isFinite(exp)) return false;
  if (Number.isFinite(at) && at > now + CLOCK_SKEW_MS) return false;
  return now < exp;
}

export function createTokenSigner(secret, { ttlMs = TOKEN_TTL_MS, now = () => Date.now() } = {}) {
  if (!secret) throw new Error('createTokenSigner: secret is required');
  const hmac = (data) => createHmac('sha256', secret).update(data).digest('hex');
  return {
    sign(payload) {
      const at = Number(payload?.at) || now();
      const data = JSON.stringify({ ...payload, at, exp: at + ttlMs });
      return Buffer.from(JSON.stringify({ data, sig: hmac(data) })).toString('base64url');
    },
    verify(token) {
      try {
        const raw = JSON.parse(Buffer.from(String(token || ''), 'base64url').toString());
        if (typeof raw?.data !== 'string' || typeof raw?.sig !== 'string') return null;
        if (!safeEqual(hmac(raw.data), raw.sig)) return null;
        const payload = JSON.parse(raw.data);
        return isTokenLive(payload, now(), ttlMs) ? payload : null;
      } catch {
        return null;
      }
    },
  };
}

export const MAX_USERNAME_LENGTH = 200;
export const MAX_PASSWORD_LENGTH = 1024;
const MAX_ADDRESS_LENGTH = 64;
const MAX_HASHED_INPUT = 1024;

/** `{ username, password }` from a sign-in body, or `{ error }` when either is missing, not text or too long. */
export function readLoginBody(body) {
  const { username, password } = body && typeof body === 'object' ? body : {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return { error: 'Username and password required' };
  }
  if (username.length > MAX_USERNAME_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return { error: 'Username or password is too long' };
  }
  return { username, password };
}

function normalizeAddress(value) {
  let address = String(value ?? '').trim();
  if (address.toLowerCase().startsWith('::ffff:')) address = address.slice(7);
  return address.slice(0, MAX_ADDRESS_LENGTH);
}

/** True for no address (a Unix socket), loopback, private or link-local: a reverse proxy on this host or network. */
export function isProxyAddress(value) {
  const a = normalizeAddress(value).toLowerCase();
  if (!a || a === '::1' || a === 'localhost') return true;
  if (/^(127|10)\./.test(a) || /^192\.168\./.test(a) || /^169\.254\./.test(a)) return true;
  const private172 = /^172\.(\d{1,3})\./.exec(a);
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return true;
  return /^f[cd][0-9a-f]{0,2}:/.test(a) || /^fe[89ab][0-9a-f]?:/.test(a);
}

/** Proxies in front of the CMS that append to X-Forwarded-For (`CMS_TRUSTED_PROXY_HOPS`, default 1, 0 ignores the header). */
export function trustedProxyHops(env = process.env) {
  const hops = Number.parseInt(String(env?.CMS_TRUSTED_PROXY_HOPS ?? ''), 10);
  return Number.isInteger(hops) && hops >= 0 && hops <= 5 ? hops : 1;
}

/**
 * Client address for the sign-in limits (the same rule as CMS 2.2). A direct connection counts by its
 * socket address. A request from a local reverse proxy counts by the X-Forwarded-For hop that proxy
 * appended (`hops` from the right), never by the first hop, which the client writes itself. A local
 * proxy that sends no X-Forwarded-For (or `hops` 0) counts as its own address.
 */
export function clientIpFromRequest(req, { hops = trustedProxyHops() } = {}) {
  const socket = req?.socket?.remoteAddress || '';
  if (!isProxyAddress(socket)) return normalizeAddress(socket);
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!hops || !forwarded.length) return normalizeAddress(socket);
  return normalizeAddress(forwarded[Math.max(0, forwarded.length - hops)]);
}

/**
 * Sliding-window sign-in limiter (in memory, one Node process per site).
 *
 * - `begin(account, ip, { knownAccount })` runs before the password check: it refuses when a limit is
 *   reached, and otherwise counts the attempt at once, so parallel requests cannot pass the limit
 *   together. `ticket.succeed()` takes the attempt back and clears the account's failures; an attempt
 *   that is never settled stays counted as a failure.
 * - `knownAccount` marks the account key of a real account (the admin or a user). The table holds at
 *   most `maxKeys` keys: when it is full, expired keys go first, then IP keys and keys for usernames
 *   that do not exist (oldest first). A real account's key is never dropped inside its window; when
 *   only those are left, new attempts are refused until room frees up.
 * - Memory stays bounded: usernames are kept as short hashes, addresses are capped, every key keeps at
 *   most its limit of timestamps, and the table holds at most `maxKeys` keys.
 * - `check`, `fail` and `succeed` are the same steps without a ticket.
 */
const shortHash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 32);
const accountName = (account) => String(account ?? '').slice(0, MAX_HASHED_INPUT).trim().toLowerCase();

export function createLoginLimiter({
  windowMs = 15 * 60 * 1000,
  maxPerAccount = 10,
  maxPerIp = 50,
  maxKeys = 10000,
  now = () => Date.now(),
} = {}) {
  /** key -> { times: ascending attempt times inside the window, known: true for a real account's key } */
  const entries = new Map();

  const accountKey = (name) => `a:${shortHash(name)}`;
  const ipKey = (ip) => `i:${normalizeAddress(ip)}`;
  const limitOf = (key) => (key.startsWith('a:') ? maxPerAccount : maxPerIp);

  function keysFor(account, ip) {
    const keys = [];
    const name = accountName(account);
    if (name) keys.push(accountKey(name));
    if (normalizeAddress(ip)) keys.push(ipKey(ip));
    return keys;
  }

  function forget(account) {
    const name = accountName(account);
    if (name) entries.delete(accountKey(name));
  }

  function recent(key) {
    const entry = entries.get(key);
    if (!entry) return [];
    const t = now();
    while (entry.times.length && t - entry.times[0] >= windowMs) entry.times.shift();
    if (!entry.times.length) {
      entries.delete(key);
      return [];
    }
    return entry.times;
  }

  const retryAfter = (times) => Math.max(1, Math.ceil((times[0] + windowMs - now()) / 1000));

  function blocked(keys) {
    for (const key of keys) {
      const times = recent(key);
      if (times.length >= limitOf(key)) return { ok: false, retryAfterSec: retryAfter(times) };
    }
    return null;
  }

  /** Makes room for `count` new keys; false when only real accounts' keys inside their window are left. */
  function makeRoom(count) {
    if (entries.size + count <= maxKeys) return true;
    for (const key of [...entries.keys()]) recent(key);
    // Free a tenth of the table at once so a full table is not scanned on every attempt.
    const target = Math.max(0, Math.min(maxKeys - count, Math.floor(maxKeys * 0.9)));
    for (const [key, entry] of entries) {
      if (entries.size <= target) break;
      if (!entry.known) entries.delete(key);
    }
    return entries.size + count <= maxKeys;
  }

  function fullRetryAfter() {
    let soonest = Infinity;
    for (const { times } of entries.values()) if (times.length) soonest = Math.min(soonest, times[0]);
    return Number.isFinite(soonest) ? retryAfter([soonest]) : 1;
  }

  function record(keys, t, knownAccount) {
    for (const key of keys) {
      const times = recent(key);
      const known = key.startsWith('a:') && (knownAccount || entries.get(key)?.known === true);
      times.push(t);
      const limit = limitOf(key);
      if (times.length > limit) times.splice(0, times.length - limit);
      entries.delete(key); // re-insert: the table is ordered by the latest attempt
      entries.set(key, { times, known });
    }
  }

  function unrecord(keys, t) {
    for (const key of keys) {
      const entry = entries.get(key);
      if (!entry) continue;
      const at = entry.times.lastIndexOf(t);
      if (at >= 0) entry.times.splice(at, 1);
      if (!entry.times.length) entries.delete(key);
    }
  }

  /** Counts the attempt for every key, or returns a refusal. */
  function admit(account, ip, knownAccount) {
    const keys = keysFor(account, ip);
    const verdict = blocked(keys);
    if (verdict) return { verdict };
    const fresh = keys.filter((key) => !entries.has(key)).length;
    if (fresh && !makeRoom(fresh)) return { verdict: { ok: false, retryAfterSec: fullRetryAfter() } };
    const t = now();
    record(keys, t, knownAccount);
    return { keys, t };
  }

  return {
    begin(account, ip, { knownAccount = true } = {}) {
      const { verdict, keys, t } = admit(account, ip, knownAccount);
      if (verdict) return verdict;
      let settled = false;
      return {
        ok: true,
        ticket: {
          /** Wrong password: the attempt stays counted. */
          fail() {
            settled = true;
          },
          /** Right password: the attempt is taken back and the account's failures are cleared. */
          succeed() {
            if (settled) return;
            settled = true;
            unrecord(keys, t);
            forget(account);
          },
        },
      };
    },
    check(account, ip) {
      const keys = keysFor(account, ip);
      const verdict = blocked(keys);
      if (verdict) return verdict;
      const fresh = keys.filter((key) => !entries.has(key)).length;
      if (fresh && !makeRoom(fresh)) return { ok: false, retryAfterSec: fullRetryAfter() };
      return { ok: true };
    },
    fail(account, ip, { knownAccount = true } = {}) {
      const keys = keysFor(account, ip);
      const fresh = keys.filter((key) => !entries.has(key)).length;
      if (fresh && !makeRoom(fresh)) return;
      record(keys, now(), knownAccount);
    },
    succeed(account) {
      forget(account);
    },
    /** Keys now held (tests and diagnostics). */
    keys() {
      return [...entries.keys()];
    },
  };
}

/**
 * Express guard, called right before the password check: returns a ticket when the attempt may go
 * ahead (settle it with `succeed()` or `fail()`), else answers 429 with Retry-After and returns null.
 */
export function guardLogin(limiter, req, res, account, { knownAccount = true } = {}) {
  const verdict = limiter.begin(account, clientIpFromRequest(req), { knownAccount });
  if (verdict.ok) return verdict.ticket;
  res.setHeader('Retry-After', String(verdict.retryAfterSec));
  res.status(429).json({ message: 'Too many sign-in attempts. Try again later.' });
  return null;
}

/** The only hub config keys that GET /api/cms/config may show to the public. */
export const PUBLIC_CONFIG_KEYS = Object.freeze([
  'id',
  'name',
  'domain',
  'features',
  'ecommerceCatalogType',
  'websitePlan',
  'desiredCmsVersion',
  'analyticsLevel',
  'packageVersion',
]);

export function publicConfig(config) {
  const out = {};
  if (!config || typeof config !== 'object') return out;
  for (const key of PUBLIC_CONFIG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(config, key)) out[key] = config[key];
  }
  return out;
}

/** Passwords that earlier releases or common setups used as defaults. New passwords may not be one of them. */
export const KNOWN_DEFAULT_PASSWORDS = Object.freeze(['changeme', 'change-me', 'admin', 'password']);

/**
 * Default admin passwords that earlier releases actually shipped. An admin still on one of these gets
 * a random password at start. Other weak passwords are refused when set, but never replaced at start,
 * so a password the client chose before this release keeps working.
 */
export const SHIPPED_DEFAULT_PASSWORDS = Object.freeze(['changeme', 'change-me']);

export const MIN_PASSWORD_LENGTH = 8;

/**
 * Why a new password is refused (a message for the admin UI, in Norwegian), or null when it is fine.
 * Spaces at the ends do not count towards the minimum. The maximum is the longest password sign-in accepts.
 */
export function newPasswordProblem(value) {
  if (typeof value !== 'string' || value.trim().length < MIN_PASSWORD_LENGTH) {
    return `Passordet må ha minst ${MIN_PASSWORD_LENGTH} tegn.`;
  }
  if (value.length > MAX_PASSWORD_LENGTH) {
    return `Passordet kan ha høyst ${MAX_PASSWORD_LENGTH} tegn.`;
  }
  if (KNOWN_DEFAULT_PASSWORDS.includes(value.trim().toLowerCase())) {
    return 'Dette passordet er for enkelt å gjette. Velg et annet passord.';
  }
  return null;
}

export function isUsableEnvPassword(value) {
  return newPasswordProblem(String(value ?? '')) === null;
}

export function randomAdminPassword() {
  return randomBytes(18).toString('base64url');
}

export function initialAdminPath(dataPath) {
  return join(ensurePrivateDir(dataPath), 'initial-admin.json');
}

export function writeInitialAdmin(dataPath, { username, password, reason }) {
  const file = initialAdminPath(dataPath);
  const record = { username, password, reason, createdAt: new Date().toISOString() };
  writePrivateFile(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}
