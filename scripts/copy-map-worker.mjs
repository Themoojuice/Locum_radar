// MapLibre 6 loads its worker relative to its own module URL, which a bundler
// rewrites. Serving a copy from /public keeps the worker same-origin and pinned
// to the installed version.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const dist = path.dirname(require.resolve('maplibre-gl/package.json'));
mkdirSync('public/maplibre', { recursive: true });
copyFileSync(
  path.join(dist, 'dist/maplibre-gl-worker.mjs'),
  'public/maplibre/maplibre-gl-worker.mjs',
);
