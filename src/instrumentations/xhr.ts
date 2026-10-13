import { buildTraceparent, spanId } from '../ids';
import { ATTR } from '../semconv';
import { parseServerTiming, serverTimingAttributes } from '../serverTiming';
import { now } from '../tracer';
import type { Tracer } from '../tracer';

/**
 * Reads `Server-Timing` without the console warning `getResponseHeader`
 * logs for a header a cross-origin response did not expose.
 */
function serverTimingHeader(xhr: XMLHttpRequest, sameOrigin: boolean): string | null {
  if (sameOrigin) return xhr.getResponseHeader('server-timing');
  const all = xhr.getAllResponseHeaders();
  const match = /^server-timing:(.*)$/im.exec(all);
  return match ? match[1]!.trim() : null;
}

/** Same as fetch instrumentation, for XMLHttpRequest. */
export function instrumentXhr(tracer: Tracer, serverTiming = true): void {
  const Xhr = window.XMLHttpRequest;
  if (!Xhr) return;

  const open = Xhr.prototype.open;
  const send = Xhr.prototype.send;

  type Tracked = XMLHttpRequest & {
    __tel?: { method: string; url: string; id: string; start: number; traceId: string; parentSpanId: string };
  };

  Xhr.prototype.open = function (this: Tracked, method: string, url: string | URL, ...rest: unknown[]) {
    this.__tel = { method: method.toUpperCase(), url: String(url), id: spanId(), start: 0, traceId: '', parentSpanId: '' };
    // @ts-expect-error — forwarding the native signature
    return open.call(this, method, url, ...rest);
  };

  Xhr.prototype.send = function (this: Tracked, ...args: unknown[]) {
    const t = this.__tel;
    if (t) {
      t.start = now();
      // Captured now: a soft navigation may move the active trace before this ends.
      const scope = tracer.context.scope();
      t.traceId = scope.traceId;
      t.parentSpanId = scope.parentSpanId;
      const sameOrigin = t.url.startsWith('/') || t.url.startsWith(location.origin);
      if (sameOrigin) {
        try {
          this.setRequestHeader('traceparent', buildTraceparent(t.traceId, t.id));
        } catch {
          /* header may be locked — ignore */
        }
      }
      this.addEventListener('loadend', () => {
        let timing;
        if (serverTiming && this.status !== 0) {
          try {
            timing = serverTimingAttributes(parseServerTiming(serverTimingHeader(this, sameOrigin)));
          } catch {
            /* unreadable headers — the span still records */
          }
        }
        tracer.record({
          name: `xhr ${t.method}`,
          kind: 'client',
          start: t.start,
          end: now(),
          spanId: t.id,
          traceId: t.traceId,
          parentSpanId: t.parentSpanId,
          status: this.status === 0 || this.status >= 500 ? 'error' : 'ok',
          attributes: {
            [ATTR.HTTP_METHOD]: t.method,
            [ATTR.HTTP_URL]: t.url,
            [ATTR.HTTP_STATUS]: this.status,
            ...timing,
          },
        });
        if (sameOrigin && this.status !== 0) {
          tracer.observeResponse({
            url: t.url,
            spanId: t.id,
            traceId: t.traceId,
            header: (name) => {
              try {
                return this.getResponseHeader(name);
              } catch {
                return null;
              }
            },
          });
        }
      });
    }
    // @ts-expect-error — forwarding the native signature
    return send.apply(this, args);
  };
}
