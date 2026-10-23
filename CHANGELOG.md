# Changelog

## 2.2.1 (2026-10-23)

- Asoldi sign-in links are checked with Asoldi before use (needs an Asoldi hub that offers the check). See [docs/security.md](docs/security.md).
- Sites upgraded from 1.7.x keep their admin sessions; the secret and first admin login move into `cms/private/secrets`.
- New admin and staff passwords need at least 8 characters and may not be a common default.
- Sign-in limits keep their counts for real usernames when the table is full, and the shop's own limits use the same client address as sign-ins.

## 2.2.0 (2026-10-23)

- Admin: new look, a Pages panel, and a shop menu with Features (Timer, Rabatter, Gavekort, Abonnement, Omtaler, Forlatte kasser). A module a site never set stays on; switching it off in Settings → Features hides it.
- Content: CMS fallback pages for `/blog` and `/products`, post excerpt and featured image, `GET /api/cms/content-pages`, `GET /api/cms/capabilities` and `DELETE /api/cms/leads/:id`.
- Admin access: sessions expire, sign-in attempts are rate limited, and each site keeps its own secrets in its private data folder. See [docs/security.md](docs/security.md).
- Hub: calls send `x-site-key`; the heartbeat reports the package build and how sign-ins reach the site (no addresses).
- `dev-server.mjs` works with Windows paths and opens the admin without a password on 127.0.0.1.

Earlier versions: see the git log.
