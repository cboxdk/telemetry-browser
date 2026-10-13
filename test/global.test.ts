import { describe, it, expect, vi, beforeEach } from 'vitest';

const initSpy = vi.fn();
vi.mock('../src/index', () => ({ init: initSpy }));

const loadWith = async (data: Record<string, string>) => {
  const script = document.createElement('script');
  for (const [k, v] of Object.entries(data)) script.dataset[k] = v;
  Object.defineProperty(document, 'currentScript', { value: script, configurable: true });
  vi.resetModules();
  await import('../src/global');
};

describe('standalone auto-init (global build)', () => {
  beforeEach(() => {
    initSpy.mockClear();
  });

  it('maps data-* attributes and initializes once per document', async () => {
    await loadWith({
      endpoint: '/telemetry/spans',
      traceHeader: 'X-Request-Trace',
      serverTiming: '0',
      frameworks: '0',
    });
    expect(initSpy).toHaveBeenCalledTimes(1);
    const config = initSpy.mock.calls[0]![0];
    expect(config.endpoint).toBe('/telemetry/spans');
    expect(config.traceIdHeader).toBe('X-Request-Trace');
    expect(config.instrument.serverTiming).toBe(false);
    expect(config.instrument.frameworks).toBe(false);
    expect(config.instrument.fetch).toBe(true);

    // Livewire's wire:navigate may run the <script> again — a no-op.
    await loadWith({ endpoint: '/telemetry/spans' });
    expect(initSpy).toHaveBeenCalledTimes(1);
  });
});
