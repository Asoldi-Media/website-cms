/**
 * Site credential for calls to the Asoldi hub.
 *
 * The site key is a public identifier: it is written into the site's form HTML. To show the hub that
 * a call comes from this site's own server, the CMS keeps a second value, its site credential: 32
 * random bytes made once in {dataPath}/cms/private/secrets/hub-credential.json (mode 0600). It goes
 * only to the configured hub (the hubUrl option or CMS_HUB_URL, never an address from a request), in
 * the x-site-credential header, over https (or to a hub on this machine or the local network). It is
 * never part of the public config, HTML, logs or heartbeat bodies.
 *
 * Enrollment: the CMS posts {siteKey, credential, nonce} to <hub>/api/hub/site-credential/enroll. The
 * hub then asks https://<the site's domain in the hub>/api/cms/hub-enroll-proof?nonce=<nonce>, and
 * this CMS answers HMAC-SHA256(credential, nonce) only for a nonce it sent itself in the last two
 * minutes (kept on disk, so every process of the site can answer). The hub then keeps
 * sha256(credential). The CMS enrolls shortly after start and with each heartbeat until the hub has
 * accepted it, with growing pauses after a failure, and again when a hub answer says
 * x-site-credential-status: not-enrolled or invalid. After a revoke (not-enrolled while this CMS was
 * enrolled) it makes a new credential first; a credential made for one hub is never sent to another.
 */
import { createHash, createHmac, randomBytes } from 'crypto';
import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createFileOnce, privateDir } from './secret.js';

/**
 * {dataPath}/cms/private/secrets: the same folder (and file names) CMS 2.2 uses, so a site that moves
 * from 1.7.2 to 2.2.2 or later keeps its credential.
 */
export function cmsSecretsDir(dataPath) {
  return join(privateDir(dataPath), 'secrets');
}

function writeFileOnce(file, text) {
  return createFileOnce(file, text);
}

export const SITE_CREDENTIAL_HEADER = 'x-site-credential';
export const SITE_CREDENTIAL_STATUS_HEADER = 'x-site-credential-status';
export const CREDENTIAL_FILE = 'hub-credential.json';
export const PENDING_FILE = 'hub-enroll-pending.json';
/** The proof is answered for a nonce this long after the CMS sent it. */
export const ENROLL_PROOF_WINDOW_MS = 2 * 60_000;
export const ENROLL_PATH = '/api/hub/site-credential/enroll';
const VALUE_RE = /^[A-Za-z0-9_-]{43}$/;
const FIRST_DELAY_MS = 5_000;
const MIN_RETRY_MS = 60_000;
const MAX_RETRY_MS = 6 * 60 * 60_000;
const OFF_RETRY_MS = 30 * 60_000;
const MAX_PENDING = 50;

