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
      expect(s.attributes[ATTR.USER_ID]).toBe('user-42');
      expect(s.attributes['user.id']).toBe('user-42');
      expect(s.attributes['enduser.id']).toBeUndefined();
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

  it('emits track() as an unsampled analytics event in the events channel', () => {
    const t = init({
      endpoint: '/telemetry/spans',
      session: 'visit-1',
      analytics: true,
      instrument: { documentLoad: false, webVitals: false, fetch: false, xhr: false, errors: false, navigation: false },
    })!;

    t.track('signup_completed', { plan: 'pro' });
    t.flush();

    return new Response(beacon.mock.calls[0]![1]).text().then((raw) => {
      const payload = JSON.parse(raw);
      expect(payload.spans).toBeUndefined();          // analytics is NOT a span
      expect(payload.events).toHaveLength(1);
      const e = payload.events[0];
      expect(e.name).toBe('signup_completed');
      expect(e.sessionId).toBe('visit-1');            // shared visit key
      expect(e.attributes.plan).toBe('pro');
      expect(typeof e.time).toBe('number');
    });
  });

  it('track() is a no-op when analytics is disabled', () => {
    const t = init({
      endpoint: '/x',
      instrument: { documentLoad: false, webVitals: false, fetch: false, xhr: false, errors: false, navigation: false },
    })!;

    t.track('should_not_emit');
    t.flush();

    expect(beacon).not.toHaveBeenCalled();
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

  describe('once per page', () => {
    const off = { documentLoad: false, webVitals: false, fetch: false, xhr: false, errors: false, navigation: false };

    it('returns the existing handle on a second call and ignores its config', () => {
      const first = init({ endpoint: '/a', serviceName: 'first', instrument: off })!;
      const second = init({ endpoint: '/b', serviceName: 'second', instrument: off });
      expect(second).toBe(first);

      second!.record({ name: 'manual.thing' });
      second!.flush();
      expect(beacon).toHaveBeenCalledTimes(1);
      expect(beacon.mock.calls[0]![0]).toBe('/a');
      expect(JSON.parse(beacon.mock.calls[0]![1] as string).spans[0].attributes[ATTR.SERVICE_NAME]).toBe('first');
    });

    it('warns about the ignored config only in debug mode', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      init({ endpoint: '/x', instrument: off });
      init({ endpoint: '/x', instrument: off });
      expect(warn).not.toHaveBeenCalled();
      init({ endpoint: '/x', instrument: off, debug: true });
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });

    it('keeps a sampled-out page sampled out', () => {
      const random = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      expect(init({ endpoint: '/x', sampleRate: 0.5, instrument: off })).toBeUndefined();
      random.mockReturnValue(0);
      expect(init({ endpoint: '/x', sampleRate: 0.5, instrument: off })).toBeUndefined();
      random.mockRestore();
    });

    it('does not count a call without an endpoint', () => {
      expect(init({ endpoint: '' })).toBeUndefined();
      expect(init({ endpoint: '/x', instrument: off })).toBeDefined();
    });
  });
});
