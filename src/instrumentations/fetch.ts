import { buildTraceparent, isSameOrigin, spanId } from '../ids';
import { ATTR } from '../semconv';
import { parseServerTiming, serverTimingAttributes } from '../serverTiming';
import { now } from '../tracer';
import type { Tracer } from '../tracer';

type Wrapped = typeof fetch & { __cboxTelemetry?: boolean };

/**
 * Instruments fetch: a client span per call, and — for SAME-ORIGIN calls
 * only — a W3C traceparent header so the backend continues the trace.
 * Cross-origin is left untouched (an unexpected header trips CORS preflight).
 * The response's `Server-Timing` header lands on the span; cross-origin it
 * is only readable when the server exposes it (Access-Control-Expose-Headers).
 */
export function instrumentFetch(tracer: Tracer, serverTiming = true): void {
  if (!window.fetch || (window.fetch as Wrapped).__cboxTelemetry) return; // a second init() must not double-wrap
  const original = window.fetch.bind(window);

  const wrapped: Wrapped = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const sameOrigin = isSameOrigin(url);
    const id = spanId();
    const start = now();
    // Captured now: a soft navigation may move the active trace before this ends.
    const scope = tracer.context.scope();

    let opts = init;
    if (sameOrigin) {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set('traceparent', buildTraceparent(scope.traceId, id, scope.sampled));
      opts = { ...init, headers };
    }

    const finish = (status: number, ok: boolean, extra?: Record<string, string | number | boolean>) =>
      tracer.record({
        name: `fetch ${method}`,
        kind: 'client',
        start,
        end: now(),
        spanId: id,
        traceId: scope.traceId,
        parentSpanId: scope.parentSpanId,
        status: ok ? 'ok' : 'error',
        attributes: {
          [ATTR.HTTP_METHOD]: method,
          [ATTR.HTTP_URL]: url,
          [ATTR.HTTP_STATUS]: status,
          ...extra,
        },
      });

    return original(input, opts).then(
      (res) => {
        let timing;
        if (serverTiming) {
          try {
            timing = serverTimingAttributes(parseServerTiming(res.headers.get('server-timing')));
          } catch {
            /* unreadable headers — the span still records */
          }
        }
        finish(res.status, res.status < 500, timing);
        if (sameOrigin) {
          tracer.observeResponse({
            url,
            spanId: id,
            traceId: scope.traceId,
            header: (name) => {
              try {
                return res.headers.get(name);
              } catch {
                return null;
              }
            },
          });
        }
        return res;
      },
      (err: unknown) => {
        finish(0, false);
        throw err;
      },
    );
  };
  wrapped.__cboxTelemetry = true;
  window.fetch = wrapped;
}
