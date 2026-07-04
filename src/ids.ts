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

const TP = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

export interface TraceParent {
  traceId: string;
  spanId: string;
}

/** Parse a W3C traceparent header value, or null if malformed. */
export function parseTraceparent(value: string | null | undefined): TraceParent | null {
  if (!value) return null;
  const m = TP.exec(value.trim());
  return m ? { traceId: m[1]!, spanId: m[2]! } : null;
}

export function buildTraceparent(trace: string, span: string): string {
  return `00-${trace}-${span}-01`;
}
