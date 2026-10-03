// Parse stamped HTML into the cms.site.json slot map. Same shape as
// website-maker lib/cms-hookup/slot-map.js. Attributes only — never class/id.

function attr(source, name) {
  const re = new RegExp(`(?:^|\\s)${name}="([^"]*)"`, 'i');
  const match = String(source || '').match(re);
  return match ? match[1] : '';
}

export function extractSlotMapFromHtml(html = '') {
  const source = String(html || '');
  const sections = [];
  const text = [];
  const media = [];
  const cmsSlots = [];
  const tagRe = /<([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
  let match;
  while ((match = tagRe.exec(source))) {
    const attrs = match[2] || '';
    const textKey = attr(attrs, 'data-asoldi-text');
    const mediaKey = attr(attrs, 'data-asoldi-media');
    const key = attr(attrs, 'data-asoldi-key');
    const section = attr(attrs, 'data-asoldi-section');
    const cms = attr(attrs, 'data-cms-slot');
    if (textKey) text.push({ key: textKey });
    if (mediaKey) media.push({ key: mediaKey });
    if (key && section) sections.push({ key, section });
    if (cms) cmsSlots.push({ slot: cms });
  }
  return {
    sections,
    text,
    media,
    cmsSlots,
    hasMarkers: sections.length + text.length + media.length + cmsSlots.length > 0,
  };
}

export function emptySlotMap() {
  return { sections: [], text: [], media: [], cmsSlots: [], hasMarkers: false };
}

export function normalizeSlotMap(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const sections = (Array.isArray(src.sections) ? src.sections : [])
    .map((row) => ({
      key: String(row?.key || '').trim(),
      section: String(row?.section || '').trim(),
    }))
    .filter((row) => row.key && row.section);
  const text = (Array.isArray(src.text) ? src.text : [])
    .map((row) => ({ key: String(row?.key || row || '').trim() }))
    .filter((row) => row.key);
  const media = (Array.isArray(src.media) ? src.media : [])
    .map((row) => ({ key: String(row?.key || row || '').trim() }))
    .filter((row) => row.key);
  const cmsSlots = (Array.isArray(src.cmsSlots) ? src.cmsSlots : [])
    .map((row) => ({ slot: String(row?.slot || row || '').trim() }))
    .filter((row) => row.slot);
  return {
    sections,
    text,
    media,
    cmsSlots,
    hasMarkers: src.hasMarkers === true || sections.length + text.length + media.length > 0,
  };
}
