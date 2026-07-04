import { Context } from './context';
import { Exporter } from './exporter';
import { spanId as newSpanId } from './ids';
import type { Attributes, SpanKind, SpanStatus, WireSpan } from './types';

/**
 * Turns instrumentation callbacks into wire spans: stamps the global
 * dimensions, fills ids/parenting, and hands them to the exporter. Every
 * browser span shares one trace id (rooted on the server trace when the
 * page carried a traceparent), so backend + browser join in one waterfall.
 */
export class Tracer {
  constructor(
    readonly context: Context,
    private readonly exporter: Exporter,
  ) {}

  /** Record a completed span. */
  record(opts: {
    name: string;
    kind?: SpanKind;
    start: number;
    end: number;
    attributes?: Attributes;
    parentSpanId?: string;
    status?: SpanStatus;
    spanId?: string;
  }): WireSpan {
    const span: WireSpan = {
      traceId: this.context.traceId,
      spanId: opts.spanId ?? newSpanId(),
      parentSpanId: opts.parentSpanId ?? this.context.rootSpanId,
      name: opts.name,
      kind: opts.kind ?? 'internal',
      start: Math.round(opts.start),
      end: Math.round(Math.max(opts.start, opts.end)),
      attributes: { ...this.context.dimensions(), ...(opts.attributes ?? {}) },
      status: opts.status ?? 'ok',
    };
    this.exporter.record(span);
    return span;
  }

  /**
   * Start a span now and get a finisher — for timing in-flight work
   * (fetch, XHR). The returned id can be propagated as the parent.
   */
  start(name: string, kind: SpanKind = 'internal'): {
    id: string;
    end(status?: SpanStatus, attributes?: Attributes): void;
  } {
    const id = newSpanId();
    const start = now();
    return {
      id,
      end: (status, attributes) =>
        this.record({ name, kind, start, end: now(), attributes, status, spanId: id }),
    };
  }
}

/** Epoch milliseconds with sub-ms precision when available. */
export function now(): number {
  return performance.timeOrigin + performance.now();
}
