import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Exporter } from '../src/exporter';
import type { WireSpan } from '../src/types';

const span = (name: string): WireSpan => ({
  traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), name, kind: 'internal',
  start: 1, end: 2, attributes: {}, status: 'ok',
});

describe('Exporter', () => {
  let beacon: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    beacon = vi.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
  });

  it('buffers and ships the batch via sendBeacon', async () => {
    const ex = new Exporter('/telemetry/spans', 128, false);
    ex.record(span('a'));
    ex.record(span('b'));
    expect(beacon).not.toHaveBeenCalled();
    ex.flush();
    expect(beacon).toHaveBeenCalledOnce();
    const [url, blob] = beacon.mock.calls[0]!;
    expect(url).toBe('/telemetry/spans');
    const body = JSON.parse(blob as string);
    expect(body.spans.map((s: WireSpan) => s.name)).toEqual(['a', 'b']);
  });

  it('force-flushes when the buffer is full', () => {
    const ex = new Exporter('/x', 2, false);
    ex.record(span('a'));
    ex.record(span('b')); // hits cap
    expect(beacon).toHaveBeenCalledOnce();
  });
});
