/**
 * `cms.site.json` from Website Creator Step 3, read-only at runtime.
 * Lists are seeded once; forms carry destination and field map; pages carry kind and slot map.
 * Field keys match website-creator `lib/cms-hookup/field-schema.js`.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { CONTENT_SEED_CONTRACT } from './cms-slot-contract.js';
import { FORM_PURPOSES, PAGE_KINDS, SCHEMA_KEYS, SEED_DESTINATION_TYPES, } from './capabilities.js';
import { emptySlotMap, normalizeSlotMap } from './slot-map.js';
import { resolveCatalogType } from './catalog.js';
export { FORM_PURPOSES, PAGE_KINDS, SCHEMA_KEYS };
export const DESTINATION_TYPES = SEED_DESTINATION_TYPES;
function text(value = '') {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}
/** One cms.site.json list, or null without a name. */
export function normalizeSeedList(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const name = text(raw.name);
    if (!name)
        return null;
    return {
        id: text(raw.id),
        name,
        slug: text(raw.slug) || name.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, ''),
        description: text(raw.description),
    };
}
/** One cms.site.json form binding. Unknown field targets are dropped. */
export function normalizeSeedForm(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const id = text(raw.id);
    if (!id)
        return null;
    const destType = DESTINATION_TYPES.includes(text(raw.destination?.type)) ? text(raw.destination.type) : 'inbox';
    const fieldMap = {};
    for (const [key, value] of Object.entries(raw.fieldMap || {})) {
        const k = text(key);
        const v = text(value);
        if (k && SCHEMA_KEYS.includes(v))
            fieldMap[k] = v;
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
/** One cms.site.json page, including its slot map. */
export function normalizeSeedPage(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const route = text(raw.route);
    if (!route)
        return null;
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
    if (!raw || typeof raw !== 'object')
        return null;
    const products = Array.isArray(raw.products) ? raw.products : [];
    const categories = Array.isArray(raw.categories) ? raw.categories : [];
    if (!products.length)
        return null;
    return {
        catalogType: resolveCatalogType(raw.catalogType),
        categories,
        products,
    };
}
/** Full cms.site.json with defaults for anything missing. */
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
/** Seed with no lists, forms, or pages. */
export function emptySiteSeed() {
    return normalizeSiteSeed({});
}
/**
 * Load the seed from an explicit object, an explicit path, or the conventional
 * `cms.site.json` in the process cwd (where server.js lives on Hostinger).
 */
export function loadSiteSeed({ siteSeed, siteSeedPath } = {}) {
    if (siteSeed && typeof siteSeed === 'object')
        return normalizeSiteSeed(siteSeed);
    const candidates = [siteSeedPath, process.env.CMS_SITE_SEED, join(process.cwd(), 'cms.site.json')].filter(Boolean);
    for (const candidate of candidates) {
        try {
            if (!existsSync(candidate))
                continue;
            return normalizeSiteSeed(JSON.parse(readFileSync(candidate, 'utf8')));
        }
        catch {
            // try next
        }
    }
    return emptySiteSeed();
}
