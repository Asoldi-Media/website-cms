# Contributing

Edit `server/` and `client/` only. They are the source. `npm test` runs the node tests. `npm run lint` checks those two folders. `npm run build:admin` rebuilds `admin-dist/` after a client UI change that HTML sites serve.

Read `docs/ai/layout.md` before moving a module. Read `docs/ai/typescript-revert.md` before introducing a compile step or TypeScript.

## JSDoc

Keep it to one or two lines.

- A file starts with a block that says what the file is for.
- An exported function gets one line when the name does not already say what it returns or what it refuses.
- Contract files (`capabilities.js`, `site-seed.js`, `cms-slot-contract.js`, `slot-map.js`, `forms.js`) name the website-creator file they must match.
- Do not add `@param` or `@returns` lists.
- Do not comment an obvious local.
- Do not put a block comment inside a browser-runtime template string. A backtick there ends the string.

`npm run lint` warns when an exported function has no JSDoc description. Warnings are the reminder. They are not a second type system.

## Website Creator contract

`server/capabilities.js` is the feeler list Step 3 may bind to. `server/cms-slot-contract.js` matches `lib/cms-content/hydrator-contract.js` in website-creator.

Do not rename a purpose, schema key, slot, `data-cms-*` attribute, or `/api/cms` path. Add new ones. Removing or renaming one is a major version.

`cms.site.json` and `createCmsRoutes({ hubUrl, siteKey, dataPath, siteSeed, siteSeedPath, publicPath, adminSecret })` stay as they are.
