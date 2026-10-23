/**
 * Admin token secret and first admin login for this site.
 * An env value wins when it is strong; otherwise the value is generated once
 * under {dataPath}/cms/private/secrets (outside the deployed repo) and reused.
 */
import { randomBytes } from 'crypto';
import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';

export const KNOWN_DEFAULT_SECRETS = Object.freeze(['change-me', 'changeme', 'change-me-in-production', 'secret', 'admin', 'password', 'test', 'dev']);
export const WEAK_ADMIN_PASSWORDS = Object.freeze(['changeme', 'change-me', 'admin', 'password', 'passord', '12345678', '123456789', 'administrator']);
/** Checked against the stored admin hash at start (one bcrypt compare each, so keep it short). */
export const DEFAULT_ADMIN_PASSWORDS = Object.freeze(['changeme']);
export const MIN_ENV_SECRET_LENGTH = 16;
export const MIN_ENV_PASSWORD_LENGTH = 8;
const DISK_SECRET_MIN_LENGTH = 32;
const SECRETS_FILE = 'secrets.json';
const INITIAL_ADMIN_FILE = 'initial-admin.json';
/** A sign-in file name: the secret or the first admin login, or a set-aside or temp copy of one. */
const SIGN_IN_FILE_NAME = /^(secrets|initial-admin)\.json(\..*)?$/;
const NO_HARD_LINKS = Object.freeze(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'ENOSYS', 'EACCES', 'EMLINK']);

/** {dataPath}/cms/private: never served by URL; the shop keeps its digital product files here. */
export function cmsPrivateDir(dataPath) {
    return join(String(dataPath || ''), 'cms', 'private');
}
/**
 * {dataPath}/cms/private/secrets: the session secret and the first admin login. A subfolder, because
 * shop file names can never contain a slash, so no shop file route can reach into it.
 */
export function cmsSecretsDir(dataPath) {
    return join(cmsPrivateDir(dataPath), 'secrets');
}
function ensurePrivateDir(dataPath) {
    if (!dataPath)
        throw new Error('CMS secrets need a dataPath.');
    const dir = cmsSecretsDir(dataPath);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
}
/**
 * True for a sign-in file name. Shop download files never match (uploads are named
 * <time>-<hex>.<ext>), so the shop file routes skip these names.
 */
export function isSignInFileName(name) {
    return SIGN_IN_FILE_NAME.test(String(name ?? ''));
}
function sameContent(a, b) {
    try {
        return readFileSync(a).equals(readFileSync(b));
    }
    catch {
        return false;
    }
}
function unlinkIfPresent(file) {
    try {
        unlinkSync(file);
    }
    catch (error) {
        if (error?.code !== 'ENOENT')
            throw error;
    }
}
/** Move `source` to `target` only if `target` does not exist yet. Returns false when it does. */
function moveOnce(source, target) {
    try {
        linkSync(source, target);
    }
    catch (error) {
        if (error?.code === 'EEXIST')
            return false;
        if (!NO_HARD_LINKS.includes(error?.code))
            throw error;
        if (existsSync(target))
            return false;
        renameSync(source, target);
        return true;
    }
    unlinkIfPresent(source);
    return true;
}
/**
 * CMS 1.7.x kept the session secret and the first admin login directly in cms/private.
 * This version reads them from cms/private/secrets and keeps shop download files in
 * cms/private, so move them: sessions signed before the upgrade stay valid, and the
 * files leave the shop files folder. A file already in the secrets folder wins; a
 * different older copy is kept next to it as <name>.legacy-<time>. Never throws.
 * Returns { moved, failed } (file names).
 */
