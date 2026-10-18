/**
 * Shop data under {dataPath}/cms/shop/*.json. Single Node process per site, so
 * synchronous read-modify-write is race-free; writes go through a temp file + rename.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { normalizeShopSettings } from './settings.js';
import { normalizeDiscount } from './discounts.js';

const COLLECTIONS = ['discounts', 'giftcards', 'holds', 'bookings', 'subscriptions', 'reviews', 'customers', 'sessions', 'downloads', 'loginTokens', 'audit'];

/** Random id with an optional prefix. */
export function newId(prefix = '') {
  return `${prefix}${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
}

/** JSON file store for shop data under cms/shop/. */
export function createShopDb(dataPath) {
  const dir = join(dataPath, 'cms', 'shop');

  function file(name) {
    return join(dir, `${name}.json`);
  }

  function read(name, fallback) {
    const path = file(name);
    if (!existsSync(path)) return fallback;
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      return fallback;
    }
  }

  function write(name, value) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const path = file(name);
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
    renameSync(tmp, path);
  }

  function list(name) {
    if (!COLLECTIONS.includes(name)) throw new Error(`Unknown shop collection ${name}`);
    const rows = read(name, []);
    const out = Array.isArray(rows) ? rows : [];
    return name === 'discounts' ? out.map(normalizeDiscount) : out;
  }

  function save(name, rows) {
    if (!COLLECTIONS.includes(name)) throw new Error(`Unknown shop collection ${name}`);
    write(name, rows);
  }

  function upsert(name, row, key = 'id') {
    const rows = list(name);
    const i = rows.findIndex((r) => r[key] === row[key]);
    if (i === -1) rows.push(row);
    else rows[i] = row;
    save(name, rows);
    return row;
  }

  function remove(name, id, key = 'id') {
    const rows = list(name);
    const next = rows.filter((r) => r[key] !== id);
    if (next.length === rows.length) return false;
    save(name, next);
    return true;
  }

  function find(name, predicate) {
    return list(name).find(predicate) || null;
  }

  function getSettings() {
    return normalizeShopSettings(read('settings', {}));
  }

  /** Shallow-merge per top-level section so the admin can save one card at a time. */
  function saveSettings(patch = {}) {
    const current = read('settings', {}) || {};
    const next = { ...current };
    for (const [key, value] of Object.entries(patch || {})) {
      next[key] = value && typeof value === 'object' && !Array.isArray(value) && current[key] && typeof current[key] === 'object' ? { ...current[key], ...value } : value;
    }
    const normalized = normalizeShopSettings(next);
    write('settings', normalized);
    return normalized;
  }

  /** Gap-free sequence per series (orders, credit notes). */
  function nextNumber(series, start = 1) {
    const counters = read('counters', {}) || {};
    const value = Math.max(Number(counters[series]) || 0, start - 1) + 1;
    counters[series] = value;
    write('counters', counters);
    return value;
  }

  function audit(entry) {
    const rows = list('audit');
    rows.push({ at: new Date().toISOString(), ...entry });
    save('audit', rows.slice(-1000));
  }

  return { dir, read, write, list, save, upsert, remove, find, getSettings, saveSettings, nextNumber, audit };
}
