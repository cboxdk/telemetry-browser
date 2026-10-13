import { describe, it, expect } from 'vitest';
import { hex, traceId, spanId, parseTraceparent, buildTraceparent, isSameOrigin } from '../src/ids';

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
      sampled: true,
    });
    expect(parseTraceparent('garbage')).toBeNull();
    expect(parseTraceparent(null)).toBeNull();
    expect(buildTraceparent('a'.repeat(32), 'b'.repeat(16))).toBe(`00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`);
  });

  it('rejects all-zero ids (invalid per W3C) and reads the sampled flag', () => {
    expect(parseTraceparent(`00-${'0'.repeat(32)}-b7ad6b7169203331-01`)).toBeNull();
    expect(parseTraceparent(`00-0af7651916cd43dd8448eb211c80319c-${'0'.repeat(16)}-01`)).toBeNull();
    expect(parseTraceparent('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00')?.sampled).toBe(false);
    expect(parseTraceparent('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-03')?.sampled).toBe(true);
    expect(buildTraceparent('a'.repeat(32), 'b'.repeat(16), false)).toBe(`00-${'a'.repeat(32)}-${'b'.repeat(16)}-00`);
  });

  it('decides same-origin by the resolved origin, not a string prefix', () => {
    expect(isSameOrigin('/api/x')).toBe(true);
    expect(isSameOrigin('api/x')).toBe(true);
    expect(isSameOrigin(`${location.origin}/x`)).toBe(true);
    expect(isSameOrigin('//other.example/x')).toBe(false);
    expect(isSameOrigin(`${location.origin}.evil.example/x`)).toBe(false);
    expect(isSameOrigin('https://third-party.example.com/x')).toBe(false);
  });
});