export function adoptLegacySignInFiles(dataPath) {
    const moved = [];
    const failed = [];
    if (!dataPath)
        return { moved, failed };
    const from = cmsPrivateDir(dataPath);
    let names;
    try {
        names = readdirSync(from, { withFileTypes: true }).filter((entry) => entry.isFile() && isSignInFileName(entry.name)).map((entry) => entry.name);
    }
    catch {
        return { moved, failed };
    }
    if (!names.length)
        return { moved, failed };
    let dir;
    try {
        dir = ensurePrivateDir(dataPath);
    }
    catch {
        return { moved, failed: names };
    }
    for (const name of names) {
        const source = join(from, name);
        const target = join(dir, name);
        try {
            if (!moveOnce(source, target)) {
                // Another start moved the same file first, or this version already made its own.
                if (sameContent(source, target))
                    unlinkIfPresent(source);
                else
                    renameSync(source, join(dir, `${name}.legacy-${Date.now()}-${randomBytes(3).toString('hex')}`));
            }
            moved.push(name);
        }
        catch (error) {
            if (error?.code === 'ENOENT')
                continue;
            failed.push(name);
        }
    }
    return { moved, failed };
}
/** True for a value that is long enough and not a well-known placeholder. */
export function isStrongSecret(value) {
    const s = String(value ?? '').trim();
    return s.length >= MIN_ENV_SECRET_LENGTH && !KNOWN_DEFAULT_SECRETS.includes(s.toLowerCase());
}
/** True for a password that may seed the first admin. */
export function isUsableAdminPassword(value) {
    const s = String(value ?? '');
    return s.length >= MIN_ENV_PASSWORD_LENGTH && !WEAK_ADMIN_PASSWORDS.includes(s.trim().toLowerCase());
}
function randomToken(bytes = 32) {
    return randomBytes(bytes).toString('base64url');
}
/** Create `file` with `text` only if it does not exist yet. Returns false when another writer won. */
export function writeFileOnce(file, text) {
    const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    writeFileSync(tmp, text, { mode: 0o600, flag: 'wx' });
    try {
        // A hard link appears complete or not at all, so a reader never sees half a file.
        linkSync(tmp, file);
        return true;
    }
    catch (error) {
        if (error?.code === 'EEXIST')
            return false;
        if (!['EPERM', 'ENOTSUP', 'EXDEV', 'ENOSYS', 'EACCES'].includes(error?.code))
            throw error;
        try {
            writeFileSync(file, text, { mode: 0o600, flag: 'wx' });
            return true;
        }
        catch (fallbackError) {
            if (fallbackError?.code === 'EEXIST')
                return false;
            throw fallbackError;
        }
    }
    finally {
        try {
            unlinkSync(tmp);
        }
        catch {
            // already gone
        }
    }
}
function readSecretsFile(file) {
    try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        const adminSecret = String(parsed?.adminSecret || '');
        return adminSecret.length >= DISK_SECRET_MIN_LENGTH ? { adminSecret, createdAt: String(parsed.createdAt || '') } : null;
    }
    catch {
        return null;
    }
}
function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
/** Read or create {dataPath}/cms/private/secrets/secrets.json. Concurrent first starts agree on one secret. */
export function readOrCreateDiskSecrets(dataPath) {
    const dir = ensurePrivateDir(dataPath);
    // A site upgraded from 1.7.x keeps its secret (and so its sessions).
    adoptLegacySignInFiles(dataPath);
    const file = join(dir, SECRETS_FILE);
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const existing = existsSync(file) ? readSecretsFile(file) : null;
        if (existing)
            return { ...existing, created: false };
        if (!existsSync(file)) {
            const createdAt = new Date().toISOString();
            const adminSecret = randomToken(32);
            const body = `${JSON.stringify({ version: 1, adminSecret, createdAt }, null, 2)}\n`;
            if (writeFileOnce(file, body))
                return { adminSecret, createdAt, created: true };
        }
        // Another process is writing it (fallback path) or the file is damaged; give it a moment.
        for (let i = 0; i < 20; i += 1) {
            sleepSync(25);
            const settled = readSecretsFile(file);
            if (settled)
                return { ...settled, created: false };
        }
        // Still unreadable: keep the damaged file for inspection and start a new one.
        try {
            renameSync(file, `${file}.damaged-${Date.now()}`);
        }
        catch {
            // someone else moved it
        }
    }
    throw new Error('Could not create the CMS secrets file.');
}
/**
 * Admin token secret. Order: explicit option (when strong or not a placeholder),
 * env CMS_ADMIN_SECRET / ADMIN_SECRET (when strong), then the disk secret.
 * Sign-in files a 1.7.x site left in cms/private are moved into the secrets folder first,
 * whichever source wins. Returns { adminSecret, source, createdAt, warning, adopted }.
 * Never logs the value.
 */
