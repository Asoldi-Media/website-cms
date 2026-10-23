/** What GET /api/cms/config may show the public, and this package's build id. */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

/** Explicit allowlist: a field the hub adds later stays private until it is listed here. */
export const PUBLIC_CONFIG_KEYS = Object.freeze([
    'name',
    'domain',
    'features',
    'ecommerceCatalogType',
    'websitePlan',
    'analyticsLevel',
    'desiredCmsVersion',
    'packageVersion',
]);
/** Copy of the hub config with only the allowlisted keys. */
export function publicConfig(config) {
    const out = {};
    for (const key of PUBLIC_CONFIG_KEYS) {
        if (config && Object.prototype.hasOwnProperty.call(config, key) && config[key] !== undefined)
            out[key] = config[key];
    }
    return out;
}
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** 12-hex build id from cms.vendor.manifest.json (written by the Maker sync), or 'dev'. */
export function readPackageBuild(root = PACKAGE_ROOT) {
    try {
        const manifest = JSON.parse(readFileSync(join(root, 'cms.vendor.manifest.json'), 'utf8'));
        const build = String(manifest?.packageBuild || '');
        return /^[a-f0-9]{12}$/.test(build) ? build : 'dev';
    }
    catch {
        return 'dev';
    }
}
