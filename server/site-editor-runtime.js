export function siteEditorRuntimeScript() {
  return `(function(){
if (window.__asoldiSiteEditor) return; window.__asoldiSiteEditor = true;
var TEXT='data-asoldi-text', MEDIA='data-asoldi-media', KEY='data-asoldi-key', SECTION='data-asoldi-section', CMS='data-cms-slot', HID='data-asoldi-hidden', INS='data-asoldi-inserted';
var state = { ready:false, page:{ route:'/', kind:'other', isTemplate:false, catalogType:'' }, patches:[], selected:null };
var parentOrigin = '*';

function esc(v){ try { return CSS.escape(String(v||'')); } catch(e){ return String(v||'').replace(/["\\\\]/g,'\\\\$&'); } }
function skipCms(el){ return !!(el && (el.hasAttribute(CMS) || (el.closest && el.closest('['+CMS+']')))); }
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
function isOurs(el){ return !!(el && (el.id && /^asoldi-ed-/.test(el.id) || (el.closest && el.closest('#asoldi-ed-root')))); }
function chromeOf(el){
  if (!el) return false;
  var sec = el.closest && el.closest('['+SECTION+']');
  var label = sec ? (sec.getAttribute(SECTION)||'') : '';
  if (label==='header' || label==='footer' || label==='nav') return true;
  return !!(el.closest && el.closest('header, footer, nav'));
}
function cmsSlotOf(el){
  var node = el && (el.hasAttribute && el.hasAttribute(CMS) ? el : (el.closest && el.closest('['+CMS+']')));
  return node ? (node.getAttribute(CMS)||'') : '';
}
function lockInfo(el){
  if (!el) return { locked:true, reason:'none' };
  var slot = cmsSlotOf(el);
  if (slot) {
    var tab = /^blog\\./.test(slot) || /^post\\./.test(slot) || slot.indexOf('card.title')>=0 || slot.indexOf('card.excerpt')>=0 ? 'blog' : 'ecommerce';
    return { locked:true, reason:'cms-slot', slot:slot, tab:tab, productId: (el.closest && el.closest('[data-cms-product-id]')) ? el.closest('[data-cms-product-id]').getAttribute('data-cms-product-id') : '' };
  }
  if (state.page.isTemplate && !chromeOf(el)) {
    return { locked:true, reason:'template', tab: state.page.kind==='blog-post' ? 'blog' : 'ecommerce' };
  }
  if (state.page.kind==='menu' && /\\/price\\//.test(el.getAttribute(TEXT)||'') && !slot) {
    return { locked:true, reason:'menu-unbound' };
  }
  return { locked:false };
}
function rasterBg(el){
  if (!el || el.nodeType!==1) return '';
  var parts=[];
  try { if (el.style && el.style.backgroundImage) parts.push(el.style.backgroundImage); } catch (e) {}
  try { parts.push(el.getAttribute('style')||''); } catch (e) {}
  try { parts.push(getComputedStyle(el).backgroundImage||''); } catch (e) {}
  var joined=parts.join(' ');
  var m=joined.match(/url\\(\\s*['"]?([^'")]+)['"]?\\s*\\)/i);
  return m ? m[1] : '';
}
function isMediaNode(el){
  if (!el || el.nodeType!==1) return false;
  if (el.hasAttribute(MEDIA)) return true;
  if (/^(IMG|VIDEO|PICTURE|SOURCE)$/i.test(el.tagName)) return true;
  return !!rasterBg(el);
}
function ensureMediaKey(el){
  if (!el) return '';
  var existing=el.getAttribute(MEDIA);
  if (existing) return existing;
  var section=el.closest && el.closest('['+KEY+']');
  var base=section ? section.getAttribute(KEY) : 'page';
  var n=1;
  while (document.querySelector('['+MEDIA+'="'+esc(base+'/image/'+n)+'"]')) n+=1;
  var key=base+'/image/'+n;
  el.setAttribute(MEDIA, key);
  return key;
}
function mediaAncestor(el){
  var n=el;
  while (n && n!==document.documentElement){
    if (isMediaNode(n)) return n;
    n=n.parentElement;
  }
  return null;
}
function addressable(el){
  if (!el || el.nodeType!==1) return null;
  if (el.hasAttribute(CMS)) return el;
  var cms=el.closest && el.closest('['+CMS+']');
  if (cms) return cms;
  if (isMediaNode(el)) return el;
  if (el.hasAttribute(TEXT)) return el;
  var text=el.closest && el.closest('['+TEXT+']');
  if (text) return text;
  var media=el.closest && el.closest('['+MEDIA+']') || mediaAncestor(el);
  if (media) return media;
  if (el.hasAttribute(KEY) || el.hasAttribute(SECTION)) return el;
  return (el.closest && el.closest('['+KEY+'],['+SECTION+']')) || null;
}
function kindOf(el){
  if (!el) return 'none';
  if (cmsSlotOf(el) || (state.page.isTemplate && !chromeOf(el))) return 'template';
  if (isMediaNode(el)) return 'media';
  if (el.hasAttribute(TEXT)) {
    var key = el.getAttribute(TEXT)||'';
    if (/\\/price\\//.test(key)) return 'price';
    if (el.tagName==='A' || /\\/cta\\//.test(key) || /\\/link\\//.test(key)) return 'link';
    return 'text';
  }
  if (el.hasAttribute(KEY) || el.hasAttribute(SECTION)) return 'section';
  return 'none';
}
function chip(kind, lock){
  if (lock && lock.locked && lock.reason==='cms-slot') return 'Mal-felt';
  if (lock && lock.locked && lock.reason==='template') return 'Mal-felt';
  if (lock && lock.locked && lock.reason==='menu-unbound') return 'Pris (CMS)';
  if (kind==='media') return 'Bilde';
  if (kind==='price') return 'Pris';
  if (kind==='link') return 'Lenke';
  if (kind==='section') return 'Seksjon';
  if (kind==='text') return 'Tekst';
  return 'Ikke redigerbar';
}

function normRoute(r){
  var path=String(r||'').trim();
  if (!path) return '';
  path=path.split('?')[0].split('#')[0];
  if (path.charAt(0)!=='/') path='/'+path;
  if (path.length>1 && path.charAt(path.length-1)==='/') path=path.slice(0,-1);
  return path||'/';
}
function applyPatches(patches){
  var list = patches || [];
  var route = normRoute(state.page && state.page.route);
  for (var i=0;i<list.length;i++){
    var p = list[i]; if (!p) continue;
    if (p.route && route && normRoute(p.route)!==route) continue;
    if (p.type==='text'){
      var t=document.querySelector('['+TEXT+'="'+esc(p.key)+'"]');
      if (!t || skipCms(t)) continue;
      setText(t, p.value);
    } else if (p.type==='media'){
      var m=document.querySelector('['+MEDIA+'="'+esc(p.key)+'"]');
      if (!m && p.sectionKey) m=document.querySelector('['+KEY+'="'+esc(p.sectionKey)+'"]');
      if (!m || skipCms(m)) continue;
      var url=String(p.value||'');
      if (m.hasAttribute('src') || /^(IMG|VIDEO|SOURCE|PICTURE)$/i.test(m.tagName)) m.setAttribute('src', url);
      else m.style.backgroundImage='url("'+url.replace(/"/g,'\\\\"')+'")';
    } else if (p.type==='href'){
      var h=document.querySelector('['+TEXT+'="'+esc(p.key)+'"]');
      if (!h || skipCms(h)) continue;
      var a=h.tagName==='A'?h:(h.closest&&h.closest('a'));
      if (a) a.setAttribute('href', String(p.href||p.value||''));
    } else if (p.type==='hide'){
      var s=document.querySelector('['+KEY+'="'+esc(p.key)+'"]');
      if (!s || skipCms(s)) continue;
      if (p.hidden===false){ s.removeAttribute('hidden'); s.removeAttribute(HID); s.style.opacity=''; s.style.outline=''; continue; }
      s.setAttribute(HID,'1'); s.style.opacity='0.35'; s.style.outline='1px dashed #94a3b8';
    } else if (p.type==='insert'){
      if (document.querySelector('['+KEY+'="'+esc(p.key)+'"]')) continue;
      var after=document.querySelector('['+KEY+'="'+esc(p.afterKey)+'"]');
      if (after && p.html) after.insertAdjacentHTML('afterend', p.html);
    } else if (p.type==='remove'){
      var rm=document.querySelector('['+KEY+'="'+esc(p.key)+'"]');
      if (rm) rm.remove();
    } else if (p.type==='move'){
      var mv=document.querySelector('['+KEY+'="'+esc(p.key)+'"]');
      if (!mv) continue;
      if (p.beforeKey){
        var before=document.querySelector('['+KEY+'="'+esc(p.beforeKey)+'"]');
        if (before && before.parentNode) before.parentNode.insertBefore(mv, before);
      } else if (p.afterKey){
        var afterM=document.querySelector('['+KEY+'="'+esc(p.afterKey)+'"]');
        if (afterM) afterM.insertAdjacentElement('afterend', mv);
      }
    }
  }
  paintSelected();
}

function send(payload){
  try { parent.postMessage(Object.assign({ source:'asoldi-editor' }, payload), parentOrigin); } catch (e) {}
}

function selectionOf(el){
  if (!el) return null;
  var kind = kindOf(el);
  var lock = lockInfo(el);
  if (kind==='media') ensureMediaKey(el);
  var related = (kind==='media') ? el : mediaAncestor(el && el.parentElement);
  if (related) ensureMediaKey(related);
  var key = el.getAttribute(TEXT) || el.getAttribute(MEDIA) || el.getAttribute(KEY) || '';
  var href = '';
  var link = el.tagName==='A'?el:(el.closest&&el.closest('a'));
  if (kind==='link' || link) href = link ? (link.getAttribute('href')||'') : '';
  if (link && kind!=='media' && kind!=='section') kind = kind==='none' ? 'link' : kind;
  var mediaEl = kind==='media' ? el : related;
  var mediaUrl = '';
  if (mediaEl) {
    mediaUrl = mediaEl.getAttribute('src') || mediaEl.currentSrc || rasterBg(mediaEl) || '';
  }
  var sectionEl = el.hasAttribute(KEY) ? el : (el.closest && el.closest('['+KEY+']'));
  return {
    kind: kind,
    key: key,
    route: state.page.route,
    value: el.textContent || '',
    href: href,
    mediaUrl: mediaUrl,
    mediaKey: mediaEl ? (mediaEl.getAttribute(MEDIA)||'') : '',
    mediaIsSection: !!(mediaEl && mediaEl.hasAttribute(KEY)),
    lock: lock,
    sectionKey: sectionEl ? sectionEl.getAttribute(KEY) : '',
    inserted: !!(sectionEl && sectionEl.getAttribute(INS)==='1'),
    chip: chip(kind, lock)
  };
}

var root = document.createElement('div');
root.id = 'asoldi-ed-root';
root.setAttribute('aria-hidden','true');
root.innerHTML = '<div id="asoldi-ed-hover"></div><div id="asoldi-ed-selected"></div><div id="asoldi-ed-chip"></div>';
document.documentElement.appendChild(root);
var style = document.createElement('style');
style.textContent = '#asoldi-ed-root{position:fixed;inset:0;pointer-events:none;z-index:2147483646;font-family:system-ui,sans-serif}'
  + '#asoldi-ed-hover{position:fixed;display:none;border:2px solid #FF5B00;background:rgba(255,91,0,.08);border-radius:4px;box-sizing:border-box}'
  + '#asoldi-ed-selected{position:fixed;display:none;border:2px solid #171717;border-radius:4px;box-sizing:border-box}'
  + '#asoldi-ed-chip{position:fixed;display:none;background:#111827;color:#fff;font-size:11px;line-height:1.2;padding:3px 7px;border-radius:4px;max-width:60vw;white-space:nowrap}'
  + 'a[href],area[href]{cursor:default}';
document.head.appendChild(style);
var hoverBox = document.getElementById('asoldi-ed-hover');
var selectedBox = document.getElementById('asoldi-ed-selected');
var chipEl = document.getElementById('asoldi-ed-chip');

function placeBox(el, box){
  if (!el) { box.style.display='none'; return; }
  var r = el.getBoundingClientRect();
  box.style.display = 'block';
  box.style.left = Math.max(4, r.left) + 'px';
  box.style.top = Math.max(4, r.top) + 'px';
  box.style.width = Math.max(8, r.width) + 'px';
  box.style.height = Math.max(8, r.height) + 'px';
}
function placeChip(el, text){
  if (!el) { chipEl.style.display='none'; return; }
  var r = el.getBoundingClientRect();
  var top = r.top>28 ? r.top-22 : r.bottom+6;
  if (top + 24 > window.innerHeight) top = Math.max(4, r.top-22);
  chipEl.textContent = text;
  chipEl.style.display = 'block';
  chipEl.style.left = Math.max(4, Math.min(r.left, window.innerWidth-160)) + 'px';
  chipEl.style.top = Math.max(4, top) + 'px';
}
function paintSelected(){
  placeBox(state.selected, selectedBox);
}

function emitSelect(el){
  state.selected = el || null;
  paintSelected();
  var payload = selectionOf(el);
  send({ type:'asoldi-editor-select', selection: payload });
  if (payload && payload.sectionKey) send({ type:'asoldi-editor-select-section', key:payload.sectionKey, route:state.page.route });
  else send({ type:'asoldi-editor-select-section', key:'', route:state.page.route });
}

document.addEventListener('mousemove', function(e){
  var el = document.elementFromPoint(e.clientX, e.clientY);
  if (!el || isOurs(el)) return;
  var hit = addressable(el);
  var boxEl = hit || el;
  if (!hit && (el===document.documentElement || el===document.body)) {
    hoverBox.style.display='none';
    if (!state.selected) chipEl.style.display='none';
    return;
  }
  var lock = hit ? lockInfo(hit) : { locked:false };
  var kind = hit ? kindOf(hit) : 'none';
  placeBox(boxEl, hoverBox);
  placeChip(boxEl, chip(kind, lock));
}, true);

function stopNav(e){
  var nav = e.target && e.target.closest && e.target.closest('a[href],area[href]');
  if (!nav) return false;
  e.preventDefault();
  e.stopPropagation();
  return true;
}
document.addEventListener('click', function(e){
  if (isOurs(e.target)) return;
  stopNav(e);
  var hit = addressable(e.target);
  if (!hit) {
    emitSelect(null);
    send({ type:'asoldi-editor-unmarked' });
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  emitSelect(hit);
}, true);
document.addEventListener('auxclick', function(e){ stopNav(e); }, true);
document.addEventListener('keydown', function(e){
  if (e.key!=='Enter' && e.key!==' ') return;
  if (e.target && e.target.closest && e.target.closest('a[href],area[href]')) {
    e.preventDefault();
    e.stopPropagation();
  }
}, true);

function onViewport(){ paintSelected(); }
window.addEventListener('scroll', onViewport, true);
window.addEventListener('resize', onViewport);

window.addEventListener('message', function(e){
  var data = e.data || {};
  if (data.source!=='asoldi-cms') return;
  parentOrigin = e.origin || '*';
  if (data.type==='asoldi-editor-init') {
    state.page = data.page || state.page;
    state.patches = data.draftPatches || [];
    applyPatches(state.patches);
    state.ready = true;
    send({ type:'asoldi-editor-ready', hasMarkers: !!document.querySelector('['+TEXT+'],['+MEDIA+'],['+KEY+']') });
  }
  if (data.type==='asoldi-editor-apply') {
    applyPatches(data.draftPatches || []);
  }
  if (data.type==='asoldi-editor-set-media' && data.key) {
    applyPatches([{ type:'media', route:state.page.route, key:data.key, value:data.url }]);
  }
  if (data.type==='asoldi-editor-clear-select') {
    state.selected = null;
    paintSelected();
  }
  if (data.type==='asoldi-editor-section-action' && data.action && data.key) {
    var sectionEl = document.querySelector('['+KEY+'="'+esc(data.key)+'"]');
    if (!sectionEl) return;
    var skey = data.key;
    if (data.action==='duplicate') {
      send({ type:'asoldi-editor-duplicate', key:skey, route:state.page.route, html: sectionEl.outerHTML });
      return;
    }
    if (data.action==='up') {
      var prev = sectionEl.previousElementSibling;
      var before = prev && prev.getAttribute && prev.getAttribute(KEY);
      if (before) send({ type:'asoldi-editor-change', patch:{ type:'move', route:state.page.route, key:skey, beforeKey:before } });
      return;
    }
    if (data.action==='down') {
      var next = sectionEl.nextElementSibling;
      var after = next && next.getAttribute && next.getAttribute(KEY);
      if (after) send({ type:'asoldi-editor-change', patch:{ type:'move', route:state.page.route, key:skey, afterKey:after } });
    }
  }
});

send({ type:'asoldi-editor-ready', hasMarkers: !!document.querySelector('['+TEXT+'],['+MEDIA+'],['+KEY+']') });
})();`;
}
