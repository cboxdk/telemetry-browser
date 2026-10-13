import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { init, ATTR, SPAN } from '../src/index';
import type { Telemetry, WireSpan } from '../src/index';
import type { WireEvent } from '../src/types';

// One SDK per file: its document listeners outlive a test, so a second
// init() would answer the same events twice.

const PAGE_TRACE = '0af7651916cd43dd8448eb211c80319c';
const PAGE_SPAN = 'b7ad6b7169203331';
const NEXT_TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const NEXT_SPAN = '00f067aa0ba902b7';

let beacon: ReturnType<typeof vi.fn>;
let underlying: ReturnType<typeof vi.fn>;
let t: Telemetry;

const setMeta = (content: string | null) => {
  document.head.querySelector('meta[name=traceparent]')?.remove();
  if (content === null) return;
  const meta = document.createElement('meta');
  meta.name = 'traceparent';
  meta.content = content;
  document.head.appendChild(meta);
};

const fire = (name: string, detail?: unknown, cancelable = false) => {
  const e = new CustomEvent(name, { detail, bubbles: true, cancelable });
  document.dispatchEvent(e);
  return e;
};

const sent = (): { spans: WireSpan[]; events: WireEvent[] } => {
  t.flush();
  const spans: WireSpan[] = [];
  const events: WireEvent[] = [];
  for (const call of beacon.mock.calls) {
    const payload = JSON.parse(call[1] as string);
    spans.push(...(payload.spans ?? []));
    events.push(...(payload.events ?? []));
  }
  return { spans, events };
};

const headerOf = (call: number): string | null =>
  new Headers((underlying.mock.calls[call]![1] as RequestInit | undefined)?.headers).get('traceparent');

/** What Livewire's navigateTo() does, in order. */
async function wireNavigate(to: string, { meta, cached = false, history = false }: { meta?: string | null; cached?: boolean; history?: boolean } = {}) {
  fire('livewire:navigate', { url: new URL(to, location.origin), history, cached }, true);
  if (!cached) await window.fetch(to, { headers: { 'X-Livewire-Navigate': '1' } });
  fire('livewire:navigating', { onSwap: () => {} });
  history ? window.history.replaceState({}, '', to) : window.history.pushState({}, '', to);
  if (meta !== undefined) setMeta(meta); // the head swap brings the new page's meta
  await Promise.resolve();
  fire('livewire:navigated');
}

