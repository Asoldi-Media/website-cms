/**
 * "Open CMS as Asoldi": the hub gives staff a one-time link with a random token. Before a session
 * opens, the CMS asks the hub whether the token is good (POST {hubUrl}/api/cms/sso/redeem with this
 * site's key), so only a link the hub issued for this site, unused and within its 60 s, signs in.
 * The hub address comes from the server config only. Any doubt (no answer within 5 s, an error, a
 * redirect, anything but { ok: true }) refuses the sign-in. Tokens are also burned here, and every
 * sign-in is audited.
 */
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export const SSO_SESSION_MS = 8 * 60 * 60 * 1000;
export const SSO_REDEEM_TIMEOUT_MS = 5000;
/** A burned token is remembered this long (the hub's own token lives 60 s). */
const BURN_KEEP_MS = 10 * 60 * 1000;
const MAX_BURNED = 1000;
/** 32 random bytes, base64url: the only shape the hub issues. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function readJson(path, fallback) {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
  } catch {
    return fallback;
  }
}

/** The hub address from the server config, or '' when there is no usable hub. */
export function hubBase(hubUrl) {
  const raw = String(hubUrl || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    if (url.username || url.password) return '';
    return raw;
  } catch {
    return '';
  }
}

/** One-time 'Open CMS as Asoldi' tokens, checked with the hub: verify, burn, keep an audit log. */
export function createSsoVerifier({ dataPath, siteKey, hubUrl, fetchImpl = (...args) => fetch(...args), timeoutMs = SSO_REDEEM_TIMEOUT_MS, now = () => Date.now() }) {
  const dir = join(dataPath, 'cms');
  const burnPath = join(dir, 'sso-nonces.json');
  const auditPath = join(dir, 'audit.json');
  const base = hubBase(hubUrl);

  function save(path, value) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(value, null, 2), 'utf8');
  }

  /** True when this token was not seen before; it is marked as seen in the same step (no await in between). */
  function burn(id, t) {
    const raw = readJson(burnPath, {});
    const seen = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    for (const [key, until] of Object.entries(seen)) if (!(Number(until) > t)) delete seen[key];
    if (seen[id]) return false;
    seen[id] = t + BURN_KEEP_MS;
    const keys = Object.keys(seen);
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_BURNED))) delete seen[key];
    save(burnPath, seen);
    return true;
  }

  /** Resolves { ok: true, by } or { ok: false, reason }. Never throws. */
  async function verify(token) {
    if (!siteKey || !base) return { ok: false, reason: 'not-linked' };
    const value = String(token || '').trim();
    if (!TOKEN_RE.test(value)) return { ok: false, reason: 'malformed' };
    const id = createHash('sha256').update(value).digest('hex');
    try {
      if (!burn(id, now())) return { ok: false, reason: 'used' };
    } catch {
      return { ok: false, reason: 'storage' };
    }
    let response;
    try {
      response = await fetchImpl(`${base}/api/cms/sso/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-site-key': siteKey },
        body: JSON.stringify({ token: value }),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { ok: false, reason: 'hub-unreachable' };
    }
    if (response.status !== 200) return { ok: false, reason: response.status === 429 ? 'hub-busy' : 'refused' };
    let body;
    try {
      body = await response.json();
    } catch {
      return { ok: false, reason: 'hub-answer' };
    }
    if (!body || body.ok !== true) return { ok: false, reason: 'refused' };
    return { ok: true, by: String(body.by || 'asoldi').slice(0, 80) };
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
