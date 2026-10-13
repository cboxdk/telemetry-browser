import { describe, it, expect, vi, beforeAll } from 'vitest';
import { init } from '../src/index';

// A fresh XHR class for this file (the SDK marks the prototype it wrapped).
const sentHeaders: Array<Record<string, string>> = [];
class FakeXhr extends EventTarget {
  status = 0;
  private headers: Record<string, string> = {};
  open() {}
  setRequestHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
  }
  getResponseHeader() {
    return null;
  }
  getAllResponseHeaders() {
    return '';
  }
  send() {
    sentHeaders.push(this.headers);
    this.status = 200;
    this.dispatchEvent(new Event('loadend'));
  }
}

const request = (url: string) => {
  const r = new XMLHttpRequest();
  r.open('GET', url);
  r.send();
};

describe('XHR instrumentation', () => {
  const beacon = vi.fn((_url: string, _body: string) => true);

  beforeAll(() => {
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    (window as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXhr;
  });

  it('propagates only to the exact same origin, and is wrapped once across init() calls', () => {
    const off = { documentLoad: false, webVitals: false, fetch: false, errors: false, navigation: false };
    const t = init({ endpoint: '/x', instrument: off })!;
    init({ endpoint: '/x', instrument: off }); // must not wrap again

    request('/api/a');
    request('api/b');
    request('//other.example/c');
    request(`${location.origin}.evil.example/d`);

    expect(sentHeaders.map((h) => h.traceparent !== undefined)).toEqual([true, true, false, false]);

    t.flush();
    const spans = beacon.mock.calls.flatMap((c) => JSON.parse(c[1]).spans ?? []);
    expect(spans).toHaveLength(4); // one span per request, not two
  });
});
