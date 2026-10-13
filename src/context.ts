import { parseTraceparent, traceId as newTraceId, spanId as newSpanId } from './ids';
import { sessionId } from './session';
import { ATTR } from './semconv';
import type { Attributes, TelemetryConfig } from './types';

/** A trace + the span a new span parents to. */
export interface Scope {
  traceId: string;
  parentSpanId: string;
  /** The upstream sampling decision, carried on propagated traceparents. */
  sampled: boolean;
}

/**
 * The trace root + the dimensions stamped on spans. The endpoint stamps the
 * app resource (service.name, host) itself, so here we carry the browser's
 * view: the identity dims (light, on every span) and the device dims
 * (heavy, only on the page-load span).
 */
export class Context {
  /**
   * The ACTIVE page trace. It starts as the server-rendered page's trace and
   * moves when a soft navigation fetches a new server page (`rebase()`), so
   * later fetch/XHR spans parent to the page the user is actually on.
   */
  traceId: string;
  /** The span new browser spans parent to by default (the active page's server span). */
  rootSpanId: string;
  /** The server's sampling decision for the active trace (true when the browser started it). */
  sampled: boolean;
  /** The trace the document itself was loaded under — page-load + Web Vitals stay here. */
  readonly initial: Scope;
  /** The span id of the soft navigation in flight, if any (set by the navigation instrumentation). */
  navigationSpanId: string | undefined = undefined;
  /** The visit key — server-provided (data-session) or the per-tab default. */
  readonly session: string;

  private extra: Attributes;

  constructor(private readonly config: TelemetryConfig) {
    const server = parseTraceparent(config.traceparent);
    this.traceId = server?.traceId ?? newTraceId();
    this.rootSpanId = server?.spanId ?? newSpanId();
    this.sampled = server?.sampled ?? true;
    this.initial = { traceId: this.traceId, parentSpanId: this.rootSpanId, sampled: this.sampled };
    this.session = config.session || sessionId();
    this.extra = { ...(config.attributes ?? {}) };
  }

  /**
   * Where a span starting NOW belongs: the active trace, parented to the
   * in-flight soft navigation if there is one, else the active page root.
   * Capture it when work starts — a navigation may rebase before it ends.
   */
  scope(): Scope {
    return {
      traceId: this.traceId,
      parentSpanId: this.navigationSpanId ?? this.rootSpanId,
      sampled: this.sampled,
    };
  }

  /** Move the active page trace (a soft navigation landed on a new server page). */
  rebase(traceId: string, parentSpanId: string, sampled = this.sampled): void {
    this.traceId = traceId;
    this.rootSpanId = parentSpanId;
    this.sampled = sampled;
  }

  /** The current authenticated user id, if configured. */
  user(): string | undefined {
    const u = typeof this.config.user === 'function' ? this.config.user() : this.config.user;
    return u ?? undefined;
  }

  setUser(id: string | null): void {
    if (id) this.extra[ATTR.ENDUSER_ID] = id;
    else delete this.extra[ATTR.ENDUSER_ID];
  }

  setAttributes(attributes: Attributes): void {
    Object.assign(this.extra, attributes);
  }

  /** Light dimensions stamped on EVERY span so any span filters by them. */
  dimensions(): Attributes {
    const dims: Attributes = {
      [ATTR.BROWSER]: true,
      // A server-provided session id (the Laravel package's analytics
      // keystone, propagated via data-session) wins, so browser and server
      // spans share ONE visit key; otherwise the per-tab default.
      [ATTR.SESSION_ID]: this.config.session || sessionId(),
      [ATTR.URL_PATH]: location.pathname,
      ...this.extra,
    };
    if (this.config.serviceName) dims[ATTR.SERVICE_NAME] = this.config.serviceName;
    if (this.config.environment) dims[ATTR.DEPLOYMENT_ENVIRONMENT] = this.config.environment;
    if (this.config.release) dims[ATTR.SERVICE_VERSION] = this.config.release;

    const user = typeof this.config.user === 'function' ? this.config.user() : this.config.user;
    if (user) dims[ATTR.ENDUSER_ID] = user;

    return dims;
  }

  /** Heavy device/browser dimensions — only worth it on the page span. */
  device(): Attributes {
    const nav = navigator as Navigator & { connection?: { effectiveType?: string }; deviceMemory?: number };
    const dims: Attributes = {
      [ATTR.USER_AGENT]: nav.userAgent,
      [ATTR.BROWSER_LANGUAGE]: nav.language,
      [ATTR.BROWSER_VIEWPORT]: `${window.innerWidth}x${window.innerHeight}`,
      [ATTR.SCREEN]: `${window.screen?.width ?? 0}x${window.screen?.height ?? 0}`,
      [ATTR.DEVICE_PIXEL_RATIO]: window.devicePixelRatio ?? 1,
      [ATTR.URL_FULL]: location.href,
    };
    if (nav.connection?.effectiveType) dims[ATTR.NETWORK_CONNECTION_TYPE] = nav.connection.effectiveType;
    if (typeof nav.deviceMemory === 'number') dims[ATTR.DEVICE_MEMORY_GB] = nav.deviceMemory;
    return dims;
  }
}
