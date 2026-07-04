import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';
import { ATTR, SPAN } from '../semconv';
import { now } from '../tracer';
import type { Tracer } from '../tracer';

/**
 * Core Web Vitals as marker spans — LCP, CLS, INP, FCP, TTFB. Each
 * finalizes at its own time (INP/CLS on page hide); we emit one marker
 * span per metric with its value + Google's good/needs-improvement/poor
 * rating. The UI aggregates by web_vital.name.
 */
export function instrumentWebVitals(tracer: Tracer): void {
  const report = (metric: Metric) => {
    const t = now();
    tracer.record({
      name: SPAN.WEB_VITAL,
      start: t,
      end: t,
      attributes: {
        [ATTR.WEB_VITAL_NAME]: metric.name,
        [ATTR.WEB_VITAL_VALUE]: Math.round(metric.value * 100) / 100,
        [ATTR.WEB_VITAL_RATING]: metric.rating,
      },
    });
  };

  onLCP(report);
  onCLS(report);
  onINP(report);
  onFCP(report);
  onTTFB(report);
}
