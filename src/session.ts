import { hex } from './ids';

const KEY = 'cbox.telemetry.session';
const TIMEOUT_MS = 30 * 60 * 1000; // 30 min inactivity → new session

interface Stored {
  id: string;
  last: number;
}

/**
 * A stable per-visit session id (16 hex), refreshed after 30 min of
 * inactivity. Kept in sessionStorage so it doesn't outlive the tab; falls
 * back to an in-memory id when storage is unavailable (private mode).
 */
let memory: Stored | null = null;

export function sessionId(now: number = Date.now()): string {
  let stored: Stored | null = memory;

  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) stored = JSON.parse(raw) as Stored;
  } catch {
    /* storage blocked — use memory */
  }

  if (!stored || typeof stored.id !== 'string' || now - stored.last > TIMEOUT_MS) {
    stored = { id: hex(8), last: now };
  } else {
    stored.last = now;
  }

  memory = stored;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    /* ignore */
  }

  return stored.id;
}
