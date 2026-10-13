import { ATTR } from './semconv';
import type { Attributes } from './types';

/** One `Server-Timing` metric — the shape `PerformanceServerTiming` has too. */
export interface ServerTimingEntry {
  name: string;
  /** Milliseconds; 0 when the metric carried no `dur`. */
  duration: number;
  /** '' when the metric carried no `desc`. */
  description: string;
}

/** At most this many metrics become attributes per span. */
const MAX_ENTRIES = 10;
const MAX_NAME = 64;
const MAX_DESCRIPTION = 256;
/** Longer headers are not parsed at all — a hostile or runaway value costs nothing. */
const MAX_HEADER = 4096;
/** A non-negative decimal number, nothing trailing (`12abc` is not a duration). */
const DURATION = /^\d+(?:\.\d+)?$|^\.\d+$/;

/**
 * Parse a `Server-Timing` header value
 * (`db;dur=12.3;desc="3 queries", app;dur=48.1`). Lenient: a malformed
 * metric is skipped, never thrown on. Commas and semicolons inside quoted
 * descriptions are respected.
 */
export function parseServerTiming(header: string | null | undefined): ServerTimingEntry[] {
  const out: ServerTimingEntry[] = [];
  if (!header || header.length > MAX_HEADER) return out;

  // Split into metrics and their params, honouring quoted strings.
  const metrics: string[][] = [];
  let params: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < header.length; i++) {
    const c = header[i]!;
    if (quoted) {
      if (c === '\\' && i + 1 < header.length) cur += header[++i];
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ';' || c === ',') {
      params.push(cur.trim());
      cur = '';
      if (c === ',') {
        metrics.push(params);
        params = [];
      }
    } else cur += c;
  }
  params.push(cur.trim());
  metrics.push(params);

  for (const [name, ...rest] of metrics) {
    if (!name) continue;
    const entry: ServerTimingEntry = { name, duration: 0, description: '' };
    let dur = false;
    let desc = false;
    for (const p of rest) {
      const eq = p.indexOf('=');
      const key = (eq < 0 ? p : p.slice(0, eq)).trim().toLowerCase();
      const value = eq < 0 ? '' : p.slice(eq + 1).trim();
      // The spec keeps the first occurrence of each param.
      if (key === 'dur' && !dur) {
        dur = true;
        // Malformed or negative durations are ignored (the metric keeps 0).
        if (DURATION.test(value)) {
          const n = Number(value);
          if (Number.isFinite(n)) entry.duration = n;
        }
      } else if (key === 'desc' && !desc) {
        desc = true;
        entry.description = value;
      }
    }
    out.push(entry);
  }
  return out;
}

/**
 * A metric name as an attribute segment: lowercase `[a-z0-9_]`, starting
 * with a letter, so the key stays `[a-z][a-z0-9._]*`. Empty when nothing
 * usable is left.
 */
export function sanitizeServerTimingName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+$/, '')
    .slice(0, MAX_NAME);
}

/**
 * Server-Timing metrics as span attributes:
 * `server_timing.<name>.duration_ms` and, when present,
 * `server_timing.<name>.description`. Capped at 10 metrics; a repeated
 * name keeps its first entry.
 */
export function serverTimingAttributes(entries: ReadonlyArray<ServerTimingEntry> | undefined): Attributes {
  const attrs: Attributes = {};
  if (!entries) return attrs;
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.size >= MAX_ENTRIES) break;
    const name = sanitizeServerTimingName(String(e.name ?? ''));
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const prefix = `${ATTR.SERVER_TIMING}.${name}.`;
    const duration = Number(e.duration);
    attrs[`${prefix}duration_ms`] = Number.isFinite(duration) ? Math.round(duration * 1000) / 1000 : 0;
    if (e.description) attrs[`${prefix}description`] = String(e.description).slice(0, MAX_DESCRIPTION);
  }
  return attrs;
}
