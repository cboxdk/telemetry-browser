import { describe, it, expect } from 'vitest';
import { fingerprint, normalizeMessage } from '../src/fingerprint';

describe('fingerprint', () => {
  it('groups the same error shape despite varying data', () => {
    const a = fingerprint('TypeError', 'User 5 not found');
    const b = fingerprint('TypeError', 'User 4212 not found');
    const c = fingerprint('TypeError', "Cannot read 'x' of undefined");
    const d = fingerprint('RangeError', 'User 5 not found');

    expect(a).toBe(b);        // numbers normalized → same issue
    expect(a).not.toBe(c);    // different message shape → different issue
    expect(a).not.toBe(d);    // different type → different issue
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });

  it('normalizes numbers, uuids, urls and quoted strings', () => {
    expect(normalizeMessage('id 42 uuid 550e8400-e29b-41d4-a716-446655440000'))
      .toBe('id <n> uuid <uuid>');
    expect(normalizeMessage('failed GET https://api.test/x?q=1'))
      .toBe('failed GET <url>');
    expect(normalizeMessage('bad value "supersecret"')).toBe('bad value <str>');
  });
});
