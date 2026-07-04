import { ATTR, SPAN } from '../semconv';
import type { Tracer } from '../tracer';

const round = (n: number): number => Math.max(0, Math.round(n));

/** A page-load span with navigation timing + device dimensions. */
export function instrumentDocumentLoad(tracer: Tracer): void {
  const emit = () => {
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

    tracer.record({
      name: SPAN.PAGE_LOAD,
      kind: 'client',
      start: t0 + nav.startTime,
      end: t0 + (nav.loadEventEnd || nav.responseEnd || nav.domComplete),
      parentSpanId: tracer.context.rootSpanId,
      attributes,
    });
  };

  if (document.readyState === 'complete') setTimeout(emit, 0);
  else addEventListener('load', () => setTimeout(emit, 0));
}
