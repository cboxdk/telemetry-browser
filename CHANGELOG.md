# Changelog

All notable changes to `@cboxdk/telemetry-browser` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **The standalone build's handle is reachable.** The `<script>` build
  started itself from its `data-*` attributes but kept the handle, so a page
  could not call `setUser`, `track` or `error`. It is now
  `window.Telemetry.client`. Code that may run before the script loads pushes
  callbacks onto `window.TelemetryQueue`
  (`(window.TelemetryQueue = window.TelemetryQueue || []).push((t) => t.setUser('42'))`).
  They run in order once the SDK has started, and a later `push()` runs at
  once. A manual `window.Telemetry.init()` does the same.
- **`data-user-id`** sets the user id from the script tag (`data-user` still
  works). `ATTR.USER_ID` is exported.

### Changed

- **`init()` runs once per page.** A second call returns the first handle and
  ignores its config (`debug: true` logs a warning) instead of building a
  second tracer and adding a second set of error, history and navigation
  listeners. This also covers the npm build and the script tag on the same
  page. A sampled-out page stays sampled out.
- **The user id is `user.id`, not `enduser.id`.** laravel-telemetry stamps
  `user.id` on its request spans and telemetry-ui's user dimension reads
  `user.id`, so browser spans were missing from per-user views. (Both keys
  are valid OTel attributes today; `user.id` is the one the backend uses.)
  `ATTR.ENDUSER_ID` is deprecated and is now an alias of `user.id`.
  **Upgrade note:** queries or dashboards that filter browser spans on
  `enduser.id` must use `user.id`.

The standalone build is ~9.5 KB gzipped (+0.2 KB).

## [0.3.0] - 2026-10-13

### Added

- **Server-Timing on spans.** The backend's `Server-Timing` metrics (which
  laravel-telemetry can send, opt in) become
  `server_timing.<name>.duration_ms` and `server_timing.<name>.description`
  attributes: on `browser.page_load` from the navigation entry, and on
  fetch/XHR spans from the response header itself. Names are sanitized to
  `[a-z][a-z0-9_]*`, at most 10 metrics per span. Cross-origin responses
  need `Access-Control-Expose-Headers: Server-Timing`. Turn it off with
  `instrument.serverTiming: false` (`data-server-timing="0"`). Adds about
  0.7 KB gzipped to the standalone build.

- **Livewire 3/4 `wire:navigate` and Inertia v1/v2/v3 soft navigations.**
  Each one becomes a single `browser.navigation` span, from
  `livewire:navigate` to `livewire:navigated` or from `inertia:start` to
  `inertia:finish`. It records the framework, outcome, the previous path and
  back/forward/cached flags. A page request that starts during the
  navigation is its child; Livewire link clicks fetch on mousedown, before
  the navigation starts, so theirs usually isn't. Once a framework actually
  navigates, the generic `history` handler stops recording, so a navigation
  isn't counted twice (spans or analytics page views). Turn it off with
  `instrument.frameworks: false`. Adds about 1.8 KB gzipped to the
  standalone build (now ~9.5 KB in total).
- **Later requests join the new page's trace.** After a Livewire navigation
  the SDK adopts the swapped-in `<meta name="traceparent">`. After an Inertia
  visit it adopts a `traceresponse` header if there is one; otherwise later
  requests parent to the navigation span. If `X-Trace-Id` shows the server
  started a different trace, the trace stays as it is and the server's id is
  recorded. A server span whose sampled flag is `00` is never adopted. New
  `traceIdHeader` option (`data-trace-header`).

### Changed

- fetch/XHR spans keep the trace and parent they started under, even if a
  navigation moves the active trace before they finish.
- Page-load and Web Vitals spans always stay on the document's original
  trace.
- The standalone build initialises once per document. A second run of the
  script (for example from Livewire re-running `<body>` scripts) does
  nothing. A second ESM `init()` no longer wraps fetch/XHR again.
- `telemetry.traceId()` now follows soft navigations: it returns the trace
  later requests join, not always the document's original one.
- Propagated `traceparent` headers carry the server's sampling flag (from
  the page's traceparent) instead of always `01`.

### Fixed

- `parseTraceparent` rejects all-zero trace and span ids, which W3C defines
  as invalid.
- `Server-Timing` parsing ignores durations with trailing junk (`dur=12abc`)
  or a minus sign, and skips headers longer than 4096 characters.

### Security

- **traceparent no longer leaks to other origins.** The same-origin check
  was a string prefix, so `//other.example/x` and
  `https://app.example.com.evil.example/` (for an app on
  `https://app.example.com`) got the header. It now compares the resolved
  origin exactly. Relative paths without a leading slash (`api/x`) now
  count as same-origin, which they are.

