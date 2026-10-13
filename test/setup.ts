import { beforeEach } from 'vitest';

// init() is once per page; each test starts on a fresh "page".
beforeEach(() => {
  const w = window as unknown as Record<string, unknown>;
  delete w.__cboxTelemetry;
  delete w.TelemetryQueue;
});
