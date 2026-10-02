# Local service posts

When `LOCAL_BLOG_ENABLED=1`, this CMS asks Asoldi for its own service brief and writes up to 10 text-only posts a month. The town from that brief is mentioned at most twice. No cover image is set. Add one later in the blog editor, from the media library.

This does not link to other clients. The brief is only this site.

## Asoldi

`GET {hubUrl}/api/hub/local-blog-brief`

Headers: `Authorization: Bearer <LOCAL_BLOG_TOKEN>` and `X-Site-Key` set to this site’s key (`cms.config.json` or `CMS_SITE_KEY`).

`hubUrl` comes from `CMS_HUB_URL` or `cms.config.json`.

If the brief says Blog is off, or there is nothing real to write about, the job skips. A repeat topic is skipped. The ledger is `cms/local-blog.json` next to `posts.json`.

## Hostinger env

Paste these on the site. The hub cannot write that tab.

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_MODEL` optional, default `deepseek-chat`
- `LOCAL_BLOG_TOKEN`
- `LOCAL_BLOG_ENABLED=1`

The scheduler starts from `createCmsRoutes` (`server/local-blog-job.js`). It waits about 20 seconds after boot, then checks about every six hours, and publishes at most one due post per check.

The first start also writes three published test posts when `posts.json` does not exist yet (`server/test-posts.js`). Each one has a test image in the media library and on the post. An existing posts file is not changed. Monthly posts still have no image.
