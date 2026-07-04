import { parseTraceparent, traceId as newTraceId, spanId as newSpanId } from './ids';
import { sessionId } from './session';
import { ATTR } from './semconv';
import type { Attributes, TelemetryConfig } from './types';

/**
 * The trace root + the dimensions stamped on spans. The endpoint stamps the
 * app resource (service.name, host) itself, so here we carry the browser's
 * view: the identity dims (light, on every span) and the device dims
 * (heavy, only on the page-load span).
 */
export class Context {
  readonly traceId: string;
  readonly rootSpanId: string;

  private extra: Attributes;

  constructor(private readonly config: TelemetryConfig) {
    const server = parseTraceparent(config.traceparent);
    this.traceId = server?.traceId ?? newTraceId();
    this.rootSpanId = server?.spanId ?? newSpanId();
    this.extra = { ...(config.attributes ?? {}) };
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
      [ATTR.URL_FULL]: location.href,
    };
    if (nav.connection?.effectiveType) dims[ATTR.NETWORK_CONNECTION_TYPE] = nav.connection.effectiveType;
    if (typeof nav.deviceMemory === 'number') dims[ATTR.DEVICE_MEMORY_GB] = nav.deviceMemory;
    return dims;
  }
}
