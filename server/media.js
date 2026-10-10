/** Uploads on the Hostinger disk (`cms/uploads`), served at `/api/cms/uploads/<name>`. */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { basename, extname, join, resolve } from 'path';
const INDEX_FILE = 'media-index.json';
const EXTENSIONS = {
    image: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif'],
    video: ['.mp4', '.webm', '.mov', '.m4v'],
    audio: ['.mp3', '.wav', '.m4a', '.ogg'],
    document: ['.pdf'],
};
const MIME_BY_EXT = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.avif': 'image/avif',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.m4v': 'video/x-m4v',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.pdf': 'application/pdf',
};
/** image, video, audio, document, or other, from the extension. */
export function mediaKindForName(name = '') {
    const ext = extname(String(name || '')).toLowerCase();
    for (const [kind, list] of Object.entries(EXTENSIONS)) {
        if (list.includes(ext))
            return kind;
    }
    return 'other';
}
/** True when the extension is in the upload allow list. */
export function isAllowedMediaName(name = '') {
    return mediaKindForName(name) !== 'other';
}
/** MIME type for an upload name, or application/octet-stream. */
export function mediaMimeForName(name = '') {
    return MIME_BY_EXT[extname(String(name || '')).toLowerCase()] || 'application/octet-stream';
}
/** Upload cap in bytes. `CMS_UPLOAD_MAX_MB` (default 25). */
export function readUploadMaxBytes(env = process.env) {
    const raw = Number(env.CMS_UPLOAD_MAX_MB);
    const mb = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 2048) : 25;
    return Math.round(mb * 1024 * 1024);
}
/** Multer 1.x reads UTF-8 filenames as latin1. Re-decode when the name looks like that. */
export function fixLatin1Name(name = '') {
    const value = String(name || '');
    if (!/[\u0080-\u00ff]/.test(value) || /[\u0100-\uffff]/.test(value))
        return value;
    try {
        const decoded = Buffer.from(value, 'latin1').toString('utf8');
        return decoded.includes('\ufffd') ? value : decoded;
    }
    catch {
        return value;
    }
}
/** ASCII file name safe to store on disk. Keeps the extension. */
export function sanitizeUploadName(name = '') {
    const original = fixLatin1Name(name);
    const rawExt = extname(String(original || ''));
    const ext = rawExt.toLowerCase();
    const stem = basename(String(original || ''), rawExt)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/Ø/g, 'O')
        .replace(/ø/g, 'o')
        .replace(/Æ/g, 'AE')
        .replace(/æ/g, 'ae')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '')
        .slice(0, 80);
    return `${stem || `file-${Date.now()}`}${ext}`;
}
const SKIP_PUBLIC_DIRS = new Set(['node_modules', 'admin', 'admin-dist', 'cms', 'api', '.git']);

/** Images already on the live site (`public/`), listed next to CMS uploads. */
export function listPublicSiteMedia(publicPath) {
    const root = resolve(publicPath || '');
    if (!publicPath || !existsSync(root))
        return [];
    const items = [];
    function walk(dir, rel) {
        let entries = [];
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (entry.name.startsWith('.'))
                continue;
            const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!SKIP_PUBLIC_DIRS.has(entry.name))
                    walk(full, nextRel);
                continue;
            }
            if (mediaKindForName(entry.name) !== 'image')
                continue;
            const stat = statSync(full);
            items.push({
                name: nextRel,
                url: `/${nextRel.split('/').map(encodeURIComponent).join('/')}`,
                size: stat.size,
                kind: 'image',
                mime: mediaMimeForName(entry.name),
                alt: '',
                uploadedBy: 'Site',
                createdAt: stat.birthtime?.toISOString?.() || stat.mtime.toISOString(),
                origin: 'site',
            });
        }
    }
    walk(root, '');
    return items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** Uploads dir plus the alt-text index. Names are never overwritten. */
