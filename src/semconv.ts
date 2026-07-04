/**
 * The attribute contract — the dimensions every browser span carries.
 *
 * These mirror the backend (`cboxdk/laravel-telemetry`) semantic
 * conventions where they overlap (service, deployment, enduser, http,
 * session), so a browser span and the backend span it triggered filter by
 * the SAME keys. `browser.*`, `device.*` and `web_vital.*` are the
 * frontend-specific dimensions. `cboxdk/laravel-telemetry-ui` reads these
 * to render and cross-link the frontend.
 */
export const ATTR = {
  // Resource / identity — aligned with the backend so the UI joins them.
  SERVICE_NAME: 'service.name',
  SERVICE_VERSION: 'service.version',
  DEPLOYMENT_ENVIRONMENT: 'deployment.environment.name',
  ENDUSER_ID: 'enduser.id',
  SESSION_ID: 'session.id',

  // HTTP — same keys the backend uses on its request spans.
  HTTP_URL: 'http.url',
  HTTP_METHOD: 'http.request.method',
  HTTP_STATUS: 'http.response.status_code',
  HTTP_ROUTE: 'http.route',

  // The marker that says "this span was produced in the browser".
  BROWSER: 'browser',
  BROWSER_LANGUAGE: 'browser.language',
  BROWSER_VIEWPORT: 'browser.viewport',
  USER_AGENT: 'user_agent.original',
  NETWORK_CONNECTION_TYPE: 'network.connection.type',
  DEVICE_MEMORY_GB: 'device.memory_gb',
  URL_PATH: 'url.path',
  URL_FULL: 'url.full',

  // Page-load timing (on the browser.page_load span).
  PAGE_TTFB_MS: 'browser.ttfb_ms',
  PAGE_FCP_MS: 'browser.fcp_ms',
  PAGE_DOM_INTERACTIVE_MS: 'browser.dom_interactive_ms',
  PAGE_DOM_COMPLETE_MS: 'browser.dom_complete_ms',
  PAGE_TRANSFER_BYTES: 'browser.transfer_bytes',
  PAGE_NAV_TYPE: 'browser.navigation_type',

  // Web Vitals (on browser.web_vital marker spans).
  WEB_VITAL_NAME: 'web_vital.name',
  WEB_VITAL_VALUE: 'web_vital.value',
  WEB_VITAL_RATING: 'web_vital.rating',

  // Errors.
  EXCEPTION_TYPE: 'exception.type',
  EXCEPTION_MESSAGE: 'exception.message',
  EXCEPTION_FILE: 'exception.file',
  EXCEPTION_LINE: 'exception.line',
  EXCEPTION_COLUMN: 'exception.column',
  EXCEPTION_GROUP: 'exception.group',
  EXCEPTION_STACKTRACE: 'exception.stacktrace',
} as const;

/** Span names the SDK produces — a small, bounded, queryable set. */
export const SPAN = {
  PAGE_LOAD: 'browser.page_load',
  ROUTE_CHANGE: 'browser.route_change',
  WEB_VITAL: 'browser.web_vital',
  RESOURCE: 'browser.resource',
  EXCEPTION: 'exception',
} as const;
