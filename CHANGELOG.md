# Changelog

All notable changes to `@cboxdk/telemetry-browser` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/cboxdk/telemetry-browser/compare/v0.1.0-alpha.1...HEAD
[0.1.0-alpha.1]: https://github.com/cboxdk/telemetry-browser/releases/tag/v0.1.0-alpha.1
