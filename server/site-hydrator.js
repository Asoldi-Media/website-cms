import { normalizePatch, normalizePatchList } from './site-edits.js';

export const TEXT_ATTR = 'data-asoldi-text';
export const MEDIA_ATTR = 'data-asoldi-media';
export const SECTION_ATTR = 'data-asoldi-section';
export const KEY_ATTR = 'data-asoldi-key';
export const CMS_SLOT_ATTR = 'data-cms-slot';
export const HIDDEN_ATTR = 'data-asoldi-hidden';
export const INSERTED_ATTR = 'data-asoldi-inserted';

const VOID_TAGS = new Set(['img', 'input', 'br', 'hr', 'meta', 'link', 'source', 'area', 'col', 'embed', 'track', 'wbr']);

function escapeRe(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function openTagRe(attr, key) {
  return new RegExp(`<([a-zA-Z][a-zA-Z0-9-]*)(\\s[^>]*${escapeRe(attr)}="${escapeRe(key)}"[^>]*?)(\\/?)>`, 'i');
}

function skipOpen(attrs, skipCmsSlots) {
  return skipCmsSlots && /data-cms-slot\s*=/i.test(String(attrs || ''));
}

function findClose(html, tag, start) {
  const lower = tag.toLowerCase();
  const openRe = new RegExp(`<${escapeRe(tag)}(?:\\s|>)`, 'ig');
  const closeRe = new RegExp(`</${escapeRe(tag)}>`, 'ig');
  openRe.lastIndex = start;
  closeRe.lastIndex = start;
  let depth = 1;
  let cursor = start;
  while (cursor < html.length && depth > 0) {
    closeRe.lastIndex = cursor;
    openRe.lastIndex = cursor;
    const close = closeRe.exec(html);
    if (!close) return -1;
    const between = html.slice(cursor, close.index);
    const nested = between.match(new RegExp(`<${escapeRe(lower)}(?:\\s|>)`, 'ig'));
    depth += nested ? nested.length : 0;
    depth -= 1;
    if (depth === 0) return close.index;
    cursor = close.index + close[0].length;
  }
  return -1;
}

function replaceInner(html, attr, key, nextInner, skipCmsSlots) {
  const re = openTagRe(attr, key);
  const match = html.match(re);
  if (!match) return html;
  if (skipOpen(match[2], skipCmsSlots)) return html;
  const tag = match[1];
  if (VOID_TAGS.has(tag.toLowerCase()) || match[3] === '/') return html;
  const start = match.index + match[0].length;
  const end = findClose(html, tag, start);
  if (end < 0) return html;
  return html.slice(0, start) + escapeHtml(nextInner) + html.slice(end);
}

function replaceAttr(html, attr, key, name, value, skipCmsSlots) {
  const re = openTagRe(attr, key);
  const match = html.match(re);
  if (!match) return html;
  if (skipOpen(match[2], skipCmsSlots)) return html;
  let attrs = match[2];
  const nameRe = new RegExp(`\\s${escapeRe(name)}=(["'])[\\s\\S]*?\\1`, 'i');
  if (nameRe.test(attrs)) attrs = attrs.replace(nameRe, ` ${name}="${escapeAttr(value)}"`);
  else attrs += ` ${name}="${escapeAttr(value)}"`;
  return html.slice(0, match.index) + `<${match[1]}${attrs}${match[3]}>` + html.slice(match.index + match[0].length);
}

function elementSlice(html, attr, key) {
  const re = openTagRe(attr, key);
  const match = html.match(re);
  if (!match) return null;
  const tag = match[1];
  if (VOID_TAGS.has(tag.toLowerCase()) || match[3] === '/') {
    return { start: match.index, end: match.index + match[0].length, open: match };
  }
  const innerStart = match.index + match[0].length;
  const closeAt = findClose(html, tag, innerStart);
  if (closeAt < 0) return null;
  const closeLen = `</${tag}>`.length;
  return { start: match.index, end: closeAt + closeLen, open: match };
}

function applyHideHtml(html, patch, skipCmsSlots) {
  const slice = elementSlice(html, KEY_ATTR, patch.key);
  if (!slice) return html;
  if (skipOpen(slice.open[2], skipCmsSlots)) return html;
  let attrs = slice.open[2];
  if (!/\sdata-asoldi-hidden=/.test(attrs)) attrs += ` ${HIDDEN_ATTR}="1"`;
  if (!/\shidden(?:\s|=|>)/i.test(attrs)) attrs += ' hidden';
  const nextOpen = `<${slice.open[1]}${attrs}${slice.open[3]}>`;
  return html.slice(0, slice.open.index) + nextOpen + html.slice(slice.open.index + slice.open[0].length);
}

function applyInsertHtml(html, patch) {
  const afterKey = String(patch.afterKey || '').trim();
  if (!afterKey || !patch.html) return html;
  const slice = elementSlice(html, KEY_ATTR, afterKey);
  if (!slice) return html;
  return html.slice(0, slice.end) + patch.html + html.slice(slice.end);
}

function applyRemoveHtml(html, patch) {
  const slice = elementSlice(html, KEY_ATTR, patch.key) || elementSlice(html, TEXT_ATTR, patch.key);
  if (!slice) return html;
  return html.slice(0, slice.start) + html.slice(slice.end);
}

export function normalizeRoutePath(route) {
  let path = String(route || '').trim();
  if (!path) return '';
  try {
    if (/^https?:\/\//i.test(path)) path = new URL(path).pathname;
  } catch {
    /* keep */
  }
  path = path.split('?')[0].split('#')[0];
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path || '/';
}

export function routeFromHtml(html) {
  const match = String(html || '').match(/data-asoldi-route="([^"]*)"/i);
  return match ? normalizeRoutePath(match[1]) : '';
}

export function patchMatchesRoute(patch, pageRoute) {
  const wanted = normalizeRoutePath(patch?.route);
  if (!wanted) return true;
  const current = normalizeRoutePath(pageRoute);
  if (!current) return true;
  return wanted === current;
}

function applyMoveHtml(html, patch) {
  const slice = elementSlice(html, KEY_ATTR, patch.key);
  if (!slice) return html;
  const block = html.slice(slice.start, slice.end);
  const without = html.slice(0, slice.start) + html.slice(slice.end);
  if (patch.beforeKey) {
    const target = elementSlice(without, KEY_ATTR, patch.beforeKey);
    if (!target) return html;
    return without.slice(0, target.start) + block + without.slice(target.start);
  }
  if (patch.afterKey) {
    const target = elementSlice(without, KEY_ATTR, patch.afterKey);
    if (!target) return html;
    return without.slice(0, target.end) + block + without.slice(target.end);
  }
  return html;
}

export function applyPatchesToHtml(html, patches, { skipCmsSlots = true, route } = {}) {
  let out = String(html || '');
  const pageRoute = route != null && String(route).trim() ? normalizeRoutePath(route) : routeFromHtml(out);
  for (const patch of normalizePatchList(patches)) {
    if (!patchMatchesRoute(patch, pageRoute)) continue;
    if (patch.type === 'text') out = replaceInner(out, TEXT_ATTR, patch.key, String(patch.value ?? ''), skipCmsSlots);
    else if (patch.type === 'media') out = replaceAttr(out, MEDIA_ATTR, patch.key, 'src', String(patch.value ?? ''), skipCmsSlots);
    else if (patch.type === 'href') out = replaceAttr(out, TEXT_ATTR, patch.key, 'href', String(patch.href || patch.value || ''), skipCmsSlots);
    else if (patch.type === 'hide') out = patch.hidden === false ? out : applyHideHtml(out, patch, skipCmsSlots);
    else if (patch.type === 'insert') out = applyInsertHtml(out, patch);
    else if (patch.type === 'remove') out = applyRemoveHtml(out, patch);
    else if (patch.type === 'move') out = applyMoveHtml(out, patch);
  }
  return out;
}

export function setElementTextPreserveChrome(el, next) {
  if (!el) return;
  const value = next == null ? '' : String(next);
  if (String(el.textContent || '') === value) return;
  const nodes = [...(el.childNodes || [])];
  const proto = nodes.find((node) => node.nodeType === 1 && node.tagName === 'SPAN' && String(node.textContent || '').length === 1);
  const onlySimple = nodes.length > 0 && nodes.every((node) => (
    node.nodeType === 3
    || (node.nodeType === 1 && node.tagName === 'SPAN' && String(node.textContent || '').length <= 2)
  ));
  if (proto && onlySimple && value.trim()) {
    const doc = el.ownerDocument;
    el.textContent = '';
    for (const part of value.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        el.appendChild(doc.createTextNode(part));
        continue;
      }
      const wrap = proto.cloneNode(false);
      wrap.textContent = part.charAt(0);
      el.appendChild(wrap);
      if (part.length > 1) el.appendChild(doc.createTextNode(part.slice(1)));
    }
    return;
  }
  el.textContent = value;
}

