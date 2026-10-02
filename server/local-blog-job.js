import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import {
  MONTHLY_QUOTA,
  SIX_HOURS_MS,
  acceptDraft,
  buildLocalBlogPrompt,
  emptyLedger,
  extractJsonObject,
  isPostDue,
  localBlogEnabled,
  monthKey,
  parseDraft,
  postsForMonth,
  topicKey,
} from './local-blog.js';

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const started = new Set();

function ledgerPath(dataPath) {
  return join(dataPath, 'cms', 'local-blog.json');
}

export function readLedger(dataPath, now = new Date()) {
  const file = ledgerPath(dataPath);
  if (!existsSync(file)) return emptyLedger(now);
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    if (!raw || raw.month !== monthKey(now)) return emptyLedger(now);
    return {
      month: raw.month,
      posts: Array.isArray(raw.posts) ? raw.posts : [],
      lastSkip: raw.lastSkip || null,
    };
  } catch {
    return emptyLedger(now);
  }
}

export function writeLedger(dataPath, ledger) {
  const file = ledgerPath(dataPath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
}

function skip(dataPath, ledger, reason) {
  const next = { ...ledger, lastSkip: { at: new Date().toISOString(), reason } };
  writeLedger(dataPath, next);
  return { ok: false, skipped: reason };
}

async function fetchBrief({ hubUrl, siteKey, token, fetchImpl }) {
  const base = String(hubUrl || '').replace(/\/$/, '');
  const response = await fetchImpl(`${base}/api/hub/local-blog-brief`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Site-Key': siteKey,
    },
  });
  if (!response.ok) {
    const error = new Error(`Hub brief ${response.status}`);
    error.code = response.status === 401 ? 'unauthorized' : 'hub';
    throw error;
  }
  return response.json();
}

async function writeWithDeepSeek({ env, brief, usedTopics, fetchImpl }) {
  const apiKey = String(env.DEEPSEEK_API_KEY || '').trim();
  const model = String(env.DEEPSEEK_MODEL || '').trim() || 'deepseek-chat';
  const prompt = buildLocalBlogPrompt(brief, usedTopics);
  const response = await fetchImpl(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      max_tokens: 2500,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    }),
  });
  if (!response.ok) {
    const error = new Error(`DeepSeek ${response.status}`);
    error.code = 'deepseek';
    throw error;
  }
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content || '';
  return parseDraft(extractJsonObject(content) || content);
}

export async function runLocalBlogOnce({
  store,
  dataPath,
  hubUrl,
  siteKey,
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
} = {}) {
  if (!localBlogEnabled(env)) return { ok: false, skipped: 'disabled' };
  const token = String(env.LOCAL_BLOG_TOKEN || '').trim();
  if (!token || !hubUrl || !siteKey || !String(env.DEEPSEEK_API_KEY || '').trim()) {
    return { ok: false, skipped: 'not-configured' };
  }
  if (!store || !dataPath) return { ok: false, skipped: 'no-store' };
  const ledger = readLedger(dataPath, now);
  if (!isPostDue(ledger, now, MONTHLY_QUOTA)) return { ok: true, skipped: 'not-due' };
  let brief;
  try {
    brief = await fetchBrief({ hubUrl, siteKey, token, fetchImpl });
  } catch (error) {
    return skip(dataPath, ledger, error.code || 'hub');
  }
  if (!brief?.blogEnabled) return skip(dataPath, ledger, 'blog-disabled');
  if (!brief.hasSubject) return skip(dataPath, ledger, 'no-subject');
  const usedTopics = postsForMonth(ledger, now).map((row) => topicKey(row.topic)).filter(Boolean);
  let draft;
  try {
    draft = await writeWithDeepSeek({ env, brief, usedTopics, fetchImpl });
  } catch (error) {
    return skip(dataPath, ledger, error.code || 'deepseek');
  }
  const accepted = acceptDraft(draft, { brief, usedTopics });
  if (!accepted.ok) return skip(dataPath, ledger, accepted.reason);
  const created = store.createPost(accepted.post, { name: brief.businessName || '' });
  if (!created?.ok) return skip(dataPath, ledger, 'create-post');
  const next = {
    month: monthKey(now),
    posts: [
      ...postsForMonth(ledger, now),
      { topic: accepted.topic, slug: created.post.slug, createdAt: new Date().toISOString() },
    ],
    lastSkip: null,
  };
  writeLedger(dataPath, next);
  return { ok: true, slug: created.post.slug, topic: accepted.topic };
}

export function startLocalBlogScheduler(options = {}) {
  if (!localBlogEnabled(options.env || process.env)) return { started: false };
  const key = String(options.siteKey || '');
  if (!key || started.has(key)) return { started: false };
  started.add(key);
  let inFlight = false;
  const tick = () => {
    if (inFlight) return;
    inFlight = true;
    runLocalBlogOnce(options).finally(() => {
      inFlight = false;
    }).then((result) => {
      if (result?.skipped && result.skipped !== 'not-due') {
        console.log(`[local-blog] ${key} skipped: ${result.skipped}`);
      } else if (result?.ok && result.slug) {
        console.log(`[local-blog] ${key} published ${result.slug}`);
      }
    }).catch((error) => {
      console.error(`[local-blog] ${key}`, error?.message || error);
    });
  };
  const boot = setTimeout(tick, 20_000);
  const timer = setInterval(tick, SIX_HOURS_MS);
  if (typeof boot.unref === 'function') boot.unref();
  if (typeof timer.unref === 'function') timer.unref();
  return { started: true };
}
