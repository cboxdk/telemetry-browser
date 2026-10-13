/** Cryptographically-random lowercase hex of `bytes` length. */
export function hex(bytes: number): string {
  const a = new Uint8Array(bytes);
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(a);
  } else {
    for (let i = 0; i < bytes; i++) a[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (let i = 0; i < a.length; i++) out += (a[i]! + 0x100).toString(16).slice(1);
  return out;
}

export const traceId = (): string => hex(16); // 32 hex
export const spanId = (): string => hex(8); // 16 hex

const TP = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const ZERO_TRACE = '0'.repeat(32);
const ZERO_SPAN = '0'.repeat(16);

export interface TraceParent {
  traceId: string;
  spanId: string;
  /** The `sampled` trace flag (bit 0): did the upstream record this span? */
  sampled: boolean;
}

/**
 * Parse a W3C traceparent (or traceresponse) value, or null if malformed.
 * All-zero trace or span ids are invalid per the spec and rejected.
 */
export function parseTraceparent(value: string | null | undefined): TraceParent | null {
  if (!value) return null;
  const m = TP.exec(value.trim());
  if (!m || m[1] === ZERO_TRACE || m[2] === ZERO_SPAN) return null;
  return { traceId: m[1]!, spanId: m[2]!, sampled: (parseInt(m[3]!, 16) & 1) === 1 };
}

/** Build a traceparent, carrying the upstream sampling decision. */
export function buildTraceparent(trace: string, span: string, sampled = true): string {
  return `00-${trace}-${span}-${sampled ? '01' : '00'}`;
}

/**
 * True only when `url` resolves to this page's exact origin. Prefix checks
 * are not enough: `//other.example/x` and `https://app.example.com.evil.com/`
 * both start like same-origin URLs, and traceparent must never leak to them.
 */
export function isSameOrigin(url: string): boolean {
  try {
    return new URL(url, location.href).origin === location.origin;
  } catch {
    return false;
  }
}
