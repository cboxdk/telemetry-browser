import { describe, it, expect, vi, beforeEach } from 'vitest';
import { init, ATTR } from '../src/index';

describe('fetch instrumentation', () => {
  let beacon: ReturnType<typeof vi.fn>;
  let underlying: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    beacon = vi.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    underlying = vi.fn(() => Promise.resolve(new Response('', { status: 200 })));
    window.fetch = underlying as unknown as typeof fetch;
  });

  it('propagates traceparent to same-origin calls and records a client span', async () => {
    const t = init({ endpoint: '/telemetry/spans', instrument: { documentLoad: false, webVitals: false, xhr: false, errors: false, navigation: false } })!;

    await window.fetch('/api/orders', { method: 'POST' });

    // The underlying fetch received a traceparent header for the same trace.
    const init2 = underlying.mock.calls[0]![1] as RequestInit;
    const headers = new Headers(init2.headers);
    expect(headers.get('traceparent')).toMatch(new RegExp(`^00-${t.traceId()}-[0-9a-f]{16}-01$`));

    t.flush();
    const s = JSON.parse(beacon.mock.calls[0]![1] as string).spans[0];
    expect(s.name).toBe('fetch POST');
    expect(s.kind).toBe('client');
    expect(s.attributes[ATTR.HTTP_STATUS]).toBe(200);
    expect(s.attributes[ATTR.HTTP_URL]).toBe('/api/orders');
  });

  it('does not add a header to cross-origin calls', async () => {
    init({ endpoint: '/x', instrument: { documentLoad: false, webVitals: false, xhr: false, errors: false, navigation: false } });
    await window.fetch('https://third-party.example.com/x');
    const init2 = underlying.mock.calls[0]![1] as RequestInit | undefined;
    const headers = new Headers(init2?.headers);
    expect(headers.get('traceparent')).toBeNull();
  });

  const header = (call = 0) =>
    new Headers((underlying.mock.calls[call]![1] as RequestInit | undefined)?.headers).get('traceparent');
  const off = { documentLoad: false, webVitals: false, xhr: false, errors: false, navigation: false };

  it('does not leak traceparent to protocol-relative or look-alike hosts', async () => {
    init({ endpoint: '/x', instrument: off });
    await window.fetch('//other.example/x');
    await window.fetch(`${location.origin}.evil.example/x`);
    expect(header(0)).toBeNull();
    expect(header(1)).toBeNull();
  });

  it('propagates to a relative same-origin path without a leading slash', async () => {
    init({ endpoint: '/x', instrument: off });
    await window.fetch('api/orders');
    expect(header(0)).not.toBeNull();
  });

  it('carries the server\'s unsampled decision instead of forcing -01', async () => {
    init({ endpoint: '/x', traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00', instrument: off });
    await window.fetch('/api/x');
    expect(header(0)).toMatch(/^00-0af7651916cd43dd8448eb211c80319c-[0-9a-f]{16}-00$/);
  });

  it('a second init() does not wrap fetch twice', async () => {
    const first = init({ endpoint: '/x', instrument: off })!;
    const second = init({ endpoint: '/x', instrument: off })!;
    expect(second).toBe(first);
    await window.fetch('/api/once');
    first.flush();
    second.flush();
    const spans = beacon.mock.calls.flatMap((c) => JSON.parse(c[1] as string).spans ?? []);
    expect(spans.filter((s: { name: string }) => s.name === 'fetch GET')).toHaveLength(1);
    expect(underlying).toHaveBeenCalledTimes(1);
  });
});

