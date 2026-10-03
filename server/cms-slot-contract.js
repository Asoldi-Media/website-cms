// Keep in lockstep with website-maker lib/cms-content/hydrator-contract.js
// (scripts/cms-content-contract.test.mjs asserts the same attribute + inject order).
export const CMS_SLOT_ATTR = 'data-cms-slot';
export const CMS_WHEN_ATTR = 'data-cms-when';
export const CMS_LIST_ITEM_SLOT = 'listing.item';
export const CMS_EMPTY_SLOT = 'listing.empty';

export const PUBLIC_SCRIPT_INJECT_ORDER = Object.freeze([
  'forms-runtime',
  'asoldi-hydrator',
  'content-runtime',
]);

export const CONTENT_SEED_CONTRACT = Object.freeze({
  cmsSlotAttr: CMS_SLOT_ATTR,
  injectOrder: PUBLIC_SCRIPT_INJECT_ORDER,
  asoldiHydratorSkipsCmsSlots: true,
});

export function asoldiHydratorShouldSkip(el) {
  if (!el) return false;
  const attr = typeof el.getAttribute === 'function' ? el.getAttribute(CMS_SLOT_ATTR) : '';
  if (attr) return true;
  if (typeof el.closest === 'function' && el.closest(`[${CMS_SLOT_ATTR}]`)) return true;
  return false;
}
