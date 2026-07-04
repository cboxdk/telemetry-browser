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
});
