# Admin access and secrets

How a client CMS signs people in and where it keeps its secrets. Code: `server/secret.js`, `server/admin-token.js`, `server/login-limiter.js`, `server/public-config.js`.

## Private data folder

Each site keeps its secrets in `<dataPath>/cms/private/secrets/`. On Hostinger that is `~/.asoldi-cms-data/<siteKey>/cms/private/secrets/`, outside the deployed repo, so it survives every deploy. `cms/private/` itself holds the shop's digital product files; shop file names can never contain a slash, and the shop file routes only touch plain files, so no shop route reaches the `secrets/` folder.

| File | What it is |
|---|---|
| `secrets.json` | `{ version, adminSecret, createdAt }`. Signs admin sessions and the cart cookie. Created once on first start (two processes starting together agree on one value). |
| `initial-admin.json` | One-time admin login when no usable password was given. Removed when the admin changes the password or the Asoldi hub sets the client admin. |

Treat the folder like a password file. It never goes into Git, support uploads, or backups that leave the server.

## Session secret

1. `adminSecret` passed to `createCmsRoutes` (tests and dev tools).
2. `CMS_ADMIN_SECRET`, then `ADMIN_SECRET`, when the value has 16+ characters and is not a placeholder. A shorter value is ignored with a warning in the log (the value is never logged).
3. Otherwise `secrets/secrets.json`.

Changing the secret signs everyone out and empties open carts.

## Sessions

| Login | Lifetime |
|---|---|
| `/admin/login`, `/auth/login` | 7 days |
| Local open (`CMS_LOCAL_OPEN=1`, loopback or LAN Host only) | 12 hours |
| Open CMS as Asoldi (hub SSO) | 8 hours |

Signatures are checked in constant time. A token with no expiry field counts as issued at `at` plus 7 days.

## Sign-in limits

`POST /api/cms/admin/login` and `POST /api/cms/auth/login` allow 10 failed attempts per username and 50 per client IP in 15 minutes. After that the answer is `429` with `Retry-After`, even for the right password. A successful sign-in clears the username's count. Counts live in memory, so a restart clears them.

## First admin login

- `CMS_ADMIN_USERNAME` / `CMS_ADMIN_PASSWORD` seed the first admin when the password has 8+ characters and is not on the common-password list in `server/secret.js`.
- Otherwise the CMS generates a 24-character password and writes it to `initial-admin.json`. The log names the file, never the password.
- At start, a stored admin password on the `DEFAULT_ADMIN_PASSWORDS` list in `server/secret.js` is replaced the same way.

### When nobody knows the admin password

1. **Hub client admin.** Set the client admin in the Asoldi hub. The CMS applies it on its next `GET /api/cms/config` and removes `initial-admin.json`. The heartbeat reports `adminApplied` and `initialAdminPending`.
2. **Open CMS as Asoldi.** Sign in through hub SSO, then add a login with rank `admin` under Settings → Staff and hand it to the client.
3. **Server shell.** Read `cms/private/secrets/initial-admin.json` from the site's data folder.

## Public config

`GET /api/cms/config` is public. It returns only the keys in `PUBLIC_CONFIG_KEYS` (`server/public-config.js`): name, domain, features, catalog type, website plan, analytics level, desired version and package version. Any other field from the hub stays on the server until it is added to that list.

The package build id (`packageBuild`, from `cms.vendor.manifest.json` in shipped copies, `dev` in this repo) goes to the hub heartbeat only.

## Hub calls

Server-to-server calls send the site key in the `x-site-key` header. `GET /api/hub/site-config` also still carries `?site_key=` for hubs that read only the query; that copy will be dropped once every hub reads the header.
