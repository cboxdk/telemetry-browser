import type { Scope } from '../context';
import { parseTraceparent, spanId as newSpanId } from '../ids';
import { ATTR, SPAN } from '../semconv';
import { now } from '../tracer';
import type { ObservedResponse, Tracer } from '../tracer';
import type { Attributes } from '../types';
import type { NavigationState } from './navigation';

type Framework = 'livewire' | 'inertia';
type Outcome = 'completed' | 'cancelled' | 'interrupted' | 'timeout';

/** A navigation with no finish event by then is closed (Livewire fires none when its fetch fails). */
const NAVIGATION_TIMEOUT_MS = 30_000;

interface Pending {
  framework: Framework;
  id: string;
  start: number;
  /** Where the navigation span itself belongs — captured before it opened. */
  scope: Scope;
  fromPath: string;
  /** Destination path, to pick the response that fetched the new page. */
  toPath?: string;
  /** False when the framework restored the page without a server request. */
  fetches: boolean;
  attributes: Attributes;
  /** The response that fetched the new page, if the network instrumentation saw it. */
  response?: ObservedResponse;
  failed?: boolean;
  /** The Inertia visit object (stable across its start/finish events). */
  visit?: unknown;
}

const TRACE_ID = /^[0-9a-f]{32}$/;

const pathOf = (url: unknown): string | undefined => {
  try {
    return new URL(String(url), location.href).pathname;
  } catch {
    return undefined;
  }
};

const metaTraceparent = (): string | null =>
  document.querySelector('meta[name=traceparent]')?.getAttribute('content') ?? null;

/**
 * First-class soft navigations for Livewire (`wire:navigate`) and Inertia.
 *
 * Each navigation becomes ONE `browser.navigation` span from the framework's
 * start event to its finish event; fetch/XHR started during it (the page
 * request itself) are its children. Once a framework is seen it owns
 * navigation, and the generic history handler stops recording, so the
 * framework's own pushState is never counted twice.
 *
 * When the navigation lands on a new server page, the active trace moves so
 * later fetch/XHR spans parent to the page the user is now on:
 *
 * - **Livewire** fetches full HTML and swaps the `<head>`, so the new
 *   `<meta name="traceparent">` (from `@telemetryTraceparent` /
 *   `@telemetryBrowser`) carries the new page's server span — adopted.
 * - **Inertia** gets JSON, no meta. A `traceresponse` header on the page
 *   response is adopted when present. Otherwise later spans parent to the
 *   navigation span itself ("via navigation") — unless the server's
 *   `X-Trace-Id` shows it started a DIFFERENT trace, which can't be joined
 *   without its span id; then the trace stays put and the server's id is
 *   recorded on the navigation span.
 *
 * Restores from the framework's own cache/history make no server request,
 * so they record a span but never move the trace.
 */
