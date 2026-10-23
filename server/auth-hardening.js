/**
 * Admin sign-in hardening for the client CMS.
 *
 * - Tokens: HMAC compared in constant time; every token carries `exp`.
 * - Logins: failed attempts are limited per account and per client IP.
 * - Public config: only an explicit list of keys reaches GET /api/cms/config.
 * - First admin: never a built-in password; a random one is written to
 *   <data>/cms/private/initial-admin.json until the hub sets the real one.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
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

export function clientIpFromRequest(req) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(req?.socket?.remoteAddress || req?.ip || '').trim();
}

export function createLoginLimiter({
  windowMs = 15 * 60 * 1000,
  maxPerAccount = 10,
  maxPerIp = 50,
  maxKeys = 10000,
  now = () => Date.now(),
} = {}) {
  const failures = new Map();

  function recent(key) {
    const t = now();
    const list = (failures.get(key) || []).filter((ts) => t - ts < windowMs);
    if (list.length) failures.set(key, list);
    else failures.delete(key);
    return list;
  }

  function sweep() {
    if (failures.size < maxKeys / 2) return;
    for (const key of [...failures.keys()]) recent(key);
    // Still too many distinct keys: drop the oldest entries (Map keeps insertion order).
    for (const key of failures.keys()) {
      if (failures.size < maxKeys) break;
      failures.delete(key);
    }
  }

  const accountKey = (account) => `a:${String(account ?? '').trim().toLowerCase()}`;
  const ipKey = (ip) => `i:${String(ip ?? '').trim()}`;

  function retryAfterSec(list) {
    return Math.max(1, Math.ceil((Math.min(...list) + windowMs - now()) / 1000));
  }

  return {
    check(account, ip) {
      if (account) {
        const list = recent(accountKey(account));
        if (list.length >= maxPerAccount) return { ok: false, retryAfterSec: retryAfterSec(list) };
      }
      if (ip) {
        const list = recent(ipKey(ip));
        if (list.length >= maxPerIp) return { ok: false, retryAfterSec: retryAfterSec(list) };
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
      if (account) failures.delete(accountKey(account));
    },
  };
}

/** Express helper: returns true when the login may proceed, else answers 429. */
export function guardLogin(limiter, req, res, account) {
  const verdict = limiter.check(account, clientIpFromRequest(req));
  if (verdict.ok) return true;
  res.setHeader('Retry-After', String(verdict.retryAfterSec));
  res.status(429).json({ message: 'Too many sign-in attempts. Try again later.' });
  return false;
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

/** Passwords that earlier releases or common setups used as defaults. */
export const KNOWN_DEFAULT_PASSWORDS = Object.freeze(['changeme', 'change-me', 'admin', 'password']);

export function isUsableEnvPassword(value) {
  const text = String(value ?? '');
  if (text.length < 8) return false;
  return !KNOWN_DEFAULT_PASSWORDS.includes(text.trim().toLowerCase());
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