export function shouldSkipElement(el) {
  if (!el || el.nodeType !== 1) return true;
  if (el.hasAttribute?.(CMS_SLOT_ATTR)) return true;
  if (typeof el.closest === 'function' && el.closest(`[${CMS_SLOT_ATTR}]`)) return true;
  return false;
}

export function applyPatchesToDocument(document, patches, { skipCmsSlots = true, editor = false, route } = {}) {
  if (!document) return;
  const marked = document.querySelector?.('[data-asoldi-route]')?.getAttribute('data-asoldi-route');
  const pageRoute = route != null && String(route).trim()
    ? normalizeRoutePath(route)
    : normalizeRoutePath(marked || document.defaultView?.location?.pathname || '');
  for (const patch of normalizePatchList(patches)) {
    if (!patchMatchesRoute(patch, pageRoute)) continue;
    if (patch.type === 'text') {
      const el = document.querySelector(`[${TEXT_ATTR}="${cssEscape(patch.key)}"]`);
      if (!el || (skipCmsSlots && shouldSkipElement(el))) continue;
      setElementTextPreserveChrome(el, patch.value);
    } else if (patch.type === 'media') {
      const el = document.querySelector(`[${MEDIA_ATTR}="${cssEscape(patch.key)}"]`)
        || (patch.sectionKey ? document.querySelector(`[${KEY_ATTR}="${cssEscape(patch.sectionKey)}"]`) : null);
      if (!el || (skipCmsSlots && shouldSkipElement(el))) continue;
      const url = String(patch.value ?? '');
      if (el.hasAttribute('src') || /^(IMG|VIDEO|SOURCE)$/i.test(el.tagName)) el.setAttribute('src', url);
      else el.style.backgroundImage = `url("${url.replace(/"/g, '\\"')}")`;
    } else if (patch.type === 'href') {
      const el = document.querySelector(`[${TEXT_ATTR}="${cssEscape(patch.key)}"]`);
      if (!el || (skipCmsSlots && shouldSkipElement(el))) continue;
      const link = el.tagName === 'A' ? el : el.closest?.('a');
      if (link) link.setAttribute('href', String(patch.href || patch.value || ''));
    } else if (patch.type === 'hide') {
      const el = document.querySelector(`[${KEY_ATTR}="${cssEscape(patch.key)}"]`);
      if (!el || (skipCmsSlots && shouldSkipElement(el))) continue;
      if (patch.hidden === false) {
        el.removeAttribute('hidden');
        el.removeAttribute(HIDDEN_ATTR);
        el.style.removeProperty('display');
        el.style.removeProperty('opacity');
        continue;
      }
      el.setAttribute(HIDDEN_ATTR, '1');
      if (editor) {
        el.style.opacity = '0.35';
        el.style.outline = '1px dashed #94a3b8';
      } else {
        el.setAttribute('hidden', '');
        el.style.display = 'none';
      }
    } else if (patch.type === 'insert') {
      const after = document.querySelector(`[${KEY_ATTR}="${cssEscape(patch.afterKey)}"]`);
      if (!after || !patch.html) continue;
      after.insertAdjacentHTML('afterend', patch.html);
    } else if (patch.type === 'remove') {
      const el = document.querySelector(`[${KEY_ATTR}="${cssEscape(patch.key)}"]`);
      if (el) el.remove();
    } else if (patch.type === 'move') {
      const el = document.querySelector(`[${KEY_ATTR}="${cssEscape(patch.key)}"]`);
      if (!el) continue;
      if (patch.beforeKey) {
        const target = document.querySelector(`[${KEY_ATTR}="${cssEscape(patch.beforeKey)}"]`);
        if (target?.parentNode) target.parentNode.insertBefore(el, target);
      } else if (patch.afterKey) {
        const target = document.querySelector(`[${KEY_ATTR}="${cssEscape(patch.afterKey)}"]`);
        if (target) target.insertAdjacentElement('afterend', el);
      }
    }
  }
}

