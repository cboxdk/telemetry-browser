import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { init, ATTR, SPAN } from '../src/index';
import type { Telemetry, WireSpan } from '../src/index';

// One SDK per file: its document listeners outlive a test.

const PAGE_TRACE = '0af7651916cd43dd8448eb211c80319c';
const PAGE_SPAN = 'b7ad6b7169203331';
const OTHER_TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const OTHER_SPAN = '00f067aa0ba902b7';

/** A minimal XHR — Inertia (v1 and v2) sends its visits through axios' XHR adapter. */
let nextResponseHeaders: Record<string, string> = {};
const xhrRequests: Array<{ url: string; headers: Record<string, string> }> = [];
class FakeXhr extends EventTarget {
  status = 0;
  private url = '';
  private headers: Record<string, string> = {};
  private responseHeaders: Record<string, string> = {};
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
  }
  getResponseHeader(name: string): string | null {
    return this.responseHeaders[name.toLowerCase()] ?? null;
  }
  send() {
    xhrRequests.push({ url: this.url, headers: this.headers });
    this.responseHeaders = nextResponseHeaders;
    this.status = 200;
    this.dispatchEvent(new Event('loadend'));
  }
}

let beacon: ReturnType<typeof vi.fn>;
let t: Telemetry;

const fire = (name: string, detail?: unknown) => document.dispatchEvent(new CustomEvent(name, { detail }));

const sent = async (): Promise<WireSpan[]> => {
  await Promise.resolve(); // let the generic history handler's microtask run
  t.flush();
  return beacon.mock.calls.flatMap((c) => JSON.parse(c[1] as string).spans ?? []);
};

const xhr = (url: string) => {
  const r = new XMLHttpRequest();
  r.open('GET', url);
  r.send();
};

const visitTo = (path: string, extra: Record<string, unknown> = {}) => ({
  url: new URL(path, location.origin),
  method: 'get',
  prefetch: false,
  async: false,
  only: [],
  except: [],
  completed: false,
  cancelled: false,
  interrupted: false,
  ...extra,
});

/**
 * What Inertia's router does for a visit, in order. v2/v3 finish with the
 * same visit object; v1 finishes with a COPY (`activeVisit = {...visit}`).
 */
function inertiaVisit(
  path: string,
  headers: Record<string, string>,
  extra: Record<string, unknown> = {},
  { v1 = false, failWith }: { v1?: boolean; failWith?: string } = {},
) {
  const visit = visitTo(path, extra);
  fire('inertia:before', { visit });
  fire('inertia:start', { visit });
  const active = v1 ? { ...visit } : visit;
  nextResponseHeaders = { 'x-inertia': 'true', ...headers };
  xhr(visit.url.href);
  if (failWith) {
    fire(`inertia:${failWith}`, {});
  } else {
    window.history.pushState({}, '', path);
    fire('inertia:navigate', { page: { url: path } });
    fire('inertia:success', { page: { url: path } });
  }
  active.completed = true;
  fire('inertia:finish', { visit: active });
  return visit;
}

