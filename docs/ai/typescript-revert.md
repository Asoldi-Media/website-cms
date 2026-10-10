# TypeScript revert

A TypeScript pass was tried and then removed. Do not add TypeScript again unless the conditions at the bottom are true.

## What the pass did

Source moved to `src/server/*.ts` and `src/client/*.tsx`. `tsc` wrote `dist/`, and a build script copied that over `server/*.js` and `client/*.js` plus `.d.ts`. `package.json` `"test"` ran `tsc` before the node tests.

That layout existed because Website Creator's sync (`scripts/sync-client-cms.mjs` in the website-creator repo) copies this repo and skips `dist/`. Hostinger starts `server/routes.js` with plain Node. A `dist/`-only package would not boot on a client site.

`tsconfig` was strict (`strict`, `noImplicitReturns`, `verbatimModuleSyntax`, NodeNext). JSX emitted as `react-jsx`, so the committed client files were function calls, not JSX.

The same pass brought in behavior that is still here, because the creator's vendored snapshot was ahead of this repo:

- `server/capabilities.js`, the feeler list Step 3 binds to.
- `server/local-open.js`, plus `GET /api/cms/admin/local-open` and `GET /api/cms/admin/local-session`. Login is skipped only for a loopback or private Host when `CMS_LOCAL_OPEN=1`.
- Hydrator matching for an unmarked image only when one element matches the CSS path, and script URLs `site-hydrator.js?v=5` and `site-editor-runtime.js?v=6`.

The editor runtime was not replaced with the vendored copy. That copy still called `setAttribute('contenteditable')`. This repo's test requires the side panel instead. `server/site-editor-runtime.js` is that side panel.

## Why it was removed

Hostinger and Website Creator never read the TypeScript. Every edit was written twice: `src/`, then the generated `server/` and `client/` that had to be committed.

Strict mode did not protect the data. Request bodies, the JSON store, and React state were annotated `any` (on the order of nine hundred annotations). A wrong product or form field still typechecked. ESLint's ban on `any` was turned off so lint could pass.

The useful check stayed the node tests against `server/*.js`.

## What "easy to change" means instead

One JavaScript tree. A file comment and a one-line JSDoc on each export. ESLint `recommended` plus `eslint-plugin-jsdoc` warnings on exported functions. See `CONTRIBUTING.md` and `docs/ai/layout.md`.

## Do not add TypeScript again unless all of these are true

- `cms.site.json`, the store rows, and the `createCmsRoutes` options have real types, not `any`.
- Hostinger can still start `server/routes.js` with plain Node and no build.
- Website Creator can still import `server/capabilities.js`, `server/catalog.js`, `server/blog.js`, `server/cms-slot-contract.js`, `server/content-runtime.js`, and `server/site-seed.js` by those paths after a sync.
