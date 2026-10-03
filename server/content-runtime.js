/**
 * Browser fill for data-cms-slot from GET /api/cms/catalog and /api/cms/posts.
 * Injected after asoldi-hydrator so CMS JSON wins on slotted nodes.
 */
export function contentRuntimeScript() {
  return `(function(){
if (window.__cmsContentRuntime) return; window.__cmsContentRuntime = true;
var SLOT='data-cms-slot';
var WHEN='data-cms-when';
function compact(v){ return String(v==null?'':v).replace(/\\s+/g,' ').trim(); }
function money(price){
  if (price==null || price==='') return '';
  if (typeof price==='number' && isFinite(price)) return price.toLocaleString('nb-NO')+' kr';
  var raw=String(price).trim();
  var n=Number(raw.replace(/\\s/g,'').replace(',','.'));
  if (isFinite(n) && /^-?\\d/.test(raw)) return n.toLocaleString('nb-NO')+' kr';
  return raw;
}
function kindOf(){
  var b=document.body;
  var k=compact(b && (b.getAttribute('data-asoldi-page-kind')||b.getAttribute('data-cms-page-kind')));
  if (k) return k;
  var p=location.pathname.replace(/\\/+$/,'')||'/';
  if (/^\\/products\\/[^/]+$/.test(p)) return 'product-page';
  if (/^\\/blog\\/[^/]+$/.test(p)) return 'blog-post';
  if (p==='/products') return 'product-index';
  if (p==='/blog') return 'blog-index';
  return '';
}
function lastSeg(){
  var parts=location.pathname.replace(/\\/+$/,'').split('/').filter(Boolean);
  return decodeURIComponent(parts[parts.length-1]||'');
}
function nodes(root, slot){
  root=root||document;
  var q='['+SLOT+'="'+slot+'"]';
  if (root===document) return Array.prototype.slice.call(document.querySelectorAll(q));
  var out=[];
  if (root.getAttribute && root.getAttribute(SLOT)===slot) out.push(root);
  var found=root.querySelectorAll && root.querySelectorAll(q);
  if (found) for (var i=0;i<found.length;i++) out.push(found[i]);
  return out;
}
function setSlot(root, slot, opts){
  opts=opts||{};
  var els=nodes(root, slot);
  for (var i=0;i<els.length;i++){
    var el=els[i];
    if (opts.show===false){ el.setAttribute('hidden','hidden'); continue; }
    el.removeAttribute('hidden');
    if (opts.src!=null){
      if (el.tagName==='IMG') el.setAttribute('src', opts.src);
      else el.style.backgroundImage='url('+opts.src+')';
      if (!opts.src) el.setAttribute('hidden','hidden');
    }
    if (opts.href!=null){
      if (el.tagName==='A') el.setAttribute('href', opts.href);
      else { var a=el.querySelector('a'); if (a) a.setAttribute('href', opts.href); }
    }
    if (opts.html!=null) el.innerHTML=opts.html;
    else if (opts.text!=null) el.textContent=opts.text;
  }
}
function applyWhen(type){
  var t=compact(type)||'normal';
  var all=document.querySelectorAll('['+WHEN+']');
  for (var i=0;i<all.length;i++){
    var el=all[i];
    var allowed=compact(el.getAttribute(WHEN)).split('|').map(function(s){return s.trim();}).filter(Boolean);
    if (!allowed.length) continue;
    if (allowed.indexOf(t)>=0 || allowed.indexOf('all')>=0) el.removeAttribute('hidden');
    else el.setAttribute('hidden','hidden');
  }
}
function catName(product, cats){
  var id=compact(product && product.categoryId);
  if (!id) return '';
  for (var i=0;i<(cats||[]).length;i++) if (String(cats[i].id)===id) return compact(cats[i].name);
  return '';
}
function fillProduct(product, cats){
  var contact=!!(product && product.contactInsteadOfPrice);
  var soldOut=!!(product && product.soldOut);
  var priceText=contact?'':money(product && product.price);
  var compare=contact?'':compact(product && product.comparePrice);
  applyWhen(product && product.productType);
  setSlot(document,'product.name',{text:compact(product && product.name)});
  setSlot(document,'product.subtitle',{text:compact(product && product.subtitle),show:!!compact(product && product.subtitle)});
  setSlot(document,'product.image',{src:compact(product && product.imageUrl),show:!!compact(product && product.imageUrl)});
  setSlot(document,'product.price',{text:priceText,show:!contact && !!priceText});
  setSlot(document,'product.comparePrice',{text:compare?money(compare):'',show:!!compare});
  setSlot(document,'product.contactInsteadOfPrice',{text:compact(product && product.cta)||'Kontakt oss',show:contact});
  var desc=compact(product && product.description);
  setSlot(document,'product.description',{html:desc?'<p>'+desc+'</p>':'',show:!!desc});
  var included=(product && product.included)||[];
  setSlot(document,'product.included',{html:included.length?'<ul>'+included.map(function(l){return '<li>'+compact(l)+'</li>';}).join('')+'</ul>':'',show:included.length>0});
  setSlot(document,'product.allergens',{text:compact(product && product.allergens),show:!!compact(product && product.allergens)});
  var extras=(product && product.extraTexts)||[];
  setSlot(document,'product.extraTexts',{html:extras.length?extras.map(function(l){return '<p>'+compact(l)+'</p>';}).join(''):'',show:extras.length>0});
  var options=(product && product.extraOptions)||[];
  setSlot(document,'product.extraOptions',{html:options.length?'<ul>'+options.map(function(o){return '<li>'+compact(o.name)+(o.price?' — '+money(o.price):'')+'</li>';}).join('')+'</ul>':'',show:options.length>0});
  var href='/products/'+compact(product && product.id);
  setSlot(document,'product.cta',{text:compact(product && product.cta)||'Kjøp',href:href,show:!contact});
  setSlot(document,'product.stockQty',{text:product && product.stockQty!=='' && product.stockQty!=null?String(product.stockQty):'',show:product && product.stockQty!=='' && product.stockQty!=null});
  setSlot(document,'product.soldOut',{text:soldOut?'Utsolgt':'',show:soldOut});
  var cn=catName(product,cats);
  setSlot(document,'product.category',{text:cn,show:!!cn});
  setSlot(document,'product.href',{href:href});
}
function postBody(post){
  var blocks=(post && post.blocks)||[];
  return blocks.map(function(b){
    if (b && b.type==='image' && b.url) return '<figure><img src="'+String(b.url).replace(/"/g,'&quot;')+'" alt="'+compact(b.alt).replace(/"/g,'&quot;')+'"></figure>';
    return String((b && (b.text||b.html))||'');
  }).join('\\n');
}
function coverUrl(post){
  var blocks=(post && post.blocks)||[];
  for (var i=0;i<blocks.length;i++){
    if (blocks[i] && blocks[i].type==='image' && compact(blocks[i].url)) return compact(blocks[i].url);
  }
  return '';
}
function excerpt(post){
  var blocks=(post && post.blocks)||[];
  var first=null;
  for (var i=0;i<blocks.length;i++) if (blocks[i] && blocks[i].type!=='image'){ first=blocks[i]; break; }
  var text=compact(String((first && first.text)||'').replace(/<[^>]+>/g,' '));
  return text.length>160?text.slice(0,159)+'…':text;
}
function fillPost(post){
  setSlot(document,'post.title',{text:compact(post && post.title)});
  setSlot(document,'post.slug',{text:compact(post && post.slug)});
  setSlot(document,'post.authorName',{text:compact(post && post.authorName),show:!!compact(post && post.authorName)});
  var when=compact(post && post.publishedAt);
  setSlot(document,'post.publishedAt',{text:when?new Date(when).toLocaleDateString('nb-NO'):'',show:!!when});
  var body=postBody(post);
  setSlot(document,'post.body',{html:body,show:!!body});
  setSlot(document,'post.href',{href:'/blog/'+compact((post && post.slug)||(post && post.id))});
}
function cloneListing(items, fillFn){
  var tpl=document.querySelector('['+SLOT+'="listing.item"]');
  var empty=document.querySelector('['+SLOT+'="listing.empty"]');
  if (!tpl) return;
  var parent=tpl.parentNode;
  var html=tpl.outerHTML;
  tpl.parentNode.removeChild(tpl);
  if (!items.length){ if (empty) empty.removeAttribute('hidden'); return; }
  if (empty) empty.setAttribute('hidden','hidden');
  for (var i=0;i<items.length;i++){
    parent.insertAdjacentHTML('beforeend', html);
    var clone=parent.lastElementChild;
    clone.removeAttribute('hidden');
    fillFn(clone, items[i]);
  }
}
function hideExtra(parent){
  if (!parent) return;
  var kids=parent.children;
  for (var i=0;i<kids.length;i++){
    var el=kids[i];
    if (el.getAttribute(SLOT)==='listing.item') continue;
    if (el.querySelector('img') && compact(el.textContent)) el.setAttribute('hidden','hidden');
  }
}
function pickProduct(products){
  var id=lastSeg();
  for (var i=0;i<(products||[]).length;i++){
    if (String(products[i].id)===id) return products[i];
  }
  return (products&&products[0])||null;
}
function pickPost(posts){
  var slug=lastSeg();
  for (var i=0;i<(posts||[]).length;i++){
    if (String(posts[i].slug)===slug || String(posts[i].id)===slug) return posts[i];
  }
  return (posts&&posts[0])||null;
}
function run(){
  var kind=kindOf();
  if (!kind) return;
  var catalogP=fetch('/api/cms/catalog',{credentials:'same-origin'}).then(function(r){return r.ok?r.json():{products:[],categories:[]};}).catch(function(){return {products:[],categories:[]};});
  var postsP=fetch('/api/cms/posts',{credentials:'same-origin'}).then(function(r){return r.ok?r.json():[];}).catch(function(){return [];});
  Promise.all([catalogP, postsP]).then(function(pair){
    var catalog=pair[0]||{};
    var posts=Array.isArray(pair[1])?pair[1]:[];
    var products=catalog.products||[];
    var cats=catalog.categories||[];
    if (kind==='product-page' || kind==='product-detail') fillProduct(pickProduct(products), cats);
    else if (kind==='blog-post') fillPost(pickPost(posts));
    else if (kind==='product-index'){
      var tpl=document.querySelector('['+SLOT+'="listing.item"]');
      if (tpl) hideExtra(tpl.parentNode);
      cloneListing(products, function(clone, item){
        setSlot(clone,'listing.item.name',{text:compact(item.name)});
        setSlot(clone,'listing.item.image',{src:compact(item.imageUrl),show:!!compact(item.imageUrl)});
        var contact=!!item.contactInsteadOfPrice;
        setSlot(clone,'listing.item.price',{text:contact?(compact(item.cta)||'Kontakt'):money(item.price),show:contact||item.price!=null});
        var href='/products/'+compact(item.id);
        setSlot(clone,'listing.item.href',{href:href});
        if (clone.tagName==='A') clone.setAttribute('href', href);
      });
    } else if (kind==='blog-index'){
      var tpl2=document.querySelector('['+SLOT+'="listing.item"]');
      if (tpl2) hideExtra(tpl2.parentNode);
      cloneListing(posts, function(clone, item){
        setSlot(clone,'listing.item.name',{text:compact(item.title)});
        var cover=coverUrl(item);
        setSlot(clone,'listing.item.image',{src:cover,show:!!cover});
        var href='/blog/'+compact(item.slug);
        setSlot(clone,'listing.item.href',{href:href});
        if (clone.tagName==='A') clone.setAttribute('href', href);
        setSlot(clone,'listing.item.excerpt',{text:excerpt(item),show:!!excerpt(item)});
        var when=compact(item.publishedAt);
        setSlot(clone,'listing.item.date',{text:when?new Date(when).toLocaleDateString('nb-NO'):'',show:!!when});
        setSlot(clone,'listing.item.author',{text:compact(item.authorName),show:!!compact(item.authorName)});
      });
    }
  });
}
if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', run);
else run();
})();`;
}
