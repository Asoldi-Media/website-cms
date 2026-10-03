import express from 'express';
import { createHmac } from 'crypto';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { createStore } from './store.js';
import { startLocalBlogScheduler } from './local-blog-job.js';
import { seedTestBlogPosts } from './test-posts.js';
import { resolveCmsDataPath } from './data-path.js';
import {
  DEFAULT_FEATURES,
  normalizeFeatures,
  publicCategory,
  publicProduct,
  resolveCatalogType,
} from './catalog.js';
import { filterOrders, summarizeOrders, rangeFromPreset } from './orders.js';
import { publicLead } from './leads.js';
import { isPostPublic, publicPost } from './blog.js';
import { canDeleteUsers, normalizeRank } from './ranks.js';
import { publicAnalyticsSnippet, verifyAnalyticsDns } from './analytics.js';
import { createAnalyticsEventStore } from './analytics-events.js';
import { analyticsTrackerScript, rangeFromPreset as analyticsRangeFromPreset, summarizeTrafficEvents } from './analytics-tracker.js';
import { summarizeCta, summarizeEcommerceFunnel, summarizeShopifyCommerce, normalizeAnalyticsPath } from './analytics-insights.js';
import { setPublicAnalyticsEnabled } from './analytics-flag.js';
import { publicPayments } from './payments.js';
import { createEmailTemplateStore, mergeFieldsMeta, shouldSeedAsoldiPresets } from './email-templates.js';
import { loadSiteSeed } from './site-seed.js';
import { createMediaLibrary, isAllowedMediaName } from './media.js';
import { createSiteEditsStore } from './site-edits.js';
import { siteHydratorScript } from './site-hydrator.js';
import { siteEditorRuntimeScript } from './site-editor-runtime.js';
import { contentRuntimeScript } from './content-runtime.js';
import { extractSlotMapFromHtml } from './slot-map.js';
import { resolvePublicHtml } from './html-tracker.js';
import {
  applyFieldMap,
  errorMessageFor,
  formsRuntimeScript,
  looksLikeBot,
  publicSubmission,
  safeReturnPath,
  successMessageFor,
  wantsJson,
} from './forms.js';

export { resolveCmsDataPath } from './data-path.js';
export { loadSiteSeed, normalizeSiteSeed } from './site-seed.js';
export { getAdminDistDir, mountCmsAdmin } from './admin-static.js';

