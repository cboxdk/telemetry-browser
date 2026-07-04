import { Analytics } from './analytics';
import { Context } from './context';
import { Exporter } from './exporter';
import { instrumentDocumentLoad } from './instrumentations/documentLoad';
import { instrumentErrors } from './instrumentations/errors';
import { instrumentFetch } from './instrumentations/fetch';
import { instrumentNavigation } from './instrumentations/navigation';
import { instrumentWebVitals } from './instrumentations/webVitals';
import { instrumentXhr } from './instrumentations/xhr';
import { fingerprint } from './fingerprint';
import { ATTR, SPAN } from './semconv';
import { now, Tracer } from './tracer';
import type { Attributes, Telemetry, TelemetryConfig } from './types';

export { ATTR, SPAN } from './semconv';
export { fingerprint, normalizeMessage } from './fingerprint';
export type { Attributes, Telemetry, TelemetryConfig, WireSpan, SpanKind, SpanStatus } from './types';

/**
 * Start browser telemetry. Wires the enabled auto-instrumentations and
 * returns a handle for manual spans/errors. Best-effort: it never throws
 * into your app, and returns undefined when there's no DOM or the page is
 * sampled out.
 */
export function init(config: TelemetryConfig): Telemetry | undefined {
  if (typeof window === 'undefined' || !config || !config.endpoint) return undefined;

  const sample = config.sampleRate ?? 1;
  if (sample < 1 && Math.random() > sample) return undefined;

  const context = new Context(config);
  const exporter = new Exporter(config.endpoint, config.maxSpans ?? 128, config.debug ?? false);
  const tracer = new Tracer(context, exporter);

  // The unsampled analytics channel (off unless enabled).
  const analytics = config.analytics ? new Analytics(context, exporter) : undefined;

  const inst = config.instrument ?? {};
  const enabled = (v?: boolean) => v !== false;

  const guard = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      if (config.debug) console.debug('[telemetry] instrument', e);
    }
  };

  if (enabled(inst.documentLoad)) guard(() => instrumentDocumentLoad(tracer));
  if (enabled(inst.webVitals)) guard(() => instrumentWebVitals(tracer));
  if (enabled(inst.fetch)) guard(() => instrumentFetch(tracer));
  if (enabled(inst.xhr)) guard(() => instrumentXhr(tracer));
  if (enabled(inst.errors)) guard(() => instrumentErrors(tracer));
  // SPA navigations the server never sees also become unsampled page views.
  if (enabled(inst.navigation)) {
    guard(() => instrumentNavigation(tracer, analytics ? (_to, from) => analytics.pageView(from) : undefined));
  }

  return {
    record: (span) => tracer.record({ start: now(), end: now(), ...span }),
    error: (error, attributes) => {
      const t = now();
      const err = error as { name?: string; message?: string; stack?: string } | undefined;
      tracer.record({
        name: SPAN.EXCEPTION,
        start: t,
        end: t,
        status: 'error',
        attributes: {
          [ATTR.EXCEPTION_TYPE]: err?.name ?? 'Error',
          [ATTR.EXCEPTION_MESSAGE]: String(err?.message ?? error).slice(0, 1024),
          [ATTR.EXCEPTION_GROUP]: fingerprint(err?.name ?? 'Error', String(err?.message ?? error)),
          ...(err?.stack ? { [ATTR.EXCEPTION_STACKTRACE]: err.stack.slice(0, 8000) } : {}),
          ...(attributes ?? {}),
        } satisfies Attributes,
      });
    },
    setUser: (id) => context.setUser(id),
    setAttributes: (a) => context.setAttributes(a),
    track: (name, properties) => analytics?.track(name, properties),
    traceId: () => context.traceId,
    flush: () => exporter.flush(),
  };
}
