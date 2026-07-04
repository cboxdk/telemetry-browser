import { describe, it, expect, vi, beforeEach } from 'vitest';
import { init, ATTR } from '../src/index';

describe('init', () => {
  let beacon: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    beacon = vi.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
  });

  it('roots on the server traceparent and stamps aligned dimensions', () => {
    const t = init({
      endpoint: '/telemetry/spans',
      serviceName: 'my-app',
      environment: 'production',
      traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      instrument: { documentLoad: false, webVitals: false, fetch: false, xhr: false, errors: false, navigation: false },
    })!;

    expect(t.traceId()).toBe('0af7651916cd43dd8448eb211c80319c');

    t.setUser('user-42');
    t.record({ name: 'manual.thing' });
    t.flush();

    // Read the real payload:
    return new Response(beacon.mock.calls[0]![1]).text().then((raw) => {
      const s = JSON.parse(raw).spans[0];
      expect(s.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
      expect(s.attributes[ATTR.SERVICE_NAME]).toBe('my-app');
      expect(s.attributes[ATTR.DEPLOYMENT_ENVIRONMENT]).toBe('production');
      expect(s.attributes[ATTR.ENDUSER_ID]).toBe('user-42');
      expect(s.attributes[ATTR.BROWSER]).toBe(true);
      expect(s.attributes[ATTR.SESSION_ID]).toMatch(/^[0-9a-f]{16}$/);
    });
  });

  it('adopts a server-provided session id (shared visit key) over its own', () => {
    const t = init({
      endpoint: '/telemetry/spans',
      session: 'srv-shared-session-id',
      instrument: { documentLoad: false, webVitals: false, fetch: false, xhr: false, errors: false, navigation: false },
    })!;

    t.record({ name: 'manual.thing' });
    t.flush();

    return new Response(beacon.mock.calls[0]![1]).text().then((raw) => {
      const s = JSON.parse(raw).spans[0];
      expect(s.attributes[ATTR.SESSION_ID]).toBe('srv-shared-session-id');
    });
  });

  it('records errors as exception spans', async () => {
    const t = init({ endpoint: '/x', instrument: { documentLoad: false, webVitals: false, fetch: false, xhr: false, errors: false, navigation: false } })!;
    t.error(new TypeError('boom'));
    t.flush();
    const s = JSON.parse(beacon.mock.calls[0]![1] as string).spans[0];
    expect(s.status).toBe('error');
    expect(s.attributes[ATTR.EXCEPTION_TYPE]).toBe('TypeError');
    expect(s.attributes[ATTR.EXCEPTION_MESSAGE]).toBe('boom');
  });
});
