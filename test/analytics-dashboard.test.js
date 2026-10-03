import test from 'node:test';
import assert from 'node:assert/strict';
import { injectAnalyticsTracker, summarizeTrafficEvents, analyticsTrackerScript } from '../server/analytics-tracker.js';
import { summarizeCta, summarizeEcommerceFunnel } from '../server/analytics-insights.js';

test('tracker injects once before body close', () => {
  const html = injectAnalyticsTracker('<html><body><h1>Hi</h1></body></html>');
  assert.match(html, /\/api\/cms\/analytics\/collect\.js/);
  const again = injectAnalyticsTracker(html);
  assert.equal(again.split('collect.js').length, 2);
});

test('pageviews from two sessions compute bounce', () => {
  const stats = summarizeTrafficEvents([
    { type: 'pageview', visitorId: 'a', sessionId: '1', path: '/', at: '2026-09-01T12:00:00.000Z' },
    { type: 'pageview', visitorId: 'b', sessionId: '2', path: '/', at: '2026-09-01T12:00:00.000Z' },
    { type: 'ping', visitorId: 'b', sessionId: '2', path: '/', at: '2026-09-01T12:00:20.000Z' },
  ]);
  assert.equal(stats.visits, 2);
  assert.equal(stats.bounceRate, 50);
});

test('tracker script records CTA clicks when a destination is set', () => {
  const script = analyticsTrackerScript({ ctaPath: '/bestill' });
  assert.match(script, /ev\('cta'/);
  assert.match(script, /\/bestill/);
  assert.match(script, /add_to_cart/);
});

test('CTA clicks use href not the page the click started on', () => {
  const stats = summarizeCta([
    { type: 'cta', sessionId: '1', visitorId: 'a', path: '/', href: '/bestill', at: '2026-09-01T12:00:00.000Z' },
    { type: 'pageview', sessionId: '1', visitorId: 'a', path: '/bestill', at: '2026-09-01T12:00:01.000Z' },
  ], '/bestill', { from: new Date('2026-09-01'), to: new Date('2026-09-02'), visits: 4 });
  assert.equal(stats.clicks, 1);
  assert.equal(stats.pageviews, 1);
});

test('funnel dropoff is computed between cart and checkout', () => {
  const funnel = summarizeEcommerceFunnel([
    { type: 'pageview', sessionId: '1', path: '/cart', at: '2026-09-01T12:00:00.000Z' },
    { type: 'pageview', sessionId: '2', path: '/cart', at: '2026-09-01T12:01:00.000Z' },
    { type: 'pageview', sessionId: '2', path: '/checkout', at: '2026-09-01T12:01:10.000Z' },
  ], [], { from: new Date('2026-09-01'), to: new Date('2026-09-02') });
  assert.equal(funnel.counts.cart, 2);
  assert.equal(funnel.counts.checkout, 1);
  assert.equal(funnel.abandonment.cart, 50);
});
