# Agent guide — cboxdk/telemetry-browser

The browser RUM SDK for `cboxdk/laravel-telemetry`. TypeScript, zero heavy
deps (only `web-vitals`), built with tsup, tested with vitest (jsdom).

## Commands

```bash
npm run check   # typecheck + test + build — run before every commit
npm test
npm run build   # dist: ESM + CJS + .d.ts + IIFE (window.Telemetry)
```

## Invariants

1. **Never throw into the app.** Every instrumentation is guarded; a
   failure drops the span, it never surfaces.
2. **Dimensions align with the backend.** `src/semconv.ts` is the shared
   contract — mirror `cboxdk/laravel-telemetry`'s keys where they overlap
   (service/deployment/enduser/http/session). `telemetry-ui` reads these.
3. **Wire format matches the ingest endpoint** (`{spans:[{traceId,spanId,
   parentSpanId,name,kind,start,end,attributes,status}]}`, ms timestamps).
4. **traceparent only propagates same-origin** — never trip CORS preflight.
5. **Best-effort transport** — sendBeacon (string body = simple request),
   fetch keepalive fallback, batched, flushed on the way out.
6. Keep the bundle small. No `@opentelemetry/*`.
