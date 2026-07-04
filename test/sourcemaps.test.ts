import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uploadSourcemaps } from '../src/sourcemaps';

describe('uploadSourcemaps', () => {
  let dir: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tel-'));
    await mkdir(join(dir, 'assets'), { recursive: true });
    await writeFile(join(dir, 'assets', 'app-abc123.js.map'), '{"version":3,"sources":["a.ts"]}');
    await writeFile(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)'); // not a map
    fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  });

  it('posts only .map files, keyed by release + relative name', async () => {
    const res = await uploadSourcemaps({ dir, endpoint: 'https://app.test/telemetry/sourcemaps', release: 'v9', token: 'secret' });

    expect(res.uploaded).toEqual(['assets/app-abc123.js.map']);
    expect(res.failed).toEqual([]);
    expect(fetchMock).toHaveBeenCalledOnce();

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer secret' });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.release).toBe('v9');
    expect(body.name).toBe('assets/app-abc123.js.map');
    expect(body.map).toContain('"version":3');
  });

  it('reports failures without throwing', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    const res = await uploadSourcemaps({ dir, endpoint: 'https://x', release: 'v1' });
    expect(res.failed).toEqual(['assets/app-abc123.js.map']);
  });
});
