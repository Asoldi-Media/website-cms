/** Server-to-server calls to asoldi.com, authenticated by this site's site_key. */

const STATUS_TTL_MS = 30_000;

/** Hub API client for shop calls (checkout, verify, refunds, documents). */
export function createHubClient({ hubUrl, siteKey }) {
  const base = String(hubUrl || '').trim().replace(/\/+$/, '');
  const linked = Boolean(base && siteKey);
  let statusCache = { at: 0, value: null };

  async function call(method, path, body, timeoutMs = 25_000) {
    if (!linked) {
      const err = new Error('Denne nettsiden er ikke koblet til Asoldi ennå.');
      err.status = 503;
      throw err;
    }
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-site-key': siteKey },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || `Asoldi svarte ${res.status}`);
      err.status = res.status >= 500 ? 502 : res.status;
      err.code = data.code || '';
      throw err;
    }
    return data;
  }

  async function status({ fresh = false } = {}) {
    if (!linked) return null;
    if (!fresh && statusCache.value && Date.now() - statusCache.at < STATUS_TTL_MS) return statusCache.value;
    try {
      const value = await call('GET', '/api/hub/shop/status', undefined, 5_000);
      statusCache = { at: Date.now(), value };
      return value;
    } catch {
      // Storefront must not hang when asoldi.com is down; keep the last answer for another TTL.
      if (statusCache.value) statusCache.at = Date.now();
      return statusCache.value;
    }
  }

  function resetStatus() {
    statusCache = { at: 0, value: null };
  }

  return { linked, call, status, resetStatus };
}
