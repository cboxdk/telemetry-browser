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

  const meta = document.querySelector('meta[name=traceparent]')?.getAttribute('content') ?? undefined;
  const d = script!.dataset;

  init({
    endpoint,
    traceparent: meta,
    serviceName: d.service,
    environment: d.environment,
    release: d.release,
    user: d.user,
    sampleRate: d.sample ? parseFloat(d.sample) : undefined,
    debug: d.debug === '1',
    instrument: {
      fetch: d.fetch !== '0',
      xhr: d.xhr !== '0',
      errors: d.errors !== '0',
      navigation: d.navigation !== '0',
      webVitals: d.vitals !== '0',
    },
  });
})();
