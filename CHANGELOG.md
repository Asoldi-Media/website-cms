# Changelog

## 2.2.0 (2026-10-23)

- Admin: new look, a Pages panel, and a shop menu with Features (Timer, Rabatter, Gavekort, Abonnement, Omtaler, Forlatte kasser). A module a site never set stays on; switching it off in Settings → Features hides it.
- Content: CMS fallback pages for `/blog` and `/products`, post excerpt and featured image, `GET /api/cms/content-pages`, `GET /api/cms/capabilities` and `DELETE /api/cms/leads/:id`.
- Admin access: sessions expire, sign-in attempts are rate limited, and each site keeps its own secrets in its private data folder. See [docs/security.md](docs/security.md).
- Hub: calls send `x-site-key`; the heartbeat reports the package build.
- `dev-server.mjs` works with Windows paths and opens the admin without a password on 127.0.0.1.

Earlier versions: see the git log.
