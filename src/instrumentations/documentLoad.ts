import { ATTR, SPAN } from '../semconv';
import { serverTimingAttributes } from '../serverTiming';
import type { Tracer } from '../tracer';

const round = (n: number): number => Math.max(0, Math.round(n));

/** A page-load span with navigation timing, Server-Timing + device dimensions. */
export function instrumentDocumentLoad(tracer: Tracer, serverTiming = true): void {
  // Guarded: this runs from a timer, outside any caller's try, and a
  // browser without the Navigation Timing L2 API must not see it throw.
  const emit = () => {
    try {
      record();
    } catch {
      /* no page-load span rather than an uncaught error */
    }
  };

  const record = () => {
    if (typeof performance.getEntriesByType !== 'function') return;
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (!nav) return;
    const t0 = performance.timeOrigin;
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime;

    const attributes = {
      ...tracer.context.device(),
      [ATTR.HTTP_URL]: location.href,
      [ATTR.PAGE_TTFB_MS]: round(nav.responseStart - nav.startTime),
      [ATTR.PAGE_DOM_INTERACTIVE_MS]: round(nav.domInteractive - nav.startTime),
      [ATTR.PAGE_DOM_COMPLETE_MS]: round(nav.domComplete - nav.startTime),
      [ATTR.PAGE_TRANSFER_BYTES]: nav.transferSize,
      [ATTR.PAGE_NAV_TYPE]: nav.type,
    } as Record<string, string | number | boolean>;
    if (typeof fcp === 'number') attributes[ATTR.PAGE_FCP_MS] = round(fcp);
    // The document response's own Server-Timing (absent in older browsers).
    if (serverTiming) Object.assign(attributes, serverTimingAttributes(nav.serverTiming));

    tracer.record({
      name: SPAN.PAGE_LOAD,
      kind: 'client',
      start: t0 + nav.startTime,
      end: t0 + (nav.loadEventEnd || nav.responseEnd || nav.domComplete),
      // The document's own trace, even if a soft navigation already moved on.
      traceId: tracer.context.initial.traceId,
      parentSpanId: tracer.context.initial.parentSpanId,
      attributes,
    });
  };

  if (document.readyState === 'complete') setTimeout(emit, 0);
  else addEventListener('load', () => setTimeout(emit, 0));
}
