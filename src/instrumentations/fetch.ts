import { buildTraceparent, spanId } from '../ids';
import { ATTR } from '../semconv';
import { now } from '../tracer';
import type { Tracer } from '../tracer';

/**
 * Instruments fetch: a client span per call, and — for SAME-ORIGIN calls
 * only — a W3C traceparent header so the backend continues the trace.
 * Cross-origin is left untouched (an unexpected header trips CORS preflight).
 */
export function instrumentFetch(tracer: Tracer): void {
  if (!window.fetch) return;
  const original = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const sameOrigin = url.startsWith('/') || url.startsWith(location.origin);
    const id = spanId();
    const start = now();

    let opts = init;
    if (sameOrigin) {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set('traceparent', buildTraceparent(tracer.context.traceId, id));
      opts = { ...init, headers };
    }

    const finish = (status: number, ok: boolean) =>
      tracer.record({
        name: `fetch ${method}`,
        kind: 'client',
        start,
        end: now(),
        spanId: id,
        status: ok ? 'ok' : 'error',
        attributes: {
          [ATTR.HTTP_METHOD]: method,
          [ATTR.HTTP_URL]: url,
          [ATTR.HTTP_STATUS]: status,
        },
      });

    return original(input, opts).then(
      (res) => {
        finish(res.status, res.status < 500);
        return res;
      },
      (err: unknown) => {
        finish(0, false);
        throw err;
      },
    );
  };
}
