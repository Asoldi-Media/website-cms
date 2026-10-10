/** Blog posts: normalize, decide what is public, and the shape the site reads. */
function slugify(value) {
    return String(value || '')
        .toLowerCase()
        .trim()
        .replace(/[^\w]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'post';
}
function normalizeBlock(raw, index = 0) {
    if (!raw || typeof raw !== 'object')
        return null;
    const type = String(raw.type || '').trim() === 'image' ? 'image' : 'text';
    const id = String(raw.id || `block-${index}`);
    if (type === 'image') {
        return {
            id,
            type: 'image',
            url: String(raw.url || '').trim(),
            alt: String(raw.alt || '').trim(),
        };
    }
    return {
        id,
        type: 'text',
        text: String(raw.text || raw.html || raw.content || ''),
    };
}
/** One stored post. Unknown status becomes draft. */
export function normalizePost(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const createdAt = raw.createdAt || new Date().toISOString();
    const title = String(raw.title || '').trim();
    const statusRaw = String(raw.status || 'draft').trim().toLowerCase();
    const status = statusRaw === 'published' || statusRaw === 'scheduled' ? statusRaw : 'draft';
    const scheduledAt = String(raw.scheduledAt || '').trim();
    const publishedAt = String(raw.publishedAt || '').trim();
    return {
        id: String(raw.id || ''),
        title,
        slug: String(raw.slug || slugify(title)),
        status,
        scheduledAt,
        publishedAt,
        authorId: String(raw.authorId || ''),
        authorName: String(raw.authorName || '').trim(),
        blocks: (Array.isArray(raw.blocks) ? raw.blocks : []).map(normalizeBlock).filter(Boolean),
        createdAt,
        updatedAt: raw.updatedAt || createdAt,
    };
}
/** Published, and not still waiting on scheduledAt. */
export function isPostPublic(post, now = new Date()) {
    if (!post)
        return false;
    if (post.status === 'published')
        return true;
    if (post.status === 'scheduled' && post.scheduledAt) {
        const when = new Date(post.scheduledAt);
        return !Number.isNaN(when.getTime()) && when.getTime() <= now.getTime();
    }
    return false;
}
/** Flip a due scheduled post to published. */
export function publishDuePost(post, now = new Date()) {
    const next = normalizePost(post);
    if (!next)
        return null;
    if (next.status === 'scheduled' && isPostPublic(next, now)) {
        next.status = 'published';
        next.publishedAt = next.publishedAt || now.toISOString();
        next.updatedAt = now.toISOString();
    }
    return next;
}
/** Post fields the public site is allowed to read. */
export function publicPost(post) {
    if (!post)
        return null;
    return {
        id: post.id,
        title: post.title,
        slug: post.slug,
        status: post.status,
        publishedAt: post.publishedAt,
        authorName: post.authorName,
        blocks: post.blocks,
    };
}
export { slugify };
