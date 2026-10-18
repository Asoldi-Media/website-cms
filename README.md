# @damianhch/client-cms

Client CMS for Asoldi client sites: **users**, **typed ecommerce** (menu / tiers / normal), and hub-driven feature flags (users, ecommerce, blog, social sync, analytics). Install in any client project; mount at `/api/cms`, show UI at `/admin`.

Package version: **2.1.3**.

Source is plain JavaScript in `server/` and `client/`. Install lines stay `import createCmsRoutes from '@damianhch/client-cms'` and `import { ClientCMS } from '@damianhch/client-cms/ClientCMS'`.

---

## What you need

- **Hub (super-admin):** Runs in the [Asoldi website](https://github.com/Damianhch/Asoldi-website) repo at **that domain/superadmin**. There you add client sites, pick a website plan, turn features on/off, and choose an ecommerce catalog type.
- **This package:** Install in each **client** project so that **domain.com/admin** gives the client their CMS.

---

## Install in a client project

```bash
npm install @damianhch/client-cms
```

---

## 1. Add the site in the hub (once per client)

1. Open the hub: **https://your-hub-domain.com/superadmin** (e.g. asoldi.com/superadmin).
2. Log in (same credentials as that site’s /admin).
3. Click **Add site**, enter **Name**, **Domain**, and **Website plan**.
4. If the plan includes a shop (or you enable Ecommerce later), pick **catalog type**: menu, tiers, or normal products.
5. Copy the **site key** and set it in the client project as `CMS_SITE_KEY`.

---

## 2. Backend: mount the CMS API

In the client project’s server (e.g. `server.js`), mount the routes **before** static/SPA:

```js
import express from 'express';
import createCmsRoutes from '@damianhch/client-cms';

const app = express();
app.use(express.json());

app.use(
  '/api/cms',
  createCmsRoutes({
    hubUrl: process.env.CMS_HUB_URL,
    siteKey: process.env.CMS_SITE_KEY,
  })
);

// Then your static, SPA fallback, etc.
```

- **hubUrl** – Root URL of the site that runs the hub (no trailing slash).
- **siteKey** – From the hub (Super Admin → Add site → Copy).
- **dataPath** – Optional. Defaults to `~/.asoldi-cms-data/<siteKey>` (Hostinger Git deploys do not wipe it). Set `CMS_DATA_PATH` only to override.

---

## 3. Frontend: add the /admin route

In the client’s React app (React Router):

```jsx
import { ClientCMS } from '@damianhch/client-cms/ClientCMS';

// In your router:
<Route path="/admin" element={<ClientCMS />} />
```

Optionally hide the main site nav/footer when `pathname === '/admin'`.

---

## 4. Env on the client host

Set on the server (e.g. Hostinger env):

- **CMS_HUB_URL** – Hub root URL (e.g. `https://asoldi.com`).
- **CMS_SITE_KEY** – Site key from the hub for this client.
- **CMS_DATA_PATH** – Optional. Folder for this site’s CMS JSON (users, products, uploads). If unset, data lives in `~/.asoldi-cms-data/<siteKey>` so Hostinger Git deploys do not wipe content. Existing `./data/cms` is copied there once.

For HTML (non-React) Hostinger apps, serve the prebuilt admin SPA:

```js
import createCmsRoutes, { mountCmsAdmin } from '@damianhch/client-cms';

app.use('/api/cms', createCmsRoutes({
  hubUrl: process.env.CMS_HUB_URL,
  siteKey: process.env.CMS_SITE_KEY,
}));
mountCmsAdmin(app);
```

Optional (first-run admin account):

- **CMS_ADMIN_USERNAME** / **CMS_ADMIN_PASSWORD** – Default admin for this client’s CMS (defaults: `admin` / `changeme`).
- **CMS_PUBLIC_URL** – Public site origin used in hub heartbeats (e.g. `https://mongsushi.no`). If unset, the CMS infers it from the incoming request host.

---

## Ecommerce catalog

When Ecommerce is enabled for the site in the hub, `/admin` shows the **Ecommerce** tab with **Products** and **Orders / Ordre**.

| Catalog / product type | Categories | Product fields |
|---|---|---|
| **menu** | Yes (groups) | name, price, compare-at, contact instead, description, image, category, allergens, extras, stock |
| **tiers** | Optional | name, price, included bullets, CTA, extra notes, image, stock |
| **normal** | Yes (tabs) | name, subtitle, description, price, image, category, extra notes, stock |

Each product stores its own **product type**. The hub catalog type is the default for new products.

Admin CRUD is authenticated. The public storefront should read:

```
GET /api/cms/catalog
→ { catalogType, name, categories, products }
```

Orders are stored on the client host (`orders.json`) and are not deleted; cancel them with status. The one exception is shop **test mode** (since 2.1.0, Shop → Innstillinger → Testmodus): while it is on, orders are numbered `TEST-1`, `TEST-2` … (credit notes `TEST-K1`) in their own series, stay out of reports, VAT and CSV, and buyers see a test banner on the product and cart pages. `POST /shop/admin/test-data/clear` (owner) deletes the test orders and the bookings, downloads, subscriptions, gift cards and customer rows they created, returns their stock and restarts the TEST series. Real orders and the real number series are never touched.

**Payment setup** (Ecommerce → Payment setup, admin rank only) has **Connect Stripe** and **Log in with PayPal** buttons (or a PayPal email fallback). Asoldi (the hub) is the Stripe Connect platform and PayPal partner; the client host holds **no** provider keys. Every call goes server-to-server to `hubUrl/api/hub/shop/*` with the site key (`server/shop-checkout.js`).

**Shop** (since 2.0.0): products with a plain numeric price, not sold out and not "contact instead of price" get `buyable: true` in `/catalog`, and the storefront `product.cta` slot links to the product page `/api/cms/shop/product/<id>`, which adds to the signed cookie cart (`/api/cms/cart`). Checkout prices every line from the stored products (never from the form), adds MVA and shipping, and redirects to Stripe Checkout (direct charge on the seller's account) or PayPal. `GET /checkout/return` asks the hub to verify (Stripe session paid / PayPal capture), checks amount + currency, then writes **one** order (`paymentProvider`, `paymentStatus: paid`, `paymentRef`, `checkoutRef`), lowers `stockQty` and emails the owner through the hub forms pipe. The hub forwards Stripe webhooks to `POST /checkout/notify`, which re-verifies the same way. Pending checkouts live in `cms/checkouts.json`. Currency: `CMS_CURRENCY` (default `nok`).

---

## Email marketing

Hub flag `emailMarketing`. **Maler** (GrapesJS, HTML-import, emne + preheader) lives in `email-templates.json`. Asoldi sites seed welcome/reminder presets; other clients start empty. Lists + contacts live in `lists.json` / `leads.json`. Public form endpoint:

```
POST /api/cms/leads
{ email, name, sms, whatsapp, language, marketingAccept, listSlug? }
```

`marketingAccept` is stored as `true` or empty (never a visible `false` in the admin table).

---

## Site seed — bound website forms + pages (`cms.site.json`)

Website Creator's **Step 3 “CMS hookup”** ships a `cms.site.json` next to `server.js` (pass `siteSeedPath` to
`createCmsRoutes`, or `siteSeed` as an object). It is read-only site structure:

- `lists` — email lists the developer created before deploy. Seeded **once** into `lists.json` with their ids kept, so
  bindings resolve 1:1; an existing list with the same slug is reused.
- `forms` — every frontend form bound to this CMS: `destination` (`list` → `listId`, or `inbox`), `fieldMap`
  (`{ formField: email|name|firstName|lastName|sms|whatsapp|language|marketingAccept|message|subject|company|extra|skip }`),
  `notify`, `successMessage`, `fields`, `pages`.
- `pages` — the page map with kinds (`home`, `about`, …, `blog-post`, `product-page`, `cta`, `legal`); `isTemplate` marks
  the layouts the CMS fills.

Endpoints:

```
GET  /api/cms/forms-runtime.js         public JS the site pages load; upgrades bound forms to fetch + inline success
POST /api/cms/forms/:id/submit         public; JSON (runtime) or urlencoded (no-JS → 303 back to ?cms-form=ok)
GET  /api/cms/forms                    admin; bindings + counts
GET  /api/cms/pages                    admin; page map
GET  /api/cms/site                     admin; whole seed (+ live counts)
GET  /api/cms/submissions?formId=&unread=true   admin; inbox log (PUT /:id {read}, DELETE /:id)
```

`list` destinations upsert a lead (`formId`, unmapped fields in `extra`); `inbox` destinations store a submission and
forward it to the hub's `/api/client-forms/:siteKey` so the client still gets the e-mail. Honeypot `_gotcha`.
Admin UI: **General → Pages / Forms & inbox**; Email marketing lists show which website forms feed them.

---

## Blog, ranks, analytics

- **Blog** (`blog` flag): text + image blocks, author is the signed-in user, draft / scheduled / published. Public `GET /api/cms/posts`.
- **General** (`general` flag): CMS user ranks — employee (no delete users), writer (blog only), member (no modules). Superadmin has a **Client admin user** page (name, email, password, avatar, service checkboxes). A new password hashes on the hub and syncs to the client CMS on the next config fetch.
- **Analytics** (`analytics` flag): Tier 2 basic dashboard (visits, bounce, Google Maps ranking). Tier 3 adds ecommerce metrics. First-party tracker at `/api/cms/analytics/collect.js`. Maps ranking is fetched from the Asoldi hub (DataForSEO Google Maps SERP, every 14 days). GA4 DNS TXT remains optional.

That endpoint returns **404** when ecommerce is off. Product data stays on the client server (`{dataPath}/cms/products.json`). Existing flat `{name, price, description, imageUrl}` rows are migrated in place.

---

## Hub config and heartbeats

`GET /api/cms/config` proxies the hub and adds this package version:

```
{
  features: { users, analytics, ecommerce, blog, socialSync, emailMarketing, general },
  name, id,
  ecommerceCatalogType,
  websitePlan,
  desiredCmsVersion,
  packageVersion
}
```

On each config load the CMS POSTs `{CMS_HUB_URL}/api/hub/heartbeat` with `site_key`, `packageVersion`, and `adminUrl` so the hub can show last-seen version for fleet updates.

---

## Domain changes

If a client’s domain changes, update the **Domain** in the hub for that site. **CMS_SITE_KEY** in the client project stays the same.

---

## See also

- **CONTEXT.md** – Overview for developers / Cursor so a new environment understands the setup.
- **docs/ai/layout.md** – Where the JavaScript lives and which files Website Creator imports.
- **docs/ai/typescript-revert.md** – Why this package stays plain JavaScript.
- **docs/** – Strategy and implementation notes (single per client + hub, where data lives, etc.).
