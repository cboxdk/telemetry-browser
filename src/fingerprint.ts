/**
 * A Sentry-style fingerprint for browser errors so identical failures
 * group into one issue — matching the backend's `exception.group`, so
 * telemetry-ui groups frontend and backend errors uniformly.
 *
 * Unlike the backend (which groups by throw site), browser file names and
 * line numbers are minified and CHANGE every deploy, so grouping on them
 * would over-split. We group on `type` + a NORMALIZED message (digits,
 * uuids, hex, quoted strings and urls masked), which is stable across
 * deploys and data. Source-map symbolication (future) would enable
 * frame-based grouping on top of this.
 */
export function normalizeMessage(message: string): string {
  return message
    .replace(/\b0x[0-9a-f]+\b/gi, '0x_')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/(['"]).*?\1/g, '<str>')
    .replace(/\d+/g, '<n>')
    .trim()
    .slice(0, 200);
}

/** cyrb53 — a fast, stable, non-cryptographic 53-bit string hash. */
function cyrb53(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(12, '0').slice(0, 12);
}

export function fingerprint(type: string, message: string): string {
  return cyrb53(`${type}@${normalizeMessage(message)}`);
}