## [0.2.0] - 2026-07-07

First **stable** release — graduates the SDK out of the `0.1.0-alpha` line; the
API is now considered stable under SemVer and publishes to the npm `latest` tag.
No functional change since `0.1.0-alpha.6` (which added `url.full` on analytics
events so the server can parse UTM campaign tags and ad click-ids).

## [0.1.0-alpha.6] - 2026-07-07

### Added

- **Analytics page views now send `url.full`** (`location.href`) alongside
  `url.path`, so the server can parse UTM campaign tags (`utm_*`) and ad
  click-ids from the landing URL. Pairs with `cboxdk/laravel-telemetry` 0.3.0's
  `telemetry.analytics.utm` capture — no query string is stored on the path.

## [0.1.0-alpha.5] - 2026-07-04

### Added

- **Unsampled analytics channel** (`analytics: true`, or `data-analytics="1"`
  from `@telemetryBrowser`). Emits *events* — never sampled away — to the
  ingest endpoint's `events` key:
  - **SPA page views** on `history` navigations (the server never sees them),
    with `document.referrer` and the previous path.
  - **Engagement** — visible time + scroll depth, summarised on page hide.
  - **`track(name, properties)`** for custom conversions/goals.
  - Screen size + `devicePixelRatio` device dimensions.

## [0.1.0-alpha.4] - 2026-07-04

### Added

- **Shared `session.id` (analytics keystone).** A new `session` config
  option (and `data-session` on the standalone `<script>`) lets the server
  provide the visit's `session.id`; when set it overrides the SDK's own
  per-tab id, so browser and server spans share ONE visit key. The Laravel
  package's `@telemetryBrowser` directive emits it automatically when
  `telemetry.analytics` is on.

## [0.1.0-alpha.3] - 2026-07-04

### Added

- **Source map uploader** (`@cboxdk/telemetry-browser/sourcemaps` + the
  `telemetry-sourcemaps` CLI): ships your build's `*.map` files to the
  app's upload endpoint keyed by release, so the backend can symbolicate
  minified browser stacks back to the original source. Node-only — never
  in the browser bundle. Ships as a Vite plugin (`telemetrySourcemaps`)
  and a CLI for other build pipelines.

## [0.1.0-alpha.2] - 2026-07-04

### Added

- **`exception.group` fingerprint** on error spans — matching the backend
  so telemetry-ui groups frontend and backend errors uniformly (no more
  self-grouping in the UI). Since minified file names/line numbers shift
  every deploy, the browser groups on `type` + a NORMALIZED message
  (digits/uuids/urls/quoted strings masked), which is deploy-stable.
  `exception.column` is captured too. The raw stack/file/line/column +
  release are emitted so a future source-map symbolication step can
  re-group on the original throw site. `fingerprint`/`normalizeMessage`
  are exported for the UI to reuse the exact algorithm.

## [0.1.0-alpha.1] - 2026-07-04

First release — the deep browser RUM SDK for `cboxdk/laravel-telemetry`.

### Added

- Core SDK: `init(config)` returning a manual handle (`record`, `error`,
  `setUser`, `setAttributes`, `traceId`, `flush`). Roots on the server's
  W3C `traceparent`, stamps backend-aligned dimensions, batches with
  `sendBeacon`.
- Auto-instrumentations (all on by default, individually toggleable):
  page load (navigation timing), Web Vitals (LCP/CLS/INP/FCP/TTFB via
  `web-vitals`), `fetch` and XHR (with same-origin `traceparent`
  propagation), uncaught errors + unhandled rejections, SPA route changes.
- A shared `ATTR`/`SPAN` contract exported for `cboxdk/laravel-telemetry-ui`
  to align against.
- Builds: ESM, CJS, `.d.ts`, and a standalone IIFE (~6 KB gzipped) that
  auto-inits from its `<script data-*>` tag — the contract the Laravel
  package's `@telemetryBrowser` directive emits.

[Unreleased]: https://github.com/cboxdk/telemetry-browser/compare/v0.1.0-alpha.3...HEAD
[0.1.0-alpha.3]: https://github.com/cboxdk/telemetry-browser/compare/v0.1.0-alpha.2...v0.1.0-alpha.3
[0.1.0-alpha.2]: https://github.com/cboxdk/telemetry-browser/compare/v0.1.0-alpha.1...v0.1.0-alpha.2
[0.1.0-alpha.1]: https://github.com/cboxdk/telemetry-browser/releases/tag/v0.1.0-alpha.1
