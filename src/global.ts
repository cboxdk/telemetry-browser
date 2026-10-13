import { init as start } from './index';
import { current } from './instance';
import type { Telemetry, TelemetryConfig } from './types';

export * from './index';

/** A callback queued on `window.TelemetryQueue`, run with the live handle. */
export type TelemetryCallback = (telemetry: Telemetry) => void;

/**
 * The page's handle once telemetry is running (`window.Telemetry.client`),
 * whether the script tag's data-* or a manual `Telemetry.init()` started it.
 * Undefined before that, without a `data-endpoint`, or on a sampled-out page.
 */
export let client: Telemetry | undefined;

/**
 * `window.Telemetry.init` — same as the npm `init()`, and also publishes the
 * handle as `Telemetry.client` and runs the queued callbacks. Once per page.
 */
export function init(config: TelemetryConfig): Telemetry | undefined {
  const t = start(config);
  if (t) ready(t, config.debug);
  return t;
}

/**
 * Runs the callbacks the page pushed onto `window.TelemetryQueue` before
 * this script loaded, then swaps the array for one whose `push()` runs a
 * callback at once — so the same line works before and after load:
 *
 *   (window.TelemetryQueue = window.TelemetryQueue || []).push((t) => t.setUser('42'));
 */
function ready(t: Telemetry, debug?: boolean): void {
  client = t;
  const w = window as unknown as { TelemetryQueue?: unknown };
  const queued = w.TelemetryQueue;
  const run = (fn: unknown) => {
    try {
      if (typeof fn === 'function') (fn as TelemetryCallback)(t);
    } catch (e) {
      if (debug) console.debug('[telemetry] queued callback', e);
    }
  };
  w.TelemetryQueue = {
    push: (...fns: unknown[]) => {
      fns.forEach(run);
      return 0;
    },
  };
  if (Array.isArray(queued)) queued.forEach(run);
}

/**
 * Standalone build: auto-initializes from its own <script data-*> tag (the
 * same contract the Laravel package's @telemetryBrowser directive emits),
 * and also exposes window.Telemetry.init for manual configuration.
 */
(function () {
  if (typeof document === 'undefined') return;

  // Livewire's wire:navigate re-runs <body> scripts on every soft
  // navigation. The page is already instrumented: only re-publish the
  // handle on this (new) window.Telemetry.
  const existing = current();
  if (existing !== undefined) {
    if (existing) ready(existing);
    return;
  }

  const script = document.currentScript as HTMLScriptElement | null;
  const endpoint = script?.dataset.endpoint;
  if (!endpoint) return;

  const meta = document.querySelector('meta[name=traceparent]')?.getAttribute('content') ?? undefined;
  const d = script!.dataset;

  init({
    endpoint,
    traceparent: meta,
    session: d.session,
    serviceName: d.service,
    environment: d.environment,
    release: d.release,
    user: d.userId || d.user,
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
