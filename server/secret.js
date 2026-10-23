/**
 * The secret that signs CMS admin tokens.
 *
 * An env value (CMS_ADMIN_SECRET, else ADMIN_SECRET) is used only when it is at
 * least 16 characters and not a known placeholder. Otherwise a random secret is
 * generated once into <data>/cms/private/secrets.json (dir 0700, file 0600) and
 * reused. The data dir lives outside the deployed repo, so the secret survives
 * deploys and no host env change is needed.
 *
 * File format (shared with later CMS releases, which read the same file):
 *   { "version": 1, "adminSecret": "<43-char base64url>", "createdAt": "<ISO>" }
 */
import { randomBytes } from 'crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'fs';
import { join } from 'path';

export const KNOWN_DEFAULT_SECRETS = Object.freeze(['change-me', 'changeme', 'change-me-in-production', 'secret', 'admin']);
export const MIN_ENV_SECRET_LENGTH = 16;
const MIN_DISK_SECRET_LENGTH = 32;
const NO_HARD_LINKS = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV', 'EMLINK']);

export function privateDir(dataPath) {
  return join(dataPath, 'cms', 'private');
}

export function ensurePrivateDir(dataPath) {
  const dir = privateDir(dataPath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // Windows ignores POSIX modes.
  }
  return dir;
}

export function isUsableEnvSecret(value) {
  const text = String(value ?? '');
  if (text.trim().length < MIN_ENV_SECRET_LENGTH) return false;
  return !KNOWN_DEFAULT_SECRETS.includes(text.trim().toLowerCase());
}

/**
 * Create `file` with `content` only if it does not exist yet. The content becomes
 * visible all at once (hard link from a finished temp file), so a second process
 * never reads a half-written file. Returns true when this call created it.
 */
export function createFileOnce(file, content, mode = 0o600) {
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  const fd = openSync(tmp, 'wx', mode);
  try {
    writeSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    linkSync(tmp, file);
    return true;
  } catch (error) {
    if (error?.code === 'EEXIST') return false;
    if (!NO_HARD_LINKS.has(error?.code)) throw error;
    try {
      writeFileSync(file, content, { flag: 'wx', mode });
      return true;
    } catch (inner) {
      if (inner?.code === 'EEXIST') return false;
      throw inner;
    }
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      // already gone
    }
  }
}

/** Replace `file` atomically (temp file + rename), mode 0600. */
export function writePrivateFile(file, content, mode = 0o600) {
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(tmp, content, { flag: 'wx', mode });
  renameSync(tmp, file);
  try {
    chmodSync(file, mode);
  } catch {
    // Windows ignores POSIX modes.
  }
}

function readDiskSecret(file) {
  if (!existsSync(file)) return { state: 'missing' };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const secret = typeof parsed?.adminSecret === 'string' ? parsed.adminSecret : '';
    if (secret.length >= MIN_DISK_SECRET_LENGTH) {
      return { state: 'ok', adminSecret: secret, createdAt: parsed.createdAt || null };
    }
  } catch {
    // fall through
  }
  return { state: 'invalid' };
}

/**
 * resolveCmsSecrets({ dataPath, env }) -> { adminSecret, source: 'env'|'disk', createdAt }
 */
export function resolveCmsSecrets({ dataPath, env = process.env, log = console } = {}) {
  const envValue = env.CMS_ADMIN_SECRET || env.ADMIN_SECRET || '';
  if (envValue) {
    if (isUsableEnvSecret(envValue)) return { adminSecret: envValue, source: 'env', createdAt: null };
    log?.warn?.('[cms] CMS_ADMIN_SECRET / ADMIN_SECRET is too short or a placeholder; using the generated secret on disk.');
  }
  if (!dataPath) throw new Error('resolveCmsSecrets: dataPath is required');
  const file = join(ensurePrivateDir(dataPath), 'secrets.json');
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = readDiskSecret(file);
    if (current.state === 'ok') return { adminSecret: current.adminSecret, source: 'disk', createdAt: current.createdAt };
    if (current.state === 'invalid') {
      try {
        renameSync(file, `${file}.invalid-${Date.now()}`);
        log?.warn?.(`[cms] ${file} was unreadable; moved it aside and generated a new secret.`);
      } catch {
        // another process moved it first
      }
    }
    const record = {
      version: 1,
      adminSecret: randomBytes(32).toString('base64url'),
      createdAt: new Date().toISOString(),
    };
    if (createFileOnce(file, `${JSON.stringify(record, null, 2)}\n`)) {
      return { adminSecret: record.adminSecret, source: 'disk', createdAt: record.createdAt };
    }
  }
  throw new Error(`resolveCmsSecrets: could not create or read ${file}`);
}
