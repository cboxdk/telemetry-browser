import { describe, it, expect, vi, beforeEach } from 'vitest';

type Handle = { setUser: ReturnType<typeof vi.fn>; track: ReturnType<typeof vi.fn> };
type Slot = { __cboxTelemetry?: Handle | null; TelemetryQueue?: unknown };
const w = window as unknown as Slot;

// The real init() remembers its handle on window (once per page); the mock does the same.
const initSpy = vi.fn((_config: unknown): Handle | undefined => {
  const handle = { setUser: vi.fn(), track: vi.fn() };
  w.__cboxTelemetry = handle;
  return handle;
});
vi.mock('../src/index', () => ({ init: initSpy }));

const load = async (data: Record<string, string>) => {
  const script = document.createElement('script');
  for (const [k, v] of Object.entries(data)) script.dataset[k] = v;
  Object.defineProperty(document, 'currentScript', { value: script, configurable: true });
  vi.resetModules();
  return (await import('../src/global')) as unknown as {
    client?: Handle;
    init: (config: unknown) => Handle | undefined;
  };
};

describe('standalone auto-init (global build)', () => {
  beforeEach(() => {
    initSpy.mockClear();
  });

  it('maps data-* attributes and initializes once per document', async () => {
    const first = await load({
      endpoint: '/telemetry/spans',
      traceHeader: 'X-Request-Trace',
      serverTiming: '0',
      frameworks: '0',
      user: '42',
    });
    expect(initSpy).toHaveBeenCalledTimes(1);
    const config = initSpy.mock.calls[0]![0] as Record<string, any>;
    expect(config.endpoint).toBe('/telemetry/spans');
    expect(config.traceIdHeader).toBe('X-Request-Trace');
    expect(config.user).toBe('42');
    expect(config.instrument.serverTiming).toBe(false);
    expect(config.instrument.frameworks).toBe(false);
    expect(config.instrument.fetch).toBe(true);

    // Livewire's wire:navigate may run the <script> again: no second init,
    // but the new window.Telemetry still exposes the page's handle.
    const again = await load({ endpoint: '/telemetry/spans' });
    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(again.client).toBe(first.client);
  });

  it('prefers data-user-id over data-user', async () => {
    await load({ endpoint: '/x', userId: '7', user: '42' });
    expect((initSpy.mock.calls[0]![0] as { user: string }).user).toBe('7');
  });

  it('exposes the auto-inited handle as Telemetry.client', async () => {
    const g = await load({ endpoint: '/x' });
    expect(g.client).toBeDefined();
    expect(g.client).toBe(initSpy.mock.results[0]!.value);
  });

  it('runs callbacks queued before load, then runs later pushes at once', async () => {
    const order: string[] = [];
    w.TelemetryQueue = [
      (t: Handle) => {
        order.push('a');
        t.setUser('42');
      },
      () => {
        throw new Error('a broken callback never stops the rest');
      },
      'not a function',
      () => order.push('b'),
    ];

    const g = await load({ endpoint: '/x' });
    expect(order).toEqual(['a', 'b']);
    expect(g.client!.setUser).toHaveBeenCalledWith('42');

    // The same snippet after load: runs immediately.
    (w.TelemetryQueue as { push: (fn: (t: Handle) => void) => void }).push((t) => t.track('signup'));
    expect(g.client!.track).toHaveBeenCalledWith('signup');
  });

  it('a manual Telemetry.init() publishes the handle and drains the queue', async () => {
    const queued = vi.fn();
    w.TelemetryQueue = [queued];

    const g = await load({}); // no data-endpoint: no auto-init
    expect(initSpy).not.toHaveBeenCalled();
    expect(g.client).toBeUndefined();
    expect(queued).not.toHaveBeenCalled();

    const t = g.init({ endpoint: '/x' });
    expect(g.client).toBe(t);
    expect(queued).toHaveBeenCalledWith(t);
  });

  it('a sampled-out page exposes no client and runs no callbacks', async () => {
    initSpy.mockImplementationOnce(() => {
      w.__cboxTelemetry = null;
      return undefined;
    });
    const queued = vi.fn();
    w.TelemetryQueue = [queued];

    const g = await load({ endpoint: '/x', sample: '0.1' });
    expect(g.client).toBeUndefined();
    expect(queued).not.toHaveBeenCalled();

    // A re-run script does not re-roll the sampling decision.
    await load({ endpoint: '/x', sample: '0.1' });
    expect(initSpy).toHaveBeenCalledTimes(1);
  });
});
