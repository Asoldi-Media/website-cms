import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

function dayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function createAnalyticsEventStore(dataPath) {
  const dir = join(dataPath, 'cms', 'analytics-events');

  function ensure() {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  function fileFor(day) {
    ensure();
    return join(dir, `${day}.jsonl`);
  }

  function append(events = []) {
    const rows = Array.isArray(events) ? events : [events];
    const groups = new Map();
    for (const event of rows) {
      if (!event || typeof event !== 'object') continue;
      const at = Date.parse(event.at || event.timestamp || '') || Date.now();
      const day = dayKey(at);
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day).push({
        type: String(event.type || 'pageview'),
        visitorId: String(event.visitorId || '').slice(0, 80),
        sessionId: String(event.sessionId || '').slice(0, 80),
        path: String(event.path || '/').slice(0, 300),
        href: String(event.href || '').slice(0, 300),
        referrer: String(event.referrer || '').slice(0, 500),
        ua: String(event.ua || '').slice(0, 300),
        host: String(event.host || '').slice(0, 200),
        ms: Number(event.ms) || 0,
        at: new Date(at).toISOString(),
      });
    }
    let accepted = 0;
    for (const [day, list] of groups) {
      appendFileSync(fileFor(day), `${list.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
      accepted += list.length;
    }
    return accepted;
  }

  function read(fromMs, toMs) {
    ensure();
    const fromDay = dayKey(fromMs);
    const toDay = dayKey(toMs);
    const files = readdirSync(dir).filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)).sort();
    const out = [];
    for (const name of files) {
      const day = name.slice(0, 10);
      if (day < fromDay || day > toDay) continue;
      const text = readFileSync(join(dir, name), 'utf8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line);
          const at = Date.parse(row.at || '');
          if (!Number.isFinite(at) || at < fromMs || at > toMs) continue;
          out.push(row);
        } catch {
          // skip
        }
      }
    }
    return out;
  }

  return { append, read };
}