function cssEscape(value) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(String(value || ''));
  return String(value || '').replace(/["\\]/g, '\\$&');
}

export function siteHydratorScript() {
  return `(function(){
if (window.__asoldiSiteHydrator) return; window.__asoldiSiteHydrator = true;
var CMS='data-cms-slot', TEXT='data-asoldi-text', MEDIA='data-asoldi-media', KEY='data-asoldi-key', HID='data-asoldi-hidden';
function esc(v){ try { return CSS.escape(String(v||'')); } catch(e){ return String(v||'').replace(/["\\\\]/g,'\\\\$&'); } }
function skip(el){ return !el || el.nodeType!==1 || el.hasAttribute(CMS) || (el.closest && el.closest('['+CMS+']')); }
function setText(el, next){
  var value=next==null?'':String(next);
  if ((el.textContent||'')===value) return;
  var nodes=[], i; for (i=0;i<el.childNodes.length;i++) nodes.push(el.childNodes[i]);
  var proto=null, onlySimple=nodes.length>0;
  for (i=0;i<nodes.length;i++){
    var n=nodes[i];
    if (n.nodeType===1 && n.tagName==='SPAN' && String(n.textContent||'').length===1 && !proto) proto=n;
    if (!(n.nodeType===3 || (n.nodeType===1 && n.tagName==='SPAN' && String(n.textContent||'').length<=2))) onlySimple=false;
  }
  if (proto && onlySimple && value.replace(/\\s+/g,'')){
    var parts=value.split(/(\\s+)/);
    el.textContent='';
    for (i=0;i<parts.length;i++){
      var part=parts[i]; if (!part) continue;
      if (/^\\s+$/.test(part)){ el.appendChild(document.createTextNode(part)); continue; }
      var wrap=proto.cloneNode(false); wrap.textContent=part.charAt(0); el.appendChild(wrap);
      if (part.length>1) el.appendChild(document.createTextNode(part.slice(1)));
    }
    return;
  }
  el.textContent=value;
}
function normRoute(r){
  var path=String(r||'').trim();
  if (!path) return '';
  path=path.split('?')[0].split('#')[0];
  if (path.charAt(0)!=='/') path='/'+path;
  if (path.length>1 && path.charAt(path.length-1)==='/') path=path.slice(0,-1);
  return path||'/';
}
function pageRoute(doc){
  var el=doc && doc.querySelector && doc.querySelector('[data-asoldi-route]');
  if (el && el.getAttribute('data-asoldi-route')) return normRoute(el.getAttribute('data-asoldi-route'));
  try { return normRoute(location.pathname); } catch(e){ return ''; }
}
function matchRoute(p, route){
  var wanted=normRoute(p && p.route);
  if (!wanted) return true;
  var current=normRoute(route);
  if (!current) return true;
  return wanted===current;
}
function apply(doc, patches){
  if (!doc || !patches) return;
  var route=pageRoute(doc);
  for (var i=0;i<patches.length;i++){
    var p=patches[i]; if (!p || !p.type) continue;
    if (!matchRoute(p, route)) continue;
    if (p.type==='text'){
      var t=doc.querySelector('['+TEXT+'="'+esc(p.key)+'"]');
      if (!t || skip(t)) continue;
      setText(t, p.value);
    } else if (p.type==='media'){
      var m=doc.querySelector('['+MEDIA+'="'+esc(p.key)+'"]');
      if (!m || skip(m)) continue;
      var url=String(p.value||'');
      if (m.hasAttribute('src') || /^(IMG|VIDEO|SOURCE)$/i.test(m.tagName)) m.setAttribute('src', url);
      else m.style.backgroundImage='url("'+url.replace(/"/g,'\\\\"')+'")';
    } else if (p.type==='href'){
      var h=doc.querySelector('['+TEXT+'="'+esc(p.key)+'"]');
      if (!h || skip(h)) continue;
      var a=h.tagName==='A'?h:(h.closest&&h.closest('a'));
      if (a) a.setAttribute('href', String(p.href||p.value||''));
    } else if (p.type==='hide'){
      var s=doc.querySelector('['+KEY+'="'+esc(p.key)+'"]');
      if (!s || skip(s)) continue;
      if (p.hidden===false){ s.removeAttribute('hidden'); s.removeAttribute(HID); s.style.display=''; continue; }
      s.setAttribute(HID,'1'); s.setAttribute('hidden',''); s.style.display='none';
    } else if (p.type==='insert'){
      var after=doc.querySelector('['+KEY+'="'+esc(p.afterKey)+'"]');
      if (after && p.html) after.insertAdjacentHTML('afterend', p.html);
    } else if (p.type==='remove'){
      var rm=doc.querySelector('['+KEY+'="'+esc(p.key)+'"]');
      if (rm) rm.remove();
    } else if (p.type==='move'){
      var mv=doc.querySelector('['+KEY+'="'+esc(p.key)+'"]');
      if (!mv) continue;
      if (p.beforeKey){
        var before=doc.querySelector('['+KEY+'="'+esc(p.beforeKey)+'"]');
        if (before && before.parentNode) before.parentNode.insertBefore(mv, before);
      } else if (p.afterKey){
        var afterM=doc.querySelector('['+KEY+'="'+esc(p.afterKey)+'"]');
        if (afterM) afterM.insertAdjacentElement('afterend', mv);
      }
    }
  }
}
function run(patches){ try { apply(document, patches||[]); } catch (e) {} }
if (window.__ASOLDI_SITE_EDITS__ && window.__ASOLDI_SITE_EDITS__.patches) {
  run(window.__ASOLDI_SITE_EDITS__.patches);
} else {
  fetch('/api/cms/site-edits/public', { credentials: 'same-origin' })
    .then(function(r){ return r.ok ? r.json() : { patches: [] }; })
    .then(function(data){ run(data.patches || []); })
    .catch(function(){});
}
})();`;
}

export function injectOnce(html, marker, tag) {
  const source = String(html || '');
  if (!source) return source;
  if (source.includes(marker)) return source;
  if (/<\/body>/i.test(source)) return source.replace(/<\/body>/i, `${tag}</body>`);
  if (/<\/html>/i.test(source)) return source.replace(/<\/html>/i, `${tag}</html>`);
  return `${source}${tag}`;
}

export function injectSiteRuntimes(html, { editor = false, analytics = false, injectAnalytics } = {}) {
  let out = String(html || '');
  if (editor) {
    out = injectOnce(out, 'site-editor-runtime.js', '<script src="/api/cms/site-editor-runtime.js?v=4"></script>');
  } else {
    out = injectOnce(out, 'site-hydrator.js', '<script src="/api/cms/site-hydrator.js?v=3"></script>');
    out = injectOnce(out, 'content-runtime.js', '<script src="/api/cms/content-runtime.js" defer></script>');
  }
  if (analytics && typeof injectAnalytics === 'function') out = injectAnalytics(out);
  return out;
}

export { normalizePatch };