export function instrumentFrameworkNavigation(
  tracer: Tracer,
  state: NavigationState,
  onPageView?: (to: string, from: string) => void,
  traceIdHeader = 'x-trace-id',
): void {
  const context = tracer.context;
  let pending: Pending | undefined;
  let lastMeta = metaTraceparent();
  let lastPath = location.pathname;
  let poppedAt = 0;

  if ((window as unknown as { Livewire?: unknown }).Livewire) state.owner = 'livewire';

  const begin = (framework: Framework, init: Omit<Pending, 'framework' | 'id' | 'start' | 'scope' | 'fromPath'>, start = now()) => {
    if (pending) finish(pending, 'interrupted');
    // The navigation's own parent is whatever was active before it opened.
    const scope = context.scope();
    // lastPath, not location: on back/forward the URL has already changed.
    pending = { framework, id: newSpanId(), start, scope, fromPath: lastPath, ...init };
    context.navigationSpanId = pending.id;
    const p = pending;
    // Without this, a failed Livewire fetch would leave every later span
    // parented to a navigation span that is never recorded.
    setTimeout(() => finish(p, 'timeout'), NAVIGATION_TIMEOUT_MS);
    return p;
  };

  const drop = (p: Pending) => {
    if (pending !== p) return;
    pending = undefined;
    context.navigationSpanId = undefined;
  };

  /** Move the active trace to the page this navigation landed on. Returns the source used. */
  const follow = (p: Pending, attributes: Attributes): string => {
    if (p.framework === 'livewire') {
      const meta = metaTraceparent();
      const parsed = meta !== lastMeta ? parseTraceparent(meta) : null;
      lastMeta = meta;
      if (parsed) {
        context.rebase(parsed.traceId, parsed.spanId);
        return 'meta';
      }
    }

    const res = p.response;
    const traceresponse = parseTraceparent(res?.header('traceresponse'));
    if (traceresponse) {
      context.rebase(traceresponse.traceId, traceresponse.spanId);
      return 'traceresponse';
    }

    const serverTrace = traceIdHeader ? res?.header(traceIdHeader)?.trim().toLowerCase() : undefined;
    if (serverTrace && TRACE_ID.test(serverTrace) && serverTrace !== p.scope.traceId) {
      // The server started its own trace; without its span id we can't
      // join it, so keep the current one and leave a pointer.
      attributes[ATTR.NAVIGATION_SERVER_TRACE_ID] = serverTrace;
      return 'none';
    }

    // Same trace (or no header to say otherwise): the page this navigation
    // produced is the navigation span — later requests hang off it.
    context.rebase(p.scope.traceId, p.id);
    return 'navigation';
  };

  const finish = (p: Pending, outcome: Outcome) => {
    if (pending !== p) return;
    drop(p);

    const attributes: Attributes = {
      [ATTR.NAVIGATION_FRAMEWORK]: p.framework,
      [ATTR.NAVIGATION_OUTCOME]: outcome,
      [ATTR.ROUTE_FROM]: p.fromPath,
      [ATTR.HTTP_URL]: location.href,
      ...p.attributes,
    };

    const landed = outcome === 'completed' && !p.failed;
    attributes[ATTR.NAVIGATION_TRACE_SOURCE] = landed && p.fetches ? follow(p, attributes) : 'none';

    tracer.record({
      name: SPAN.NAVIGATION,
      kind: 'client',
      spanId: p.id,
      traceId: p.scope.traceId,
      parentSpanId: p.scope.parentSpanId,
      start: p.start,
      end: now(),
      status: p.failed ? 'error' : 'ok',
      attributes,
    });

    if (landed && location.pathname !== p.fromPath) onPageView?.(location.pathname, p.fromPath);
    lastPath = location.pathname;
  };

  // The response that fetched the new page: same-origin, to the destination.
  tracer.onResponse((res) => {
    const p = pending;
    if (!p || !p.fetches) return;
    if (p.toPath && pathOf(res.url) !== p.toPath) return;
    if (p.framework === 'inertia' && !res.header('x-inertia')) return;
    p.response = res;
  });

  addEventListener('popstate', () => {
    poppedAt = now();
  });

  // ---- Livewire 3 (wire:navigate) -------------------------------------
  // livewire:navigate (cancelable; detail {url, history, cached}) →
  // livewire:navigating → swap → livewire:navigated. navigated also fires
  // once on the initial page load (no navigation pending — ignored).

  document.addEventListener('livewire:navigate', (e: Event) => {
    state.owner = 'livewire';
    const detail = (e as CustomEvent<{ url?: unknown; history?: boolean; cached?: boolean } | undefined>).detail ?? {};
    const cached = detail.cached === true;
    const p = begin('livewire', {
      toPath: pathOf(detail.url),
      fetches: !cached,
      attributes: {
        [ATTR.NAVIGATION_HISTORY]: detail.history === true,
        [ATTR.NAVIGATION_CACHED]: cached,
      },
    });
    // Cancelable: a listener after us may prevent it — then nothing follows.
    queueMicrotask(() => {
      if (e.defaultPrevented) drop(p);
    });
  });

  // The page HTML is in hand (fetched, prefetched or cached) — split the
  // request time from the swap/script time.
  document.addEventListener('livewire:navigating', () => {
    if (pending?.framework === 'livewire') {
      pending.attributes[ATTR.NAVIGATION_FETCH_MS] = Math.max(0, Math.round(now() - pending.start));
    }
  });

  document.addEventListener('livewire:navigated', () => {
    state.owner = 'livewire';
    if (pending?.framework === 'livewire') finish(pending, 'completed');
  });

  // ---- Inertia v1 / v2 (router events on document as inertia:*) --------
  // inertia:start {visit} → request → inertia:navigate {page} →
  // inertia:success → inertia:finish {visit: completed|cancelled|interrupted}.
  // History (back/forward) restores fire only inertia:navigate. v2 may not
  // fire finish for a cancelled visit — the next start interrupts it.

  type Visit = {
    url?: unknown;
    method?: string;
    prefetch?: boolean;
    async?: boolean;
    only?: unknown[];
    except?: unknown[];
    completed?: boolean;
    cancelled?: boolean;
    interrupted?: boolean;
  };

  document.addEventListener('inertia:start', (e: Event) => {
    state.owner = 'inertia';
    const visit = (e as CustomEvent<{ visit?: Visit } | undefined>).detail?.visit;
    if (!visit || visit.prefetch || visit.async) return;
    const toPath = pathOf(visit.url);
    // A partial reload of the current page is a data refresh, not a navigation.
    const partial = (visit.only?.length ?? 0) > 0 || (visit.except?.length ?? 0) > 0;
    if (partial && toPath === location.pathname) return;

    const attributes: Attributes = {};
    if (visit.method) attributes[ATTR.HTTP_METHOD] = String(visit.method).toUpperCase();
    begin('inertia', { toPath, fetches: true, attributes, visit });
  });

  const markFailed = () => {
    if (pending?.framework === 'inertia') pending.failed = true;
  };
  document.addEventListener('inertia:exception', markFailed);
  document.addEventListener('inertia:invalid', markFailed);

  document.addEventListener('inertia:finish', (e: Event) => {
    state.owner = 'inertia';
    const visit = (e as CustomEvent<{ visit?: Visit } | undefined>).detail?.visit;
    const p = pending;
    if (!p || p.framework !== 'inertia' || p.visit !== visit || !visit) return;
    finish(p, visit.cancelled ? 'cancelled' : visit.interrupted ? 'interrupted' : 'completed');
  });

  document.addEventListener('inertia:navigate', () => {
    state.owner = 'inertia';
    if (pending?.framework === 'inertia') return; // the visit's finish records it
    if (location.pathname === lastPath) return; // the initial page, or same page

    // Back/forward: Inertia restores the page from history state, no request.
    const start = poppedAt && now() - poppedAt < 10_000 ? poppedAt : now();
    const p = begin('inertia', { fetches: false, attributes: { [ATTR.NAVIGATION_HISTORY]: true } }, start);
    finish(p, 'completed');
  });
}
