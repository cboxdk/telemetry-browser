import type { WireSpan } from './types';

/**
 * Buffers spans and ships them to the ingest endpoint. Uses sendBeacon —
 * the only transport guaranteed to survive page unload — falling back to
 * fetch(keepalive). Flushes on the way out (visibilitychange/pagehide),
 * when the buffer fills, and on a slow timer.
 */
export class Exporter {
  private buffer: WireSpan[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly endpoint: string,
    private readonly maxSpans: number,
    private readonly debug: boolean,
  ) {
    const flush = () => this.flush();
    addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    addEventListener('pagehide', flush);
    // A gentle heartbeat so long-lived tabs don't hoard spans.
    this.timer = setInterval(flush, 15000);
  }

  record(span: WireSpan): void {
    this.buffer.push(span);
    if (this.debug) console.debug('[telemetry] span', span.name, span);
    if (this.buffer.length >= this.maxSpans) this.flush();
  }

  flush(): void {
    if (this.buffer.length === 0) return;
    const spans = this.buffer.splice(0, this.buffer.length);
    const body = JSON.stringify({ spans });

    try {
      if (navigator.sendBeacon) {
        // A string body is a CORS "simple request" (no preflight); the
        // ingest controller decodes the raw body regardless of type.
        const ok = navigator.sendBeacon(this.endpoint, body);
        if (ok) return;
      }
      // Fallback — keepalive lets it outlive the document.
      void fetch(this.endpoint, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        credentials: 'same-origin',
      }).catch(() => {});
    } catch {
      /* telemetry is best-effort — never throw into the app */
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
