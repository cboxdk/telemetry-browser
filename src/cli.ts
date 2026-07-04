#!/usr/bin/env node
import { uploadSourcemaps } from './sourcemaps';

/** telemetry-sourcemaps --dir public/build --endpoint URL --release SHA [--token T] */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const dir = arg('dir');
const endpoint = arg('endpoint');
const release = arg('release');

if (!dir || !endpoint || !release) {
  console.error('Usage: telemetry-sourcemaps --dir <build-dir> --endpoint <url> --release <id> [--token <bearer>]');
  process.exit(1);
}

uploadSourcemaps({ dir, endpoint, release, token: arg('token'), verbose: true }).then((r) => {
  console.log(`Uploaded ${r.uploaded.length} source maps, ${r.failed.length} failed.`);
  process.exit(r.failed.length > 0 ? 1 : 0);
});
