# Changelog

## 2.2.2 (2026-10-23)

- Hub calls carry a site credential next to the site key: 32 random bytes made once in `cms/private/secrets`, sent only to the configured hub. The site enrolls it on its own (the hub checks it by asking the site's domain for `/api/cms/hub-enroll-proof`), and makes a new one after the hub revokes it. Payments, the client admin password from the hub and heartbeat details need an Asoldi hub that accepts the credential. See [docs/security.md](docs/security.md#hub-calls).
- Shop calls to the hub, the hub analytics calls and the Asoldi sign-in check send the credential too.

## 2.2.1 (2026-10-23)

- Asoldi sign-in links are checked with Asoldi before use (needs an Asoldi hub that offers the check). See [docs/security.md](docs/security.md).
- Sites upgraded from 1.7.x keep their admin sessions; the secret and first admin login move into `cms/private/secrets`.
- New admin and staff passwords need at least 8 characters and may not be a common default.
- Sign-in limits keep their counts for real usernames when the table is full, and the shop's own limits use the same client address as sign-ins.
- An Asoldi sign-in completes even when its audit entry cannot be written, and the heartbeat reports an https admin address for public hosts.

## 2.2.0 (2026-10-23)

- Admin: new look, a Pages panel, and a shop menu with Features (Timer, Rabatter, Gavekort, Abonnement, Omtaler, Forlatte kasser). A module a site never set stays on; switching it off in Settings → Features hides it.
- Content: CMS fallback pages for `/blog` and `/products`, post excerpt and featured image, `GET /api/cms/content-pages`, `GET /api/cms/capabilities` and `DELETE /api/cms/leads/:id`.
- Admin access: sessions expire, sign-in attempts are rate limited, and each site keeps its own secrets in its private data folder. See [docs/security.md](docs/security.md).
- Hub: calls send `x-site-key`; the heartbeat reports the package build and how sign-ins reach the site (no addresses).
- `dev-server.mjs` works with Windows paths and opens the admin without a password on 127.0.0.1.

Earlier versions: see the git log.
