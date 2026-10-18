/**
 * "Open CMS as Asoldi": verifies a one-time login token minted by the hub
 * (HMAC with this site's site_key, 60 s, nonce burned on first use).
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export const SSO_SESSION_MS = 8 * 60 * 60 * 1000;
const MAX_TTL_MS = 120_000;

function readJson(path, fallback) {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
  } catch {
    return fallback;
  }
}

/** One-time 'Open CMS as Asoldi' tokens signed with the site key: verify, burn the nonce, keep an audit log. */
export function createSsoVerifier({ dataPath, siteKey }) {
  const dir = join(dataPath, 'cms');
  const noncePath = join(dir, 'sso-nonces.json');
  const auditPath = join(dir, 'audit.json');

  function save(path, value) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(value, null, 2), 'utf8');
  }

  /** Returns { ok, by } or { ok:false, reason }. Burns the nonce on success. */
  function verify(token, now = Date.now()) {
    if (!siteKey) return { ok: false, reason: 'not-linked' };
    let raw;
    try {
      raw = JSON.parse(Buffer.from(String(token || ''), 'base64url').toString('utf8'));
    } catch {
      return { ok: false, reason: 'malformed' };
    }
    if (typeof raw?.data !== 'string' || typeof raw?.sig !== 'string') return { ok: false, reason: 'malformed' };
    const expect = Buffer.from(createHmac('sha256', siteKey).update(raw.data).digest('hex'));
    const given = Buffer.from(raw.sig);
    if (expect.length !== given.length || !timingSafeEqual(expect, given)) return { ok: false, reason: 'bad-signature' };
    let data;
    try {
      data = JSON.parse(raw.data);
    } catch {
      return { ok: false, reason: 'malformed' };
    }
    const exp = Number(data.exp);
    if (!Number.isFinite(exp) || exp < now || exp - now > MAX_TTL_MS) return { ok: false, reason: 'expired' };
    const nonce = String(data.n || '');
    if (!/^[a-f0-9]{16,64}$/.test(nonce)) return { ok: false, reason: 'malformed' };
    const used = readJson(noncePath, {}) || {};
    for (const [key, until] of Object.entries(used)) if (Number(until) < now) delete used[key];
    if (used[nonce]) return { ok: false, reason: 'used' };
    used[nonce] = exp + MAX_TTL_MS;
    save(noncePath, used);
    return { ok: true, by: String(data.by || 'asoldi').slice(0, 80) };
  }

  function audit(entry) {
    const rows = readJson(auditPath, []);
    const list = Array.isArray(rows) ? rows : [];
    list.push({ at: new Date().toISOString(), ...entry });
    save(auditPath, list.slice(-500));
  }

  function auditLog() {
    const rows = readJson(auditPath, []);
    return Array.isArray(rows) ? rows : [];
  }

  return { verify, audit, auditLog };
}

/** Tiny page that hands the session to the admin SPA and leaves no token in history. */
export function ssoLandingHtml(token) {
  const safe = JSON.stringify(token).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Logger inn…</title></head><body><script>try{localStorage.setItem('adminToken',${safe});}catch(e){}location.replace('/admin');</script><noscript>JavaScript må være på for å logge inn.</noscript></body></html>`;
}
