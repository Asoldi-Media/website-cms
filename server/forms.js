// Frontend form → CMS. Pure helpers + the browser runtime the site pages load.
//
// A bound <form> (or input cluster) carries `data-cms-form="<bindingId>"` and
// posts to `/api/cms/forms/<bindingId>/submit`. The seed's field map says which
// form field feeds which lead/inbox key; unmapped fields land in `extra`, so no
// submitted data is ever lost. Works without JS (urlencoded POST → redirect) and
// upgrades to fetch + inline success message with `forms-runtime.js`.

const HONEYPOT_FIELDS = ['_gotcha', '_honey', 'website_url_hp'];
const INTERNAL_FIELDS = new Set(['_cms_return', 'site_key', ...HONEYPOT_FIELDS]);

function text(value = '') {
  if (Array.isArray(value)) return value.map((v) => text(v)).filter(Boolean).join(', ');
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function looksLikeBot(body = {}) {
  return HONEYPOT_FIELDS.some((key) => text(body?.[key]).length > 0);
}

const TRUTHY = new Set(['on', 'true', '1', 'yes', 'ja', 'checked']);

/**
 * Apply a binding's field map to a submitted body.
 * @returns {{ mapped: Record<string,string>, extra: Record<string,string>, skipped: string[] }}
 */
export function applyFieldMap(body = {}, form = {}) {
  const fieldMap = form?.fieldMap || {};
  const knownKeys = new Set((form?.fields || []).map((f) => f.key));
  const nameToKey = new Map((form?.fields || []).map((f) => [f.name || f.key, f.key]));
  const mapped = {};
  const extra = {};
  const skipped = [];
  for (const [rawName, rawValue] of Object.entries(body || {})) {
    const name = text(rawName);
    if (!name || INTERNAL_FIELDS.has(name)) continue;
    const key = knownKeys.has(name) ? name : nameToKey.get(name) || name;
    const target = fieldMap[key] || fieldMap[name] || 'extra';
    const value = text(rawValue);
    if (target === 'skip') {
      skipped.push(key);
      continue;
    }
    if (target === 'extra' || !target) {
      if (value) extra[key] = value.slice(0, 4000);
      continue;
    }
    if (target === 'marketingAccept') {
      mapped.marketingAccept = TRUTHY.has(value.toLowerCase()) || (value !== '' && value !== 'false' && value !== '0');
      continue;
    }
    if (mapped[target]) {
      // Two fields → same key: keep both, joined.
      mapped[target] = `${mapped[target]} ${value}`.trim();
    } else {
      mapped[target] = value;
    }
  }
  if (!mapped.name && (mapped.firstName || mapped.lastName)) {
    mapped.name = [mapped.firstName, mapped.lastName].filter(Boolean).join(' ');
  }
  return { mapped, extra, skipped };
}

export function normalizeSubmission(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const createdAt = raw.createdAt || new Date().toISOString();
  return {
    id: String(raw.id || ''),
    formId: text(raw.formId),
    formLabel: text(raw.formLabel),
    purpose: text(raw.purpose),
    page: text(raw.page),
    name: text(raw.name),
    email: text(raw.email).toLowerCase(),
    sms: text(raw.sms),
    subject: text(raw.subject),
    message: String(raw.message ?? '').trim().slice(0, 20000),
    company: text(raw.company),
    extra: raw.extra && typeof raw.extra === 'object' ? raw.extra : {},
    read: raw.read === true,
    forwarded: raw.forwarded === true,
    createdAt,
  };
}

export function publicSubmission(row) {
  if (!row) return null;
  return { ...row };
}

/** Where to send the visitor after a no-JS submit. Stays on this site. */
export function safeReturnPath(value = '', fallback = '/') {
  const raw = text(value);
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return fallback;
  return raw.replace(/[\r\n]/g, '');
}

export function wantsJson(req) {
  const accept = String(req.get?.('accept') || req.headers?.accept || '');
  if (/application\/json/i.test(accept)) return true;
  if (String(req.get?.('x-requested-with') || '').toLowerCase() === 'fetch') return true;
  return req.is?.('application/json') === 'application/json' || req.is?.('json') === 'json';
}

const DEFAULT_SUCCESS = {
  en: 'Thank you! We have received your message.',
  nb: 'Takk! Vi har mottatt meldingen din.',
  no: 'Takk! Vi har mottatt meldingen din.',
  nn: 'Takk! Vi har motteke meldinga di.',
  sv: 'Tack! Vi har tagit emot ditt meddelande.',
  da: 'Tak! Vi har modtaget din besked.',
  de: 'Vielen Dank! Wir haben Ihre Nachricht erhalten.',
  fr: 'Merci ! Nous avons bien reçu votre message.',
  es: '¡Gracias! Hemos recibido tu mensaje.',
  it: 'Grazie! Abbiamo ricevuto il tuo messaggio.',
  nl: 'Bedankt! We hebben je bericht ontvangen.',
};
const DEFAULT_SUCCESS_LIST = {
  en: 'Thank you! You are now subscribed.',
  nb: 'Takk! Du er nå påmeldt.',
  no: 'Takk! Du er nå påmeldt.',
  nn: 'Takk! Du er no påmeld.',
  sv: 'Tack! Du är nu anmäld.',
  da: 'Tak! Du er nu tilmeldt.',
  de: 'Vielen Dank! Sie sind jetzt angemeldet.',
  fr: 'Merci ! Vous êtes maintenant inscrit(e).',
  es: '¡Gracias! Ya estás suscrito.',
  it: 'Grazie! Ora sei iscritto.',
  nl: 'Bedankt! Je bent nu ingeschreven.',
};
const DEFAULT_ERROR = {
  en: 'Something went wrong. Please try again.',
  nb: 'Noe gikk galt. Prøv igjen.',
  no: 'Noe gikk galt. Prøv igjen.',
  sv: 'Något gick fel. Försök igen.',
  da: 'Noget gik galt. Prøv igen.',
  de: 'Etwas ist schiefgelaufen. Bitte erneut versuchen.',
  fr: 'Une erreur est survenue. Veuillez réessayer.',
  es: 'Algo salió mal. Inténtalo de nuevo.',
};

export function successMessageFor(form, language = '') {
  if (form?.successMessage) return form.successMessage;
  const lang = String(language || 'en').toLowerCase().split(/[-_]/)[0];
  const table = form?.destination?.type === 'list' ? DEFAULT_SUCCESS_LIST : DEFAULT_SUCCESS;
  return table[lang] || table.en;
}

export function errorMessageFor(language = '') {
  const lang = String(language || 'en').toLowerCase().split(/[-_]/)[0];
  return DEFAULT_ERROR[lang] || DEFAULT_ERROR.en;
}

/**
 * Browser runtime served at /api/cms/forms-runtime.js. Framework-agnostic:
 * finds `[data-cms-form]`, intercepts submit (capture phase so template scripts
 * such as Webflow's form handler never get to post elsewhere), serializes every
 * input/textarea/select inside, POSTs JSON, then swaps in a success message.
 * Also handles `[data-cms-synthetic]` containers (inputs + button, no <form>).
 */
export function formsRuntimeScript({ messages = {} } = {}) {
  const config = JSON.stringify({
    success: messages.success || {},
    error: messages.error || DEFAULT_ERROR.en,
  });
  return `(function(){
if (window.__cmsFormsRuntime) return; window.__cmsFormsRuntime = true;
var CFG = ${config};
function fieldsIn(root){ return root.querySelectorAll('input,textarea,select'); }
function serialize(root){
  var out = {}; var nodes = fieldsIn(root);
  for (var i=0;i<nodes.length;i++){
    var f = nodes[i]; var name = f.getAttribute('name') || f.id; if (!name) continue;
    var type = (f.getAttribute('type')||'').toLowerCase();
    if (type==='submit'||type==='button'||type==='reset'||type==='image'||type==='file') continue;
    if (type==='checkbox'){ if (f.checked) out[name] = out[name] ? out[name]+', '+(f.value||'on') : (f.value||'on'); continue; }
    if (type==='radio'){ if (f.checked) out[name] = f.value; continue; }
    if (f.tagName==='SELECT' && f.multiple){ var vals=[]; for (var j=0;j<f.options.length;j++){ if (f.options[j].selected) vals.push(f.options[j].value); } out[name]=vals.join(', '); continue; }
    out[name] = f.value;
  }
  out._cms_page = location.pathname;
  return out;
}
function invalid(root){
  var nodes = fieldsIn(root);
  for (var i=0;i<nodes.length;i++){ if (nodes[i].checkValidity && !nodes[i].checkValidity()){ if (nodes[i].reportValidity) nodes[i].reportValidity(); return true; } }
  return false;
}
function hiddenSiblingMessage(root){
  // Templates often ship a hidden "done" block next to the form; reuse it when present.
  var parent = root.parentElement; if (!parent) return null;
  var kids = parent.children;
  for (var i=0;i<kids.length;i++){
    var el = kids[i]; if (el===root) continue;
    var cs = window.getComputedStyle(el);
    if (cs.display==='none' && (el.textContent||'').trim() && !fieldsIn(el).length && !/(wrong|galt|fel|error|feil|again|igjen)/i.test(el.textContent)) return el;
  }
  return null;
}
function showSuccess(root, msg){
  var done = hiddenSiblingMessage(root);
  root.setAttribute('data-cms-state','done');
  if (done){ root.style.display='none'; done.style.display='block'; done.setAttribute('role','status'); if (msg && root.getAttribute('data-cms-success')) done.textContent = msg; return; }
  var box = document.createElement('div');
  box.setAttribute('role','status'); box.className='cms-form-success';
  box.style.cssText='padding:12px 0;font:inherit;color:inherit;';
  box.textContent = msg;
  root.style.display='none';
  root.parentElement ? root.parentElement.insertBefore(box, root.nextSibling) : document.body.appendChild(box);
}
function showError(root, msg){
  var old = root.querySelector('.cms-form-error'); if (old) old.remove();
  var box = document.createElement('div'); box.className='cms-form-error'; box.setAttribute('role','alert');
  box.style.cssText='padding:8px 0;font:inherit;color:#b91c1c;'; box.textContent = msg || CFG.error;
  root.appendChild(box);
}
function setBusy(root, busy){
  var btns = root.querySelectorAll('button,input[type=submit]');
  for (var i=0;i<btns.length;i++){ btns[i].disabled = !!busy; }
  root.setAttribute('data-cms-state', busy ? 'sending' : 'idle');
}
function submit(root){
  if (root.getAttribute('data-cms-state')==='sending') return;
  if (invalid(root)) return;
  var id = root.getAttribute('data-cms-form'); if (!id) return;
  var url = root.getAttribute('data-cms-action') || root.getAttribute('action') || ('/api/cms/forms/'+encodeURIComponent(id)+'/submit');
  var payload = serialize(root);
  setBusy(root, true);
  fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json', 'Accept':'application/json', 'X-Requested-With':'fetch' }, body: JSON.stringify(payload), credentials:'same-origin' })
    .then(function(r){ return r.json().then(function(d){ return { ok: r.ok && d && d.ok !== false, data: d||{} }; }); })
    .then(function(res){ setBusy(root,false); if (res.ok){ showSuccess(root, root.getAttribute('data-cms-success') || res.data.message || CFG.success[id] || ''); } else { showError(root, res.data.message || res.data.error || CFG.error); } })
    .catch(function(){ setBusy(root,false); showError(root, CFG.error); });
}
document.addEventListener('submit', function(e){
  var form = e.target && e.target.closest ? e.target.closest('form[data-cms-form]') : null; if (!form) return;
  e.preventDefault(); e.stopImmediatePropagation(); submit(form);
}, true);
document.addEventListener('click', function(e){
  var btn = e.target && e.target.closest ? e.target.closest('button,input[type=submit],input[type=button],[role=button]') : null; if (!btn) return;
  var box = btn.closest('[data-cms-synthetic][data-cms-form]'); if (!box) return;
  e.preventDefault(); e.stopImmediatePropagation(); submit(box);
}, true);
document.addEventListener('keydown', function(e){
  if (e.key!=='Enter') return; var t=e.target; if (!t || t.tagName!=='INPUT') return;
  var box = t.closest('[data-cms-synthetic][data-cms-form]'); if (!box) return;
  e.preventDefault(); submit(box);
}, true);
// No-JS fallback round-trip: ?cms-form=ok&form=<id> after a redirect.
try {
  var q = new URLSearchParams(location.search); var okId = q.get('cms-form')==='ok' ? q.get('form') : null;
  if (okId){ var el = document.querySelector('[data-cms-form="'+okId.replace(/"/g,'')+'"]'); if (el){ showSuccess(el, el.getAttribute('data-cms-success') || CFG.success[okId] || ''); el.scrollIntoView({block:'center'}); } }
} catch(err) {}
try { var s=document.createElement('script'); s.src='/api/cms/analytics/collect.js'; s.defer=true; document.head.appendChild(s); } catch(e) {}
})();`;
}