describe('Livewire wire:navigate', () => {
  beforeAll(() => {
    beacon = vi.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    underlying = vi.fn(() => Promise.resolve(new Response('<html></html>', { status: 200 })));
    window.fetch = underlying as unknown as typeof fetch;
    window.history.replaceState({}, '', '/start');
    setMeta(`00-${PAGE_TRACE}-${PAGE_SPAN}-01`);

    t = init({
      endpoint: '/telemetry/spans',
      traceparent: `00-${PAGE_TRACE}-${PAGE_SPAN}-01`,
      analytics: true,
      instrument: { documentLoad: false, webVitals: false, xhr: false, errors: false },
    })!;

    // Livewire fires navigated once on the initial load — no navigation.
    fire('livewire:navigated');
  });

  beforeEach(() => {
    t.flush();
    beacon.mockClear();
    underlying.mockClear();
  });

  it('records one navigation span and adopts the new page meta for later requests', async () => {
    await wireNavigate('/orders', { meta: `00-${NEXT_TRACE}-${NEXT_SPAN}-01` });
    await window.fetch('/api/orders');

    const { spans, events } = sent();
    const nav = spans.filter((s) => s.name === SPAN.NAVIGATION);
    expect(nav).toHaveLength(1);
    expect(spans.some((s) => s.name === SPAN.ROUTE_CHANGE)).toBe(false); // no double count

    const n = nav[0]!;
    expect(n.traceId).toBe(PAGE_TRACE);
    expect(n.parentSpanId).toBe(PAGE_SPAN);
    expect(n.attributes[ATTR.NAVIGATION_FRAMEWORK]).toBe('livewire');
    expect(n.attributes[ATTR.NAVIGATION_OUTCOME]).toBe('completed');
    expect(n.attributes[ATTR.NAVIGATION_TRACE_SOURCE]).toBe('meta');
    expect(n.attributes[ATTR.ROUTE_FROM]).toBe('/start');
    expect(n.attributes[ATTR.URL_PATH]).toBe('/orders');
    expect(typeof n.attributes[ATTR.NAVIGATION_FETCH_MS]).toBe('number');

    // The page fetch is a child of the navigation, still in the old trace…
    const pageFetch = spans.find((s) => s.attributes[ATTR.HTTP_URL] === '/orders')!;
    expect(pageFetch.traceId).toBe(PAGE_TRACE);
    expect(pageFetch.parentSpanId).toBe(n.spanId);
    expect(headerOf(0)).toBe(`00-${PAGE_TRACE}-${pageFetch.spanId}-01`);

    // …and the request made on the NEW page joins the new server trace.
    const later = spans.find((s) => s.attributes[ATTR.HTTP_URL] === '/api/orders')!;
    expect(later.traceId).toBe(NEXT_TRACE);
    expect(later.parentSpanId).toBe(NEXT_SPAN);
    expect(headerOf(1)).toBe(`00-${NEXT_TRACE}-${later.spanId}-01`);
    expect(t.traceId()).toBe(NEXT_TRACE);

    // Exactly one analytics page view for the soft navigation.
    const views = events.filter((e) => e.name === 'page_view');
    expect(views).toHaveLength(1);
    expect(views[0]!.attributes[ATTR.ROUTE_FROM]).toBe('/start');
    expect(views[0]!.attributes[ATTR.URL_PATH]).toBe('/orders');
  });

  it('does not move the trace on a cached back/forward restore', async () => {
    const before = t.traceId();
    // The cached snapshot carries an OLD page's meta — it must not be adopted.
    await wireNavigate('/start', { cached: true, history: true, meta: `00-${PAGE_TRACE}-${PAGE_SPAN}-01` });
    await window.fetch('/api/x');

    const { spans } = sent();
    const n = spans.find((s) => s.name === SPAN.NAVIGATION)!;
    expect(n.attributes[ATTR.NAVIGATION_CACHED]).toBe(true);
    expect(n.attributes[ATTR.NAVIGATION_HISTORY]).toBe(true);
    expect(n.attributes[ATTR.NAVIGATION_TRACE_SOURCE]).toBe('none');
    expect(t.traceId()).toBe(before);
    expect(spans.find((s) => s.attributes[ATTR.HTTP_URL] === '/api/x')!.traceId).toBe(before);
  });

  it('parents later requests to the navigation span when the new page has no meta', async () => {
    const before = t.traceId();
    await wireNavigate('/no-meta', { meta: null });
    await window.fetch('/api/y');

    const { spans } = sent();
    const n = spans.find((s) => s.name === SPAN.NAVIGATION)!;
    expect(n.attributes[ATTR.NAVIGATION_TRACE_SOURCE]).toBe('navigation');
    const later = spans.find((s) => s.attributes[ATTR.HTTP_URL] === '/api/y')!;
    expect(later.traceId).toBe(before);
    expect(later.parentSpanId).toBe(n.spanId);
  });

  it('drops a navigation another listener prevented', async () => {
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener('livewire:navigate', stop);
    fire('livewire:navigate', { url: new URL('/nope', location.origin), history: false, cached: false }, true);
    document.removeEventListener('livewire:navigate', stop);
    await Promise.resolve();
    await window.fetch('/api/z');

    const { spans } = sent();
    expect(spans.some((s) => s.name === SPAN.NAVIGATION)).toBe(false);
    // Not parented to a navigation that never happened.
    const z = spans.find((s) => s.attributes[ATTR.HTTP_URL] === '/api/z')!;
    expect(z.parentSpanId).not.toBe(undefined);
    expect(spans.some((s) => s.spanId === z.parentSpanId)).toBe(false);
  });

  it('closes a navigation that never finishes as a timeout so later spans are not parented to a missing span', async () => {
    vi.useFakeTimers();
    try {
      fire('livewire:navigate', { url: new URL('/offline', location.origin), history: false, cached: false }, true);
      await Promise.resolve();
      vi.advanceTimersByTime(30_000);
      const n = sent().spans.find((s) => s.name === SPAN.NAVIGATION)!;
      expect(n.attributes[ATTR.NAVIGATION_OUTCOME]).toBe('timeout');
      expect(n.attributes[ATTR.NAVIGATION_TRACE_SOURCE]).toBe('none');
    } finally {
      vi.useRealTimers();
    }
  });
});
