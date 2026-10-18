# Layout

Plain JavaScript. Edit `server/` and `client/` directly. There is no package compile step.

## Commands

- `npm test` runs `node --test test/*.test.js`. Tests import `server/*.js`.
- `npm run lint` runs ESLint on `server/` and `client/`.
- `npm run build:admin` runs Vite and writes `admin-dist/`. HTML Hostinger sites serve that at `/admin`.

## What a client site imports

```js
import createCmsRoutes, { mountCmsAdmin } from '@damianhch/client-cms';
import { ClientCMS } from '@damianhch/client-cms/ClientCMS';
```

`package.json` maps those to `server/routes.js` and `client/ClientCMS.jsx`. Website Creator copies this repo into `vendor/client-cms` and skips `dist/`. Hostinger runs `node server.js`, which imports `@damianhch/client-cms`. Do not move the API behind a build.

`createCmsRoutes({ hubUrl, siteKey, dataPath, siteSeed, siteSeedPath, publicPath, adminSecret })`.

## Folders

- `server/` is the API and the scripts injected into public HTML.
- `client/` is the React admin UI. JSX stays in `.jsx` files.
- `admin-dist/` is the Vite build of `client/admin-main.jsx`. Generated. Do not edit.
- `test/` is node:test against `server/`.
- `admin/` is an unused second entry. It imports `client/ClientCMS.jsx`.

## Server modules

- `routes.js` mounts everything at `/api/cms`. This is the package entry.
- `store.js` reads and writes JSON under `{dataPath}/cms/`.
- `capabilities.js` is the feeler list Website Creator Step 3 may bind to. Slot names match website-creator `lib/cms-content/slot-contract.js`.
- `site-seed.js` loads `cms.site.json`. Field keys match website-creator `lib/cms-hookup/field-schema.js`.
- `cms-slot-contract.js` is `data-cms-slot` and the public script order. Match website-creator `lib/cms-content/hydrator-contract.js`.
- `slot-map.js` parses stamped HTML. Same shape as website-creator `lib/cms-hookup/slot-map.js`.
- `forms.js` maps a posted form onto a lead or an inbox row, and serves `forms-runtime.js`.
- `site-hydrator.js` applies published visual-editor patches and skips `data-cms-slot` nodes.
- `site-editor-runtime.js` is the editor side panel. It does not set `contenteditable`.
- `site-edits.js` stores draft and published patches.
- `local-open.js` skips admin login only when `CMS_LOCAL_OPEN=1` and the Host is loopback or private.
- `catalog.js`, `orders.js`, `leads.js`, `blog.js`, `media.js`, `payments.js`, `email-templates.js`, `ranks.js` are the module records.
- `local-blog.js` and `local-blog-job.js` write the monthly service posts.
- `test-posts.js` seeds three published posts when `posts.json` is missing.
- `data-path.js` picks `~/.asoldi-cms-data/<siteKey>` unless `dataPath` or `CMS_DATA_PATH` is set.
- `html-tracker.js` and `admin-static.js` serve public HTML and `/admin`.
- `sso.js` verifies the one-time "Open CMS as Asoldi" token from the hub and keeps `cms/audit.json`.
- `shop-checkout.js` holds `siteOrigin` and `isBuyable`, shared by the shop routes and `/catalog`.
- `shop/` is the shop engine (2.0.0). `index.js` (`createShop`) owns checkouts, finalize and webhooks. `pricing.js` is the pure price engine (MVA, shipping, discounts, gift cards; integer øre via `money.js`). `cart.js` is the signed cookie cart. `storefront.js`, `account.js` and `admin-routes.js` mount the public, customer and admin routes. `ops.js` ships and refunds. `pages.js` renders the storefront HTML. `hub-client.js` is the only code that calls the hub's `/api/hub/shop/*`. Shop data lives under `{dataPath}/cms/shop/`.

## Client modules

`ClientCMS.jsx` is the shell. Panels: products, orders, payments, blog, analytics, email, media, general (pages and inbox), site editor. `admin-main.jsx` is only the Vite entry. The shop tab is `EcommercePanel.jsx`; its pages are in `Shop*.jsx`, with shared pieces in `shop-ui.jsx` and product shop fields in `ShopCommerceFields.jsx`.

## Do not rename

Purposes, schema keys, slot names, `data-cms-*` and `data-asoldi-*` attributes, and `/api/cms` paths. Adding one is fine. Removing or renaming one is a major version. Website Creator reads `server/capabilities.js` by path after it copies this repo.