describe('Inertia router visits', () => {
  beforeAll(() => {
    beacon = vi.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    (window as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXhr;
    window.history.replaceState({}, '', '/dashboard');

    t = init({
      endpoint: '/telemetry/spans',
      traceparent: `00-${PAGE_TRACE}-${PAGE_SPAN}-01`,
      instrument: { documentLoad: false, webVitals: false, fetch: false, errors: false },
    })!;

    // Inertia fires navigate for the initial page — ownership, no span.
    fire('inertia:navigate', { page: { url: '/dashboard' } });
  });

  beforeEach(() => {
    t.flush();
    beacon.mockClear();
    xhrRequests.length = 0;
    nextResponseHeaders = {};
  });

  it('records a visit as one navigation span and parents later requests to it', async () => {
    inertiaVisit('/users', { 'x-trace-id': PAGE_TRACE });
    xhr('/api/users');

    const spans = await sent();
    const nav = spans.filter((s) => s.name === SPAN.NAVIGATION);
    expect(nav).toHaveLength(1);
    expect(spans.some((s) => s.name === SPAN.ROUTE_CHANGE)).toBe(false);

    const n = nav[0]!;
    expect(n.traceId).toBe(PAGE_TRACE);
    expect(n.parentSpanId).toBe(PAGE_SPAN);
    expect(n.attributes[ATTR.NAVIGATION_FRAMEWORK]).toBe('inertia');
    expect(n.attributes[ATTR.HTTP_METHOD]).toBe('GET');
    expect(n.attributes[ATTR.ROUTE_FROM]).toBe('/dashboard');
    expect(n.attributes[ATTR.URL_PATH]).toBe('/users');
    // The server continued this trace (X-Trace-Id matches), so the next
    // requests hang off the navigation — "via navigation".
    expect(n.attributes[ATTR.NAVIGATION_TRACE_SOURCE]).toBe('navigation');

    const pageXhr = spans.find((s) => String(s.attributes[ATTR.HTTP_URL]).endsWith('/users'))!;
    expect(pageXhr.parentSpanId).toBe(n.spanId);
    expect(xhrRequests[0]!.headers.traceparent).toBe(`00-${PAGE_TRACE}-${pageXhr.spanId}-01`);

    const later = spans.find((s) => s.attributes[ATTR.HTTP_URL] === '/api/users')!;
    expect(later.traceId).toBe(PAGE_TRACE);
    expect(later.parentSpanId).toBe(n.spanId);
  });

  it('adopts a traceresponse header (trace AND span id) from the page response', async () => {
    inertiaVisit('/teams', { traceresponse: `00-${OTHER_TRACE}-${OTHER_SPAN}-01` });
    xhr('/api/teams');

    const spans = await sent();
    const n = spans.find((s) => s.name === SPAN.NAVIGATION)!;
    expect(n.attributes[ATTR.NAVIGATION_TRACE_SOURCE]).toBe('traceresponse');
    const later = spans.find((s) => s.attributes[ATTR.HTTP_URL] === '/api/teams')!;
    expect(later.traceId).toBe(OTHER_TRACE);
    expect(later.parentSpanId).toBe(OTHER_SPAN);
    expect(xhrRequests[1]!.headers.traceparent).toBe(`00-${OTHER_TRACE}-${later.spanId}-01`);
  });

  it('keeps the trace and records the pointer when the server started a different trace', async () => {
    const before = t.traceId();
    const foreign = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    inertiaVisit('/billing', { 'x-trace-id': foreign });
    xhr('/api/billing');

    const spans = await sent();
    const n = spans.find((s) => s.name === SPAN.NAVIGATION)!;
    expect(n.attributes[ATTR.NAVIGATION_TRACE_SOURCE]).toBe('none');
    expect(n.attributes[ATTR.NAVIGATION_SERVER_TRACE_ID]).toBe(foreign);
    expect(t.traceId()).toBe(before);
    expect(spans.find((s) => s.attributes[ATTR.HTTP_URL] === '/api/billing')!.traceId).toBe(before);
  });

  it('ignores prefetches, async visits and partial reloads of the current page', async () => {
    for (const extra of [{ prefetch: true }, { async: true }]) {
      const visit = visitTo('/elsewhere', extra);
      fire('inertia:start', { visit });
      visit.completed = true;
      fire('inertia:finish', { visit });
    }
    const reload = visitTo(location.pathname, { only: ['stats'] });
    fire('inertia:start', { visit: reload });
    reload.completed = true;
    fire('inertia:finish', { visit: reload });

    expect((await sent()).some((s) => s.name === SPAN.NAVIGATION)).toBe(false);
  });

  it('records cancelled and interrupted visits without moving the trace', async () => {
    const before = t.traceId();
    const first = visitTo('/slow');
    fire('inertia:start', { visit: first });
    // v2 interrupts without a finish event — the next start closes it.
    const second = visitTo('/fast');
    fire('inertia:start', { visit: second });
    second.cancelled = true;
    fire('inertia:finish', { visit: second });

    const outcomes = (await sent())
      .filter((s) => s.name === SPAN.NAVIGATION)
      .map((s) => [s.attributes[ATTR.NAVIGATION_OUTCOME], s.attributes[ATTR.NAVIGATION_TRACE_SOURCE]]);
    expect(outcomes).toEqual([
      ['interrupted', 'none'],
      ['cancelled', 'none'],
    ]);
    expect(t.traceId()).toBe(before);
  });

  it('marks a visit that threw as an error and does not follow it', async () => {
    const visit = visitTo('/broken');
    fire('inertia:start', { visit });
    fire('inertia:exception', { exception: new Error('500') });
    visit.completed = true;
    fire('inertia:finish', { visit });

    const n = (await sent()).find((s) => s.name === SPAN.NAVIGATION)!;
    expect(n.status).toBe('error');
    expect(n.attributes[ATTR.NAVIGATION_TRACE_SOURCE]).toBe('none');
  });

  it('records back/forward (navigate without a visit) as a history navigation', async () => {
    const from = location.pathname;
    window.history.pushState({}, '', '/previous'); // stands in for the browser's own URL change
    window.dispatchEvent(new PopStateEvent('popstate'));
    fire('inertia:navigate', { page: { url: '/previous' } });

    const spans = await sent();
    const nav = spans.filter((s) => s.name === SPAN.NAVIGATION);
    expect(nav).toHaveLength(1);
    expect(nav[0]!.attributes[ATTR.NAVIGATION_HISTORY]).toBe(true);
    expect(nav[0]!.attributes[ATTR.ROUTE_FROM]).toBe(from);
    expect(nav[0]!.attributes[ATTR.NAVIGATION_TRACE_SOURCE]).toBe('none');
    expect(spans.some((s) => s.name === SPAN.ROUTE_CHANGE)).toBe(false);
  });

  it('closes a v1 visit, whose finish event carries a copy of the visit', async () => {
    inertiaVisit('/v1-page', { 'x-trace-id': PAGE_TRACE }, {}, { v1: true });

    const nav = (await sent()).filter((s) => s.name === SPAN.NAVIGATION);
    expect(nav).toHaveLength(1);
    expect(nav[0]!.attributes[ATTR.NAVIGATION_OUTCOME]).toBe('completed');
    expect(nav[0]!.attributes[ATTR.URL_PATH]).toBe('/v1-page');
  });

  it.each(['httpException', 'networkError'])('marks a v3 %s visit as failed and does not follow it', async (event) => {
    const before = t.traceId();
    inertiaVisit('/v3-broken', { traceresponse: `00-${OTHER_TRACE}-${OTHER_SPAN}-01` }, {}, { failWith: event });

    const n = (await sent()).find((s) => s.name === SPAN.NAVIGATION)!;
    expect(n.status).toBe('error');
    expect(n.attributes[ATTR.NAVIGATION_TRACE_SOURCE]).toBe('none');
    expect(t.traceId()).toBe(before);
  });

  it('does not adopt an unsampled traceresponse span; falls back to the navigation span', async () => {
    const before = t.traceId();
    inertiaVisit('/unsampled', { traceresponse: `00-${OTHER_TRACE}-${OTHER_SPAN}-00` });
    xhr('/api/after');

    const spans = await sent();
    const n = spans.find((s) => s.name === SPAN.NAVIGATION)!;
    expect(n.attributes[ATTR.NAVIGATION_TRACE_SOURCE]).toBe('navigation');
    const later = spans.find((s) => s.attributes[ATTR.HTTP_URL] === '/api/after')!;
    expect(later.traceId).toBe(before);
    expect(later.parentSpanId).toBe(n.spanId);
  });

  it('labels a prefetch-cache click (navigate, no popstate) as cached, not history', async () => {
    window.history.pushState({}, '', '/prefetched'); // Inertia's own pushState
    fire('inertia:navigate', { page: { url: '/prefetched' } }); // v2: no cached flag
    window.history.pushState({}, '', '/prefetched-v3');
    fire('inertia:navigate', { page: { url: '/prefetched-v3' }, cached: true }); // v3

    const nav = (await sent()).filter((s) => s.name === SPAN.NAVIGATION);
    expect(nav.map((s) => [s.attributes[ATTR.NAVIGATION_HISTORY], s.attributes[ATTR.NAVIGATION_CACHED]])).toEqual([
      [false, true],
      [false, true],
    ]);
  });

  it('treats router.reload() and v3 reset as data refreshes, not navigations', async () => {
    for (const extra of [{}, { reset: ['items'] }]) {
      const visit = visitTo(location.pathname + location.search, extra);
      fire('inertia:start', { visit });
      visit.completed = true;
      fire('inertia:finish', { visit });
    }
    expect((await sent()).some((s) => s.name === SPAN.NAVIGATION)).toBe(false);
  });

  it('clears the navigation timeout once the visit finishes', async () => {
    // Watch THE navigation timer (30 s), not a global timer count — other
    // timers may exist depending on the environment.
    const set = vi.spyOn(globalThis, 'setTimeout');
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    try {
      inertiaVisit('/timers', {});
      const index = set.mock.calls.findIndex((c) => c[1] === 30_000);
      expect(index).toBeGreaterThanOrEqual(0);
      const handle = set.mock.results[index]!.value;
      expect(clear).toHaveBeenCalledWith(handle);
    } finally {
      set.mockRestore();
      clear.mockRestore();
    }
  });
});

