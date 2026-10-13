import { Context } from './context';
import { Exporter } from './exporter';
import { spanId as newSpanId } from './ids';
import type { Attributes, SpanKind, SpanStatus, WireSpan } from './types';

/**
 * A completed same-origin fetch/XHR, as seen by the network
 * instrumentations — the navigation instrumentation reads the server's
 * trace headers off the response that fetched a soft-navigation page.
 */
export interface ObservedResponse {
  url: string;
  spanId: string;
  traceId: string;
  /** A response header (case-insensitive), or null. Never throws. */
  header(name: string): string | null;
}

/**
 * Turns instrumentation callbacks into wire spans: stamps the global
 * dimensions, fills ids/parenting, and hands them to the exporter. Every
 * browser span shares one trace id (rooted on the server trace when the
 * page carried a traceparent), so backend + browser join in one waterfall.
 */
export class Tracer {
  private readonly observers: Array<(response: ObservedResponse) => void> = [];

  constructor(
    readonly context: Context,
    private readonly exporter: Exporter,
  ) {}

  /** Subscribe to completed same-origin fetch/XHR responses. */
  onResponse(observer: (response: ObservedResponse) => void): void {
    this.observers.push(observer);
  }

  /** Called by the network instrumentations; observer failures never surface. */
  observeResponse(response: ObservedResponse): void {
    for (const observer of this.observers) {
      try {
        observer(response);
      } catch {
        /* telemetry never throws into the app */
      }
    }
  }

  /** Record a completed span. */
  record(opts: {
    name: string;
    kind?: SpanKind;
    start: number;
    end: number;
    attributes?: Attributes;
    parentSpanId?: string;
    /** Defaults to the active trace; pass the one captured when the work started. */
    traceId?: string;
    status?: SpanStatus;
    spanId?: string;
  }): WireSpan {
    const scope = this.context.scope();
    const span: WireSpan = {
      traceId: opts.traceId ?? scope.traceId,
      spanId: opts.spanId ?? newSpanId(),
      parentSpanId: opts.parentSpanId ?? scope.parentSpanId,
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
    const scope = this.context.scope();
    return {
      id,
      end: (status, attributes) =>
        this.record({
          name,
          kind,
          start,
          end: now(),
          attributes,
          status,
          spanId: id,
          traceId: scope.traceId,
          parentSpanId: scope.parentSpanId,
        }),
    };
  }
}

/** Epoch milliseconds with sub-ms precision when available. */
export function now(): number {
  return performance.timeOrigin + performance.now();
}
