export const RANGE_PRESETS = ['7d', '14d', '30d', '90d', '6m', '1y', 'custom'];

export function rangeFromPreset(range = '30d', customFrom = '', customTo = '', now = Date.now()) {
  const to = new Date(now);
  const from = new Date(now);
  switch (String(range || '30d')) {
    case '7d':
    case 'week':
      from.setDate(from.getDate() - 7);
      break;
    case '14d':
      from.setDate(from.getDate() - 14);
      break;
    case '30d':
    case 'month':
      from.setDate(from.getDate() - 30);
      break;
    case '90d':
      from.setDate(from.getDate() - 90);
      break;
    case '6m':
    case '6months':
      from.setMonth(from.getMonth() - 6);
      break;
    case '1y':
    case 'year':
      from.setFullYear(from.getFullYear() - 1);
      break;
    case 'custom': {
      const start = Date.parse(customFrom);
      const end = Date.parse(customTo);
      return {
        preset: 'custom',
        from: Number.isFinite(start) ? new Date(start) : new Date(0),
        to: Number.isFinite(end) ? new Date(end) : to,
      };
    }
    default:
      from.setDate(from.getDate() - 30);
  }
  return { preset: String(range || '30d'), from, to };
}

function hostOf(value = '') {
  try {
    return new URL(value).host.replace(/^www\./i, '');
  } catch {
    return String(value || '').replace(/^https?:\/\//i, '').split('/')[0].replace(/^www\./i, '');
  }
}

export function summarizeTrafficEvents(events = [], { from, to } = {}) {
  const rows = Array.isArray(events) ? events : [];
  const sessions = new Map();
  const visitors = new Set();
  const pages = new Map();
  const referrers = new Map();
  const devices = { desktop: 0, mobile: 0, tablet: 0 };
  const byDay = new Map();

  function deviceOf(ua = '') {
    const text = String(ua || '').toLowerCase();
    if (/ipad|tablet/.test(text)) return 'tablet';
    if (/mobi|iphone|android/.test(text)) return 'mobile';
    return 'desktop';
  }

  function bump(map, key, n = 1) {
    const id = String(key || '(direct)').trim() || '(direct)';
    map.set(id, (map.get(id) || 0) + n);
  }

  for (const event of rows) {
    const at = Date.parse(event?.at || '');
    if (!Number.isFinite(at)) continue;
    if (from && at < from.getTime()) continue;
    if (to && at > to.getTime()) continue;
    const sessionId = String(event.sessionId || '');
    const visitorId = String(event.visitorId || '');
    if (visitorId) visitors.add(visitorId);
    if (sessionId && !sessions.has(sessionId)) {
      sessions.set(sessionId, {
        paths: new Set(),
        start: at,
        end: at,
        bounced: true,
        device: deviceOf(event.ua),
        referrer: String(event.referrer || ''),
      });
    }
    const session = sessionId ? sessions.get(sessionId) : null;
    if (session) {
      session.end = Math.max(session.end, at);
      session.start = Math.min(session.start, at);
      if (event.path) session.paths.add(String(event.path));
      if (session.paths.size > 1 || event.type === 'ping') session.bounced = false;
    }
    if (event.type === 'pageview') {
      bump(pages, event.path || '/');
      const ref = String(event.referrer || '');
      if (ref && !ref.includes(String(event.host || ''))) bump(referrers, hostOf(ref) || ref);
      else if (!ref) bump(referrers, '(direct)');
      const day = new Date(at).toISOString().slice(0, 10);
      const bucket = byDay.get(day) || { date: day, pageviews: 0, visits: 0, visitors: new Set() };
      bucket.pageviews += 1;
      if (visitorId) bucket.visitors.add(visitorId);
      byDay.set(day, bucket);
    }
  }

  const sessionList = [...sessions.values()];
  sessionList.forEach((session) => {
    devices[session.device] = (devices[session.device] || 0) + 1;
    const day = new Date(session.start).toISOString().slice(0, 10);
    const bucket = byDay.get(day) || { date: day, pageviews: 0, visits: 0, visitors: new Set() };
    bucket.visits += 1;
    byDay.set(day, bucket);
  });

  const pageviews = rows.filter((event) => event.type === 'pageview').length;
  const visits = sessionList.length;
  const bounces = sessionList.filter((session) => session.bounced && session.paths.size <= 1).length;
  const durationMs = sessionList.reduce((sum, session) => sum + Math.max(0, session.end - session.start), 0);

  return {
    pageviews,
    visits,
    uniqueVisitors: visitors.size,
    bounceRate: visits ? Math.round((bounces / visits) * 1000) / 10 : 0,
    avgDurationSec: visits ? Math.round(durationMs / visits / 1000) : 0,
    viewRate: visits ? Math.round((pageviews / visits) * 10) / 10 : 0,
    topPages: [...pages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([path, count]) => ({ path, count })),
    referrers: [...referrers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([source, count]) => ({ source, count })),
    devices,
    series: [...byDay.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((row) => ({ date: row.date, pageviews: row.pageviews, visits: row.visits, uniqueVisitors: row.visitors.size })),
  };
}

export function analyticsTrackerScript({ ctaPath = '' } = {}) {
  const ctaJson = JSON.stringify(String(ctaPath || ''));
  return `(function(){
if (window.__asoldiAnalytics) return; window.__asoldiAnalytics = true;
function rid(){ try { var a=new Uint8Array(12); crypto.getRandomValues(a); return Array.from(a).map(function(b){return b.toString(16).padStart(2,'0');}).join(''); } catch(e){ return String(Math.random()).slice(2)+Date.now(); } }
function read(k){ try { return localStorage.getItem(k)||''; } catch(e){ return ''; } }
function write(k,v){ try { localStorage.setItem(k,v); } catch(e){} }
var vid = read('asoldi_vid') || rid(); write('asoldi_vid', vid);
var sid = read('asoldi_sid') || rid();
var started = Number(read('asoldi_sid_at')||0);
if (!started || Date.now()-started > 30*60*1000) { sid = rid(); started = Date.now(); }
write('asoldi_sid', sid); write('asoldi_sid_at', String(started));
var ctaPath = ${ctaJson};
function norm(p){
  try {
    var u = new URL(p, location.origin);
    var x = u.pathname || '/';
    if (x.length > 1) x = x.replace(/\\/+$/,'');
    return x.toLowerCase();
  } catch(e) { return String(p||'').toLowerCase(); }
}
var queue=[]; var sending=false;
function send(events){
  queue = queue.concat(events);
  if (sending) return;
  sending=true;
  var batch=queue.splice(0,20);
  fetch('/api/cms/analytics/collect', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ events: batch }), keepalive:true, credentials:'same-origin' })
    .catch(function(){})
    .then(function(){ sending=false; if (queue.length) send([]); });
}
function ev(type, extra){
  return Object.assign({
    type: type,
    visitorId: vid,
    sessionId: sid,
    path: location.pathname + location.search,
    referrer: document.referrer || '',
    ua: navigator.userAgent || '',
    host: location.host,
    at: new Date().toISOString()
  }, extra||{});
}
send([ev('pageview')]);
var last=Date.now();
setInterval(function(){ if (document.visibilityState==='hidden') return; send([ev('ping',{ ms: Date.now()-last })]); last=Date.now(); }, 15000);
document.addEventListener('visibilitychange', function(){ if (document.visibilityState==='hidden') send([ev('leave',{ ms: Date.now()-last })]); });
document.addEventListener('click', function(e){
  var el = e.target && e.target.closest && e.target.closest('a,button,[role=button]');
  if (!el) return;
  var href = (el.getAttribute && el.getAttribute('href')) || '';
  var label = ((el.innerText || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase();
  if (ctaPath && href) {
    try {
      var abs = new URL(href, location.href);
      var n = norm(abs.pathname);
      var c = norm(ctaPath);
      if (n === c || (c !== '/' && n.indexOf(c + '/') === 0)) send([ev('cta', { href: abs.pathname })]);
    } catch (err) {}
  }
  var hrefLow = href.toLowerCase();
  if (/legg i (handle)?kurv|add to cart|kjøp nå|buy now/.test(label) || (/cart|handlekurv/.test(hrefLow) && !/checkout|kasse/.test(hrefLow))) {
    send([ev('add_to_cart')]);
  }
}, true);
})();`;
}

export function injectAnalyticsTracker(html = '') {
  const source = String(html || '');
  if (!source || source.includes('__asoldiAnalytics') || source.includes('/api/cms/analytics/collect.js')) return source;
  const tag = '<script src="/api/cms/analytics/collect.js" defer></script>';
  if (/<\/body>/i.test(source)) return source.replace(/<\/body>/i, `${tag}</body>`);
  if (/<\/html>/i.test(source)) return source.replace(/<\/html>/i, `${tag}</html>`);
  return `${source}${tag}`;
}