const PACKAGE_VERSION = (() => {
  try {
    const packagePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    return JSON.parse(readFileSync(packagePath, 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

function fallbackConfig() {
  const devEcommerce = process.env.CMS_DEV_ECOMMERCE === '1';
  const publicUrl = String(process.env.CMS_PUBLIC_URL || '').trim();
  const domain = publicUrl.replace(/^https?:\/\//, '').split('/')[0];
  return {
    features: applyDevFlags({ ...DEFAULT_FEATURES }),
    name: 'Site',
    id: null,
    domain,
    ecommerceCatalogType: devEcommerce ? resolveCatalogType(process.env.CMS_DEV_CATALOG_TYPE || 'menu') : null,
    websitePlan: null,
    analyticsLevel: 'none',
    desiredCmsVersion: null,
    analyticsGoals: { mainCtaText: '', mainCtaUrl: '', ctaPath: '' },
    packageVersion: PACKAGE_VERSION,
  };
}

function applyDevFlags(features) {
  const next = { ...features };
  if (process.env.CMS_DEV_ECOMMERCE === '1') next.ecommerce = true;
  if (process.env.CMS_DEV_EMAIL === '1') next.emailMarketing = true;
  if (process.env.CMS_DEV_BLOG === '1') next.blog = true;
  if (process.env.CMS_DEV_ANALYTICS === '1') next.analytics = true;
  if (process.env.CMS_DEV_GENERAL === '1') next.general = true;
  setPublicAnalyticsEnabled(next.analytics === true);
  return next;
}

function withPackageVersion(data) {
  return {
    ...fallbackConfig(),
    ...data,
    features: applyDevFlags(normalizeFeatures(data?.features || DEFAULT_FEATURES)),
    analyticsLevel: data?.analyticsLevel || (data?.features?.ecommerce ? 'advanced' : data?.features?.analytics ? 'basic' : 'none'),
    packageVersion: PACKAGE_VERSION,
  };
}

export default function createCmsRoutes({
  hubUrl,
  siteKey,
  dataPath,
  siteSeed: siteSeedInput,
  siteSeedPath,
  publicPath,
  adminSecret = process.env.CMS_ADMIN_SECRET || process.env.ADMIN_SECRET || 'change-me',
} = {}) {
  const resolvedDataPath = resolveCmsDataPath({ dataPath, siteKey });
  const resolvedPublicPath = publicPath || join(process.cwd(), 'public');
  const router = express.Router();
  const store = createStore(resolvedDataPath);
  seedTestBlogPosts(store, resolvedDataPath);
  startLocalBlogScheduler({
    store,
    dataPath: resolvedDataPath,
    hubUrl,
    siteKey,
    env: process.env,
  });
  const analyticsEvents = createAnalyticsEventStore(resolvedDataPath);
  const emailTemplates = createEmailTemplateStore(resolvedDataPath);
  const siteEdits = createSiteEditsStore(resolvedDataPath);

  // Step 3 site seed (cms.site.json): lists are created once (ids preserved so
  // bindings resolve), forms + pages are read-only structure.
  const siteSeed = loadSiteSeed({ siteSeed: siteSeedInput, siteSeedPath });
  const seedListIdMap = store.seedLists(siteSeed.lists);
  if (siteSeed.catalog) store.seedCatalog(siteSeed.catalog);

  function resolveListForForm(form) {
    const wanted = String(form?.destination?.listId || '');
    if (!wanted) return null;
    const liveId = seedListIdMap[wanted] || wanted;
    if (store.getListById(liveId)) return store.getListById(liveId);
    const seedList = siteSeed.lists.find((l) => l.id === wanted);
    return seedList ? store.getListBySlug(seedList.slug) : null;
  }

  function publicSiteSeed() {
    return {
      ...siteSeed,
      forms: siteSeed.forms.map((form) => {
        const list = form.destination.type === 'list' ? resolveListForForm(form) : null;
        return {
          ...form,
          destination: { ...form.destination, listId: list?.id || form.destination.listId, listName: list?.name || '' },
          count:
            form.destination.type === 'list'
              ? store.queryLeads({ formId: form.id }).length
              : store.querySubmissions({ formId: form.id }).length,
          unread: form.destination.type === 'inbox' ? store.querySubmissions({ formId: form.id, unread: true }).length : 0,
        };
      }),
    };
  }

  function safeRefererPath(referer) {
    try {
      return new URL(String(referer || '')).pathname || '/';
    } catch {
      return '/';
    }
  }

  /** E-mail the client through the hub's existing client-forms pipe. */
  async function forwardToHub(form, mapped, extra, page) {
    if (!siteKey || !hubUrl) return false;
    const base = hubUrl.replace(/\/$/, '');
    const payload = {
      site_key: siteKey,
      _cms_form: form.label || form.id,
      _cms_purpose: form.purpose,
      _cms_page: page || '',
      ...mapped,
      ...extra,
    };
    try {
      const r = await fetch(`${base}/api/client-forms/${encodeURIComponent(siteKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      return r.ok;
    } catch {
      return false;
    }
  }

  const uploadsDir = resolve(resolvedDataPath, 'cms', 'uploads');
  if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
  // Media library: everything a client uploads (product photos, blog images,
  // videos, PDFs) is listed, editable and reusable — like WordPress Media.
  const media = createMediaLibrary(uploadsDir);
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadsDir),
      filename: (_req, file, cb) => cb(null, media.pickName(file.originalname)),
    }),
    limits: { fileSize: media.maxBytes, files: 20 },
    fileFilter: (_req, file, cb) => {
      if (!isAllowedMediaName(file.originalname)) return cb(new Error(`File type not allowed: ${file.originalname}`));
      cb(null, true);
    },
  });

  function uploadErrorResponse(res, error) {
    if (error?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: `File is larger than ${Math.round(media.maxBytes / 1024 / 1024)} MB (CMS_UPLOAD_MAX_MB).` });
    }
    return res.status(400).json({ message: error?.message || 'Upload failed' });
  }

  function signToken(payload) {
    const data = JSON.stringify(payload);
    const sig = createHmac('sha256', adminSecret).update(data).digest('hex');
    return Buffer.from(JSON.stringify({ data, sig })).toString('base64url');
  }

  function verifyToken(token) {
    try {
      const raw = JSON.parse(Buffer.from(token, 'base64url').toString());
      const expect = createHmac('sha256', adminSecret).update(raw.data).digest('hex');
      if (expect !== raw.sig) return null;
      return JSON.parse(raw.data);
    } catch {
      return null;
    }
  }

  async function ensureAdmin() {
    const admin = await store.getAdmin();
    if (admin) return;
    const username = process.env.CMS_ADMIN_USERNAME || process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.CMS_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'changeme';
    await store.setAdminCredentials(username, password);
  }

  function allow(...ranks) {
    return (req, res, next) => {
      const auth = req.headers.authorization;
      const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
      const payload = token ? verifyToken(token) : null;
      if (!payload) return res.status(401).json({ message: 'Unauthorized' });
      if (payload.role === 'admin') {
        req.actor = { role: 'admin', rank: 'admin', username: payload.username };
        req.admin = payload;
        return next();
      }
      if (payload.role === 'staff' || payload.role === 'employee') {
        const user = store.getUserById(payload.userId);
        if (!user) return res.status(401).json({ message: 'Unauthorized' });
        const rank = normalizeRank(user.rank);
        req.actor = { role: 'staff', rank, userId: user.id, username: user.username, name: user.name };
        if (rank === 'admin' || ranks.includes(rank)) return next();
        return res.status(403).json({ message: 'Forbidden' });
      }
      return res.status(401).json({ message: 'Unauthorized' });
    };
  }

  const adminAuth = allow('employee');
  const blogAuth = allow('employee', 'writer');
  const anyAuth = allow('employee', 'writer', 'member');

  function attachCmsConfig(req, res, next) {
    fetchHubConfig()
      .then((config) => {
        req.cmsConfig = config;
        next();
      })
      .catch(next);
  }

  async function fetchHubConfig() {
    if (!siteKey || !hubUrl) return fallbackConfig();
    try {
      const base = hubUrl.replace(/\/$/, '');
      const r = await fetch(`${base}/api/hub/site-config?site_key=${encodeURIComponent(siteKey)}`);
      if (!r.ok) return fallbackConfig();
      const data = await r.json();
      const config = withPackageVersion(data);
      if (data?.pendingAdmin?.passwordHash) {
        store.applyAdminHash(data.pendingAdmin.username, data.pendingAdmin.passwordHash);
        config.adminSynced = true;
      }
      return config;
    } catch {
      return fallbackConfig();
    }
  }

  async function fetchHubAnalytics(query = {}) {
    if (!siteKey || !hubUrl) return null;
    try {
      const params = new URLSearchParams({ site_key: siteKey, ...query });
      const r = await fetch(`${hubUrl.replace(/\/$/, '')}/api/hub/analytics?${params}`);
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  }

  function forwardCommerceToHub(payload) {
    if (!siteKey || !hubUrl || !payload) return;
    fetch(`${hubUrl.replace(/\/$/, '')}/api/hub/analytics/commerce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_key: siteKey, ...payload }),
    }).catch(() => {});
  }

  function forwardTrafficToHub(events) {
    if (!siteKey || !hubUrl || !events?.length) return;
    fetch(`${hubUrl.replace(/\/$/, '')}/api/hub/analytics/collect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_key: siteKey, events }),
    }).catch(() => {});
  }

  function sendHeartbeat(req, config) {
    if (!siteKey || !hubUrl) return;
    const base = hubUrl.replace(/\/$/, '');
    const host = req.get('host') || '';
    const proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim() || 'https';
    const adminUrl = process.env.CMS_PUBLIC_URL
      ? `${process.env.CMS_PUBLIC_URL.replace(/\/$/, '')}/admin`
      : host
        ? `${proto}://${host}/admin`
        : '';
    fetch(`${base}/api/hub/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        site_key: siteKey,
        packageVersion: PACKAGE_VERSION,
        adminUrl,
        name: config?.name || '',
        adminApplied: config?.adminSynced === true,
      }),
    }).catch(() => {});
  }

  ensureAdmin();

  router.get('/config', async (req, res) => {
    const config = await fetchHubConfig();
    sendHeartbeat(req, config);
    res.json(config);
  });

  router.get('/catalog', async (req, res) => {
    const config = await fetchHubConfig();
    const products = store.getAllProducts();
    if (!config.features.ecommerce && !products.length) {
      return res.status(404).json({ message: 'Ecommerce is not enabled' });
    }
    const catalogType = resolveCatalogType(config.ecommerceCatalogType || siteSeed.catalog?.catalogType);
    res.json({
      catalogType,
      name: config.name,
      categories: store.getAllCategories().map(publicCategory),
      products: products.map(publicProduct),
    });
  });

  router.post('/admin/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password required' });
    }
    const valid = await store.verifyAdmin(username, password);
    if (valid) {
      const token = signToken({ role: 'admin', username, rank: 'admin', at: Date.now() });
      return res.json({ token, rank: 'admin', username, name: username });
    }
    const staff = await store.verifyEmployee(username, password);
    if (!staff.ok) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    const rank = normalizeRank(staff.user.rank);
    const token = signToken({ role: 'staff', userId: staff.user.id, username: staff.user.username, rank, at: Date.now() });
    return res.json({ token, rank, username: staff.user.username, name: staff.user.name || staff.user.username });
  });

  router.get('/admin/me', anyAuth, (req, res) => {
    res.json({
      username: req.actor.username,
      rank: req.actor.rank,
      role: req.actor.role,
      name: req.actor.name || req.actor.username,
    });
  });

  router.get('/admin/users', adminAuth, (_req, res) => {
    res.json(store.getPublicUsers());
  });

  router.post('/admin/users', adminAuth, async (req, res) => {
    const { username, password, rank, name, email, avatarUrl } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password required' });
    }
    const result = await store.createUser(username, password, { rank, name, email, avatarUrl });
    if (!result.ok) {
      return res.status(400).json({ message: result.error });
    }
    res.status(201).json(result.user);
  });

  router.put('/admin/users/:id', adminAuth, async (req, res) => {
    const result = await store.updateUser(req.params.id, req.body || {});
    if (!result.ok) return res.status(400).json({ message: result.error });
    res.json(result.user || { ok: true });
  });

  router.delete('/admin/users/:id', adminAuth, async (req, res) => {
    if (!canDeleteUsers(req.actor?.rank)) {
      return res.status(403).json({ message: 'Employees cannot delete users' });
    }
    const result = await store.deleteUser(req.params.id);
    if (!result.ok) return res.status(404).json({ message: result.error });
    res.json({ ok: true });
  });

  router.post('/admin/change-password', anyAuth, async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new password required' });
    }
    if (req.actor.rank === 'admin') {
      const valid = await store.verifyAdmin(req.actor.username, currentPassword);
      if (!valid) return res.status(401).json({ message: 'Current password is wrong' });
      const admin = await store.getAdmin();
      if (!admin) return res.status(500).json({ message: 'Admin not found' });
      await store.setAdminCredentials(admin.username, newPassword);
      return res.json({ ok: true });
    }
    const user = store.getUserById(req.actor.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    const valid = await store.verifyPassword(currentPassword, user.passwordHash);
    if (!valid) return res.status(401).json({ message: 'Current password is wrong' });
    await store.updateUserPassword(user.id, newPassword);
    res.json({ ok: true });
  });

  router.post('/auth/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password required' });
    }
    const result = await store.verifyEmployee(username, password);
    if (!result.ok) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }
    const token = signToken({ role: 'employee', userId: result.user.id, at: Date.now() });
    res.json({ token, user: result.user });
  });

  // The index (alt text, who uploaded) is private — everything else in uploads/ is public media.
  router.get('/uploads/media-index.json', (_req, res) => res.status(404).end());
  router.use('/uploads', express.static(uploadsDir, { index: false, dotfiles: 'deny', maxAge: '1d' }));

  router.post('/upload', blogAuth, (req, res) => {
    upload.single('file')(req, res, (error) => {
      if (error) return uploadErrorResponse(res, error);
      if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
      media.register(req.file.filename, { uploadedBy: req.actor?.username || req.actor?.role || '', alt: req.body?.alt || '' });
      const item = media.get(req.file.filename, req.baseUrl);
      res.json({ url: item?.url || `${req.baseUrl}/uploads/${encodeURIComponent(req.file.filename)}`, item });
    });
  });

  // --- Media library -----------------------------------------------------------
  router.get('/media', blogAuth, (req, res) => {
    res.json({ items: media.list(req.baseUrl), maxBytes: media.maxBytes });
  });

  router.post('/media', blogAuth, (req, res) => {
    upload.array('files', 20)(req, res, (error) => {
      if (error) return uploadErrorResponse(res, error);
      const files = Array.isArray(req.files) ? req.files : [];
      if (!files.length) return res.status(400).json({ message: 'No files uploaded' });
      const items = [];
      for (const file of files) {
        media.register(file.filename, { uploadedBy: req.actor?.username || req.actor?.role || '', alt: req.body?.alt || '' });
        const item = media.get(file.filename, req.baseUrl);
        if (item) items.push(item);
      }
      res.status(201).json({ items });
    });
  });

  router.patch('/media/:name', blogAuth, (req, res) => {
    const result = media.update(req.params.name, { alt: req.body?.alt, rename: req.body?.rename });
    if (!result.ok) {
      const messages = { 'not-found': 'File not found', 'bad-name': 'Invalid file name (keep the same extension)', exists: 'A file with that name already exists' };
      return res.status(result.reason === 'not-found' ? 404 : 400).json({ message: messages[result.reason] || 'Update failed' });
    }
    res.json({ item: media.get(result.name, req.baseUrl) });
  });

  router.delete('/media/:name', adminAuth, (req, res) => {
    const result = media.remove(req.params.name);
    if (!result.ok) return res.status(result.reason === 'not-found' ? 404 : 400).json({ message: 'Could not delete file' });
    res.json({ ok: true });
  });

  router.get('/categories', adminAuth, (_req, res) => {
    res.json(store.getAllCategories());
  });

  router.post('/categories', adminAuth, (req, res) => {
    const result = store.createCategory(req.body || {});
    if (!result.ok) return res.status(400).json({ message: result.error });
    res.status(201).json(result.category);
  });

  router.put('/categories/:id', adminAuth, (req, res) => {
    const result = store.updateCategory(req.params.id, req.body || {});
    if (!result.ok) return res.status(result.error === 'Category not found' ? 404 : 400).json({ message: result.error });
    res.json(result.category);
  });

  router.delete('/categories/:id', adminAuth, (req, res) => {
    const result = store.deleteCategory(req.params.id);
    if (!result.ok) return res.status(404).json({ message: result.error });
    res.json({ ok: true });
  });

  router.get('/products', adminAuth, attachCmsConfig, (_req, res) => {
    res.json(store.getAllProducts());
  });

  router.post('/products', adminAuth, attachCmsConfig, async (req, res) => {
    const config = req.cmsConfig || (await fetchHubConfig());
    const result = store.createProduct({
      ...(req.body || {}),
      defaultProductType: resolveCatalogType(config.ecommerceCatalogType),
      productType: req.body?.productType || resolveCatalogType(config.ecommerceCatalogType),
    });
    if (!result.ok) return res.status(400).json({ message: result.error });
    res.status(201).json(result.product);
  });

  router.put('/products/:id', adminAuth, attachCmsConfig, (req, res) => {
    const result = store.updateProduct(req.params.id, req.body || {});
    if (!result.ok) return res.status(result.error === 'Product not found' ? 404 : 400).json({ message: result.error });
    res.json(result.product);
  });

  router.delete('/products/:id', adminAuth, attachCmsConfig, (req, res) => {
    const result = store.deleteProduct(req.params.id);
    if (!result.ok) return res.status(404).json({ message: result.error });
    res.json({ ok: true });
  });

  router.get('/settings', adminAuth, attachCmsConfig, async (req, res) => {
    const catalogType = resolveCatalogType(req.cmsConfig?.ecommerceCatalogType);
    const fallbackPreset = catalogType === 'tiers' ? 'service' : 'normal';
    res.json(store.getSettings(fallbackPreset));
  });

  router.put('/settings', adminAuth, attachCmsConfig, async (req, res) => {
    const catalogType = resolveCatalogType(req.cmsConfig?.ecommerceCatalogType);
    const fallbackPreset = catalogType === 'tiers' ? 'service' : 'normal';
    res.json(store.writeSettings(req.body || {}, fallbackPreset));
  });

  router.get('/orders', adminAuth, attachCmsConfig, (req, res) => {
    const filtered = filterOrders(store.getAllOrders(), req.query || {});
    res.json(filtered);
  });

  router.get('/orders/stats', adminAuth, attachCmsConfig, (req, res) => {
    const query = req.query || {};
    const rangeQuery = { ...query, range: query.range || 'month' };
    const filtered = filterOrders(store.getAllOrders(), rangeQuery);
    const window = rangeFromPreset(rangeQuery.range, rangeQuery.from, rangeQuery.to);
    res.json({
      ...summarizeOrders(filtered),
      range: rangeQuery.range,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
    });
  });

  router.post('/orders', adminAuth, attachCmsConfig, (req, res) => {
    const result = store.createOrder(req.body || {});
    if (!result.ok) return res.status(400).json({ message: result.error });
    res.status(201).json(result.order);
  });

  router.put('/orders/:id', adminAuth, attachCmsConfig, (req, res) => {
    const result = store.updateOrder(req.params.id, req.body || {});
    if (!result.ok) return res.status(result.error === 'Order not found' ? 404 : 400).json({ message: result.error });
    res.json(result.order);
  });

  router.options('/leads', (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.status(204).end();
  });

  router.post('/leads', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const body = req.body || {};
    const list =
      store.getListById(body.listId) ||
      store.getListBySlug(body.listSlug || body.list || body.source) ||
      store.ensureDefaultList();
    const result = store.upsertLead({
      ...body,
      listId: list.id,
      source: body.source || body.listSlug || list.slug,
    });
    if (!result.ok) return res.status(400).json({ message: result.error });
    res.status(result.created ? 201 : 200).json({ ok: true, id: result.lead.id, listId: list.id, listSlug: list.slug });
  });

  router.get('/lists', adminAuth, (_req, res) => {
    store.ensureDefaultList();
    const lists = store.getAllLists().map((list) => ({
      ...list,
      count: store.queryLeads({ listId: list.id }).length,
      // Frontend forms (Step 3 bindings) feeding this list.
      forms: siteSeed.forms
        .filter((form) => form.destination.type === 'list' && resolveListForForm(form)?.id === list.id)
        .map((form) => ({ id: form.id, label: form.label, purpose: form.purpose, pages: form.pages })),
    }));
    res.json(lists);
  });

  // ---- Step 3 CMS hookup: site structure + bound frontend forms -------------

  router.get('/site', adminAuth, (_req, res) => {
    res.json(publicSiteSeed());
  });

  router.get('/pages', adminAuth, (_req, res) => {
    res.json(siteSeed.pages);
  });

  router.get('/forms', adminAuth, (_req, res) => {
    res.json(publicSiteSeed().forms);
  });

  router.get('/forms-runtime.js', (_req, res) => {
    const success = {};
    for (const form of siteSeed.forms) success[form.id] = successMessageFor(form, siteSeed.site.language);
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(formsRuntimeScript({ messages: { success, error: errorMessageFor(siteSeed.site.language) } }));
  });

  router.get('/site-hydrator.js', (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(siteHydratorScript());
  });

  router.get('/content-runtime.js', (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(contentRuntimeScript());
  });

  router.get('/site-editor-runtime.js', (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(siteEditorRuntimeScript());
  });

  router.get('/site-edits/public', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ patches: siteEdits.readPublished().patches });
  });

  router.get('/site-edits', adminAuth, (_req, res) => {
    res.json(siteEdits.snapshot());
  });

  router.put('/site-edits/draft', adminAuth, (req, res) => {
    const next = siteEdits.writeDraft(req.body?.patches || []);
    res.json({ draft: next, ...siteEdits.snapshot() });
  });

  router.post('/site-edits/publish', adminAuth, (req, res) => {
    if (req.actor?.rank === 'writer') return res.status(403).json({ message: 'Writers cannot publish site edits.' });
    const published = siteEdits.publish();
    res.json({ published, ...siteEdits.snapshot() });
  });

  router.get('/site-edits/scan', adminAuth, (req, res) => {
    const route = String(req.query.route || '/');
    const file = resolvePublicHtml(resolvedPublicPath, route);
    if (!file) return res.json({ route, slots: extractSlotMapFromHtml('') });
    try {
      return res.json({ route, slots: extractSlotMapFromHtml(readFileSync(file, 'utf8')) });
    } catch {
      return res.json({ route, slots: extractSlotMapFromHtml('') });
    }
  });

  // Public: the site's own forms post here (JSON via runtime, urlencoded without JS).
  router.post('/forms/:id/submit', express.urlencoded({ extended: false, limit: '200kb' }), async (req, res) => {
    const form = siteSeed.forms.find((f) => f.id === String(req.params.id || ''));
    const json = wantsJson(req);
    const body = req.body || {};
    const returnPath = safeReturnPath(body._cms_return || safeRefererPath(req.get('referer')), '/');
    const fail = (status, message) => {
      if (json) return res.status(status).json({ ok: false, message });
      return res.redirect(303, `${returnPath}${returnPath.includes('?') ? '&' : '?'}cms-form=error`);
    };
    if (!form) return fail(404, 'Unknown form.');
    if (looksLikeBot(body)) {
      // Pretend success so bots learn nothing.
      return json ? res.json({ ok: true, message: successMessageFor(form, siteSeed.site.language) }) : res.redirect(303, `${returnPath}?cms-form=ok&form=${encodeURIComponent(form.id)}`);
    }
    const { mapped, extra } = applyFieldMap(body, form);
    const page = safeReturnPath(body._cms_page || body._cms_return, '');
    let stored = null;
    if (form.destination.type === 'list') {
      if (!mapped.email) return fail(400, 'E-mail is required.');
      const list = resolveListForForm(form) || store.ensureDefaultList();
      const result = store.upsertLead({
        ...mapped,
        listId: list.id,
        source: form.label || form.id,
        formId: form.id,
        language: mapped.language || siteSeed.site.language,
        extra,
      });
      if (!result.ok) return fail(400, result.error || 'Could not save.');
      stored = { kind: 'lead', id: result.lead.id, listId: list.id };
      if (form.notify) forwardToHub(form, mapped, extra, page).catch(() => {});
    } else {
      const result = store.createSubmission({
        formId: form.id,
        formLabel: form.label,
        purpose: form.purpose,
        page,
        ...mapped,
        extra,
      });
      if (!result.ok) return fail(400, result.error || 'Could not save.');
      stored = { kind: 'submission', id: result.submission.id };
      // Inbox submissions still e-mail the client through the hub (existing pipe).
      forwardToHub(form, mapped, extra, page)
        .then((ok) => ok && store.updateSubmission(result.submission.id, { forwarded: true }))
        .catch(() => {});
    }
    if (json) return res.status(201).json({ ok: true, ...stored, message: successMessageFor(form, siteSeed.site.language) });
    return res.redirect(303, `${returnPath}${returnPath.includes('?') ? '&' : '?'}cms-form=ok&form=${encodeURIComponent(form.id)}`);
  });

  router.get('/submissions', adminAuth, (req, res) => {
    const rows = store.querySubmissions({ formId: req.query.formId, unread: req.query.unread === 'true' });
    res.json(rows.map(publicSubmission));
  });

  router.put('/submissions/:id', adminAuth, (req, res) => {
    const result = store.updateSubmission(req.params.id, { read: req.body?.read === true });
    if (!result.ok) return res.status(404).json({ message: result.error });
    res.json(publicSubmission(result.submission));
  });

  router.delete('/submissions/:id', adminAuth, (req, res) => {
    const result = store.deleteSubmission(req.params.id);
    if (!result.ok) return res.status(404).json({ message: result.error });
    res.status(204).end();
  });

  router.post('/lists', adminAuth, (req, res) => {
    const result = store.createList(req.body || {});
    if (!result.ok) return res.status(400).json({ message: result.error });
    res.status(201).json(result.list);
  });

  router.get('/email-templates', adminAuth, async (req, res) => {
    const config = req.cmsConfig || (await fetchHubConfig());
    res.json({
      templates: emailTemplates.list({ seedAsoldi: shouldSeedAsoldiPresets(config) }),
      mergeFields: mergeFieldsMeta(),
    });
  });

  router.post('/email-templates', adminAuth, (req, res) => {
    const result = emailTemplates.save(req.body || {});
    if (!result.ok) return res.status(400).json({ message: result.error });
    res.status(201).json({ template: result.template });
  });

  router.put('/email-templates/:id', adminAuth, (req, res) => {
    const existing = emailTemplates.getById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Template not found' });
    const result = emailTemplates.save({ ...existing, ...(req.body || {}), id: existing.id });
    if (!result.ok) return res.status(400).json({ message: result.error });
    res.json({ template: result.template });
  });

  router.delete('/email-templates/:id', adminAuth, (req, res) => {
    const result = emailTemplates.delete(req.params.id);
    if (!result.ok) return res.status(404).json({ message: result.error });
    res.json({ ok: true });
  });

  router.post('/email-templates/import', adminAuth, (req, res) => {
    const result = emailTemplates.importHtml(req.body || {});
    if (!result.ok) return res.status(400).json({ message: result.error });
    res.status(201).json({ template: result.template });
  });


  router.get('/leads', adminAuth, (req, res) => {
    res.json(store.queryLeads(req.query || {}).map(publicLead));
  });

  router.get('/posts', async (req, res) => {
    const config = await fetchHubConfig();
    const posts = store.getAllPosts().filter((post) => isPostPublic(post)).map(publicPost);
    if (!config.features.blog && !posts.length) {
      return res.status(404).json({ message: 'Blog is not enabled' });
    }
    res.json(posts);
  });

  router.get('/posts/:slug', async (req, res) => {
    const config = await fetchHubConfig();
    if (!config.features.blog) {
      return res.status(404).json({ message: 'Blog is not enabled' });
    }
    const post = store.getPostBySlug(req.params.slug);
    if (!post || !isPostPublic(post)) return res.status(404).json({ message: 'Post not found' });
    res.json(publicPost(post));
  });

  router.get('/admin/posts', blogAuth, (_req, res) => {
    res.json(store.getAllPosts());
  });

  router.post('/admin/posts', blogAuth, (req, res) => {
    const result = store.createPost(req.body || {}, req.actor);
    if (!result.ok) return res.status(400).json({ message: result.error });
    res.status(201).json(result.post);
  });

  router.put('/admin/posts/:id', blogAuth, (req, res) => {
    const result = store.updatePost(req.params.id, req.body || {}, req.actor);
    if (!result.ok) return res.status(result.error === 'Post not found' ? 404 : 400).json({ message: result.error });
    res.json(result.post);
  });

  router.delete('/admin/posts/:id', blogAuth, (req, res) => {
    const result = store.deletePost(req.params.id);
    if (!result.ok) return res.status(404).json({ message: result.error });
    res.json({ ok: true });
  });

  router.get('/analytics', adminAuth, async (req, res) => {
    const config = req.cmsConfig || (await fetchHubConfig());
    const settings = store.getAnalytics({
      domain: config.domain || '',
      measurementId: process.env.GA4_MEASUREMENT_ID || '',
      propertyId: process.env.GA4_PROPERTY_ID || '',
    });
    res.json({
      ...settings,
      analyticsLevel: config.analyticsLevel || (config.features?.ecommerce ? 'advanced' : config.features?.analytics ? 'basic' : 'none'),
      snippet: publicAnalyticsSnippet(settings),
      dnsRecord: `${settings.dnsTxtName}.${settings.domain || '<domain>'} TXT ${settings.dnsTxtValue}`,
    });
  });

  router.put('/analytics', adminAuth, attachCmsConfig, async (req, res) => {
    const config = req.cmsConfig || (await fetchHubConfig());
    const settings = store.writeAnalytics(req.body || {}, {
      domain: req.body?.domain || config.domain || '',
    });
    res.json(settings);
  });

  router.post('/analytics/verify', adminAuth, attachCmsConfig, async (req, res) => {
    const config = req.cmsConfig || (await fetchHubConfig());
    const current = store.getAnalytics({ domain: config.domain || '' });
    const verified = await verifyAnalyticsDns(current);
    store.writeAnalytics(verified);
    res.json(verified);
  });

  router.get('/analytics/public', async (_req, res) => {
    const settings = store.getAnalytics();
    res.json(publicAnalyticsSnippet(settings));
  });

  router.get('/analytics/collect.js', async (req, res) => {
    const config = req.cmsConfig || (await fetchHubConfig());
    const ctaPath = normalizeAnalyticsPath(config?.analyticsGoals?.ctaPath || config?.analyticsGoals?.mainCtaUrl || '');
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=120');
    res.send(analyticsTrackerScript({ ctaPath }));
  });

  router.post('/analytics/collect', (req, res) => {
    const incoming = Array.isArray(req.body?.events) ? req.body.events : Array.isArray(req.body) ? req.body : [];
    const events = incoming.slice(0, 40);
    const accepted = analyticsEvents.append(events);
    forwardTrafficToHub(events);
    res.json({ ok: true, accepted });
  });

  router.get('/analytics/overview', adminAuth, attachCmsConfig, async (req, res) => {
    const config = req.cmsConfig || (await fetchHubConfig());
    const level = config.analyticsLevel || (config.features?.ecommerce ? 'advanced' : config.features?.analytics ? 'basic' : 'none');
    if (level === 'none' && !config.features?.analytics) {
      return res.status(403).json({ message: 'Analytics is not enabled for this plan.' });
    }
    const window = analyticsRangeFromPreset(req.query.range || '30d', req.query.from, req.query.to);
    const events = analyticsEvents.read(window.from.getTime(), window.to.getTime());
    const traffic = summarizeTrafficEvents(events, window);
    const hub = await fetchHubAnalytics({
      range: String(req.query.range || '30d'),
      from: String(req.query.from || ''),
      to: String(req.query.to || ''),
      refresh: String(req.query.refresh || ''),
    });
    const goals = hub?.goals || config.analyticsGoals || {};
    const cta = summarizeCta(events, goals.ctaPath || goals.mainCtaUrl, {
      from: window.from,
      to: window.to,
      visits: traffic.visits,
    });
    let ecommerce = null;
    if (level === 'advanced' || config.features?.ecommerce) {
      const orders = filterOrders(store.getAllOrders(), {
        range: 'custom',
        from: window.from.toISOString(),
        to: window.to.toISOString(),
      });
      const shop = summarizeShopifyCommerce(orders, traffic.visits);
      const funnel = summarizeEcommerceFunnel(events, orders, window);
      ecommerce = {
        ...shop,
        funnel: funnel.stages,
        abandonment: funnel.abandonment,
      };
      forwardCommerceToHub({
        ...shop,
        funnel: funnel.stages,
        abandonment: funnel.abandonment,
        range: { preset: window.preset, from: window.from.toISOString(), to: window.to.toISOString() },
      });
    }
    res.json({
      access: { level, ecommerce: Boolean(ecommerce) },
      range: { preset: window.preset, from: window.from.toISOString(), to: window.to.toISOString() },
      traffic: hub?.traffic?.visits ? hub.traffic : traffic,
      localTraffic: traffic,
      cta,
      goals: { ...goals, label: goals.mainCtaText || goals.label || '' },
      maps: hub?.maps || null,
      gbp: hub?.gbp || null,
      subject: hub?.subject || null,
      ecommerce,
      settings: store.getAnalytics({ domain: config.domain || '' }),
    });
  });

  router.get('/payments', adminAuth, (_req, res) => {
    res.json(publicPayments(store.getPayments()));
  });

  router.put('/payments', adminAuth, (req, res) => {
    const next = store.writePayments(req.body || {});
    res.json(publicPayments(next));
  });

  return router;
}
