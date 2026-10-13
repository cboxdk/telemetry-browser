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

  // Analytics (on analytics.* events — the server stamps the routing markers).
  REFERRER: 'http.request.header.referer', // aligned with the server page_view
  DEVICE_PIXEL_RATIO: 'browser.dpr',
  SCREEN: 'browser.screen',
  ENGAGEMENT_VISIBLE_MS: 'engagement.visible_ms',
  ENGAGEMENT_SCROLL_DEPTH: 'engagement.scroll_depth',
  ROUTE_FROM: 'browser.route.from',

  // Framework soft navigations (on browser.navigation spans).
  NAVIGATION_FRAMEWORK: 'browser.navigation.framework', // livewire | inertia
  NAVIGATION_OUTCOME: 'browser.navigation.outcome', // completed | cancelled | interrupted | timeout
  NAVIGATION_HISTORY: 'browser.navigation.history', // back/forward, not a link click
  NAVIGATION_CACHED: 'browser.navigation.cached', // restored from the framework's cache, no server request
  NAVIGATION_FETCH_MS: 'browser.navigation.fetch_ms', // Livewire: start → page HTML in hand (rest is swap)
  // Where later spans parent after this navigation: meta | traceresponse | trace_id_header | none.
  NAVIGATION_TRACE_SOURCE: 'browser.navigation.trace_source',
  // The server's trace id for the navigation request, when it is NOT this trace (not adopted).
  NAVIGATION_SERVER_TRACE_ID: 'browser.navigation.server_trace_id',

  // Server-Timing (on browser.page_load and fetch/XHR spans). A prefix:
  // `server_timing.<name>.duration_ms` and `server_timing.<name>.description`,
  // <name> sanitized to [a-z][a-z0-9_]*.
  SERVER_TIMING: 'server_timing',
} as const;

/** Span names the SDK produces — a small, bounded, queryable set. */
export const SPAN = {
  PAGE_LOAD: 'browser.page_load',
  ROUTE_CHANGE: 'browser.route_change',
  NAVIGATION: 'browser.navigation',
  WEB_VITAL: 'browser.web_vital',
  RESOURCE: 'browser.resource',
  EXCEPTION: 'exception',
} as const;

/** Analytics event names the SDK produces (server prefixes them `analytics.`). */
export const EVENT = {
  PAGE_VIEW: 'page_view',
  ENGAGEMENT: 'engagement',
} as const;
