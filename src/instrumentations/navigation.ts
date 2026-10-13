import { ATTR, SPAN } from '../semconv';
import { now } from '../tracer';
import type { Tracer } from '../tracer';

/**
 * Shared between the generic history handler and the framework handlers
 * (Livewire, Inertia): once a framework owns navigation, the generic
 * handler only keeps its bookkeeping so a soft navigation is never counted
 * twice (the framework's own pushState would otherwise look like one more).
 */
export interface NavigationState {
  owner?: 'livewire' | 'inertia';
}

/**
 * SPA route changes (history pushState/replaceState + popstate) as
 * route-change spans, timing each view. Turns a single-page app from one
 * page-load into a sequence of navigable "pages".
 */
export function instrumentNavigation(
  tracer: Tracer,
  onChange?: (to: string, from: string) => void,
  state: NavigationState = {},
): void {
  const history = window.history;
  let from = location.pathname;
  let enteredAt = now();

  const changed = () => {
    const to = location.pathname;
    if (to === from) return;
    const start = enteredAt;
    enteredAt = now();
    if (state.owner) {
      // The framework handler records this navigation (and its page view).
      from = to;
      return;
    }
    tracer.record({
      name: SPAN.ROUTE_CHANGE,
      kind: 'client',
      start,
      end: enteredAt,
      attributes: {
        [ATTR.URL_PATH]: to,
        'browser.route.from': from,
        [ATTR.HTTP_URL]: location.href,
      },
    });
    onChange?.(to, from);
    from = to;
  };

  const wrap = <K extends 'pushState' | 'replaceState'>(name: K) => {
    const original = history[name];
    history[name] = function (this: History, ...args: Parameters<History[K]>) {
      const result = (original as (...a: unknown[]) => unknown).apply(this, args);
      queueMicrotask(changed);
      return result;
    } as History[K];
  };

  wrap('pushState');
  wrap('replaceState');
  addEventListener('popstate', () => queueMicrotask(changed));
}
