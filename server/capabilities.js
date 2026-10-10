/**
 * Closed feeler list Website Creator Step 3 binds to.
 * Additive only: new keys or endpoints are fine; renaming one is a major version.
 * Slot names stay in lockstep with website-creator `lib/cms-content/slot-contract.js`.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { CMS_SLOT_ATTR, CMS_WHEN_ATTR, PUBLIC_SCRIPT_INJECT_ORDER, CONTENT_SEED_CONTRACT } from './cms-slot-contract.js';
const here = dirname(fileURLToPath(import.meta.url));
export const CONTRACT_VERSION = 1;
/** Version from this package's package.json, or 0.0.0. */
export function cmsPackageVersion() {
    try {
        const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
        return String(pkg.version || '').trim() || '0.0.0';
    }
    catch {
        return '0.0.0';
    }
}
export const FORM_PURPOSES = Object.freeze([
    'newsletter',
    'contact',
    'booking',
    'order',
    'search',
    'login',
    'other',
]);
/** Destinations Maker may assign, including ignore (not stored in cms.site.json). */
export const DESTINATION_TYPES = Object.freeze(['list', 'inbox', 'ignore']);
/** Destinations that may appear on a live seed form. */
export const SEED_DESTINATION_TYPES = Object.freeze(['list', 'inbox']);
export const PAGE_KINDS = Object.freeze([
    'home',
    'about',
    'services',
    'menu',
    'pricing',
    'gallery',
    'faq',
    'contact',
    'blog-index',
    'blog-post',
    'product-index',
    'product-page',
    'cta',
    'legal',
    'other',
]);
export const LEAD_SCHEMA = Object.freeze([
    { key: 'email', label: 'E-mail', required: true },
    { key: 'name', label: 'Full name' },
    { key: 'firstName', label: 'First name' },
    { key: 'lastName', label: 'Last name' },
    { key: 'sms', label: 'Phone / SMS' },
    { key: 'whatsapp', label: 'WhatsApp' },
    { key: 'language', label: 'Language' },
    { key: 'marketingAccept', label: 'Marketing consent' },
    { key: 'message', label: 'Message' },
    { key: 'subject', label: 'Subject' },
    { key: 'company', label: 'Company' },
    { key: 'extra', label: 'Keep as extra field' },
    { key: 'skip', label: 'Do not store' },
]);
export const INBOX_SCHEMA = Object.freeze([
    { key: 'email', label: 'E-mail (reply-to)' },
    { key: 'name', label: 'Name' },
    { key: 'sms', label: 'Phone' },
    { key: 'subject', label: 'Subject' },
    { key: 'message', label: 'Message' },
    { key: 'company', label: 'Company' },
    { key: 'extra', label: 'Keep as extra field' },
    { key: 'skip', label: 'Do not store' },
]);
export const SCHEMA_KEYS = Object.freeze([
    ...new Set([...LEAD_SCHEMA, ...INBOX_SCHEMA].map((row) => row.key)),
]);
export const PRODUCT_SLOTS = Object.freeze([
    'product.name',
    'product.subtitle',
    'product.image',
    'product.price',
    'product.comparePrice',
    'product.contactInsteadOfPrice',
    'product.description',
    'product.included',
    'product.allergens',
    'product.extraTexts',
    'product.extraOptions',
    'product.cta',
    'product.stockQty',
    'product.soldOut',
    'product.category',
    'product.href',
]);
export const POST_SLOTS = Object.freeze([
    'post.title',
    'post.slug',
    'post.authorName',
    'post.publishedAt',
    'post.body',
    'post.href',
]);
export const LISTING_SLOTS = Object.freeze([
    'listing.item',
    'listing.empty',
    'listing.item.name',
    'listing.item.image',
    'listing.item.price',
    'listing.item.href',
    'listing.item.excerpt',
    'listing.item.date',
    'listing.item.author',
]);
export const ALL_CMS_SLOTS = Object.freeze([...PRODUCT_SLOTS, ...POST_SLOTS, ...LISTING_SLOTS]);
export const PUBLIC_SITE_ENDPOINTS = Object.freeze([
    { id: 'forms.submit', method: 'POST', path: '/api/cms/forms/:id/submit' },
    { id: 'forms.runtime', method: 'GET', path: '/api/cms/forms-runtime.js' },
    { id: 'catalog.public', method: 'GET', path: '/api/cms/catalog' },
    { id: 'posts.list', method: 'GET', path: '/api/cms/posts' },
    { id: 'posts.one', method: 'GET', path: '/api/cms/posts/:slug' },
    { id: 'content.runtime', method: 'GET', path: '/api/cms/content-runtime.js' },
    { id: 'site.hydrator', method: 'GET', path: '/api/cms/site-hydrator.js' },
    { id: 'site.edits.public', method: 'GET', path: '/api/cms/site-edits/public' },
]);
/** Lead schema for list forms, inbox schema otherwise. */
export function schemaForDestination(destinationType) {
    return String(destinationType || '') === 'inbox' ? INBOX_SCHEMA : LEAD_SCHEMA;
}
/** Schema key names for a destination type. */
export function schemaKeys(destinationType) {
    return schemaForDestination(destinationType).map((entry) => entry.key);
}
/** The feeler catalog Maker Step 3 is allowed to bind to. */
export function cmsCapabilities() {
    return {
        contractVersion: CONTRACT_VERSION,
        packageVersion: cmsPackageVersion(),
        formPurposes: [...FORM_PURPOSES],
        destinationTypes: [...DESTINATION_TYPES],
        seedDestinationTypes: [...SEED_DESTINATION_TYPES],
        pageKinds: [...PAGE_KINDS],
        leadSchema: LEAD_SCHEMA.map((row) => ({ ...row })),
        inboxSchema: INBOX_SCHEMA.map((row) => ({ ...row })),
        schemaKeys: [...SCHEMA_KEYS],
        slots: [...ALL_CMS_SLOTS],
        slotAttr: CMS_SLOT_ATTR,
        whenAttr: CMS_WHEN_ATTR,
        injectOrder: [...PUBLIC_SCRIPT_INJECT_ORDER],
        content: { ...CONTENT_SEED_CONTRACT },
        publicEndpoints: PUBLIC_SITE_ENDPOINTS.map((row) => ({ ...row })),
    };
}
/** Closed-vocabulary block for the Step 3 binding model. Do not invent endpoints. */
export function cmsCapabilitiesPromptBlock() {
    const caps = cmsCapabilities();
    const endpoints = caps.publicEndpoints.map((row) => `${row.method} ${row.path}`).join(', ');
    const leadKeys = caps.leadSchema.map((row) => row.key).join(', ');
    const inboxKeys = caps.inboxSchema.map((row) => row.key).join(', ');
    return [
        `CMS contract v${caps.contractVersion} (package ${caps.packageVersion}). Bind the website to these feelers only. Do not invent HTTP endpoints, destinations, or schema keys. A later CMS with the same endpoints must keep working.`,
        `Public endpoints: ${endpoints}.`,
        `Purposes: ${caps.formPurposes.join('/')}.`,
        `Destinations: list (subscribers/leads), inbox (email the owner), ignore (search/login/not data).`,
        `List schema keys: ${leadKeys}. Inbox schema keys: ${inboxKeys}. Unknown real data → extra. Technical fields → skip.`,
        `CMS content slots (data-cms-slot): ${caps.slots.join(', ')}.`,
    ].join(' ');
}
function text(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}
/** True when a live seed only uses feelers this version still implements. No seed is compatible. */
export function checkCmsSeedCompatibility(seed, capabilities = cmsCapabilities()) {
    if (!seed || typeof seed !== 'object') {
        return { ok: true, errors: [], skipped: 'no-seed' };
    }
    const destOk = new Set(capabilities.seedDestinationTypes || SEED_DESTINATION_TYPES);
    const keyOk = new Set(capabilities.schemaKeys || SCHEMA_KEYS);
    const kindOk = new Set(capabilities.pageKinds || PAGE_KINDS);
    const slotOk = new Set(capabilities.slots || ALL_CMS_SLOTS);
    const errors = [];
    for (const form of Array.isArray(seed.forms) ? seed.forms : []) {
        const dest = text(form?.destination?.type);
        if (dest && !destOk.has(dest)) {
            errors.push(`form ${text(form.id) || '?'} destination "${dest}" is not in this CMS`);
        }
        for (const value of Object.values(form?.fieldMap || {})) {
            const key = text(value);
            if (key && !keyOk.has(key)) {
                errors.push(`form ${text(form.id) || '?'} fieldMap key "${key}" is not in this CMS`);
            }
        }
    }
    for (const page of Array.isArray(seed.pages) ? seed.pages : []) {
        const kind = text(page?.kind);
        if (kind && !kindOk.has(kind)) {
            errors.push(`page ${text(page.route) || '?'} kind "${kind}" is not in this CMS`);
        }
        const slots = Array.isArray(page?.slots?.cmsSlots) ? page.slots.cmsSlots : [];
        for (const row of slots) {
            const slot = text(row?.slot || row);
            if (slot && !slotOk.has(slot)) {
                errors.push(`page ${text(page.route) || '?'} slot "${slot}" is not in this CMS`);
            }
        }
    }
    return { ok: errors.length === 0, errors };
}
