import { buildTraceparent, spanId } from '../ids';
import { ATTR } from '../semconv';
import { now } from '../tracer';
import type { Tracer } from '../tracer';

/** Same as fetch instrumentation, for XMLHttpRequest. */
export function instrumentXhr(tracer: Tracer): void {
  const Xhr = window.XMLHttpRequest;
  if (!Xhr) return;

  const open = Xhr.prototype.open;
  const send = Xhr.prototype.send;

  type Tracked = XMLHttpRequest & { __tel?: { method: string; url: string; id: string; start: number } };

  Xhr.prototype.open = function (this: Tracked, method: string, url: string | URL, ...rest: unknown[]) {
    this.__tel = { method: method.toUpperCase(), url: String(url), id: spanId(), start: 0 };
    // @ts-expect-error — forwarding the native signature
    return open.call(this, method, url, ...rest);
  };

  Xhr.prototype.send = function (this: Tracked, ...args: unknown[]) {
    const t = this.__tel;
    if (t) {
      t.start = now();
      const sameOrigin = t.url.startsWith('/') || t.url.startsWith(location.origin);
      if (sameOrigin) {
        try {
          this.setRequestHeader('traceparent', buildTraceparent(tracer.context.traceId, t.id));
        } catch {
          /* header may be locked — ignore */
        }
      }
      this.addEventListener('loadend', () => {
        tracer.record({
          name: `xhr ${t.method}`,
          kind: 'client',
          start: t.start,
          end: now(),
          spanId: t.id,
          status: this.status === 0 || this.status >= 500 ? 'error' : 'ok',
          attributes: {
            [ATTR.HTTP_METHOD]: t.method,
            [ATTR.HTTP_URL]: t.url,
            [ATTR.HTTP_STATUS]: this.status,
          },
        });
      });
    }
    // @ts-expect-error — forwarding the native signature
    return send.apply(this, args);
  };
}
