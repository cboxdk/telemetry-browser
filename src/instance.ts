import type { Telemetry } from './types';

/**
 * The page's one telemetry instance, kept on `window` rather than in module
 * state: the npm build and the standalone `<script>` build (or the same
 * script run twice by Livewire's `wire:navigate`) are separate module
 * instances on the same page, and only one of them may patch fetch/XHR,
 * history and the error listeners.
 *
 * `undefined` = not initialized; `null` = initialized but sampled out (the
 * head-sampling decision is made once per page, never re-rolled).
 */
type Slot = { __cboxTelemetry?: Telemetry | null };

export const current = (): Telemetry | null | undefined => (window as unknown as Slot).__cboxTelemetry;

export const remember = (t: Telemetry | null): void => {
  (window as unknown as Slot).__cboxTelemetry = t;
};
