# @cboxdk/telemetry-browser

**Deep browser RUM, correlated with your backend traces.** The frontend
companion to [`cboxdk/laravel-telemetry`](https://github.com/cboxdk/laravel-telemetry):
page load, Web Vitals, `fetch`/XHR, uncaught errors and SPA route changes —
shipped to your app's ingest endpoint and joined to the backend trace via
W3C `traceparent`. One trace id, one waterfall: **click → browser span →
request span → queries → jobs.**

- ~6 KB gzipped (Web Vitals included), zero config to get started.
- No `@opentelemetry/*` — a lean, tailored SDK that matches the ingest
  endpoint exactly and emits the **same dimensions as the backend**, so
  `cboxdk/laravel-telemetry-ui` cross-links frontend and backend out of
  the box.
- Best-effort by design: never throws into your app.

> **Status: alpha.** APIs may shift before 1.0.

## Install

```bash
npm i @cboxdk/telemetry-browser
```

```ts
import { init } from '@cboxdk/telemetry-browser';

const telemetry = init({
  endpoint: '/telemetry/spans',
  serviceName: 'my-app',
  environment: 'production',
  release: 'a1b2c3d',
  traceparent: document.querySelector('meta[name=traceparent]')?.content, // root on the server trace
  user: () => window.currentUser?.id,   // an id, never a name/email
});
```

Or drop the standalone build in a `<script>` — it auto-inits from its own
`data-*` (the exact contract the Laravel package's `@telemetryBrowser`
directive emits):

```html
<meta name="traceparent" content="00-...-...-01">
<script src="/telemetry/browser.js" defer
        data-endpoint="/telemetry/spans"
        data-service="my-app" data-environment="production"></script>
```

## The dimension contract

Every browser span carries these — **aligned with the backend** where they
overlap, so a browser span and the backend span it triggered filter by the
same keys. Exported as `ATTR` for the UI to align against.

| Dimension | Key | On |
|---|---|---|
| Service / env / release | `service.name`, `deployment.environment.name`, `service.version` | every span |
| User (id only) | `enduser.id` | every span |
| Session | `session.id` | every span |
| Browser marker | `browser` (`true`) | every span |
| URL | `url.path`, `url.full`, `http.url` | span-dependent |
| HTTP | `http.request.method`, `http.response.status_code` | fetch/XHR |
| Device / client | `user_agent.original`, `browser.language`, `browser.viewport`, `network.connection.type`, `device.memory_gb` | page load |
| Page timing | `browser.ttfb_ms`, `browser.fcp_ms`, `browser.dom_interactive_ms` | page load |
| Server-Timing | `server_timing.<name>.duration_ms`, `server_timing.<name>.description` | page load, fetch/XHR |
| Web Vitals | `web_vital.name`, `web_vital.value`, `web_vital.rating` | vital markers |
| Errors | `exception.type`, `exception.message`, `exception.file`, `exception.line`, `exception.column`, `exception.group`, `exception.stacktrace` | error spans |

Span names are a small bounded set (`SPAN`): `browser.page_load`,
`browser.route_change`, `browser.web_vital`, `exception`, plus
`fetch <METHOD>` / `xhr <METHOD>`.

## What it captures

- **Page load** — a `browser.page_load` span with navigation timing (TTFB,
  DOM interactive/complete, transfer size) + device dimensions.
- **Web Vitals** — LCP, CLS, INP, FCP, TTFB as marker spans with Google's
  good/needs-improvement/poor rating (via the tiny `web-vitals` lib).
- **fetch & XHR** — a client span per call, with `traceparent` propagated
  to **same-origin** requests so the backend continues the trace
  (cross-origin is left untouched to avoid CORS preflight).
- **Server-Timing** — the backend's `Server-Timing` metrics on the spans
  they describe (see below).
- **Errors** — uncaught errors and unhandled promise rejections as
  exception spans, matching the backend's `exception.*` keys.
- **SPA route changes** — `history` pushState/replaceState + popstate as
  `browser.route_change` spans.
- **Livewire `wire:navigate` and Inertia visits** — one `browser.navigation`
  span per soft navigation, and later requests join the new page's server
  trace (see below).

Toggle any of them via `instrument: { fetch: false, ... }`.

## Livewire & Inertia soft navigations

Detected automatically from the frameworks' own events; nothing to
configure. Once a framework is seen it owns navigation, and the generic
`history` handler stops recording, so a navigation is never counted twice
(the framework's own `pushState` would otherwise look like a second one).

| | Livewire 3 (`wire:navigate`) | Inertia v1 / v2 |
|---|---|---|
| Span starts | `livewire:navigate` | `inertia:start` |
| Span ends | `livewire:navigated` | `inertia:finish` |
| Back/forward | `livewire:navigate` with `history: true` | `inertia:navigate` without a visit |
| Ignored | a `livewire:navigate` another listener prevented | prefetches, `async` visits, partial reloads (`only`/`except`) of the current page |

Each `browser.navigation` span carries `browser.navigation.framework`,
`browser.navigation.outcome` (`completed`/`cancelled`/`interrupted`, or
`timeout` when no finish event came within 30 s, e.g. a failed Livewire fetch),
`browser.route.from`, `url.path`/`http.url` of the new page,
`browser.navigation.history`, `browser.navigation.cached`, and for Livewire
`browser.navigation.fetch_ms` (time until the page HTML was in hand; the
rest is the swap). An analytics page view is emitted once per completed
navigation that changed the path. The request that fetched the page is a
child of the navigation span.

**Which trace later requests join** (recorded as
`browser.navigation.trace_source`):

- **Livewire** (`meta`) — `wire:navigate` fetches the full page and swaps
  `<head>`, so the new page's `<meta name="traceparent">` (from
  `@telemetryTraceparent` / `@telemetryBrowser`) names the new page's
  server span. Later fetch/XHR spans parent to it, exactly as after a full
  page load.
- **Inertia** gets JSON, so there is no meta:
  - `traceresponse` — a W3C `traceresponse` header on the page response is
    adopted (trace and span id).
  - `navigation` — otherwise, later requests parent to the navigation span
    itself, in the same trace. The page request carried our `traceparent`,
    so a backend that continues incoming traces (laravel-telemetry's
    default) put its request span under that navigation too.
  - `none` — if the `X-Trace-Id` header (`traceIdHeader`; laravel-telemetry's
    `traces.response_header`) shows the server started a *different* trace,
    the SDK can't join it without a span id. The trace stays put and the
    server's id is recorded as `browser.navigation.server_trace_id`.
- Cached restores, cancelled/interrupted/failed visits never move the trace.

Limits:

- A page Livewire prefetched (`wire:navigate.hover`, or on mousedown) is
  fetched *before* `livewire:navigate`, so that fetch span is not under the
  navigation span. The new meta is still adopted.
- A Livewire cached back/forward restore leaves later requests on the trace
  you navigated away from, not the restored page's old one: that page's
  server span ended long ago.
- Web Vitals and the page-load span stay on the document's original trace;
  they describe the hard load.
- Inertia: which response fetched the page is matched by path plus the
  `X-Inertia` response header, and needs the `xhr` (axios) or `fetch`
  instrumentation enabled to read headers. Without either, later requests
  still parent to the navigation span.
- Put `@telemetryBrowser` (or your SDK `<script>`) in `<head>`. The
  standalone build initialises once per document, so if Livewire runs it
  again from `<body>` that second run is a no-op.

## Server-Timing

When the backend sends a `Server-Timing` header (laravel-telemetry can, opt
in), the SDK puts each metric on the span for that response:

```
Server-Timing: db;dur=12.3;desc="3 queries", app;dur=48.1
→ server_timing.db.duration_ms = 12.3
  server_timing.db.description = "3 queries"
  server_timing.app.duration_ms = 48.1
```

- **Page load**: read from the navigation entry
  (`performance.getEntriesByType('navigation')[0].serverTiming`).
- **fetch / XHR**: parsed from the response's own `Server-Timing` header,
  so it is exact even when the same URL is requested many times.
- Names are lowercased and sanitized to `[a-z][a-z0-9_]*` (`DB-Read` →
  `db_read`); at most 10 metrics per span; a repeated name keeps its first
  entry. A metric with no `dur` records `0`; `description` only when set.
- **Cross-origin** fetch/XHR: the browser hides the header unless the
  server sends `Access-Control-Expose-Headers: Server-Timing`. The SDK
  reads the header, not resource timing entries, so `Timing-Allow-Origin`
  is not needed. Same-origin needs nothing.
- Turn it off with `instrument: { serverTiming: false }`
  (`data-server-timing="0"`).

## Source maps (symbolication)

Minified stacks (`app-abc.js:1:2481`) group and read poorly, and the file
names shift every deploy. Upload your build's source maps **keyed by the
same `release`** you pass to `init({ release })`, and the backend resolves
each browser stack back to original source/line/column/name on read — so
frontend error grouping and detail get as good as the backend's.

Upload from CI (which *can* hold the secret — the browser never does):

```bash
npx telemetry-sourcemaps \
  --dir dist/assets --release "$GIT_SHA" \
  --endpoint https://app.example.com/telemetry/sourcemaps \
  --token "$TELEMETRY_SOURCEMAPS_TOKEN"
```

Or as a Vite plugin, so maps upload on every production build:

```ts
// vite.config.ts
import { telemetrySourcemaps } from '@cboxdk/telemetry-browser/sourcemaps';

export default defineConfig({
  plugins: [
    telemetrySourcemaps({
      endpoint: 'https://app.example.com/telemetry/sourcemaps',
      release: process.env.GIT_SHA,
      token: process.env.TELEMETRY_SOURCEMAPS_TOKEN,
    }),
  ],
});
```

The Laravel package enables the receiving endpoint with
`TELEMETRY_SOURCEMAPS=true` + `TELEMETRY_SOURCEMAPS_TOKEN` (token-gated,
secure by default) and symbolicates at read time via its `Symbolicator`
service — see the
[browser tracing guide](https://github.com/cboxdk/laravel-telemetry/blob/main/docs/production/browser-tracing.md#source-maps-symbolication).
The uploader is Node-only and never enters the browser bundle. Maps stay
private: they're resolved server-side on demand, never shipped to clients.

Until maps exist for a release, browser errors still group — by
`exception.group`, a **deploy-stable** fingerprint (`exception.type` + a
normalized message, since minified `file:line` moves every build). Source
maps make the *detail* readable; grouping works with or without them.

## Manual API

```ts
telemetry.record({ name: 'checkout.step', attributes: { step: 2 } });
telemetry.error(err, { 'order.id': id });
telemetry.setUser(user.id);          // after login
telemetry.setAttributes({ team: 'acme' });
telemetry.track('signup_completed', { plan: 'pro' }); // custom analytics event (needs analytics:true)
telemetry.traceId();                 // correlate your own logs
telemetry.flush();
```

## Configuration

| Option | Default | |
|---|---|---|
| `endpoint` | — | the ingest URL (required) |
| `serviceName` / `environment` / `release` | — | identity dimensions |
| `user` | — | id or `() => id` |
| `traceparent` | — | server trace to root on |
| `session` | — | server-provided `session.id` to share one visit key (set by `@telemetryBrowser` when analytics is on) |
| `attributes` | `{}` | extra global dimensions |
| `sampleRate` | `1` | head sampling, decided once per page |
| `analytics` | `false` | unsampled analytics channel: SPA page views, engagement, `track()` |
| `instrument` | all on | per-instrumentation toggles (`frameworks: false` turns off Livewire/Inertia handling, `serverTiming: false` stops reading `Server-Timing`) |
| `traceIdHeader` | `X-Trace-Id` | the backend's trace-id response header (`data-trace-header`); `''` ignores it |
| `maxSpans` | `128` | buffer cap before a forced flush |

Spans batch and ship with `sendBeacon` on `visibilitychange`/`pagehide`,
when the buffer fills, and on a 15 s heartbeat.

## Security

The SDK sends only what you configure + the dimensions above. The
**server** enforces the trust boundary (throttling, payload bounding,
sampling, optional auth) — see the Laravel package's
[browser tracing guide](https://github.com/cboxdk/laravel-telemetry/blob/main/docs/production/browser-tracing.md).
Provide a user **id**, never a name or email.

## License

MIT © Cbox
