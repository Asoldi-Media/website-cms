export function siteEditorRuntimeScript() {
  return `(function(){
if (window.__asoldiSiteEditor) return; window.__asoldiSiteEditor = true;
var TEXT='data-asoldi-text', MEDIA='data-asoldi-media', KEY='data-asoldi-key', SECTION='data-asoldi-section', CMS='data-cms-slot', HID='data-asoldi-hidden', INS='data-asoldi-inserted';
var state = { ready:false, page:{ route:'/', kind:'other', isTemplate:false, catalogType:'' }, patches:[], selected:null, editing:null };
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
function addressable(el){
  if (!el || el.nodeType!==1) return null;
  var leaf = el.closest('['+TEXT+'],['+MEDIA+'],['+CMS+']');
  if (leaf) return leaf;
  if (el.hasAttribute(KEY) || el.hasAttribute(SECTION)) return el;
  return null;
}
function kindOf(el){
  if (!el) return 'none';
  if (cmsSlotOf(el) || (state.page.isTemplate && !chromeOf(el))) return 'template';
  if (el.hasAttribute(MEDIA)) return 'media';
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
      if (!m || skipCms(m)) continue;
      var url=String(p.value||'');
      if (m.hasAttribute('src') || /^(IMG|VIDEO|SOURCE)$/i.test(m.tagName)) m.setAttribute('src', url);
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
}

function send(payload){
  try { parent.postMessage(Object.assign({ source:'asoldi-editor' }, payload), parentOrigin); } catch (e) {}
}

var root = document.createElement('div');
root.id = 'asoldi-ed-root';
root.setAttribute('aria-hidden','true');
root.innerHTML = '<div id="asoldi-ed-outline"></div><div id="asoldi-ed-chip"></div><div id="asoldi-ed-bar"></div>';
document.documentElement.appendChild(root);
var style = document.createElement('style');
style.textContent = '#asoldi-ed-root{position:fixed;inset:0;pointer-events:none;z-index:2147483646;font-family:system-ui,sans-serif}'
  + '#asoldi-ed-outline{position:fixed;display:none;border:2px solid #FF5B00;background:rgba(255,91,0,.08);border-radius:4px;box-sizing:border-box}'
  + '#asoldi-ed-chip{position:fixed;display:none;background:#111827;color:#fff;font-size:11px;line-height:1.2;padding:3px 7px;border-radius:4px;max-width:60vw;white-space:nowrap}'
  + '#asoldi-ed-bar{position:fixed;display:none;pointer-events:auto;background:#111827;color:#fff;border-radius:8px;padding:6px;gap:4px;box-shadow:0 8px 24px rgba(0,0,0,.28);align-items:center}'
  + '#asoldi-ed-bar button,#asoldi-ed-bar input{pointer-events:auto;font:12px/1.2 system-ui,sans-serif}'
  + '#asoldi-ed-bar button{background:#374151;color:#fff;border:0;border-radius:6px;padding:5px 8px;cursor:pointer}'
  + '#asoldi-ed-bar button.primary{background:#FF5B00}'
  + '#asoldi-ed-bar input{background:#1f2937;color:#fff;border:1px solid #4b5563;border-radius:6px;padding:4px 6px;min-width:140px}'
  + '[contenteditable="true"]{outline:2px solid #FF5B00;outline-offset:2px}';
document.head.appendChild(style);
var outline = document.getElementById('asoldi-ed-outline');
var chipEl = document.getElementById('asoldi-ed-chip');
var bar = document.getElementById('asoldi-ed-bar');

function placeBox(el, box, yPrefer){
  var r = el.getBoundingClientRect();
  box.style.display = 'block';
  box.style.left = Math.max(4, r.left) + 'px';
  box.style.top = Math.max(4, r.top) + 'px';
  box.style.width = Math.max(8, r.width) + 'px';
  box.style.height = Math.max(8, r.height) + 'px';
  var top = yPrefer==='above' && r.top>32 ? r.top-26 : r.bottom+6;
  if (top + 28 > window.innerHeight) top = Math.max(4, r.top-26);
  chipEl.style.display = 'block';
  chipEl.style.left = Math.max(4, Math.min(r.left, window.innerWidth-160)) + 'px';
  chipEl.style.top = Math.max(4, top) + 'px';
}
function placeBar(el){
  var r = el.getBoundingClientRect();
  bar.style.display = 'flex';
  var top = r.top>48 ? r.top-44 : r.bottom+8;
  var left = Math.max(8, Math.min(r.left, window.innerWidth-280));
  if (top + 48 > window.innerHeight) top = Math.max(8, window.innerHeight-52);
  bar.style.left = left + 'px';
  bar.style.top = top + 'px';
}
function hideUi(){
  outline.style.display='none'; chipEl.style.display='none';
  if (!state.editing) bar.style.display='none';
}

function btn(label, cls, fn){
  var b=document.createElement('button');
  b.type='button'; b.textContent=label; if (cls) b.className=cls;
  b.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); fn(); });
  return b;
}

function emitChange(patch){
  send({ type:'asoldi-editor-change', patch:patch });
}

function commitText(el){
  if (!el || state.editing !== el) return;
  el.removeAttribute('contenteditable');
  el.removeEventListener('blur', el.__asoldiStop || function(){});
  el.removeEventListener('keydown', el.__asoldiKey || function(){});
  state.editing = null;
  emitChange({ type:'text', route:state.page.route, key:el.getAttribute(TEXT), value:el.textContent });
}
function startTextEdit(el){
  var lock = lockInfo(el);
  if (lock.locked) return;
  state.editing = el;
  el.setAttribute('contenteditable','true');
  try { el.focus(); } catch (e) {}
  var stop = function(){ commitText(el); };
  var onKey = function(e){ if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); commitText(el); } };
  el.__asoldiStop = stop;
  el.__asoldiKey = onKey;
  el.addEventListener('blur', stop);
  el.addEventListener('keydown', onKey);
}

function showBar(el){
  var kind = kindOf(el);
  var lock = lockInfo(el);
  bar.innerHTML = '';
  if (lock.locked && lock.reason==='menu-unbound') {
    bar.appendChild(document.createTextNode('Koble priser etter ny publisering'));
    placeBar(el);
    return;
  }
  if (lock.locked) {
    if (lock.reason==='cms-slot' && lock.slot && /price/i.test(lock.slot) && lock.productId) {
      var input=document.createElement('input');
      input.type='number'; input.step='0.01'; input.value = (el.textContent||'').replace(/[^0-9.,-]/g,'');
      bar.appendChild(input);
      bar.appendChild(btn('Lagre i produkter','primary', function(){
        send({ type:'asoldi-editor-product-put', productId:lock.productId, field:'price', value:input.value, route:state.page.route });
      }));
    }
    bar.appendChild(btn(lock.tab==='blog' ? 'Åpne Blogg' : 'Åpne Produkter','primary', function(){
      send({ type:'asoldi-editor-open-tab', tab: lock.tab==='blog' ? 'blog' : 'ecommerce' });
    }));
    placeBar(el);
    return;
  }
  if (kind==='text' || kind==='price') {
    bar.appendChild(btn('Rediger','primary', function(){ startTextEdit(el); }));
  }
  if (kind==='link') {
    bar.appendChild(btn('Rediger tekst', '', function(){ startTextEdit(el); }));
    var hrefInput=document.createElement('input');
    hrefInput.type='text';
    hrefInput.value = (el.tagName==='A'?el:el.closest('a')).getAttribute('href')||'';
    hrefInput.placeholder='Lenke';
    bar.appendChild(hrefInput);
    bar.appendChild(btn('Lagre lenke','primary', function(){
      emitChange({ type:'href', route:state.page.route, key:el.getAttribute(TEXT), href:hrefInput.value, value:hrefInput.value });
    }));
  }
  if (kind==='media') {
    bar.appendChild(btn('Bytt bilde','primary', function(){
      send({ type:'asoldi-editor-pick-media', key:el.getAttribute(MEDIA), route:state.page.route });
    }));
  }
  if (kind==='section' || el.hasAttribute(KEY)) {
    var sectionEl = el.hasAttribute(KEY) ? el : el.closest('['+KEY+']');
    var skey = sectionEl ? sectionEl.getAttribute(KEY) : '';
    bar.appendChild(btn('Skjul', '', function(){ emitChange({ type:'hide', route:state.page.route, key:skey, hidden:true }); }));
    bar.appendChild(btn('Vis', '', function(){ emitChange({ type:'hide', route:state.page.route, key:skey, hidden:false, value:false }); }));
    bar.appendChild(btn('Dupliser', '', function(){ send({ type:'asoldi-editor-duplicate', key:skey, route:state.page.route, html: sectionEl ? sectionEl.outerHTML : '' }); }));
    if (sectionEl && sectionEl.getAttribute(INS)==='1') {
      bar.appendChild(btn('Slett','', function(){ emitChange({ type:'remove', route:state.page.route, key:skey }); }));
    }
    bar.appendChild(btn('Opp','', function(){
      var prev = sectionEl && sectionEl.previousElementSibling;
      var before = prev && prev.getAttribute && prev.getAttribute(KEY);
      if (before) emitChange({ type:'move', route:state.page.route, key:skey, beforeKey:before });
    }));
    bar.appendChild(btn('Ned','', function(){
      var next = sectionEl && sectionEl.nextElementSibling;
      var after = next && next.getAttribute && next.getAttribute(KEY);
      if (after) emitChange({ type:'move', route:state.page.route, key:skey, afterKey:after });
    }));
    send({ type:'asoldi-editor-select-section', key:skey, route:state.page.route });
  }
  placeBar(el);
}

var hoverEl = null;
document.addEventListener('mousemove', function(e){
  if (state.editing) return;
  var el = document.elementFromPoint(e.clientX, e.clientY);
  if (!el || isOurs(el)) return;
  var hit = addressable(el);
  hoverEl = hit;
  if (!hit) {
    chipEl.textContent = chip('none', { locked:false });
    if (el && el !== document.documentElement && el !== document.body) placeBox(el, outline, 'above');
    else { outline.style.display='none'; chipEl.style.display='none'; }
    return;
  }
  var lock = lockInfo(hit);
  var kind = kindOf(hit);
  chipEl.textContent = chip(kind, lock);
  placeBox(hit, outline, 'above');
}, true);

document.addEventListener('pointerdown', function(e){
  if (!state.editing) return;
  if (state.editing === e.target || (state.editing.contains && state.editing.contains(e.target))) return;
  if (isOurs(e.target)) return;
  commitText(state.editing);
}, true);

document.addEventListener('click', function(e){
  if (isOurs(e.target)) return;
  if (state.editing) return;
  var hit = addressable(e.target);
  if (!hit) {
    send({ type:'asoldi-editor-unmarked' });
    bar.style.display='none';
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  state.selected = hit;
  showBar(hit);
}, true);

document.addEventListener('keydown', function(e){
  if (e.key==='Escape' && state.editing) { document.activeElement && document.activeElement.blur(); }
}, true);

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
    emitChange({ type:'media', route:state.page.route, key:data.key, value:data.url });
  }
});

send({ type:'asoldi-editor-ready', hasMarkers: !!document.querySelector('['+TEXT+'],['+MEDIA+'],['+KEY+']') });
})();`;
}
