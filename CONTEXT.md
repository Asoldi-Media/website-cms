# Context for Cursor / developers

This repo is **@damianhch/client-cms** (v1.8.0): the **client-facing CMS package** that gets installed on each client website (e.g. mongsushi.no, or any site built by Asoldi). It is **not** the super-admin; the super-admin lives in the main Asoldi website repo.

---

## What this package does

- **Client CMS** = the UI and API that **clients** (business owners) use at **domain.com/admin** to manage:
  - **Users** – staff logins for that site (e.g. “ansatt” login).
  - **Ecommerce** – typed catalog driven by the hub: **menu**, **tiers**, or **normal** products. Data is stored per site under `{dataPath}/cms/` (default `~/.asoldi-cms-data/<siteKey>/cms`).
  - **Blog / social sync / analytics / email** – tabs appear when the hub enables them. Blog, analytics (GA4 DNS), and email lists + **visual email templates** (GrapesJS newsletter editor, HTML import) are in 1.5.0. Asoldi sites seed welcome/reminder presets; other clients start empty and use Import HTML.
- **Hub-driven features:** Which modules are visible is controlled by a **hub** (super-admin). Each client project sets `CMS_HUB_URL` and `CMS_SITE_KEY`; on load the CMS calls the hub and only shows the enabled modules.

---

## Where things live

| What | Where |
|------|--------|
| **This package** | npm: `@damianhch/client-cms`. GitHub: https://github.com/Asoldi-Media/website-cms |
| **Hub (super-admin)** | Asoldi website repo. URL: that site’s `/superadmin` (e.g. asoldi.com/superadmin). You add client sites there, set website plan, feature flags, and ecommerce catalog type. |
| **Client data** | On each client’s server: users, products, categories, admin credentials. This package writes to `dataPath/cms/`. |
| **Feature flags + catalog type** | Stored in the hub; this package only reads them via `GET /api/hub/site-config?site_key=...`. |

---

## How a client project uses this package

1. **Install:** `npm install @damianhch/client-cms`
2. **Backend:** Mount the routes at `/api/cms`:
   ```js
   import createCmsRoutes from '@damianhch/client-cms';
   app.use('/api/cms', createCmsRoutes({
     hubUrl: process.env.CMS_HUB_URL,
     siteKey: process.env.CMS_SITE_KEY,
   }));
   ```
3. **Frontend:** Add route for `/admin` that renders the CMS UI:
   ```js
import { ClientCMS } from '@damianhch/client-cms/ClientCMS';
<Route path="/admin" element={<ClientCMS />} />
```
HTML Hostinger apps instead call `mountCmsAdmin(app)` and skip the React route.
4. **Env (e.g. Hostinger):** `CMS_HUB_URL`, `CMS_SITE_KEY` (and optionally `CMS_ADMIN_USERNAME`, `CMS_ADMIN_PASSWORD` for first-run admin). Data defaults to `~/.asoldi-cms-data/<siteKey>`.

The hub is **not** in this repo; it stays in the Asoldi website project. This repo only contains what gets npm-published for client sites.

---

## Ecommerce data

- Products: `dataPath/cms/products.json`
- Categories: `dataPath/cms/categories.json` (menu groups / normal product tabs)
- Orders: `dataPath/cms/orders.json` (append-only log; cancel via status, never hard-delete)
- Settings: `dataPath/cms/settings.json` (orders view preset: `normal` | `service`)
- Shared product fields: `id, name, price, comparePrice, contactInsteadOfPrice, description, imageUrl, categoryId, allergens, subtitle, included/bullets, extraTexts, extraOptions, cta, productType, stockQty, soldOut, sortOrder, createdAt, updatedAt`
- Public read: `GET /api/cms/catalog` (only when hub ecommerce is on)
- Admin: WordPress-like Products list (Quick Edit + full Edit) and Orders / Ordre
- Image upload: `POST /api/cms/upload` → `data/cms/uploads/` served at `/api/cms/uploads/...`

When the agency enables “Ecommerce” and picks a catalog type in the super-admin, the Ecommerce tab in that client’s `/admin` shows the matching form.

---

## Publishing and updates

- **Publish:** From this repo, `npm publish` (GitHub Packages, scope `@damianhch`).
- **Consuming projects** use `npm install @damianhch/client-cms` and mount the routes + route as above. When you release a new version, client projects run `npm update @damianhch/client-cms` and redeploy.
- On `/config` load this package heartbeats `packageVersion` to the hub so `/superadmin` can show which CMS version each client is running.
- Super-admin stays in the Asoldi website repo; no need to republish it with the package.

---

## Summary

- **This repo** = client CMS package only (users, typed ecommerce, future blog/social/analytics). Publish as `@damianhch/client-cms`.
- **Super-admin** = in the Asoldi website repo; you manage client sites, website plans, and feature flags there.
- **Client sites** = install this package, set env, mount `/api/cms` and `/admin`; their data lives on their server.
