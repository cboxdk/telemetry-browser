import { describe, it, expect } from 'vitest';
import { hex, traceId, spanId, parseTraceparent, buildTraceparent } from '../src/ids';

describe('ids', () => {
  it('generates hex of the right length', () => {
    expect(hex(16)).toMatch(/^[0-9a-f]{32}$/);
    expect(traceId()).toMatch(/^[0-9a-f]{32}$/);
    expect(spanId()).toMatch(/^[0-9a-f]{16}$/);
    expect(traceId()).not.toBe(traceId());
  });

  it('parses and builds W3C traceparent', () => {
    const tp = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    expect(parseTraceparent(tp)).toEqual({
      traceId: '0af7651916cd43dd8448eb211c80319c',
      spanId: 'b7ad6b7169203331',
    });
    expect(parseTraceparent('garbage')).toBeNull();
    expect(parseTraceparent(null)).toBeNull();
    expect(buildTraceparent('a'.repeat(32), 'b'.repeat(16))).toBe(`00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`);
  });
});