function clean(value) {
  return String(value ?? '').trim();
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function randomValue() {
  return randomBytes(32).toString('base64url');
}

/** HMAC-SHA256(credential, nonce) as hex: what the hub expects for a nonce. */
export function enrollProof(credential, nonce) {
  return createHmac('sha256', String(credential)).update(String(nonce)).digest('hex');
}

/** localhost, loopback and private addresses: a hub on this machine or network (local runs). */
function isLocalHostname(hostname) {
  const host = clean(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === 'host.docker.internal';
}

/**
 * The configured hub as { origin, base } (base keeps a path prefix), or null when the URL is unusable.
 * `secure` is false for plain http to a public host: the credential is never sent there.
 */
export function hubTarget(hubUrl) {
  const raw = clean(hubUrl);
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null;
  const path = url.pathname.replace(/\/+$/, '');
  return { origin: url.origin, base: `${url.origin}${path}`, secure: url.protocol === 'https:' || isLocalHostname(url.hostname) };
}

function readJson(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Replace `file` atomically (temp file, then rename), mode 0600. */
function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try {
    renameSync(tmp, file);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // already gone
    }
    throw error;
  }
}

/**
 * The site credential of one CMS. Options: dataPath, hubUrl, siteKey, fetchImpl (default fetch),
 * now (ms clock), log (console-like), autoEnroll (default true: enroll shortly after start).
 */
export function createHubCredential({ dataPath, hubUrl, siteKey, fetchImpl = (...args) => globalThis.fetch(...args), now = () => Date.now(), log = console, autoEnroll = true } = {}) {
  const hub = hubTarget(hubUrl);
  const key = clean(siteKey);
  const linked = Boolean(hub && key && dataPath);
  const dir = () => {
    const path = cmsSecretsDir(dataPath);
    mkdirSync(path, { recursive: true, mode: 0o700 });
    return path;
  };
  const credentialPath = () => join(dir(), CREDENTIAL_FILE);
  const pendingPath = () => join(dir(), PENDING_FILE);
  let cache = { mtimeMs: -1, value: null };
  let warned = { insecure: false, redirect: false };
  const backoff = { failures: 0, nextAt: 0, running: null };
  let timer = null;

  function readRecord() {
    let mtimeMs;
    try {
      mtimeMs = statSync(credentialPath()).mtimeMs;
    } catch {
      mtimeMs = -1;
    }
    if (mtimeMs >= 0 && mtimeMs === cache.mtimeMs && cache.value) return cache.value;
    const parsed = mtimeMs >= 0 ? readJson(credentialPath()) : null;
    const value = parsed && VALUE_RE.test(clean(parsed.credential)) ? parsed : null;
    cache = { mtimeMs, value };
    return value;
  }

  /**
   * The current record { credential, createdAt, hubOrigin, enrolledAt? }. Made once (exclusive
   * create, so concurrent starts agree), and made again only for another hub or after a revoke.
   */
  function record() {
    if (!linked) return null;
    const existing = readRecord();
    if (existing && (!existing.hubOrigin || existing.hubOrigin === hub.origin)) return existing;
    const fresh = { version: 1, credential: randomValue(), createdAt: new Date(now()).toISOString(), hubOrigin: hub.origin };
    if (!existing) {
      if (writeFileOnce(credentialPath(), `${JSON.stringify(fresh, null, 2)}\n`)) {
        cache = { mtimeMs: -1, value: null };
        return readRecord() || fresh;
      }
      cache = { mtimeMs: -1, value: null };
      const settled = readRecord();
      if (settled) return settled;
      // The file is there but unreadable: keep it for inspection and start a new one.
      try {
        renameSync(credentialPath(), `${credentialPath()}.damaged-${Date.now()}`);
      } catch {
        // another process moved it
      }
      if (writeFileOnce(credentialPath(), `${JSON.stringify(fresh, null, 2)}\n`)) cache = { mtimeMs: -1, value: null };
      return readRecord();
    }
    // A credential made for another hub stays with that hub.
    writeJsonAtomic(credentialPath(), fresh);
    cache = { mtimeMs: -1, value: null };
    log.warn?.('[cms] The hub address changed, so this site made a new hub credential and will enroll it.');
    return readRecord() || fresh;
  }

  function update(mutate) {
    const current = readRecord();
    if (!current) return null;
    const next = mutate({ ...current });
    if (!next) return current;
    writeJsonAtomic(credentialPath(), next);
    cache = { mtimeMs: -1, value: null };
    return readRecord();
  }

  /** True when `url` is the configured hub (same origin, under its path). */
  function isHubUrl(url) {
    if (!hub) return false;
    let target;
    try {
      target = new URL(String(url));
    } catch {
      return false;
    }
    if (target.origin !== hub.origin) return false;
    const prefix = hub.base.slice(hub.origin.length);
    return !prefix || target.pathname === prefix || target.pathname.startsWith(`${prefix}/`);
  }

  /** { 'x-site-credential': value } for a URL on the configured hub over a safe channel, else {}. */
  function headersFor(url) {
    if (!linked || !isHubUrl(url)) return {};
    if (!hub.secure) {
      if (!warned.insecure) {
        warned.insecure = true;
        log.warn?.('[cms] The hub address is plain http on a public host, so the site credential is not sent. Use https in CMS_HUB_URL.');
      }
      return {};
    }
    const current = record();
    return current ? { [SITE_CREDENTIAL_HEADER]: current.credential } : {};
  }

  // ── pending nonces ─────────────────────────────────────────────────────────

  function readPending() {
    const parsed = readJson(pendingPath());
    const rows = parsed && typeof parsed.pending === 'object' && parsed.pending && !Array.isArray(parsed.pending) ? parsed.pending : {};
    const t = now();
    const live = {};
    for (const [hash, row] of Object.entries(rows)) {
      if (/^[a-f0-9]{64}$/.test(hash) && Number(row?.exp) > t) live[hash] = { exp: Number(row.exp), cred: clean(row.cred) };
    }
    return live;
  }

  function writePending(pending) {
    const hashes = Object.keys(pending);
    for (const hash of hashes.slice(0, Math.max(0, hashes.length - MAX_PENDING))) delete pending[hash];
    writeJsonAtomic(pendingPath(), { version: 1, pending });
  }

  function addPending(nonce, credential) {
    const pending = readPending();
    pending[sha256(nonce)] = { exp: now() + ENROLL_PROOF_WINDOW_MS, cred: sha256(credential) };
    writePending(pending);
  }

  function dropPending(nonce) {
    try {
      const pending = readPending();
      delete pending[sha256(nonce)];
      writePending(pending);
    } catch {
      // expires on its own
    }
  }

  /**
   * The proof for a nonce this CMS sent in the last two minutes, for its current credential;
   * null for any other nonce.
   */
  function proofFor(nonce) {
    const value = clean(nonce);
    if (!linked || !VALUE_RE.test(value)) return null;
    let pending;
    try {
      pending = readPending();
    } catch {
      return null;
    }
    const row = pending[sha256(value)];
    const current = readRecord();
    if (!row || !current || row.cred !== sha256(current.credential)) return null;
    return enrollProof(current.credential, value);
  }

  // ── enrollment ─────────────────────────────────────────────────────────────

  function schedule(delayMs) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void ensureEnrolled();
    }, Math.max(0, delayMs));
    timer.unref?.();
  }

  function failed(minMs = MIN_RETRY_MS) {
    backoff.failures += 1;
    const base = Math.min(MAX_RETRY_MS, Math.max(minMs, MIN_RETRY_MS * 2 ** (backoff.failures - 1)));
    const jitter = base * (0.8 + Math.random() * 0.4);
    backoff.nextAt = now() + jitter;
    if (autoEnroll) schedule(jitter);
    return jitter;
  }

  /**
   * One enrollment attempt. Resolves { ok, status, code }; never throws. Concurrent calls share
   * one attempt.
   */
  async function enroll() {
    if (!linked) return { ok: false, code: 'not-linked' };
    if (!hub.secure) {
      headersFor(hub.base);
      return { ok: false, code: 'insecure-hub' };
    }
    if (backoff.running) return backoff.running;
    backoff.running = (async () => {
      let current;
      try {
        current = record();
      } catch (error) {
        log.warn?.(`[cms] Could not read or create the hub credential (${error?.code || 'error'}).`);
        failed();
        return { ok: false, code: 'storage' };
      }
      if (!current) return { ok: false, code: 'storage' };
      const nonce = randomValue();
      try {
        addPending(nonce, current.credential);
      } catch (error) {
        log.warn?.(`[cms] Could not store the enrollment nonce (${error?.code || 'error'}).`);
        failed();
        return { ok: false, code: 'storage' };
      }
      let response;
      let body;
      try {
        response = await fetchImpl(`${hub.base}${ENROLL_PATH}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-site-key': key },
          body: JSON.stringify({ siteKey: key, credential: current.credential, nonce }),
          redirect: 'error',
          signal: AbortSignal.timeout(20_000),
        });
        body = await response.json().catch(() => ({}));
      } catch {
        dropPending(nonce);
        failed();
        return { ok: false, code: 'hub-unreachable' };
      }
      dropPending(nonce);
      if (response.status === 200 && body?.ok === true) {
        backoff.failures = 0;
        backoff.nextAt = 0;
        try {
          update((row) => (row.credential === current.credential ? { ...row, enrolledAt: new Date(now()).toISOString(), enrolledHub: hub.origin } : null));
        } catch {
          // the hub has it; the local note is only used to tell a revoke apart
        }
        log.log?.('[cms] This site is enrolled with its hub credential.');
        return { ok: true, status: 200, code: body.kind || 'enrolled' };
      }
      const code = clean(body?.code) || `http-${response.status}`;
      failed(code === 'enrollment-off' ? OFF_RETRY_MS : MIN_RETRY_MS);
      if (backoff.failures === 1 || backoff.failures % 10 === 0) {
        log.warn?.(`[cms] Hub credential enrollment was not accepted (${code}); trying again later.`);
      }
      return { ok: false, status: response.status, code };
    })();
    try {
      return await backoff.running;
    } finally {
      backoff.running = null;
    }
  }

  function enrolledHere() {
    const current = readRecord();
    return Boolean(current?.enrolledAt && current.enrolledHub === hub?.origin);
  }

  /** Enroll when not enrolled yet and the pause after the last failure is over. */
  async function ensureEnrolled({ force = false } = {}) {
    if (!linked || !hub.secure) return { ok: false, code: linked ? 'insecure-hub' : 'not-linked' };
    if (!force && enrolledHere()) return { ok: true, code: 'enrolled' };
    if (!force && backoff.nextAt > now()) return { ok: false, code: 'waiting' };
    return enroll();
  }

  /**
   * React to x-site-credential-status on a hub answer: 'not-enrolled' after this CMS was enrolled
   * means a revoke, so a new credential is made and enrolled; 'invalid' enrolls the current one again.
   */
  function noteStatus(status, { sentCredential = '' } = {}) {
    const value = clean(status);
    if (!linked || !hub.secure) return;
    if (value === 'valid') return;
    if (value !== 'not-enrolled' && value !== 'invalid') return;
    if (value === 'not-enrolled') {
      try {
        update((row) => {
          if (!row.enrolledAt) return null;
          if (sentCredential && row.credential !== sentCredential) return null;
          log.warn?.('[cms] The hub no longer accepts this site credential; making a new one and enrolling it.');
          return { version: 1, credential: randomValue(), createdAt: new Date(now()).toISOString(), hubOrigin: hub.origin };
        });
      } catch (error) {
        log.warn?.(`[cms] Could not replace the hub credential (${error?.code || 'error'}).`);
      }
    } else {
      try {
        update((row) => (row.enrolledAt ? { ...row, enrolledAt: '', enrolledHub: '' } : null));
      } catch {
        // enrollment below still runs
      }
    }
    if (autoEnroll && backoff.nextAt <= now()) schedule(0);
  }

  /** Reads x-site-credential-status from a hub response. */
  function noteResponse(response, sentCredential = '') {
    const status = response?.headers?.get?.(SITE_CREDENTIAL_STATUS_HEADER);
    if (status) noteStatus(status, { sentCredential });
  }

  /**
   * fetch() for a hub URL with the credential header. The credential never follows a redirect: on
   * a 3xx answer the call is made again without it (as before this version), and a warning says to
   * set the hub's final address.
   */
  async function hubFetch(url, init = {}) {
    const extra = headersFor(url);
    const credential = extra[SITE_CREDENTIAL_HEADER] || '';
    if (!credential) return fetchImpl(url, init);
    const response = await fetchImpl(url, { ...init, headers: { ...(init.headers || {}), ...extra }, redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) {
      if (!warned.redirect) {
        warned.redirect = true;
        log.warn?.('[cms] The hub address answers with a redirect, so the site credential is not sent. Set CMS_HUB_URL to the final address.');
      }
      await response.body?.cancel?.().catch?.(() => {});
      return fetchImpl(url, init);
    }
    noteResponse(response, credential);
    return response;
  }

  /** Start: enroll a few seconds after boot (once the server listens), then with each heartbeat. */
  function start() {
    if (!linked || !autoEnroll) return;
    if (!hub.secure) {
      headersFor(hub.base);
      return;
    }
    try {
      record();
    } catch (error) {
      log.warn?.(`[cms] Could not create the hub credential (${error?.code || 'error'}).`);
    }
    if (!enrolledHere()) schedule(FIRST_DELAY_MS);
  }

  function stop() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  return {
    linked,
    hubOrigin: hub?.origin || '',
    record,
    headersFor,
    hubFetch,
    proofFor,
    enroll,
    ensureEnrolled,
    noteStatus,
    noteResponse,
    enrolledHere,
    start,
    stop,
    credentialPath,
    pendingPath,
    backoffState: () => ({ failures: backoff.failures, nextAt: backoff.nextAt }),
  };
}
