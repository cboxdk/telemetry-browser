import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { init, parseServerTiming, serverTimingAttributes } from '../src/index';
import { sanitizeServerTimingName } from '../src/serverTiming';

const HEADER = 'db;dur=12.3;desc="3 queries", cache;dur=1.2;desc="4 cache ops", redis;dur=0.8;desc="2 commands", telemetry;dur=0.4, app;dur=48.1';

const only = (keep: string) => ({
  documentLoad: keep === 'documentLoad',
  webVitals: false,
  fetch: keep === 'fetch',
  xhr: keep === 'xhr',
  errors: false,
  navigation: false,
});

describe('parseServerTiming', () => {
  it('parses the laravel-telemetry header', () => {
    expect(parseServerTiming(HEADER)).toEqual([
      { name: 'db', duration: 12.3, description: '3 queries' },
      { name: 'cache', duration: 1.2, description: '4 cache ops' },
      { name: 'redis', duration: 0.8, description: '2 commands' },
      { name: 'telemetry', duration: 0.4, description: '' },
      { name: 'app', duration: 48.1, description: '' },
    ]);
  });

  it('honours quotes, bare tokens, case and first-param-wins', () => {
    expect(parseServerTiming('miss, a;DUR=2;dur=9;desc="x, y; \\"z\\"", b;desc=plain;dur=bad')).toEqual([
      { name: 'miss', duration: 0, description: '' },
      { name: 'a', duration: 2, description: 'x, y; "z"' },
      { name: 'b', duration: 0, description: 'plain' },
    ]);
  });

  it('is lenient on empty and malformed input', () => {
    expect(parseServerTiming(null)).toEqual([]);
    expect(parseServerTiming('')).toEqual([]);
    expect(parseServerTiming(' , ;dur=1, ok')).toEqual([{ name: 'ok', duration: 0, description: '' }]);
  });

  it('rejects trailing junk and negative durations, and skips oversized headers', () => {
    expect(parseServerTiming('a;dur=12abc, b;dur=-5, c;dur=.5, d;dur="7"')).toEqual([
      { name: 'a', duration: 0, description: '' },
      { name: 'b', duration: 0, description: '' },
      { name: 'c', duration: 0.5, description: '' },
      { name: 'd', duration: 7, description: '' },
    ]);
    expect(parseServerTiming(`app;dur=1, ${'x'.repeat(5000)}`)).toEqual([]);
  });
});

describe('serverTimingAttributes', () => {
  it('maps metrics to server_timing.<name>.* attributes', () => {
    expect(serverTimingAttributes(parseServerTiming(HEADER))).toEqual({
      'server_timing.db.duration_ms': 12.3,
      'server_timing.db.description': '3 queries',
      'server_timing.cache.duration_ms': 1.2,
      'server_timing.cache.description': '4 cache ops',
      'server_timing.redis.duration_ms': 0.8,
      'server_timing.redis.description': '2 commands',
      'server_timing.telemetry.duration_ms': 0.4,
      'server_timing.app.duration_ms': 48.1,
    });
  });

  it('sanitizes names into [a-z][a-z0-9_]*', () => {
    expect(sanitizeServerTimingName('DB-Read.Primary')).toBe('db_read_primary');
    expect(sanitizeServerTimingName('9cache')).toBe('cache');
    expect(sanitizeServerTimingName('__')).toBe('');
    expect(sanitizeServerTimingName('x'.repeat(200))).toHaveLength(64);
    for (const key of Object.keys(serverTimingAttributes([{ name: 'Weird Name!', duration: 1, description: '' }]))) {
      expect(key).toMatch(/^[a-z][a-z0-9._]*$/);
    }
  });

  it('caps at 10 metrics, keeps the first of a repeated name, drops unusable names', () => {
    const entries = Array.from({ length: 15 }, (_, i) => ({ name: `m${i}`, duration: i, description: '' }));
    entries.unshift({ name: '!!!', duration: 1, description: '' }, { name: 'm0', duration: 99, description: '' });
    const attrs = serverTimingAttributes(entries);
    expect(Object.keys(attrs)).toHaveLength(10);
    expect(attrs['server_timing.m0.duration_ms']).toBe(99);
    expect(attrs['server_timing.m10.duration_ms']).toBeUndefined();
  });
});

