import type { Context } from './context';
import type { Exporter } from './exporter';
import { ATTR, EVENT } from './semconv';
import { now } from './tracer';
import type { Attributes } from './types';

/**
 * The unsampled analytics channel: SPA page views, engagement (visible time
 * + scroll depth) and custom `track()` events. Each is emitted as an event
 * (an OTLP log record server-side), so it is never sampled away — a page
 * view or conversion must never be undercounted. Every event carries the
 * shared `session.id` and the current `trace_id`, so an analytics row always
 * bridges back to its (maybe sampled) waterfall.
 */
export class Analytics {
  private visibleMs = 0;
  private lastVisible = 0;
  private maxScroll = 0;

  constructor(
    private readonly context: Context,
    private readonly exporter: Exporter,
  ) {
    this.lastVisible = document.visibilityState === 'visible' ? now() : 0;

    addEventListener('scroll', () => this.sampleScroll(), { passive: true });

    addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.pauseVisible();
      else this.lastVisible = now();
    });

    // Engagement is the whole-visit summary — emit it as the page unloads.
    addEventListener('pagehide', () => this.flushEngagement());
  }

  /** Emit a page-view event (SPA navigation, or an explicit one). */
  pageView(from?: string): void {
    const attributes: Attributes = {
      [ATTR.URL_PATH]: location.pathname,
      // The full landing URL (with its query) so the server can derive
      // campaign attribution (analytics.utm.* / analytics.click_id) — the
      // query lives client-side, this ingest request's own URL is not it.
      [ATTR.URL_FULL]: location.href,
    };
    if (document.referrer) attributes[ATTR.REFERRER] = document.referrer;
    if (from) attributes[ATTR.ROUTE_FROM] = from;
    this.emit(EVENT.PAGE_VIEW, attributes);
  }

  /** Emit a custom analytics event (a conversion / goal). */
  track(name: string, properties: Attributes = {}): void {
    this.emit(name, properties);
  }

  private emit(name: string, attributes: Attributes): void {
    const clean: Attributes = {};
    for (const k in attributes) {
      const v = attributes[k];
      if (v !== undefined && v !== null) clean[k] = v;
    }

    this.exporter.recordEvent({
      name,
      time: Date.now(),
      sessionId: this.context.session,
      traceId: this.context.traceId,
      attributes: clean,
    });
  }

  private sampleScroll(): void {
    const el = document.documentElement;
    const height = el.scrollHeight || 1;
    const depth = (el.scrollTop + el.clientHeight) / height;
    this.maxScroll = Math.max(this.maxScroll, Math.min(1, depth));
  }

  private pauseVisible(): void {
    if (this.lastVisible) {
      this.visibleMs += now() - this.lastVisible;
      this.lastVisible = 0;
    }
  }

  private flushEngagement(): void {
    this.pauseVisible();
    this.emit(EVENT.ENGAGEMENT, {
      [ATTR.URL_PATH]: location.pathname,
      [ATTR.ENGAGEMENT_VISIBLE_MS]: Math.round(this.visibleMs),
      [ATTR.ENGAGEMENT_SCROLL_DEPTH]: Math.round(this.maxScroll * 100) / 100,
    });
  }
}
