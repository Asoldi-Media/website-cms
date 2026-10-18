/**
 * Product CSV import (WooCommerce or Shopify export headers, variants included)
 * and export (WooCommerce-compatible, so our own export re-imports).
 */
import { parseMajor } from './money.js';
import { productVariants } from './product.js';

/** CSV text to rows keyed by header. Detects ; or , and strips a BOM. */
export function parseCsv(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field);
  if (row.some((v) => v !== '')) rows.push(row);
  const [header = [], ...body] = rows;
  const keys = header.map((h) => h.trim());
  return body.map((cells) => Object.fromEntries(keys.map((k, i) => [k, (cells[i] ?? '').trim()])));
}

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows to CSV text with quoting. */
export function toCsv(header, rows) {
  return `\uFEFF${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function stripHtml(html) {
  return String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim();
}

function price(value) {
  const n = parseMajor(value);
  return n == null ? '' : n;
}

function int(value) {
  if (value === '' || value == null) return '';
  const n = Math.floor(Number(String(value).replace(',', '.')));
  return Number.isFinite(n) ? n : '';
}

function truthy(value) {
  return ['1', 'yes', 'true', 'ja', 'y'].includes(String(value || '').trim().toLowerCase());
}

/** 'shopify', 'woocommerce' or '' from the header row. */
export function detectFormat(rows) {
  const keys = Object.keys(rows[0] || {});
  if (keys.includes('Handle') && keys.some((k) => k.startsWith('Variant '))) return 'shopify';
  if (keys.includes('Type') && keys.includes('Regular price')) return 'woocommerce';
  return '';
}

function wooCategory(value) {
  const first = String(value || '').split(',')[0] || '';
  return first.split('>').pop().trim();
}

function fromWoo(rows) {
  const errors = [];
  const parents = new Map();
  const products = [];
  rows.forEach((r, i) => {
    const type = String(r.Type || 'simple').toLowerCase();
    if (type.includes('variation')) return;
    const options = [];
    for (let n = 1; n <= 3; n += 1) {
      const name = r[`Attribute ${n} name`];
      const values = String(r[`Attribute ${n} value(s)`] || '').split(',').map((v) => v.trim()).filter(Boolean);
      if (name && values.length) options.push({ name, values });
    }
    if (!r.Name) {
      errors.push({ row: i + 2, message: 'Mangler navn.' });
      return;
    }
    const regular = price(r['Regular price']);
    const sale = price(r['Sale price']);
    const product = {
      importId: r.ID || '',
      name: r.Name,
      sku: r.SKU || '',
      kind: truthy(r['Downloadable?']) ? 'digital' : truthy(r['Virtual?']) ? 'service' : 'physical',
      price: regular === '' ? sale : regular,
      salePrice: regular !== '' && sale !== '' && sale < regular ? sale : '',
      saleFrom: r['Date sale price starts'] || '',
      saleTo: r['Date sale price ends'] || '',
      description: stripHtml(r.Description || r['Short description']),
      subtitle: stripHtml(r['Short description']).slice(0, 200),
      imageUrl: String(r.Images || '').split(',')[0].trim(),
      category: wooCategory(r.Categories),
      stockQty: int(r.Stock),
      soldOut: r['In stock?'] !== undefined && r['In stock?'] !== '' && !truthy(r['In stock?']) && int(r.Stock) === '',
      backorders: truthy(r['Backorders allowed?']) ? 'yes' : 'no',
      taxClass: { 'reduced-rate': 'food', 'zero-rate': 'zero' }[String(r['Tax class'] || '').toLowerCase()] || (r['Tax class'] || ''),
      weightGrams: r['Weight (kg)'] ? Math.round(Number(String(r['Weight (kg)']).replace(',', '.')) * 1000) || '' : '',
      barcode: r['GTIN, UPC, EAN, or ISBN'] || '',
      lowStockAt: int(r['Low stock amount']),
      options: type === 'variable' ? options : [],
      variants: [],
    };
    if (r.Kind) product.kind = r.Kind;
    products.push(product);
    if (r.ID) parents.set(`id:${r.ID}`, product);
    if (r.ID) parents.set(String(r.ID), product);
    if (r.SKU) parents.set(r.SKU, product);
  });
  rows.forEach((r, i) => {
    if (!String(r.Type || '').toLowerCase().includes('variation')) return;
    const parent = parents.get(String(r.Parent || '').trim());
    if (!parent) {
      errors.push({ row: i + 2, message: `Fant ikke forelder ${r.Parent || ''}.` });
      return;
    }
    const optionValues = {};
    for (let n = 1; n <= 3; n += 1) {
      const name = r[`Attribute ${n} name`];
      const value = String(r[`Attribute ${n} value(s)`] || '').split(',')[0].trim();
      if (name && value) optionValues[name] = value;
    }
    const regular = price(r['Regular price']);
    const sale = price(r['Sale price']);
    parent.variants.push({ optionValues, sku: r.SKU || '', price: regular, salePrice: regular !== '' && sale !== '' && sale < regular ? sale : '', stockQty: int(r.Stock), weightGrams: r['Weight (kg)'] ? Math.round(Number(String(r['Weight (kg)']).replace(',', '.')) * 1000) || '' : '', barcode: r['GTIN, UPC, EAN, or ISBN'] || '', imageUrl: String(r.Images || '').split(',')[0].trim() });
  });
  return { products, errors };
}

function fromShopify(rows) {
  const errors = [];
  const byHandle = new Map();
  rows.forEach((r, i) => {
    const handle = r.Handle;
    if (!handle) {
      errors.push({ row: i + 2, message: 'Mangler Handle.' });
      return;
    }
    let product = byHandle.get(handle);
    if (!product) {
      if (!r.Title) {
        errors.push({ row: i + 2, message: 'Første rad for produktet mangler Title.' });
        return;
      }
      product = { importId: handle, name: r.Title, description: stripHtml(r['Body (HTML)']), brand: r.Vendor || '', category: String(r['Product Category'] || '').split('>').pop().trim() || r.Type || '', imageUrl: r['Image Src'] || '', options: [], variants: [], kind: 'physical', _rows: [] };
      for (let n = 1; n <= 3; n += 1) {
        const name = r[`Option${n} Name`];
        if (name && name !== 'Title') product.options.push({ name, values: [] });
      }
      byHandle.set(handle, product);
    }
    if (!r['Variant Price'] && !r['Variant SKU'] && !r['Option1 Value']) return;
    product._rows.push(r);
  });
  const products = [];
  for (const product of byHandle.values()) {
    const variants = product._rows.map((r) => {
      const optionValues = {};
      product.options.forEach((o, idx) => {
        const value = r[`Option${idx + 1} Value`];
        if (value) {
          optionValues[o.name] = value;
          if (!o.values.includes(value)) o.values.push(value);
        }
      });
      const p = price(r['Variant Price']);
      const compare = price(r['Variant Compare At Price']);
      return {
        optionValues,
        sku: r['Variant SKU'] || '',
        price: compare !== '' && p !== '' && compare > p ? compare : p,
        salePrice: compare !== '' && p !== '' && compare > p ? p : '',
        stockQty: r['Variant Inventory Tracker'] === '' ? '' : int(r['Variant Inventory Qty']),
        weightGrams: int(r['Variant Grams']),
        barcode: r['Variant Barcode'] || '',
        imageUrl: r['Variant Image'] || '',
        backorders: String(r['Variant Inventory Policy']).toLowerCase() === 'continue' ? 'yes' : 'no',
        requiresShipping: r['Variant Requires Shipping'] === '' ? undefined : truthy(r['Variant Requires Shipping']),
        taxable: r['Variant Taxable'] === '' ? true : truthy(r['Variant Taxable']),
      };
    });
    delete product._rows;
    if (!product.options.length || variants.length <= 1) {
      const v = variants[0] || {};
      Object.assign(product, { price: v.price ?? '', salePrice: v.salePrice ?? '', sku: v.sku || '', stockQty: v.stockQty ?? '', weightGrams: v.weightGrams ?? '', barcode: v.barcode || '', backorders: v.backorders || 'no', options: [], variants: [] });
      if (v.requiresShipping === false) product.kind = 'service';
      if (v.taxable === false) product.taxClass = 'zero';
    } else {
      product.variants = variants;
      product.price = variants[0].price;
      product.backorders = variants.some((v) => v.backorders === 'yes') ? 'yes' : 'no';
      if (variants.every((v) => v.requiresShipping === false)) product.kind = 'service';
    }
    products.push(product);
  }
  return { products, errors };
}

/** Products from a WooCommerce or Shopify CSV. Our own export uses the WooCommerce columns. */
export function importProducts(text) {
  const rows = parseCsv(text);
  const format = detectFormat(rows);
  if (!format) return { format: '', products: [], errors: [{ row: 1, message: 'Ukjent CSV-format. Bruk en eksport fra WooCommerce eller Shopify (eller vår egen eksport).' }] };
  const result = format === 'shopify' ? fromShopify(rows) : fromWoo(rows);
  return { format, ...result };
}

const EXPORT_HEADER = ['ID', 'Type', 'SKU', 'Name', 'Published', 'Short description', 'Description', 'Regular price', 'Sale price', 'Date sale price starts', 'Date sale price ends', 'Categories', 'Images', 'In stock?', 'Stock', 'Backorders allowed?', 'Tax class', 'Weight (kg)', 'Parent', 'Attribute 1 name', 'Attribute 1 value(s)', 'Attribute 2 name', 'Attribute 2 value(s)', 'Attribute 3 name', 'Attribute 3 value(s)', 'GTIN, UPC, EAN, or ISBN', 'Virtual?', 'Downloadable?', 'Kind'];

/** Products as CSV in WooCommerce columns. */
export function exportProducts(products, categories) {
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const rows = [];
  for (const p of products) {
    const variable = p.variants?.length > 0;
    const attrs = [0, 1, 2].flatMap((i) => [p.options?.[i]?.name || '', (p.options?.[i]?.values || []).join(', ')]);
    rows.push([p.id, variable ? 'variable' : 'simple', p.sku, p.name, 1, p.subtitle, p.description, typeof p.price === 'number' ? p.price : '', p.salePrice, p.saleFrom, p.saleTo, catName.get(p.categoryId) || '', p.imageUrl, p.soldOut ? 0 : 1, variable ? '' : p.stockQty, p.backorders === 'yes' ? 1 : 0, p.taxClass, p.weightGrams ? p.weightGrams / 1000 : '', '', ...attrs, p.barcode, p.kind === 'service' || p.kind === 'booking' ? 1 : 0, p.kind === 'digital' ? 1 : 0, p.kind]);
    if (!variable) continue;
    for (const v of productVariants(p)) {
      const vattrs = [0, 1, 2].flatMap((i) => [p.options?.[i]?.name || '', p.options?.[i] ? v.optionValues[p.options[i].name] || '' : '']);
      rows.push([`${p.id}-${v.id}`, 'variation', v.sku, `${p.name} – ${Object.values(v.optionValues).join(' / ')}`, 1, '', '', v.price, v.salePrice, '', '', '', v.imageUrl, 1, v.stockQty, p.backorders === 'yes' ? 1 : 0, '', v.weightGrams ? v.weightGrams / 1000 : '', p.id, ...vattrs, v.barcode, '', '', '']);
    }
  }
  return toCsv(EXPORT_HEADER, rows);
}
