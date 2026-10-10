# Client CMS implementation notes

Source is `server/` and `client/`. Hostinger and Website Creator run those files directly. See `docs/ai/layout.md`.

## Architecture

```
Client site (e.g. mongsushi.no)
├── Website (existing)
├── npm: @asoldi/client-cms
├── Mount: /api/cms → createCmsRoutes({ hubUrl, siteKey, dataPath })
└── Route: /admin → <ClientCMS />

Hub (Asoldi website repo)
├── /superadmin → Super-admin UI (list sites, add site, set features)
└── GET /api/hub/site-config?site_key=xxx → { features, name }
```

- **Client data** (users, products, categories, admin) is stored under `dataPath/cms/` on the **client’s** server (e.g. Hostinger). Not in the hub.
- **Feature flags and catalog type** are in the hub; this package only reads them via the config endpoint.

## Ecommerce

Catalog type comes from the hub (`ecommerceCatalogType`: `menu` | `tiers` | `normal`).

- Products: `data/cms/products.json`. Fields: `id`, `name`, `price`, `description`, `imageUrl`, `categoryId`, `allergens`, `subtitle`, `bullets`, `cta`, `sortOrder`, `createdAt`, `updatedAt`.
- Categories: `data/cms/categories.json` (menu / normal only).
- Public storefront read: `GET /api/cms/catalog` when ecommerce is enabled.
- Images: upload to `data/cms/uploads/` or paste a URL.
- Flat v1.0.x products (name/price/description/imageUrl) are migrated in place on first read.

## Heartbeat

`GET /api/cms/config` includes `packageVersion` and POSTs `/api/hub/heartbeat` so the hub can track last-seen CMS version per site.

## Publishing

- From this repo: `npm publish` (with GitHub Packages or private registry for `@asoldi`).
- Consuming projects: `npm install @asoldi/client-cms`, mount routes and route, set env, deploy.
