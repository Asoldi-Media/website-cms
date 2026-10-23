# Admin access and secrets

How a client CMS signs people in and where it keeps its secrets. Code: `server/secret.js`, `server/admin-token.js`, `server/login-limiter.js`, `server/public-config.js`.

## Private data folder

Each site keeps its secrets in `<dataPath>/cms/private/secrets/`. On Hostinger that is `~/.asoldi-cms-data/<siteKey>/cms/private/secrets/`, outside the deployed repo, so it survives every deploy. `cms/private/` itself holds the shop's digital product files; shop file names can never contain a slash, and the shop file routes only touch plain files, so no shop route reaches the `secrets/` folder.

| File | What it is |
|---|---|
| `secrets.json` | `{ version, adminSecret, createdAt }`. Signs admin sessions and the cart cookie. Created once on first start (two processes starting together agree on one value). |
| `initial-admin.json` | One-time admin login when no usable password was given. Removed when the admin changes the password or the Asoldi hub sets the client admin. |

Treat the folder like a password file. It never goes into Git, support uploads, or backups that leave the server.

**Sites upgraded from 1.7.x.** The 1.7 line kept `secrets.json` and `initial-admin.json` directly in `cms/private/`. At start this version moves them (and any set-aside copies such as `secrets.json.invalid-<time>`) into `cms/private/secrets/`, so admin sessions from before the upgrade stay valid and the first admin login is where this page says it is. If the secrets folder already holds its own `secrets.json`, that one wins and a different older copy is kept next to it as `secrets.json.legacy-<time>`. The log says `Moved N sign-in file(s) …` once. If a file cannot be moved, the log says so; the shop file routes never list or serve these names either way.

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

## Open CMS as Asoldi

Asoldi staff open the CMS from the hub with a one-time link, `GET /api/cms/admin/sso?token=…` (`server/sso.js`).

- The token is 32 random bytes from the hub. Before a session opens, the CMS asks the hub whether it is good: `POST {hubUrl}/api/cms/sso/redeem` with this site's key in `x-site-key` and `{ token }` in the body. The hub accepts a token once, only for the site it was issued to, and only within 60 seconds.
- `hubUrl` comes from the server config (`cms.config.json` or `CMS_HUB_URL`), never from the request. Without a site key or hub the route answers `404`.
- The sign-in is refused (`401`) unless the hub answers `200` with `{ ok: true }` within 5 seconds. An error, a redirect, a timeout or an unreachable hub all refuse it.
- The CMS also remembers each token it has seen for 10 minutes, so a second use is refused before the hub is asked.
- Failed links count per client address like sign-ins: after 10 in 15 minutes the answer is `429` with `Retry-After`, and the hub is not asked.
- A successful sign-in is an 8-hour admin session as `asoldi-support`, recorded in `cms/audit.json` (who, when, address), which admins see under `GET /api/cms/admin/audit`.

## Sign-in limits

`POST /api/cms/admin/login` and `POST /api/cms/auth/login` count failed attempts over 15 minutes:

| Count | Limit |
|---|---|
| One username from one client address | 10 |
| One username from all addresses | 100 |
| One client address, all usernames | 50 |

Past a limit the answer is `429` with `Retry-After`, even for the right password. A successful sign-in clears the count for that username on that address, so the owner signing in from their own address is not blocked by failures from elsewhere until the 100 ceiling.

- **Parallel requests.** An attempt is counted when it starts, before the password is checked, and a correct password takes it back. Requests sent at the same time therefore share the limits above. At most 2 password checks run at once for one username and for one client address; a further request gets `429` with `Retry-After: 1`.
- **Client address.** A direct connection counts by its socket address. When the request comes from a reverse proxy on the same host or private network (loopback, private or link-local address, or a Unix socket), the CMS uses the last `X-Forwarded-For` hop, which that proxy appended. `CMS_TRUSTED_PROXY_HOPS` (default `1`) sets how many proxies append to the header; `0` ignores it. A proxy that passes the client's header through without appending gives the client control of its address; the per-username limits still apply.
- **Checking the address setup.** The hub heartbeat carries `loginAddressMode` (`direct`, `forwarded` or `shared-proxy`), `loginForwardedFor` (whether `X-Forwarded-For` was present) and `loginAddressFrom` (`sign-in` for the last sign-in, else `request` for the config request that sent the heartbeat). No address is sent. `forwarded` is the expected value behind a local proxy. `shared-proxy`, or `direct` with `loginForwardedFor: true`, means every visitor counts as one address, so the per-address limit applies to the whole site; the CMS also logs this once.
- **Input.** A username over 200 characters, a password over 1024, or a value that is not text is refused with `400` before anything is counted.
- **Memory.** Usernames are stored as short hashes and addresses are capped at 64 characters. The table holds at most 10,000 keys (the oldest go first) and expired keys are dropped once a minute. Counts live in memory, so a restart clears them.

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
