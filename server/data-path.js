/** Directory for this site's CMS JSON. Defaults to ~/.asoldi-cms-data/<siteKey>. */
import { cpSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
const HOME_CMS_ROOT = join(homedir(), '.asoldi-cms-data');
/** Site key safe to use as a directory name. */
export function sanitizeDataKey(value = '') {
    const cleaned = String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    return cleaned || 'default';
}
function dirHasCmsFiles(dir) {
    if (!existsSync(dir))
        return false;
    try {
        return readdirSync(dir).some((name) => name.endsWith('.json') || name === 'uploads');
    }
    catch {
        return false;
    }
}
/** Copy ./data/cms into the new data dir once. */
export function migrateLegacyCmsData(destPath, { cwd = process.cwd() } = {}) {
    const dest = resolve(destPath);
    const legacy = resolve(cwd, 'data');
    if (dest === legacy)
        return { migrated: false, reason: 'same-path' };
    const destCms = join(dest, 'cms');
    const legacyCms = join(legacy, 'cms');
    if (!existsSync(legacyCms) || !dirHasCmsFiles(legacyCms)) {
        return { migrated: false, reason: 'no-legacy' };
    }
    if (dirHasCmsFiles(destCms)) {
        return { migrated: false, reason: 'dest-exists' };
    }
    mkdirSync(dest, { recursive: true });
    cpSync(legacyCms, destCms, { recursive: true });
    return { migrated: true, from: legacyCms, to: destCms };
}
/** CMS data directory: explicit path, else ~/.asoldi-cms-data/<siteKey>. */
export function resolveCmsDataPath({ dataPath, siteKey, cwd = process.cwd() } = {}) {
    const fromArg = String(dataPath || '').trim();
    const fromEnv = String(process.env.CMS_DATA_PATH || '').trim();
    const explicit = fromArg || fromEnv;
    const key = sanitizeDataKey(siteKey || process.env.CMS_SITE_KEY);
    const resolved = explicit ? resolve(cwd, explicit) : join(HOME_CMS_ROOT, key);
    mkdirSync(resolved, { recursive: true });
    migrateLegacyCmsData(resolved, { cwd });
    return resolved;
}
