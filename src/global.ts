import { init } from './index';

export * from './index';

/**
 * Standalone build: auto-initializes from its own <script data-*> tag (the
 * same contract the Laravel package's @telemetryBrowser directive emits),
 * and also exposes window.Telemetry.init for manual configuration.
 */
(function () {
  if (typeof document === 'undefined') return;
  const script = document.currentScript as HTMLScriptElement | null;
  const endpoint = script?.dataset.endpoint;
  if (!endpoint) return;

  // Once per document: Livewire's wire:navigate re-runs <body> scripts on
  // every soft navigation, and a second init would double-wrap fetch/XHR.
  const w = window as unknown as { __cboxTelemetryInit?: boolean };
  if (w.__cboxTelemetryInit) return;
  w.__cboxTelemetryInit = true;

  const meta = document.querySelector('meta[name=traceparent]')?.getAttribute('content') ?? undefined;
  const d = script!.dataset;

  init({
    endpoint,
    traceparent: meta,
    session: d.session,
    serviceName: d.service,
    environment: d.environment,
    release: d.release,
    user: d.user,
    traceIdHeader: d.traceHeader,
    sampleRate: d.sample ? parseFloat(d.sample) : undefined,
    analytics: d.analytics === '1',
    debug: d.debug === '1',
    instrument: {
      fetch: d.fetch !== '0',
      xhr: d.xhr !== '0',
      errors: d.errors !== '0',
      navigation: d.navigation !== '0',
      frameworks: d.frameworks !== '0',
      webVitals: d.vitals !== '0',
      serverTiming: d.serverTiming !== '0',
    },
  });
})();
