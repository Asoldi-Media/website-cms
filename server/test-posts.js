import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createMediaLibrary } from './media.js';

const UPLOAD_BASE = '/api/cms/uploads';

function testSvg(label, accent) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#1a1a1a"/>
  <rect x="40" y="40" width="1120" height="550" fill="none" stroke="${accent}" stroke-width="8"/>
  <text x="600" y="300" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="64">${label}</text>
  <text x="600" y="370" text-anchor="middle" fill="${accent}" font-family="Arial, sans-serif" font-size="28">Bare til test</text>
</svg>
`;
}

/** Three published samples so a new client blog page can be opened before real posts exist. */
export const TEST_BLOG_POSTS = [
  {
    slug: 'test-innlegg-1',
    file: 'test-innlegg-1.svg',
    accent: '#FF5B00',
    label: 'Testbilde 1',
    title: 'Testinnlegg: tittel og ingress',
    alt: 'Testbilde for innlegg 1',
    text: '<p>Dette er et testinnlegg. Det ligger her så bloggsiden kan åpnes og sjekkes med en gang kunden er lagt til.</p><h2>Ingress</h2><p>Bytt ut denne teksten når det ekte innlegget skal publiseres. Bildet over er bare et testbilde.</p>',
  },
  {
    slug: 'test-innlegg-2',
    file: 'test-innlegg-2.svg',
    accent: '#3D8BFF',
    label: 'Testbilde 2',
    title: 'Testinnlegg: brødtekst',
    alt: 'Testbilde for innlegg 2',
    text: '<p>Andre testinnlegg, med en litt lengre brødtekst, så lista og selve innlegget kan sjekkes hver for seg.</p><h2>Slik ser et avsnitt ut</h2><p>Slett testinnleggene når de ekte tekstene er klare. De blir ikke brukt som mal for de månedlige innleggene.</p>',
  },
  {
    slug: 'test-innlegg-3',
    file: 'test-innlegg-3.svg',
    accent: '#2F9E6B',
    label: 'Testbilde 3',
    title: 'Testinnlegg: med bilde',
    alt: 'Testbilde for innlegg 3',
    text: '<p>Tredje testinnlegg. Bildet er et testbilde i mediebiblioteket, så du kan se hvordan et innlegg med media ser ut.</p><h2>Bilde</h2><p>De månedlige innleggene får ikke bilde automatisk. Der velger du selv fra biblioteket.</p>',
  },
];

export function postsFilePath(dataPath) {
  return join(dataPath, 'cms', 'posts.json');
}

function writeTestImage(uploadsDir, post) {
  mkdirSync(uploadsDir, { recursive: true });
  const full = join(uploadsDir, post.file);
  if (!existsSync(full)) writeFileSync(full, testSvg(post.label, post.accent), 'utf8');
  return `${UPLOAD_BASE}/${post.file}`;
}

export function seedTestBlogPosts(store, dataPath) {
  if (!store || !dataPath) return { seeded: false, count: 0 };
  if (existsSync(postsFilePath(dataPath))) return { seeded: false, count: 0 };
  const uploadsDir = join(dataPath, 'cms', 'uploads');
  const media = createMediaLibrary(uploadsDir);
  let count = 0;
  for (const post of TEST_BLOG_POSTS) {
    const url = writeTestImage(uploadsDir, post);
    media.register(post.file, { uploadedBy: 'Test', alt: post.alt });
    const result = store.createPost(
      {
        title: post.title,
        slug: post.slug,
        status: 'published',
        authorName: 'Test',
        blocks: [
          { type: 'image', url, alt: post.alt },
          { type: 'text', text: post.text },
        ],
      },
      { name: 'Test' },
    );
    if (!result?.ok) return { seeded: false, count, error: result?.error || 'create-failed' };
    count += 1;
  }
  return { seeded: true, count };
}
