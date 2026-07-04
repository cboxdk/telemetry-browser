import { ATTR, SPAN } from '../semconv';
import { now } from '../tracer';
import type { Tracer } from '../tracer';

const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n) : s);

/** Uncaught errors + unhandled promise rejections as exception spans. */
export function instrumentErrors(tracer: Tracer): void {
  addEventListener('error', (e: ErrorEvent) => {
    const t = now();
    const err = e.error as Error | undefined;
    tracer.record({
      name: SPAN.EXCEPTION,
      start: t,
      end: t,
      status: 'error',
      attributes: {
        [ATTR.EXCEPTION_TYPE]: err?.name ?? 'Error',
        [ATTR.EXCEPTION_MESSAGE]: clip(String(e.message ?? ''), 1024),
        [ATTR.EXCEPTION_FILE]: clip(String(e.filename ?? ''), 512),
        [ATTR.EXCEPTION_LINE]: e.lineno ?? 0,
        ...(err?.stack ? { [ATTR.EXCEPTION_STACKTRACE]: clip(err.stack, 8000) } : {}),
      },
    });
  });

  addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const t = now();
    const reason = e.reason as { name?: string; message?: string; stack?: string } | string | undefined;
    const message = typeof reason === 'string' ? reason : (reason?.message ?? String(reason));
    tracer.record({
      name: SPAN.EXCEPTION,
      start: t,
      end: t,
      status: 'error',
      attributes: {
        [ATTR.EXCEPTION_TYPE]: (typeof reason === 'object' && reason?.name) || 'UnhandledRejection',
        [ATTR.EXCEPTION_MESSAGE]: clip(message, 1024),
        ...(typeof reason === 'object' && reason?.stack ? { [ATTR.EXCEPTION_STACKTRACE]: clip(reason.stack, 8000) } : {}),
      },
    });
  });
}
