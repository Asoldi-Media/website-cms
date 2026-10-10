/** GrapesJS email templates in email-templates.json. Asoldi sites can seed presets. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
const MERGE_FIELDS = [
    { token: '{{firstName}}', label: 'Fornavn' },
    { token: '{{fullName}}', label: 'Fullt navn' },
    { token: '{{businessName}}', label: 'Bedrift' },
    { token: '{{email}}', label: 'E-post' },
];
const EMPTY_HTML = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#ffffff;">
  <tr>
    <td style="padding:32px 24px;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
      <h1 style="margin:0 0 16px;font-size:24px;font-weight:normal;">Ny e-post</h1>
      <p style="margin:0 0 12px;">Hei {{firstName}},</p>
      <p style="margin:0;">Importer en HTML-mal eller bygg den med blokkene til venstre.</p>
    </td>
  </tr>
</table>`;
const ASOLDI_PRESETS = [
    {
        key: 'thank-you',
        name: 'Velkomst / møtebekreftelse',
        subject: 'Bekreftet: møte med {{businessName}}',
        preheader: 'Vi har satt av tid til dere.',
    },
    {
        key: 'reminder-24h',
        name: 'Påminnelse 24 timer',
        subject: 'Påminnelse: møte om 24 timer',
        preheader: 'Møtet starter om 24 timer.',
    },
    {
        key: 'reminder-1h',
        name: 'Påminnelse 1 time',
        subject: 'Påminnelse: møte om 1 time',
        preheader: 'Møtet starter om 1 time.',
    },
];
/** Merge-field labels the email editor offers. */
export function mergeFieldsMeta() {
    return MERGE_FIELDS;
}
/** True for Asoldi-hosted sites, which start with welcome and reminder templates. */
export function shouldSeedAsoldiPresets(config = {}) {
    const env = String(process.env.CMS_SEED_ASOLDI_EMAILS || '').trim().toLowerCase();
    if (env === '1' || env === 'true')
        return true;
    if (env === '0' || env === 'false')
        return false;
    const key = String(process.env.CMS_SITE_KEY || config.id || '').toLowerCase();
    const domain = String(config.domain || process.env.CMS_PUBLIC_URL || '').toLowerCase();
    const name = String(config.name || '').toLowerCase();
    return key.includes('asoldi') || domain.includes('asoldi.com') || name === 'asoldi';
}
function nowIso() {
    return new Date().toISOString();
}
function makeId() {
    return `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function normalizeTemplate(raw = {}) {
    const createdAt = String(raw.createdAt || nowIso());
    return {
        id: String(raw.id || makeId()),
        key: String(raw.key || '').trim(),
        name: String(raw.name || 'Uten navn').trim(),
        subject: String(raw.subject || '').trim(),
        preheader: String(raw.preheader || '').trim(),
        html: String(raw.html || EMPTY_HTML),
        grapesProject: raw.grapesProject && typeof raw.grapesProject === 'object' ? raw.grapesProject : null,
        preset: Boolean(raw.preset),
        createdAt,
        updatedAt: String(raw.updatedAt || createdAt),
    };
}
/** CRUD for email-templates.json in the site data dir. */
export function createEmailTemplateStore(dataPath) {
    const dir = join(dataPath, 'cms');
    const file = join(dir, 'email-templates.json');
    function ensureDir() {
        if (!existsSync(dir))
            mkdirSync(dir, { recursive: true });
    }
    function readAll() {
        ensureDir();
        if (!existsSync(file))
            return [];
        try {
            const rows = JSON.parse(readFileSync(file, 'utf8'));
            return (Array.isArray(rows) ? rows : []).map(normalizeTemplate);
        }
        catch {
            return [];
        }
    }
    function writeAll(rows) {
        ensureDir();
        writeFileSync(file, JSON.stringify(rows.map(normalizeTemplate), null, 2), 'utf8');
    }
    return {
        list(options = {}) {
            const rows = readAll();
            if (!options.seedAsoldi)
                return rows;
            const keys = new Set(rows.map((row) => row.key).filter(Boolean));
            let changed = false;
            for (const preset of ASOLDI_PRESETS) {
                if (keys.has(preset.key))
                    continue;
                rows.push(normalizeTemplate({
                    ...preset,
                    id: `preset-${preset.key}`,
                    html: EMPTY_HTML,
                    preset: true,
                }));
                changed = true;
            }
            if (changed)
                writeAll(rows);
            return rows;
        },
        getById(id) {
            const target = String(id || '').trim();
            return this.list().find((row) => row.id === target || row.key === target) || null;
        },
        save(input = {}) {
            const rows = this.list();
            const incoming = normalizeTemplate({
                ...input,
                id: String(input.id || makeId()),
                updatedAt: nowIso(),
            });
            if (!incoming.name)
                return { ok: false, error: 'Name is required' };
            const index = rows.findIndex((row) => row.id === incoming.id);
            if (index === -1) {
                incoming.createdAt = nowIso();
                rows.push(incoming);
            }
            else {
                incoming.createdAt = rows[index].createdAt;
                incoming.preset = rows[index].preset || incoming.preset;
                rows[index] = incoming;
            }
            writeAll(rows);
            return { ok: true, template: incoming };
        },
        importHtml(input = {}) {
            const html = String(input.html || '').trim();
            if (!html)
                return { ok: false, error: 'HTML is required' };
            return this.save({
                name: input.name || 'Importert mal',
                subject: input.subject || '',
                preheader: input.preheader || '',
                html,
                grapesProject: input.grapesProject || null,
                key: input.key || '',
                preset: false,
            });
        },
        delete(id) {
            const rows = this.list();
            const next = rows.filter((row) => row.id !== id && row.key !== id);
            if (next.length === rows.length)
                return { ok: false, error: 'Template not found' };
            writeAll(next);
            return { ok: true };
        },
    };
}