export function createMediaLibrary(uploadsDir) {
    const root = resolve(uploadsDir);
    if (!existsSync(root))
        mkdirSync(root, { recursive: true });
    const indexPath = join(root, INDEX_FILE);
    function readIndex() {
        try {
            const parsed = JSON.parse(readFileSync(indexPath, 'utf8'));
            return parsed && typeof parsed === 'object' ? parsed : {};
        }
        catch {
            return {};
        }
    }
    function writeIndex(index) {
        writeFileSync(indexPath, JSON.stringify(index, null, 2));
    }
    function safePath(name) {
        const base = basename(String(name || ''));
        if (!base || base === INDEX_FILE || base.startsWith('.'))
            return '';
        const full = resolve(root, base);
        return full.startsWith(root) ? full : '';
    }
    function itemFor(name, index, baseUrl) {
        const full = safePath(name);
        if (!full || !existsSync(full))
            return null;
        const stat = statSync(full);
        const meta = index[name] || {};
        return {
            name,
            url: `${baseUrl}/uploads/${encodeURIComponent(name)}`,
            size: stat.size,
            kind: mediaKindForName(name),
            mime: mediaMimeForName(name),
            alt: String(meta.alt || ''),
            uploadedBy: String(meta.uploadedBy || ''),
            createdAt: meta.createdAt || stat.birthtime?.toISOString?.() || stat.mtime.toISOString(),
        };
    }
    return {
        dir: root,
        maxBytes: readUploadMaxBytes(),
        /** Unique on-disk name for an upload (never overwrites). */
        pickName(original) {
            const safe = sanitizeUploadName(original);
            if (!existsSync(join(root, safe)))
                return safe;
            const ext = extname(safe);
            const stem = safe.slice(0, -ext.length || undefined);
            for (let i = 2; i < 1000; i += 1) {
                const candidate = `${stem}-${i}${ext}`;
                if (!existsSync(join(root, candidate)))
                    return candidate;
            }
            return `${stem}-${Date.now()}${ext}`;
        },
        list(baseUrl = '/api/cms') {
            const index = readIndex();
            return readdirSync(root, { withFileTypes: true })
                .filter((entry) => entry.isFile() && entry.name !== INDEX_FILE && !entry.name.startsWith('.'))
                .map((entry) => itemFor(entry.name, index, baseUrl))
                .filter(Boolean)
                .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        },
        get(name, baseUrl = '/api/cms') {
            return itemFor(basename(String(name || '')), readIndex(), baseUrl);
        },
        register(name, { uploadedBy = '', alt = '' } = {}) {
            const index = readIndex();
            index[name] = { ...(index[name] || {}), uploadedBy: String(uploadedBy || ''), alt: String(alt || ''), createdAt: new Date().toISOString() };
            writeIndex(index);
        },
        update(name, { alt, rename } = {}) {
            const current = safePath(name);
            if (!current || !existsSync(current))
                return { ok: false, reason: 'not-found' };
            const index = readIndex();
            let finalName = basename(current);
            if (rename !== undefined && String(rename).trim()) {
                const next = sanitizeUploadName(String(rename).trim());
                if (extname(next) !== extname(finalName))
                    return { ok: false, reason: 'bad-name' };
                if (next !== finalName) {
                    const target = safePath(next);
                    if (!target)
                        return { ok: false, reason: 'bad-name' };
                    if (existsSync(target))
                        return { ok: false, reason: 'exists' };
                    renameSync(current, target);
                    index[next] = index[finalName] || {};
                    delete index[finalName];
                    finalName = next;
                }
            }
            if (alt !== undefined)
                index[finalName] = { ...(index[finalName] || {}), alt: String(alt || '') };
            writeIndex(index);
            return { ok: true, name: finalName };
        },
        remove(name) {
            const full = safePath(name);
            if (!full)
                return { ok: false, reason: 'bad-name' };
            if (!existsSync(full))
                return { ok: false, reason: 'not-found' };
            unlinkSync(full);
            const index = readIndex();
            delete index[basename(full)];
            writeIndex(index);
            return { ok: true };
        },
    };
}
