// Site seed (`cms.site.json`) — written by Website Creator's Step 3 "CMS hookup"
// and shipped in the client repo next to server.js. Read-only site structure:
//   lists   email lists the developer created before deploy (seeded once)
//   forms   frontend form bindings: destination (list/inbox) + field map
//   pages   page map with kinds (home/about/blog-post/product-page/…) plus asoldi slot map
//   content hydrator contract (cms-slot attr, inject order) — visual editor + catalog fill
// The CMS layers live data (leads, submissions) on top; this file never changes at runtime.
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { CONTENT_SEED_CONTRACT } from './cms-slot-contract.js';
import { emptySlotMap, normalizeSlotMap } from './slot-map.js';
import { resolveCatalogType } from './catalog.js';

export const FORM_PURPOSES = ['newsletter', 'contact', 'booking', 'order', 'search', 'login', 'other'];
export const DESTINATION_TYPES = ['list', 'inbox'];
export const PAGE_KINDS = [
  'home', 'about', 'services', 'menu', 'pricing', 'gallery', 'faq', 'contact',
  'blog-index', 'blog-post', 'product-index', 'product-page', 'cta', 'legal', 'other',
];
// Keys a submission can map to. Mirrors website-maker lib/cms-hookup/field-schema.js.
export const SCHEMA_KEYS = [
  'email', 'name', 'firstName', 'lastName', 'sms', 'whatsapp', 'language',
  'marketingAccept', 'message', 'subject', 'company', 'extra', 'skip',
];

function text(value = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function normalizeSeedList(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = text(raw.name);
  if (!name) return null;
  return {
    id: text(raw.id),
    name,
    slug: text(raw.slug) || name.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, ''),
    description: text(raw.description),
  };
}

export function normalizeSeedForm(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = text(raw.id);
  if (!id) return null;
  const destType = DESTINATION_TYPES.includes(text(raw.destination?.type)) ? text(raw.destination.type) : 'inbox';
  const fieldMap = {};
  for (const [key, value] of Object.entries(raw.fieldMap || {})) {
    const k = text(key);
    const v = text(value);
    if (k && SCHEMA_KEYS.includes(v)) fieldMap[k] = v;
  }
  return {
    id,
    label: text(raw.label) || id,
    purpose: FORM_PURPOSES.includes(text(raw.purpose)) ? text(raw.purpose) : 'other',
    destination: { type: destType, listId: text(raw.destination?.listId) },
    fieldMap,
    notify: raw.notify === true,
    successMessage: text(raw.successMessage),
    fields: (Array.isArray(raw.fields) ? raw.fields : [])
      .map((f) => ({
        key: text(f?.key),
        name: text(f?.name) || text(f?.key),
        type: text(f?.type),
        label: text(f?.label),
        required: f?.required === true,
      }))
      .filter((f) => f.key),
    pages: [...new Set((Array.isArray(raw.pages) ? raw.pages : []).map(text).filter(Boolean))],
    reviewed: raw.reviewed === true,
  };
}

export function normalizeSeedPage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const route = text(raw.route);
  if (!route) return null;
  const kind = PAGE_KINDS.includes(text(raw.kind)) ? text(raw.kind) : 'other';
  return {
    route,
    title: text(raw.title),
    navLabel: text(raw.navLabel),
    kind,
    isTemplate: raw.isTemplate === true || kind === 'blog-post' || kind === 'product-page',
    inNav: kind === 'blog-post' || kind === 'product-page' ? raw.inNav === true : raw.inNav !== false,
    slots: normalizeSlotMap(raw.slots || emptySlotMap()),
  };
}

function normalizeSeedCatalog(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const products = Array.isArray(raw.products) ? raw.products : [];
  const categories = Array.isArray(raw.categories) ? raw.categories : [];
  if (!products.length) return null;
  return {
    catalogType: resolveCatalogType(raw.catalogType),
    categories,
    products,
  };
}

export function normalizeSiteSeed(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    version: Number(src.version) || 1,
    generatedAt: text(src.generatedAt),
    site: {
      name: text(src.site?.name),
      language: text(src.site?.language),
      domain: text(src.site?.domain),
    },
    sourceStep: text(src.sourceStep),
    lists: (Array.isArray(src.lists) ? src.lists : []).map(normalizeSeedList).filter(Boolean),
    forms: (Array.isArray(src.forms) ? src.forms : []).map(normalizeSeedForm).filter(Boolean),
    pages: (Array.isArray(src.pages) ? src.pages : []).map(normalizeSeedPage).filter(Boolean),
    catalog: normalizeSeedCatalog(src.catalog),
    content: {
      cmsSlotAttr: text(src.content?.cmsSlotAttr) || CONTENT_SEED_CONTRACT.cmsSlotAttr,
      injectOrder: Array.isArray(src.content?.injectOrder) && src.content.injectOrder.length
        ? src.content.injectOrder.map(text).filter(Boolean)
        : [...CONTENT_SEED_CONTRACT.injectOrder],
      asoldiHydratorSkipsCmsSlots: src.content?.asoldiHydratorSkipsCmsSlots !== false,
    },
  };
}

export function emptySiteSeed() {
  return normalizeSiteSeed({});
}

/**
 * Load the seed from an explicit object, an explicit path, or the conventional
 * `cms.site.json` in the process cwd (where server.js lives on Hostinger).
 */
export function loadSiteSeed({ siteSeed, siteSeedPath } = {}) {
  if (siteSeed && typeof siteSeed === 'object') return normalizeSiteSeed(siteSeed);
  const candidates = [siteSeedPath, process.env.CMS_SITE_SEED, join(process.cwd(), 'cms.site.json')].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (!existsSync(candidate)) continue;
      return normalizeSiteSeed(JSON.parse(readFileSync(candidate, 'utf8')));
    } catch {
      // try next
    }
  }
  return emptySiteSeed();
}
