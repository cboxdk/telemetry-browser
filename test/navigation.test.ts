import { describe, it, expect, vi } from 'vitest';
import { init, SPAN } from '../src/index';

describe('generic history navigation (no framework)', () => {
  it('still records pushState route changes when no framework is present', async () => {
    const beacon = vi.fn((_url: string, _body: string) => true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    const t = init({
      endpoint: '/x',
      instrument: { documentLoad: false, webVitals: false, fetch: false, xhr: false, errors: false },
    })!;

    window.history.pushState({}, '', '/plain-spa-route');
    await Promise.resolve();
    t.flush();

    const spans = JSON.parse(beacon.mock.calls[0]![1]).spans;
    expect(spans.map((s: { name: string }) => s.name)).toEqual([SPAN.ROUTE_CHANGE]);
  });
});
