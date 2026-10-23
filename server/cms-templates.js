/** CMS slot pages used when the published site has no page of that kind. Client HTML still wins. */
const SLOT = 'data-cms-slot';

function shell(kind, title, inner) {
    return `<!DOCTYPE html>
<html lang="nb">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    body { margin: 0; font-family: Georgia, serif; color: #1a202c; background: #f7fafc; }
    .cms-chrome { background: #1a202c; color: #fff; padding: 1rem 1.5rem; }
    .cms-chrome a { color: #bee3f8; }
    .cms-wrap { max-width: 960px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
    .cms-hero { display: grid; gap: 1.5rem; }
    @media (min-width: 800px) { .cms-hero { grid-template-columns: 1.1fr 0.9fr; } }
    .cms-hero img, .cms-card img { width: 100%; height: auto; background: #e2e8f0; }
    .cms-muted { color: #4a5568; }
    .cms-price { font-size: 1.5rem; font-weight: 700; }
    .cms-grid { display: grid; gap: 1.25rem; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
    .cms-card { background: #fff; border-radius: 8px; overflow: hidden; }
    article.cms-post { background: #fff; padding: 1.5rem; border-radius: 8px; }
    [hidden] { display: none !important; }
  </style>
</head>
<body data-cms-page-kind="${kind}">
  <header class="cms-chrome"><a href="/">Hjem</a></header>
  <main class="cms-wrap">${inner}</main>
</body>
</html>`;
}

const productInner = `
  <article class="cms-hero">
    <img ${SLOT}="product.image" alt="">
    <div>
      <p class="cms-muted" ${SLOT}="product.category"></p>
      <h1 ${SLOT}="product.name"></h1>
      <p class="cms-muted" ${SLOT}="product.subtitle"></p>
      <p><span class="cms-price" ${SLOT}="product.price"></span></p>
      <div ${SLOT}="product.description"></div>
      <a ${SLOT}="product.href" href="#">Permalink</a>
    </div>
  </article>`;

const indexInner = (heading) => `
  <h1>${heading}</h1>
  <p ${SLOT}="listing.empty" hidden>Ingen treff.</p>
  <div class="cms-grid">
    <article class="cms-card" ${SLOT}="listing.item">
      <img ${SLOT}="listing.item.image" alt="">
      <div>
        <h2 ${SLOT}="listing.item.name"></h2>
        <p ${SLOT}="listing.item.price"></p>
        <p class="cms-muted" ${SLOT}="listing.item.excerpt"></p>
        <p class="cms-muted"><span ${SLOT}="listing.item.date"></span> <span ${SLOT}="listing.item.author"></span></p>
        <a ${SLOT}="listing.item.href" href="#">Åpne</a>
      </div>
    </article>
  </div>`;

const postInner = `
  <article class="cms-post">
    <p class="cms-muted"><span ${SLOT}="post.publishedAt"></span> · <span ${SLOT}="post.authorName"></span></p>
    <h1 ${SLOT}="post.title"></h1>
    <div ${SLOT}="post.body"></div>
    <p><a ${SLOT}="post.href" href="#">Lenke</a></p>
  </article>`;

const BY_KIND = {
    'blog-index': shell('blog-index', 'Blogg', indexInner('Blogg')),
    'blog-post': shell('blog-post', 'Innlegg', postInner),
    'product-index': shell('product-index', 'Produkter', indexInner('Produkter')),
    'product-page': shell('product-page', 'Produkt', productInner),
};

/** HTML for a content kind, or '' when this URL is not a CMS template. */
export function fallbackHtmlForKind(kind) {
    return BY_KIND[String(kind || '')] || '';
}
