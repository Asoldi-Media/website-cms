/** Visual-editor patches. Draft until publish; published patches hydrate public HTML. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
const PATCH_TYPES = new Set(['text', 'media', 'href', 'hide', 'insert', 'remove', 'move']);
function text(value = '') {
    return String(value ?? '').trim();
}
function nextId() {
    return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
/** One visual-editor patch, or null when the type or key is unusable. */
export function normalizePatch(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const type = text(raw.type).toLowerCase();
    if (!PATCH_TYPES.has(type))
        return null;
    const route = text(raw.route) || '/';
    const key = text(raw.key);
    if (type !== 'insert' && !key)
        return null;
    if (type === 'insert' && !text(raw.afterKey) && !text(raw.html))
        return null;
    return {
        id: text(raw.id) || nextId(),
        route: route === '' ? '/' : route,
        type,
        key,
        value: raw.value === undefined || raw.value === null ? '' : raw.value,
        href: text(raw.href),
        selector: text(raw.selector),
        afterKey: text(raw.afterKey),
        beforeKey: text(raw.beforeKey),
        html: typeof raw.html === 'string' ? raw.html : '',
        hidden: type === 'hide' ? raw.hidden !== false && raw.value !== false : false,
    };
}
/** Patches that survived normalizePatch. */
export function normalizePatchList(raw) {
    return (Array.isArray(raw) ? raw : []).map(normalizePatch).filter(Boolean);
}
/** Empty draft and published patch lists. */
export function emptySiteEdits() {
    return { version: 1, updatedAt: '', patches: [] };
}
/** Stored site-edits document with both lists normalized. */
export function normalizeSiteEdits(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    return {
        version: Number(src.version) || 1,
        updatedAt: text(src.updatedAt),
        patches: normalizePatchList(src.patches),
    };
}
/** True when two patch lists carry the same edits. */
export function patchesEqual(a, b) {
    return JSON.stringify(normalizePatchList(a)) === JSON.stringify(normalizePatchList(b));
}
/** Draft and published patch files under the site data dir. */
export function createSiteEditsStore(dataPath) {
    const dir = join(dataPath, 'cms');
    const draftPath = join(dir, 'site-edits-draft.json');
    const livePath = join(dir, 'site-edits.json');
    function ensureDir() {
        if (!existsSync(dir))
            mkdirSync(dir, { recursive: true });
    }
    function readFile(path) {
        ensureDir();
        if (!existsSync(path))
            return emptySiteEdits();
        try {
            return normalizeSiteEdits(JSON.parse(readFileSync(path, 'utf8')));
        }
        catch {
            return emptySiteEdits();
        }
    }
    function writeFile(path, value) {
        ensureDir();
        const next = normalizeSiteEdits({ ...value, updatedAt: new Date().toISOString() });
        writeFileSync(path, JSON.stringify(next, null, 2), 'utf8');
        return next;
    }
    return {
        readDraft() {
            return readFile(draftPath);
        },
        readPublished() {
            return readFile(livePath);
        },
        writeDraft(patches) {
            return writeFile(draftPath, { version: 1, patches: normalizePatchList(patches) });
        },
        publish() {
            const draft = this.readDraft();
            return writeFile(livePath, draft);
        },
        snapshot() {
            const draft = this.readDraft();
            const published = this.readPublished();
            return {
                draft,
                published,
                dirty: !patchesEqual(draft.patches, published.patches),
                dirtyCount: draft.patches.length,
            };
        },
    };
}
