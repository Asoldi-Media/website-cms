/**
 * Pure rules for the monthly service posts.
 * The client CMS calls Asoldi for the brief, then writes text only.
 */

export const MONTHLY_QUOTA = 10;
export const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

export function localBlogEnabled(env = process.env) {
  const flag = String(env?.LOCAL_BLOG_ENABLED || '').trim().toLowerCase();
  return flag === '1' || flag === 'true';
}

export function monthKey(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function monthStart(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function nextMonthStart(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

export function emptyLedger(date = new Date()) {
  return { month: monthKey(date), posts: [], lastSkip: null };
}

export function postsForMonth(ledger, date = new Date()) {
  if (!ledger || ledger.month !== monthKey(date) || !Array.isArray(ledger.posts)) return [];
  return ledger.posts;
}

export function isPostDue(ledger, now = new Date(), quota = MONTHLY_QUOTA) {
  const posts = postsForMonth(ledger, now);
  if (posts.length >= quota) return false;
  const start = monthStart(now);
  const span = nextMonthStart(now) - start;
  const slot = start + Math.floor((span * posts.length) / quota);
  return now.getTime() >= slot;
}

export function topicKey(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function wordCount(html = '') {
  const text = String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .trim();
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function plainText(html = '') {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function safeContactPath(value = '') {
  const path = String(value || '').trim();
  if (!path.startsWith('/') || path.startsWith('//') || path.length > 200) return '';
  if (/[\s"'<>]/.test(path)) return '';
  return path;
}

function contactLabel(language = '') {
  const value = String(language || '').toLowerCase();
  if (value.includes('norsk') || value === 'no' || value.startsWith('nb') || value.startsWith('nn')) return 'Kontakt oss';
  return 'Contact';
}

function hrefOf(attrs = '') {
  const match = String(attrs || '').match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  return (match?.[1] || match?.[2] || match?.[3] || '').trim();
}

export function sanitizePostHtml(html = '', { contactPath = '', language = '' } = {}) {
  const path = safeContactPath(contactPath);
  const label = contactLabel(language);
  let source = String(html || '');
  source = source.replace(/<script[\s\S]*?<\/script>/gi, '');
  source = source.replace(/<style[\s\S]*?<\/style>/gi, '');
  source = source.replace(/<img\b[^>]*>/gi, '');
  source = source.replace(/<h1\b([^>]*)>/gi, '<h2$1>').replace(/<\/h1>/gi, '</h2>');
  source = source.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_full, attrs, inner) => {
    const href = hrefOf(attrs);
    const text = plainText(inner) || label;
    if (path && href === path) return `<a href="${path}">${text}</a>`;
    return text;
  });
  if (path && !source.includes(`href="${path}"`)) {
    source = `${source.trim()}\n<p><a href="${path}">${label}</a></p>`;
  }
  return source.trim();
}

function countPlace(text, place) {
  const needle = String(place || '').trim().toLowerCase();
  if (needle.length < 2) return 0;
  const hay = String(text || '').toLowerCase();
  let count = 0;
  let from = 0;
  while (from < hay.length) {
    const at = hay.indexOf(needle, from);
    if (at === -1) break;
    const before = at === 0 ? '' : hay[at - 1];
    const after = hay[at + needle.length] || '';
    const boundaryBefore = !before || /[^\p{L}\p{N}]/u.test(before);
    const boundaryAfter = !after || /[^\p{L}\p{N}]/u.test(after);
    if (boundaryBefore && boundaryAfter) count += 1;
    from = at + needle.length;
  }
  return count;
}

function sharesService(title, topic, services = []) {
  if (!services.length) return true;
  const hay = `${title} ${topic}`.toLowerCase();
  return services.some((service) => {
    const name = String(service?.name || '').trim().toLowerCase();
    if (!name) return false;
    if (name.length >= 3 && hay.includes(name)) return true;
    return name
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 4)
      .some((word) => hay.includes(word));
  });
}

export function extractJsonObject(raw = '') {
  const source = String(raw || '').trim();
  if (!source) return null;
  const unfenced = source.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(unfenced);
  } catch {
    // fall through
  }
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function parseDraft(raw) {
  const obj = raw && typeof raw === 'object' ? raw : extractJsonObject(raw);
  if (!obj || typeof obj !== 'object') return null;
  const title = String(obj.title || '').trim();
  return {
    title,
    topic: topicKey(obj.topic || title),
    html: String(obj.html || obj.body || '').trim(),
  };
}

export function acceptDraft(draft, { brief = {}, usedTopics = [] } = {}) {
  if (!draft?.title || !draft?.html) return { ok: false, reason: 'empty' };
  const used = new Set((Array.isArray(usedTopics) ? usedTopics : []).map(topicKey).filter(Boolean));
  if (!draft.topic || used.has(draft.topic)) return { ok: false, reason: 'repeat-topic' };
  const places = Array.isArray(brief.places) ? brief.places.map((place) => String(place || '').trim()).filter(Boolean) : [];
  if (places.some((place) => topicKey(place) === draft.topic)) return { ok: false, reason: 'topic-is-place' };
  if (places.some((place) => draft.title.trim().toLowerCase() === place.toLowerCase())) {
    return { ok: false, reason: 'title-is-place' };
  }
  const services = Array.isArray(brief.services) ? brief.services : [];
  if (!sharesService(draft.title, draft.topic, services)) return { ok: false, reason: 'off-brief' };
  const html = sanitizePostHtml(draft.html, { contactPath: brief.contactPath, language: brief.language });
  if (/<img\b/i.test(html)) return { ok: false, reason: 'image' };
  const words = wordCount(html);
  if (words < 500 || words > 1300) return { ok: false, reason: 'length' };
  const text = plainText(html);
  for (const place of places) {
    if (countPlace(text, place) > 2) return { ok: false, reason: 'place-stuffing' };
  }
  return {
    ok: true,
    topic: draft.topic,
    post: {
      title: draft.title,
      status: 'published',
      authorName: String(brief.businessName || '').trim(),
      blocks: [{ type: 'text', text: html }],
    },
  };
}

export function buildLocalBlogPrompt(brief = {}, usedTopics = []) {
  const places = Array.isArray(brief.places) ? brief.places.filter(Boolean) : [];
  const placeRule = places.length
    ? `You may mention ${places.join(' / ')} at most twice in the whole post, and only where a reader needs it. Do not name any other town, street, stop, or landmark.`
    : 'Do not name any town, street, neighborhood, stop, or landmark.';
  const system = [
    'You write one blog post a person would actually read about a real business.',
    'Return one JSON object with keys title, topic, and html. No markdown fence.',
    `Write the whole post in this language: ${brief.language || 'Norsk (Norge)'}.`,
    'The title is the service or the job, not a place name. topic is a short stable id for that service angle, with no place name.',
    'html is about 600 to 900 words, with two or three h2 headings. No h1. No images. No img tags.',
    'Use only the services and facts in the user message. Do not invent services, prices, reviews, events, news, or other businesses.',
    placeRule,
    'The address is context only. Do not print the street.',
    brief.contactPath
      ? `Include exactly one link, to ${brief.contactPath}. No other links.`
      : 'Do not include any links.',
    'Do not repeat a topic that was already used.',
  ].join(' ');
  const user = JSON.stringify({
    businessName: brief.businessName || '',
    whatTheyDo: brief.whatTheyDo || '',
    services: brief.services || [],
    places,
    hours: brief.hours || '',
    contactPath: brief.contactPath || '',
    usedTopics,
  });
  return { system, user };
}