export function resolveCmsSecrets({ dataPath, env = process.env, explicit } = {}) {
    const legacy = adoptLegacySignInFiles(dataPath);
    const legacyWarning = legacy.failed.length
        ? `Could not move ${legacy.failed.length} sign-in file(s) from cms/private into cms/private/secrets; the shop file routes skip them.`
        : '';
    const result = (fields) => ({ ...fields, warning: [fields.warning, legacyWarning].filter(Boolean).join(' '), adopted: legacy.moved });
    const explicitValue = explicit === undefined || explicit === null ? '' : String(explicit);
    if (explicitValue && !KNOWN_DEFAULT_SECRETS.includes(explicitValue.trim().toLowerCase())) {
        return result({ adminSecret: explicitValue, source: 'explicit', createdAt: '', warning: '' });
    }
    let warning = explicitValue ? 'The adminSecret option is a placeholder; using the secret in the private data folder.' : '';
    const envName = String(env?.CMS_ADMIN_SECRET || '').trim() ? 'CMS_ADMIN_SECRET' : String(env?.ADMIN_SECRET || '').trim() ? 'ADMIN_SECRET' : '';
    if (envName) {
        const value = String(env[envName]).trim();
        if (isStrongSecret(value))
            return result({ adminSecret: value, source: 'env', createdAt: '', warning });
        warning = `${envName} is shorter than ${MIN_ENV_SECRET_LENGTH} characters or a placeholder; using the secret in the private data folder.`;
    }
    const disk = readOrCreateDiskSecrets(dataPath);
    return result({ adminSecret: disk.adminSecret, source: 'disk', createdAt: disk.createdAt, warning });
}
/** First admin login: env CMS_ADMIN_* when usable, else a generated password. */
export function initialAdminCredentials(env = process.env) {
    const username = String(env?.CMS_ADMIN_USERNAME || env?.ADMIN_USERNAME || '').trim() || 'admin';
    const envPassword = env?.CMS_ADMIN_PASSWORD || env?.ADMIN_PASSWORD || '';
    if (envPassword && isUsableAdminPassword(envPassword))
        return { username, password: String(envPassword), generated: false };
    return { username, password: randomToken(18), generated: true };
}
/** Path of the one-time first admin login file. */
export function initialAdminPath(dataPath) {
    return join(cmsSecretsDir(dataPath), INITIAL_ADMIN_FILE);
}
/** Write the generated first admin login (mode 0600). Only the path is ever logged. */
export function writeInitialAdminFile(dataPath, { username, password, reason = 'first-start' }) {
    ensurePrivateDir(dataPath);
    const file = initialAdminPath(dataPath);
    const body = {
        username,
        password,
        reason,
        createdAt: new Date().toISOString(),
        note: 'One-time admin login for /admin. Change the password after signing in. This file is removed when the password changes or the Asoldi hub sets the client admin.',
    };
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, file);
    return file;
}
/** The pending first admin login, or null. */
export function readInitialAdminFile(dataPath) {
    try {
        const parsed = JSON.parse(readFileSync(initialAdminPath(dataPath), 'utf8'));
        return parsed && parsed.username && parsed.password ? parsed : null;
    }
    catch {
        return null;
    }
}
/** Remove the first admin login file once the admin has a password of their own. */
export function clearInitialAdminFile(dataPath) {
    const file = initialAdminPath(dataPath);
    if (!existsSync(file))
        return false;
    rmSync(file, { force: true });
    return true;
}