describe('Server-Timing on spans', () => {
  let beacon: ReturnType<typeof vi.fn>;
  const spans = () => beacon.mock.calls.flatMap((c) => JSON.parse(c[1] as string).spans ?? []);

  beforeEach(() => {
    beacon = vi.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
  });

  afterEach(() => vi.restoreAllMocks());

  it('reads the fetch response header', async () => {
    window.fetch = vi.fn(() =>
      Promise.resolve(new Response('', { status: 200, headers: { 'Server-Timing': HEADER } })),
    ) as unknown as typeof fetch;
    const t = init({ endpoint: '/x', instrument: only('fetch') })!;

    await window.fetch('/api/orders');
    t.flush();

    const s = spans().find((x) => x.name === 'fetch GET');
    expect(s.attributes['server_timing.db.duration_ms']).toBe(12.3);
    expect(s.attributes['server_timing.db.description']).toBe('3 queries');
    expect(s.attributes['server_timing.app.duration_ms']).toBe(48.1);
  });

  it('can be switched off', async () => {
    window.fetch = vi.fn(() =>
      Promise.resolve(new Response('', { status: 200, headers: { 'Server-Timing': HEADER } })),
    ) as unknown as typeof fetch;
    const t = init({ endpoint: '/x', instrument: { ...only('fetch'), serverTiming: false } })!;

    await window.fetch('/api/orders');
    t.flush();

    const s = spans().find((x) => x.name === 'fetch GET');
    expect(Object.keys(s.attributes).some((k) => k.startsWith('server_timing.'))).toBe(false);
  });

  it('reads the XHR response header, and only exposed headers cross-origin', () => {
    class FakeXhr extends EventTarget {
      status = 0;
      headers: Record<string, string> = {};
      open() {}
      setRequestHeader() {}
      send() {
        this.status = 200;
        this.dispatchEvent(new Event('loadend'));
      }
      getResponseHeader(name: string) {
        return this.headers[name.toLowerCase()] ?? null;
      }
      getAllResponseHeaders() {
        return Object.entries(this.headers)
          .map(([k, v]) => `${k}: ${v}\r\n`)
          .join('');
      }
    }
    const getResponseHeader = vi.spyOn(FakeXhr.prototype, 'getResponseHeader');
    const original = window.XMLHttpRequest;
    window.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
    try {
      const t = init({ endpoint: '/x', instrument: only('xhr') })!;

      const same = new window.XMLHttpRequest() as unknown as FakeXhr;
      same.headers = { 'server-timing': 'db;dur=5;desc="1 query"' };
      (same as unknown as XMLHttpRequest).open('GET', '/api/a');
      (same as unknown as XMLHttpRequest).send();

      const cross = new window.XMLHttpRequest() as unknown as FakeXhr;
      cross.headers = { 'content-type': 'text/plain', 'server-timing': 'app;dur=7' };
      (cross as unknown as XMLHttpRequest).open('GET', 'https://api.example.com/b');
      (cross as unknown as XMLHttpRequest).send();
      t.flush();

      const [a, b] = spans().filter((x) => x.name === 'xhr GET');
      expect(a.attributes['server_timing.db.duration_ms']).toBe(5);
      expect(a.attributes['server_timing.db.description']).toBe('1 query');
      expect(b.attributes['server_timing.app.duration_ms']).toBe(7);
      // Cross-origin reads go through getAllResponseHeaders (no console warning).
      expect(getResponseHeader).toHaveBeenCalledTimes(1);
    } finally {
      window.XMLHttpRequest = original;
    }
  });

  it('reads the navigation entry onto the page-load span', async () => {
    vi.spyOn(performance, 'getEntriesByType').mockImplementation(((type: string) =>
      type === 'navigation'
        ? [
            {
              startTime: 0,
              responseStart: 50,
              domInteractive: 100,
              domComplete: 200,
              loadEventEnd: 210,
              transferSize: 1000,
              type: 'navigate',
              serverTiming: [
                { name: 'db', duration: 12.3, description: '3 queries' },
                { name: 'app', duration: 48.1, description: '' },
              ],
            },
          ]
        : []) as unknown as typeof performance.getEntriesByType);
    const t = init({ endpoint: '/x', instrument: only('documentLoad') })!;

    await new Promise((r) => setTimeout(r, 0));
    t.flush();

    const s = spans().find((x) => x.name === 'browser.page_load');
    expect(s.attributes['server_timing.db.duration_ms']).toBe(12.3);
    expect(s.attributes['server_timing.db.description']).toBe('3 queries');
    expect(s.attributes['server_timing.app.duration_ms']).toBe(48.1);
    expect(s.attributes['server_timing.app.description']).toBeUndefined();
  });
  it('never throws from the page-load timer when navigation timing is unusable', async () => {
    vi.spyOn(performance, 'getEntriesByType').mockImplementation(() => {
      throw new Error('no navigation timing');
    });
    const t = init({ endpoint: '/x', instrument: only('documentLoad') })!;

    // An uncaught throw from the timer would fail this test as an unhandled error.
    await new Promise((r) => setTimeout(r, 0));
    t.flush();

    expect(spans().find((x) => x.name === 'browser.page_load')).toBeUndefined();
  });
});
