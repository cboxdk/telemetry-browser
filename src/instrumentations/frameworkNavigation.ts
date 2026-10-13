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
  /** The Inertia visit as `inertia:start` gave it (v1 finishes with a copy). */
  visit?: Visit;
  timer?: ReturnType<typeof setTimeout>;
}

/** The fields of an Inertia visit we read (v1, v2 and v3 share them). */
type Visit = {
  url?: unknown;
  method?: string;
  prefetch?: boolean;
  async?: boolean;
  only?: unknown[];
  except?: unknown[];
  /** v3: props to reset — a partial reload like only/except. */
  reset?: unknown[];
  completed?: boolean;
  cancelled?: boolean;
  interrupted?: boolean;
};

/** A popstate this recent before an `inertia:navigate` makes it back/forward. */
const POPSTATE_WINDOW_MS = 1_000;

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
 * start event to its finish event; fetch/XHR started during it are its
 * children (Inertia's page request; Livewire's only when it isn't already
 * in flight from mousedown). Once a framework actually navigates it owns
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
    p.timer = setTimeout(() => finish(p, 'timeout'), NAVIGATION_TIMEOUT_MS);
    return p;
  };

  const drop = (p: Pending) => {
    if (pending !== p) return;
    clearTimeout(p.timer);
    pending = undefined;
    context.navigationSpanId = undefined;
  };

  /** Move the active trace to the page this navigation landed on. Returns the source used. */
  const follow = (p: Pending, attributes: Attributes): string => {
    // A server span is only adopted when the server SAMPLED it (flag 01):
    // an unsampled span is never exported, so children would hang off nothing.
    if (p.framework === 'livewire') {
      const meta = metaTraceparent();
      const parsed = meta !== lastMeta ? parseTraceparent(meta) : null;
      lastMeta = meta;
      if (parsed?.sampled) {
        context.rebase(parsed.traceId, parsed.spanId, true);
        return 'meta';
      }
    }

    const res = p.response;
    const traceresponse = parseTraceparent(res?.header('traceresponse'));
    if (traceresponse?.sampled) {
      context.rebase(traceresponse.traceId, traceresponse.spanId, true);
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

  // ---- Livewire 3 / 4 (wire:navigate) ---------------------------------
  // livewire:navigate (cancelable; detail {url, history, cached}) →
  // livewire:navigating → swap → livewire:navigated. navigated also fires
  // once on the initial page load (no navigation pending — ignored), and on
  // any Livewire page, used or not — so ownership is taken only by an actual
  // livewire:navigate. A link's page is fetched on mousedown, BEFORE
  // livewire:navigate (click release), so that fetch is usually not under
  // the navigation span, and fetch_ms is a lower bound.

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
    if (pending?.framework === 'livewire') finish(pending, 'completed');
  });

  // ---- Inertia v1 / v2 / v3 (router events on document as inertia:*) ---
  // inertia:start {visit} → request → inertia:navigate {page} →
  // inertia:success → inertia:finish {visit: completed|cancelled|interrupted}.
  // A cancelled or interrupted visit still fires finish with that flag; a
  // new start closes anything left open. Without a start: back/forward
  // restores and (v2/v3) clicks served from the prefetch cache fire only
  // inertia:navigate (v3 marks the latter `cached`).

  /** Visits that are data refreshes or background work, not navigations. */
  const ignored = (visit: Visit): boolean => {
    if (visit.prefetch || visit.async) return true;
    let to: URL;
    try {
      to = new URL(String(visit.url), location.href);
    } catch {
      return false;
    }
    if (to.pathname !== location.pathname) return false;
    // Partial reload (only/except, v3 reset) of the current page, or a
    // router.reload() — a GET to exactly the current URL.
    const partial = (visit.only?.length ?? 0) > 0 || (visit.except?.length ?? 0) > 0 || (visit.reset?.length ?? 0) > 0;
    const reload = String(visit.method ?? 'get').toLowerCase() === 'get' && to.search === location.search;
    return partial || reload;
  };

  /** v1 finishes with a COPY of the visit, so identity alone can't match. */
  const sameVisit = (a: Visit | undefined, b: Visit): boolean =>
    a === b ||
    (!!a &&
      pathOf(a.url) === pathOf(b.url) &&
      String(a.method ?? 'get').toLowerCase() === String(b.method ?? 'get').toLowerCase());

  document.addEventListener('inertia:start', (e: Event) => {
    state.owner = 'inertia';
    const visit = (e as CustomEvent<{ visit?: Visit } | undefined>).detail?.visit;
    if (!visit || ignored(visit)) return;
    const toPath = pathOf(visit.url);

    const attributes: Attributes = {};
    if (visit.method) attributes[ATTR.HTTP_METHOD] = String(visit.method).toUpperCase();
    begin('inertia', { toPath, fetches: true, attributes, visit });
  });

  const markFailed = () => {
    if (pending?.framework === 'inertia') pending.failed = true;
  };
  // v1/v2 name the failures exception/invalid; v3 httpException/networkError.
  for (const name of ['exception', 'invalid', 'httpException', 'networkError']) {
    document.addEventListener(`inertia:${name}`, markFailed);
  }

  document.addEventListener('inertia:finish', (e: Event) => {
    state.owner = 'inertia';
    const visit = (e as CustomEvent<{ visit?: Visit } | undefined>).detail?.visit;
    const p = pending;
    if (!p || p.framework !== 'inertia' || !visit || visit.prefetch || visit.async) return;
    if (!sameVisit(p.visit, visit)) return;
    finish(p, visit.cancelled ? 'cancelled' : visit.interrupted ? 'interrupted' : 'completed');
  });

  document.addEventListener('inertia:navigate', (e: Event) => {
    state.owner = 'inertia';
    if (pending?.framework === 'inertia') return; // the visit's finish records it
    if (location.pathname === lastPath) return; // the initial page, or same page

    // No request of ours: back/forward (restored from history state) if a
    // popstate just happened, else a click served from the prefetch cache.
    const history = poppedAt > 0 && now() - poppedAt < POPSTATE_WINDOW_MS;
    const cached = (e as CustomEvent<{ cached?: boolean } | undefined>).detail?.cached === true || !history;
    const p = begin(
      'inertia',
      { fetches: false, attributes: { [ATTR.NAVIGATION_HISTORY]: history, [ATTR.NAVIGATION_CACHED]: cached } },
      history ? poppedAt : now(),
    );
    poppedAt = 0;
    finish(p, 'completed');
  });
}
