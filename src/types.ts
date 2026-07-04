export type AttrValue = string | number | boolean;

export type Attributes = Record<string, AttrValue>;

export type SpanKind = 'internal' | 'client' | 'server' | 'producer' | 'consumer';

export type SpanStatus = 'ok' | 'error';

/** The wire shape the ingest endpoint (`POST {endpoint}`) accepts. */
export interface WireSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: SpanKind;
  /** epoch milliseconds */
  start: number;
  /** epoch milliseconds */
  end: number;
  attributes: Attributes;
  status: SpanStatus;
}

/**
 * An unsampled analytics event (page view, engagement, custom track). The
 * server re-emits it as an OTLP log record with the analytics routing
 * markers — never subject to trace sampling.
 */
export interface WireEvent {
  name: string;
  /** epoch milliseconds */
  time: number;
  sessionId?: string;
  traceId?: string;
  attributes: Attributes;
}

export interface InstrumentationConfig {
  documentLoad?: boolean;
  webVitals?: boolean;
  fetch?: boolean;
  xhr?: boolean;
  errors?: boolean;
  navigation?: boolean;
}

export interface TelemetryConfig {
  /** Where spans are POSTed — the app's ingest endpoint, e.g. "/telemetry/spans". */
  endpoint: string;

  /** Identity dimensions — align these with your backend for clean joins. */
  serviceName?: string;
  environment?: string;
  release?: string;

  /**
   * The authenticated user id (or a getter, re-read at span time). Never a
   * name/email — an id, like the backend's enduser.id.
   */
  user?: string | (() => string | undefined | null);

  /**
   * The server's W3C traceparent to root the browser trace on — usually
   * `<meta name="traceparent">`. When absent the SDK starts a fresh trace.
   */
  traceparent?: string;

  /**
   * A server-provided `session.id` (the Laravel package's analytics
   * keystone, propagated via `data-session`). When set, it overrides the
   * SDK's own per-tab session id so browser and server spans share one visit
   * key. When absent the SDK generates its own.
   */
  session?: string;

  /** Extra global dimensions stamped on every span (team, tenant, plan…). */
  attributes?: Attributes;

  /** Head sampling 0..1 — decided once per page, keeps whole traces. */
  sampleRate?: number;

  /** Toggle individual auto-instrumentations. All on by default. */
  instrument?: InstrumentationConfig;

  /**
   * Enable the unsampled analytics channel — SPA page-view events,
   * engagement (visible time + scroll depth) and the `track()` API, all
   * emitted as events (never sampled away). Off unless set; the Laravel
   * package's `@telemetryBrowser` turns it on (`data-analytics`) when
   * `telemetry.analytics` is enabled.
   */
  analytics?: boolean;

  /** Local buffer cap before a forced flush. */
  maxSpans?: number;

  /** console.debug the SDK's activity. */
  debug?: boolean;
}

/** The handle returned by init() for manual instrumentation. */
export interface Telemetry {
  /** Record a completed span (ids/timestamps filled if omitted). */
  record(span: Partial<WireSpan> & { name: string }): void;
  /** Record an error as an exception span. */
  error(error: unknown, attributes?: Attributes): void;
  /** Update the user id at runtime (after login). */
  setUser(id: string | null): void;
  /** Add/replace global dimensions. */
  setAttributes(attributes: Attributes): void;
  /**
   * Record a custom analytics event (a conversion/goal) — unsampled, on the
   * analytics event stream. No-op unless `analytics` is enabled.
   */
  track(name: string, properties?: Attributes): void;
  /** The active trace id, for correlating your own logs. */
  traceId(): string;
  /** Force a flush now. */
  flush(): void;
}
