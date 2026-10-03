import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import bcrypt from 'bcryptjs';
import { normalizeCategory, normalizeProduct } from './catalog.js';
import { normalizeOrder, normalizeSettings } from './orders.js';
import { filterLeads, normalizeLead, normalizeList, slugifyListName } from './leads.js';
import { normalizePost, publishDuePost, slugify as slugifyPost } from './blog.js';
import { normalizeRank, publicUser } from './ranks.js';
import { normalizeAnalytics } from './analytics.js';
import { normalizePayments } from './payments.js';
import { normalizeSubmission } from './forms.js';

const SALT_ROUNDS = 12;

export function createStore(dataPath) {
  const dir = join(dataPath, 'cms');
  const USERS_PATH = join(dir, 'users.json');
  const ADMIN_PATH = join(dir, 'admin.json');
  const PRODUCTS_PATH = join(dir, 'products.json');
  const CATEGORIES_PATH = join(dir, 'categories.json');
  const ORDERS_PATH = join(dir, 'orders.json');
  const SETTINGS_PATH = join(dir, 'settings.json');
  const LISTS_PATH = join(dir, 'lists.json');
  const LEADS_PATH = join(dir, 'leads.json');
  const POSTS_PATH = join(dir, 'posts.json');
  const ANALYTICS_PATH = join(dir, 'analytics.json');
  const PAYMENTS_PATH = join(dir, 'payments.json');
  const SUBMISSIONS_PATH = join(dir, 'submissions.json'); // inbox-type form submissions

  function ensureDir() {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  function readJson(path, fallback) {
    ensureDir();
    if (!existsSync(path)) return fallback;
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      return fallback;
    }
  }

  function writeJson(path, value) {
    ensureDir();
    writeFileSync(path, JSON.stringify(value, null, 2), 'utf8');
  }

  function normalizeStoredUser(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const createdAt = raw.createdAt || new Date().toISOString();
    return {
      id: String(raw.id || ''),
      username: String(raw.username || '').trim(),
      passwordHash: String(raw.passwordHash || ''),
      name: String(raw.name || '').trim(),
      email: String(raw.email || '').trim().toLowerCase(),
      avatarUrl: String(raw.avatarUrl || '').trim(),
      rank: normalizeRank(raw.rank),
      createdAt,
    };
  }

  function readUsers() {
    return (readJson(USERS_PATH, []) || []).map(normalizeStoredUser).filter((user) => user && user.id);
  }

  function writeUsers(users) {
    writeJson(USERS_PATH, users.map(normalizeStoredUser).filter(Boolean));
  }

  function readAdmin() {
    return readJson(ADMIN_PATH, null);
  }

  function writeAdmin(admin) {
    writeJson(ADMIN_PATH, admin);
  }

  function migrateProducts(raw) {
    const rows = Array.isArray(raw) ? raw : [];
    const migrated = [];
    let changed = false;
    for (const row of rows) {
      const product = normalizeProduct(row);
      if (!product || !product.id) {
        changed = true;
        continue;
      }
      migrated.push(product);
      if (
        product.categoryId !== (row.categoryId || '') ||
        product.allergens !== (row.allergens || '') ||
        product.subtitle !== (row.subtitle || '') ||
        JSON.stringify(product.bullets) !== JSON.stringify(Array.isArray(row.bullets) ? row.bullets : []) ||
        product.cta !== (row.cta || '') ||
        product.updatedAt !== row.updatedAt
      ) {
        changed = true;
      }
    }
    return { products: migrated, changed };
  }

  function readProducts() {
    const { products, changed } = migrateProducts(readJson(PRODUCTS_PATH, []));
    if (changed) writeJson(PRODUCTS_PATH, products);
    return products;
  }

  function writeProducts(products) {
    writeJson(PRODUCTS_PATH, products.map((row) => normalizeProduct(row)).filter(Boolean));
  }

  function migrateCategories(raw) {
    const rows = Array.isArray(raw) ? raw : [];
    return rows.map((row) => normalizeCategory(row)).filter((row) => row && row.id);
  }

  function readCategories() {
    const categories = migrateCategories(readJson(CATEGORIES_PATH, []));
    return categories.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  function writeCategories(categories) {
    writeJson(CATEGORIES_PATH, categories.map((row) => normalizeCategory(row)).filter(Boolean));
  }

  function nextId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  return {
    async hashPassword(plain) {
      return bcrypt.hash(plain, SALT_ROUNDS);
    },
    async verifyPassword(plain, hash) {
      return bcrypt.compare(plain, hash);
    },
    async getAdmin() {
      return readAdmin();
    },
    async setAdminCredentials(username, password) {
      const hash = await this.hashPassword(password);
      writeAdmin({ username, passwordHash: hash });
    },
    applyAdminHash(username, passwordHash) {
      if (!passwordHash) return { ok: false, error: 'Password hash required' };
      const current = readAdmin() || {};
      writeAdmin({
        username: String(username || current.username || 'admin').trim() || 'admin',
        passwordHash,
      });
      return { ok: true };
    },
    async verifyAdmin(username, password) {
      const admin = readAdmin();
      if (!admin || admin.username !== username) return false;
      return this.verifyPassword(password, admin.passwordHash);
    },
    getAllUsers() {
      return readUsers();
    },
    getPublicUsers() {
      return readUsers().map(publicUser);
    },
    getUserById(id) {
      return readUsers().find((u) => u.id === id) || null;
    },
    getUserByUsername(username) {
      return readUsers().find((u) => u.username.toLowerCase() === String(username || '').toLowerCase()) || null;
    },
    async createUser(username, password, extra = {}) {
      const users = readUsers();
      if (users.some((u) => u.username.toLowerCase() === String(username || '').toLowerCase())) {
        return { ok: false, error: 'Username already exists' };
      }
      const id = String(Date.now());
      const passwordHash = await this.hashPassword(password);
      const user = normalizeStoredUser({
        id,
        username,
        passwordHash,
        name: extra.name,
        email: extra.email,
        avatarUrl: extra.avatarUrl,
        rank: extra.rank,
        createdAt: new Date().toISOString(),
      });
      users.push(user);
      writeUsers(users);
      return { ok: true, user: publicUser(user) };
    },
    async updateUser(id, patch = {}) {
      const users = readUsers();
      const i = users.findIndex((u) => u.id === id);
      if (i === -1) return { ok: false, error: 'User not found' };
      if (patch.username !== undefined) {
        const newUsername = String(patch.username || '').trim();
        if (!newUsername) return { ok: false, error: 'Username is required' };
        if (users.some((u) => u.username.toLowerCase() === newUsername.toLowerCase() && u.id !== id)) {
          return { ok: false, error: 'Username already exists' };
        }
        users[i].username = newUsername;
      }
      if (patch.name !== undefined) users[i].name = String(patch.name || '').trim();
      if (patch.email !== undefined) users[i].email = String(patch.email || '').trim().toLowerCase();
      if (patch.avatarUrl !== undefined) users[i].avatarUrl = String(patch.avatarUrl || '').trim();
      if (patch.rank !== undefined) users[i].rank = normalizeRank(patch.rank);
      if (patch.password) users[i].passwordHash = await this.hashPassword(patch.password);
      writeUsers(users);
      return { ok: true, user: publicUser(users[i]) };
    },
    async updateUserPassword(id, newPassword) {
      return this.updateUser(id, { password: newPassword });
    },
    async updateUserUsername(id, newUsername) {
      return this.updateUser(id, { username: newUsername });
    },
    async deleteUser(id) {
      const users = readUsers();
      const filtered = users.filter((u) => u.id !== id);
      if (filtered.length === users.length) return { ok: false, error: 'User not found' };
      writeUsers(filtered);
      return { ok: true };
    },
    async verifyEmployee(username, password) {
      const user = this.getUserByUsername(username);
      if (!user) return { ok: false };
      const valid = await this.verifyPassword(password, user.passwordHash);
      return valid
        ? { ok: true, user: { id: user.id, username: user.username, rank: normalizeRank(user.rank), name: user.name, email: user.email } }
        : { ok: false };
    },
    getAllCategories() {
      return readCategories();
    },
    getCategoryById(id) {
      return readCategories().find((category) => category.id === id) || null;
    },
    createCategory({ name, sortOrder }) {
      const trimmed = String(name || '').trim();
      if (!trimmed) return { ok: false, error: 'Category name is required' };
      const categories = readCategories();
      if (categories.some((category) => category.name.toLowerCase() === trimmed.toLowerCase())) {
        return { ok: false, error: 'Category already exists' };
      }
      const now = new Date().toISOString();
      const maxSort = categories.reduce((max, category) => Math.max(max, category.sortOrder || 0), -1);
      const category = normalizeCategory({
        id: nextId(),
        name: trimmed,
        sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : maxSort + 1,
        createdAt: now,
        updatedAt: now,
      });
      categories.push(category);
      writeCategories(categories);
      return { ok: true, category };
    },
    updateCategory(id, { name, sortOrder }) {
      const categories = readCategories();
      const i = categories.findIndex((category) => category.id === id);
      if (i === -1) return { ok: false, error: 'Category not found' };
      if (name !== undefined) {
        const trimmed = String(name || '').trim();
        if (!trimmed) return { ok: false, error: 'Category name is required' };
        if (categories.some((category) => category.name.toLowerCase() === trimmed.toLowerCase() && category.id !== id)) {
          return { ok: false, error: 'Category already exists' };
        }
        categories[i].name = trimmed;
      }
      if (sortOrder !== undefined) {
        categories[i].sortOrder = Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : categories[i].sortOrder;
      }
      categories[i].updatedAt = new Date().toISOString();
      writeCategories(categories);
      return { ok: true, category: categories[i] };
    },
    deleteCategory(id) {
      const categories = readCategories();
      const filtered = categories.filter((category) => category.id !== id);
      if (filtered.length === categories.length) return { ok: false, error: 'Category not found' };
      writeCategories(filtered);
      const products = readProducts();
      let changed = false;
      for (const product of products) {
        if (product.categoryId === id) {
          product.categoryId = '';
          product.updatedAt = new Date().toISOString();
          changed = true;
        }
      }
      if (changed) writeProducts(products);
      return { ok: true };
    },
    getAllProducts() {
      return readProducts().sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    },
    getProductById(id) {
      return readProducts().find((p) => p.id === id) || null;
    },
    createProduct(input) {
      const name = String(input?.name || '').trim();
      if (!name) return { ok: false, error: 'Product name is required' };
      const products = readProducts();
      const now = new Date().toISOString();
      const maxSort = products.reduce((max, product) => Math.max(max, product.sortOrder || 0), -1);
      const product = normalizeProduct({
        ...input,
        id: nextId(),
        name,
        productType: input?.productType || input?.layout || '',
        sortOrder: input?.sortOrder !== undefined ? input.sortOrder : maxSort + 1,
        createdAt: now,
        updatedAt: now,
      }, { defaultProductType: input?.productType || input?.defaultProductType || 'normal' });
      products.push(product);
      writeProducts(products);
      return { ok: true, product };
    },
    updateProduct(id, input) {
      const products = readProducts();
      const i = products.findIndex((p) => p.id === id);
      if (i === -1) return { ok: false, error: 'Product not found' };
      const current = products[i];
      const next = normalizeProduct({
        ...current,
        ...input,
        id: current.id,
        name: input?.name !== undefined ? input.name : current.name,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
      });
      if (!String(next.name || '').trim()) return { ok: false, error: 'Product name is required' };
      products[i] = next;
      writeProducts(products);
      return { ok: true, product: products[i] };
    },
    deleteProduct(id) {
      const products = readProducts();
      const filtered = products.filter((p) => p.id !== id);
      if (filtered.length === products.length) return { ok: false, error: 'Product not found' };
      writeProducts(filtered);
      return { ok: true };
    },
    getSettings(fallbackPreset = 'normal') {
      return normalizeSettings(readJson(SETTINGS_PATH, {}), fallbackPreset);
    },
    writeSettings(patch, fallbackPreset = 'normal') {
      const next = normalizeSettings({ ...this.getSettings(fallbackPreset), ...patch }, fallbackPreset);
      writeJson(SETTINGS_PATH, next);
      return next;
    },
    getAllOrders() {
      const rows = readJson(ORDERS_PATH, []);
      return (Array.isArray(rows) ? rows : [])
        .map((row) => normalizeOrder(row))
        .filter((row) => row && row.id)
        .sort((a, b) => String(b.purchasedAt || '').localeCompare(String(a.purchasedAt || '')));
    },
    getOrderById(id) {
      return this.getAllOrders().find((order) => order.id === id) || null;
    },
    createOrder(input) {
      const orders = this.getAllOrders();
      const now = new Date().toISOString();
      const order = normalizeOrder({
        ...input,
        id: nextId(),
        createdAt: now,
        updatedAt: now,
        purchasedAt: input?.purchasedAt || now,
      });
      if (!order.customerName && !order.customerEmail) {
        return { ok: false, error: 'Customer name or email is required' };
      }
      if (!order.productName && !order.productId) {
        return { ok: false, error: 'Product is required' };
      }
      orders.push(order);
      writeJson(ORDERS_PATH, orders);
      return { ok: true, order };
    },
    updateOrder(id, input) {
      const orders = this.getAllOrders();
      const i = orders.findIndex((order) => order.id === id);
      if (i === -1) return { ok: false, error: 'Order not found' };
      const current = orders[i];
      const next = normalizeOrder({
        ...current,
        ...input,
        id: current.id,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
      });
      orders[i] = next;
      writeJson(ORDERS_PATH, orders);
      return { ok: true, order: next };
    },
    ensureDefaultList() {
      const lists = this.getAllLists();
      if (lists.length) return lists[0];
      return this.createList({ name: 'Website forms', slug: 'website-forms' }).list;
    },
    getAllLists() {
      const rows = readJson(LISTS_PATH, []);
      return (Array.isArray(rows) ? rows : []).map((row) => normalizeList(row)).filter((row) => row && row.id);
    },
    getListById(id) {
      return this.getAllLists().find((list) => list.id === id) || null;
    },
    getListBySlug(slug) {
      const needle = String(slug || '').trim().toLowerCase();
      return this.getAllLists().find((list) => list.slug === needle || list.id === needle) || null;
    },
    createList({ name, slug, id } = {}) {
      const trimmed = String(name || '').trim();
      if (!trimmed) return { ok: false, error: 'List name is required' };
      const lists = this.getAllLists();
      const nextSlug = slugifyListName(slug || trimmed);
      if (lists.some((list) => list.slug === nextSlug)) return { ok: false, error: 'List slug already exists' };
      const wantedId = String(id || '').trim();
      if (wantedId && lists.some((list) => list.id === wantedId)) return { ok: false, error: 'List id already exists' };
      const now = new Date().toISOString();
      // `id` lets the Step 3 site seed keep its list ids so form bindings resolve 1:1.
      const list = normalizeList({ id: wantedId || nextId(), name: trimmed, slug: nextSlug, createdAt: now, updatedAt: now });
      lists.push(list);
      writeJson(LISTS_PATH, lists);
      return { ok: true, list };
    },
    /**
     * Seed lists from cms.site.json once. Existing lists (by id or slug) are kept;
     * returns a map seedListId → live list id for binding resolution.
     */
    seedLists(seedLists = []) {
      const idMap = {};
      for (const seed of Array.isArray(seedLists) ? seedLists : []) {
        if (!seed || !seed.name) continue;
        const existing = (seed.id && this.getListById(seed.id)) || this.getListBySlug(seed.slug || seed.name);
        if (existing) {
          idMap[seed.id || existing.id] = existing.id;
          continue;
        }
        const created = this.createList({ name: seed.name, slug: seed.slug, id: seed.id });
        if (created.ok) idMap[seed.id || created.list.id] = created.list.id;
      }
      return idMap;
    },
    /**
     * First boot only. Live products.json is the source of truth after that —
     * re-publish must never overwrite client-entered catalog rows.
     */
    seedCatalog({ products = [], categories = [] } = {}) {
      if (readProducts().length) return { seeded: false, reason: 'already-has-products' };
      const cats = (Array.isArray(categories) ? categories : []).map((row) => normalizeCategory(row)).filter((row) => row && row.id);
      const prods = (Array.isArray(products) ? products : []).map((row) => normalizeProduct(row)).filter((row) => row && row.id && String(row.name || '').trim());
      if (!prods.length) return { seeded: false, reason: 'empty' };
      if (cats.length) writeCategories(cats);
      writeProducts(prods);
      return { seeded: true, products: prods.length, categories: cats.length };
    },
    getAllSubmissions() {
      const rows = readJson(SUBMISSIONS_PATH, []);
      return (Array.isArray(rows) ? rows : [])
        .map((row) => normalizeSubmission(row))
        .filter((row) => row && row.id)
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    },
    querySubmissions({ formId, unread } = {}) {
      const wantForm = String(formId || '').trim();
      return this.getAllSubmissions().filter((row) => {
        if (wantForm && row.formId !== wantForm) return false;
        if (unread === true && row.read) return false;
        return true;
      });
    },
    createSubmission(input) {
      const row = normalizeSubmission({ ...input, id: input?.id || nextId(), createdAt: new Date().toISOString() });
      if (!row) return { ok: false, error: 'Invalid submission' };
      const rows = this.getAllSubmissions();
      rows.unshift(row);
      // Keep the inbox bounded on disk.
      writeJson(SUBMISSIONS_PATH, rows.slice(0, 5000));
      return { ok: true, submission: row };
    },
    updateSubmission(id, patch = {}) {
      const rows = this.getAllSubmissions();
      const index = rows.findIndex((row) => row.id === String(id));
      if (index === -1) return { ok: false, error: 'Submission not found' };
      rows[index] = normalizeSubmission({ ...rows[index], ...patch, id: rows[index].id, createdAt: rows[index].createdAt });
      writeJson(SUBMISSIONS_PATH, rows);
      return { ok: true, submission: rows[index] };
    },
    deleteSubmission(id) {
      const rows = this.getAllSubmissions();
      const next = rows.filter((row) => row.id !== String(id));
      if (next.length === rows.length) return { ok: false, error: 'Submission not found' };
      writeJson(SUBMISSIONS_PATH, next);
      return { ok: true };
    },
    getAllLeads() {
      const rows = readJson(LEADS_PATH, []);
      return (Array.isArray(rows) ? rows : [])
        .map((row) => normalizeLead(row))
        .filter((row) => row && row.id)
        .sort((a, b) => String(b.signupAt || '').localeCompare(String(a.signupAt || '')));
    },
    queryLeads(query) {
      return filterLeads(this.getAllLeads(), query);
    },
    upsertLead(input) {
      const lead = normalizeLead({ ...input, id: input?.id || nextId() });
      if (!lead.email) return { ok: false, error: 'Email is required' };
      if (!lead.listId) return { ok: false, error: 'List is required' };
      const leads = this.getAllLeads();
      const existing = leads.findIndex((row) => row.listId === lead.listId && row.email === lead.email);
      const now = new Date().toISOString();
      if (existing >= 0) {
        const merged = normalizeLead({
          ...leads[existing],
          ...lead,
          id: leads[existing].id,
          createdAt: leads[existing].createdAt,
          signupAt: leads[existing].signupAt,
          updatedAt: now,
          marketingAccept: lead.marketingAccept || leads[existing].marketingAccept,
          marketingAcceptAt: lead.marketingAccept
            ? lead.marketingAcceptAt || now
            : leads[existing].marketingAcceptAt,
        });
        leads[existing] = merged;
        writeJson(LEADS_PATH, leads);
        return { ok: true, lead: merged, created: false };
      }
      lead.createdAt = now;
      lead.updatedAt = now;
      leads.push(lead);
      writeJson(LEADS_PATH, leads);
      return { ok: true, lead, created: true };
    },
    getAllPosts() {
      const now = new Date();
      const rows = readJson(POSTS_PATH, []);
      let changed = false;
      const posts = (Array.isArray(rows) ? rows : [])
        .map((row) => {
          const next = publishDuePost(row, now);
          if (next && row && next.status !== row.status) changed = true;
          return next;
        })
        .filter((row) => row && row.id)
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      if (changed) writeJson(POSTS_PATH, posts);
      return posts;
    },
    getPostById(id) {
      return this.getAllPosts().find((post) => post.id === id) || null;
    },
    getPostBySlug(slug) {
      const needle = String(slug || '').trim().toLowerCase();
      return this.getAllPosts().find((post) => post.slug === needle || post.id === needle) || null;
    },
    createPost(input, author = {}) {
      const title = String(input?.title || '').trim();
      if (!title) return { ok: false, error: 'Title is required' };
      const posts = this.getAllPosts();
      const now = new Date().toISOString();
      let slug = slugifyPost(input?.slug || title);
      if (posts.some((post) => post.slug === slug)) slug = `${slug}-${Date.now().toString(36)}`;
      const post = normalizePost({
        ...input,
        id: nextId(),
        title,
        slug,
        authorId: author.id || input?.authorId || '',
        authorName: author.name || author.username || input?.authorName || '',
        publishedAt: input?.status === 'published' ? input?.publishedAt || now : input?.publishedAt || '',
        createdAt: now,
        updatedAt: now,
      });
      posts.unshift(post);
      writeJson(POSTS_PATH, posts);
      return { ok: true, post };
    },
    updatePost(id, input, author = {}) {
      const posts = this.getAllPosts();
      const i = posts.findIndex((post) => post.id === id);
      if (i === -1) return { ok: false, error: 'Post not found' };
      const current = posts[i];
      const next = normalizePost({
        ...current,
        ...input,
        id: current.id,
        slug: input?.slug ? slugifyPost(input.slug) : current.slug,
        authorId: current.authorId || author.id || '',
        authorName: input?.authorName || current.authorName || author.name || author.username || '',
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
        publishedAt:
          input?.status === 'published' && !current.publishedAt
            ? new Date().toISOString()
            : input?.publishedAt !== undefined
              ? input.publishedAt
              : current.publishedAt,
      });
      if (!next.title) return { ok: false, error: 'Title is required' };
      posts[i] = next;
      writeJson(POSTS_PATH, posts);
      return { ok: true, post: next };
    },
    deletePost(id) {
      const posts = this.getAllPosts();
      const filtered = posts.filter((post) => post.id !== id);
      if (filtered.length === posts.length) return { ok: false, error: 'Post not found' };
      writeJson(POSTS_PATH, filtered);
      return { ok: true };
    },
    getAnalytics(defaults = {}) {
      return normalizeAnalytics(readJson(ANALYTICS_PATH, {}), defaults);
    },
    writeAnalytics(patch, defaults = {}) {
      const next = normalizeAnalytics({ ...this.getAnalytics(defaults), ...patch }, defaults);
      writeJson(ANALYTICS_PATH, next);
      return next;
    },
    getPayments() {
      return normalizePayments(readJson(PAYMENTS_PATH, {}));
    },
    writePayments(patch) {
      const current = this.getPayments();
      const next = normalizePayments({
        ...current,
        ...patch,
        stripe: { ...current.stripe, ...(patch.stripe || {}) },
        paypal: { ...current.paypal, ...(patch.paypal || {}) },
        updatedAt: new Date().toISOString(),
      });
      writeJson(PAYMENTS_PATH, next);
      return next;
    },
  };
}
