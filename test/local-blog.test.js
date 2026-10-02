import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStore } from '../server/store.js';
import { acceptDraft, emptyLedger, isPostDue, sanitizePostHtml } from '../server/local-blog.js';
import { runLocalBlogOnce } from '../server/local-blog-job.js';
import { seedTestBlogPosts } from '../server/test-posts.js';

const brief = {
  blogEnabled: true,
  hasSubject: true,
  businessName: 'Kafe Test',
  language: 'Norsk (Norge)',
  places: ['Trondheim'],
  services: [{ name: 'Kjøkkenmontering', description: 'Montering av kjøkken.' }],
  contactPath: '/kontakt',
  whatTheyDo: 'Vi monterer kjøkken for folk som vil ha det gjort skikkelig.',
  hours: 'Man: 08–16',
};

function article({ places = 1 } = {}) {
  const words = Array.from({ length: 640 }, (_, index) => (index % 20 === 0 ? 'kjøkkenmontering' : 'arbeid'));
  const mentioned = Array.from({ length: places }, () => 'Trondheim').join(' ');
  return `<h1>Overskrift</h1><h2>Slik foregår jobben</h2><p>${words.join(' ')}</p><h2>Hva du kan forvente</h2><p>${mentioned}</p><img src="https://example.com/map.jpg" alt="kart"><a href="https://other.example/x">annen</a>`;
}

test('a new blog gets three published test posts with images, and an existing file is left alone', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'asoldi-test-posts-'));
  const store = createStore(root);
  const first = seedTestBlogPosts(store, root);
  assert.equal(first.seeded, true);
  assert.equal(first.count, 3);
  const posts = store.getAllPosts();
  assert.equal(posts.length, 3);
  assert.equal(posts.every((post) => post.status === 'published'), true);
  assert.equal(posts.every((post) => post.blocks[0]?.type === 'image' && post.blocks[1]?.type === 'text'), true);
  assert.equal(existsSync(path.join(root, 'cms', 'uploads', 'test-innlegg-1.svg')), true);
  assert.match(posts.find((post) => post.slug === 'test-innlegg-1').blocks[0].url, /\/api\/cms\/uploads\/test-innlegg-1\.svg$/);
  assert.equal(seedTestBlogPosts(store, root).seeded, false);
  assert.equal(store.getAllPosts().length, 3);

  const existing = mkdtempSync(path.join(tmpdir(), 'asoldi-test-posts-keep-'));
  mkdirSync(path.join(existing, 'cms'), { recursive: true });
  writeFileSync(path.join(existing, 'cms', 'posts.json'), '[]\n');
  assert.equal(seedTestBlogPosts(createStore(existing), existing).seeded, false);
  assert.equal(createStore(existing).getAllPosts().length, 0);
  rmSync(root, { recursive: true, force: true });
  rmSync(existing, { recursive: true, force: true });
});

test('posts are due at the start of the month and then about every three days', () => {
  const start = new Date('2026-10-01T00:00:00.000Z');
  assert.equal(isPostDue(emptyLedger(start), start), true);
  const one = { month: '2026-10', posts: [{ topic: 'kjokken' }] };
  assert.equal(isPostDue(one, start), false);
  assert.equal(isPostDue(one, new Date('2026-10-05T00:00:00.000Z')), true);
  const full = { month: '2026-10', posts: Array.from({ length: 10 }, (_, index) => ({ topic: `t${index}` })) };
  assert.equal(isPostDue(full, new Date('2026-10-28T00:00:00.000Z')), false);
});

test('a draft stays on the service, drops images and outside links, and refuses a stuffed place', () => {
  const html = sanitizePostHtml(article(), { contactPath: '/kontakt', language: 'Norsk (Norge)' });
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('https://'), false);
  assert.equal(html.includes('href="/kontakt"'), true);
  assert.equal(html.includes('<h1'), false);

  const accepted = acceptDraft(
    { title: 'Kjøkkenmontering når skapene skal på plass', topic: 'kjokkenmontering', html: article() },
    { brief, usedTopics: [] },
  );
  assert.equal(accepted.ok, true);
  assert.equal(accepted.post.blocks.length, 1);
  assert.equal(accepted.post.blocks[0].type, 'text');
  assert.equal(JSON.stringify(accepted.post).includes('<img'), false);

  const stuffed = acceptDraft(
    { title: 'Kjøkkenmontering når skapene skal på plass', topic: 'kjokkenmontering', html: article({ places: 4 }) },
    { brief, usedTopics: [] },
  );
  assert.equal(stuffed.ok, false);
  assert.equal(stuffed.reason, 'place-stuffing');

  const repeat = acceptDraft(
    { title: 'Kjøkkenmontering når skapene skal på plass', topic: 'kjokkenmontering', html: article() },
    { brief, usedTopics: ['kjokkenmontering'] },
  );
  assert.equal(repeat.reason, 'repeat-topic');

  const off = acceptDraft(
    { title: 'Noe helt annet', topic: 'annet', html: article() },
    { brief, usedTopics: [] },
  );
  assert.equal(off.reason, 'off-brief');
});

test('one run publishes a text post and does not write another the same day', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'asoldi-local-blog-'));
  const store = createStore(root);
  const now = new Date('2026-10-01T12:00:00.000Z');
  const env = {
    LOCAL_BLOG_ENABLED: '1',
    LOCAL_BLOG_TOKEN: 'token-1',
    DEEPSEEK_API_KEY: 'test-key',
  };
  let hubCalls = 0;
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/hub/local-blog-brief')) {
      hubCalls += 1;
      assert.equal(options.headers.Authorization, 'Bearer token-1');
      assert.equal(options.headers['X-Site-Key'], 'site-1');
      return { ok: true, json: async () => brief };
    }
    return {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              title: 'Kjøkkenmontering når skapene skal på plass',
              topic: 'kjokkenmontering',
              html: article(),
            }),
          },
        }],
      }),
    };
  };
  const first = await runLocalBlogOnce({
    store,
    dataPath: root,
    hubUrl: 'https://asoldi.com',
    siteKey: 'site-1',
    env,
    fetchImpl,
    now,
  });
  assert.equal(first.ok, true);
  const posts = store.getAllPosts();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].blocks.some((block) => block.type === 'image'), false);
  assert.equal(posts[0].blocks[0].text.includes('<img'), false);
  assert.equal(posts[0].blocks[0].text.includes('href="/kontakt"'), true);

  const second = await runLocalBlogOnce({
    store,
    dataPath: root,
    hubUrl: 'https://asoldi.com',
    siteKey: 'site-1',
    env,
    fetchImpl,
    now,
  });
  assert.equal(second.skipped, 'not-due');
  assert.equal(store.getAllPosts().length, 1);
  assert.equal(hubCalls, 1);

  const disabled = await runLocalBlogOnce({
    store,
    dataPath: root,
    hubUrl: 'https://asoldi.com',
    siteKey: 'site-1',
    env: { ...env, LOCAL_BLOG_ENABLED: '0' },
    fetchImpl: async () => { throw new Error('should not fetch'); },
    now,
  });
  assert.equal(disabled.skipped, 'disabled');
  rmSync(root, { recursive: true, force: true });
});
