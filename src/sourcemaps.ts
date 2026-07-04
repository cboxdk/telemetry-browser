/**
 * Build-time source map uploader (Node only — never imported by the browser
 * bundle). Ships your build's *.map files to the app's upload endpoint,
 * keyed by release, so telemetry-ui can symbolicate minified frames back to
 * the original source. Use the Vite plugin or the CLI (bin: telemetry-sourcemaps).
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

export interface UploadOptions {
  /** Build output dir holding the .map files (e.g. 'public/build' or 'dist'). */
  dir: string;
  /** The app's upload endpoint, e.g. https://app.test/telemetry/sourcemaps */
  endpoint: string;
  /** Release id — MUST match the `release` the browser SDK reports (service.version). */
  release: string;
  /** Bearer token for the auth-gated endpoint. */
  token?: string;
  /** console.log progress. */
  verbose?: boolean;
}

export interface UploadResult {
  uploaded: string[];
  failed: string[];
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir)) {
    const full = join(dir, entry);
    if ((await stat(full)).isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

export async function uploadSourcemaps(opts: UploadOptions): Promise<UploadResult> {
  const files = (await walk(opts.dir)).filter((f) => f.endsWith('.map'));
  const uploaded: string[] = [];
  const failed: string[] = [];

  for (const file of files) {
    const name = relative(opts.dir, file).replace(/\\/g, '/');
    try {
      const res = await fetch(opts.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        },
        body: JSON.stringify({ release: opts.release, name, map: await readFile(file, 'utf8') }),
      });
      if (res.ok) {
        uploaded.push(name);
        if (opts.verbose) console.log(`[telemetry] uploaded ${name}`);
      } else {
        failed.push(name);
        if (opts.verbose) console.warn(`[telemetry] ${name} -> HTTP ${res.status}`);
      }
    } catch (e) {
      failed.push(name);
      if (opts.verbose) console.warn(`[telemetry] ${name} failed`, e);
    }
  }

  return { uploaded, failed };
}

/** A Vite plugin — uploads maps after the production build. */
export function telemetrySourcemaps(opts: Omit<UploadOptions, 'dir'> & { dir?: string }): {
  name: string;
  apply: 'build';
  closeBundle: () => Promise<void>;
} {
  return {
    name: 'cbox-telemetry-sourcemaps',
    apply: 'build',
    async closeBundle() {
      const res = await uploadSourcemaps({ dir: opts.dir ?? 'dist', ...opts, verbose: opts.verbose ?? true });
      console.log(`[telemetry] source maps: ${res.uploaded.length} uploaded, ${res.failed.length} failed (release ${opts.release})`);
    },
  };
}
