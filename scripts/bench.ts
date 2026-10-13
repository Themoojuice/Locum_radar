/**
 * Volume benchmark: builds a synthetic national-scale workspace and times the
 * operations the app performs on every request. Run: npm run bench [-- 10000]
 */
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

const n = Number(process.argv[2] ?? 10000);
process.env.SQLITE_PATH = path.join(mkdtempSync(path.join(tmpdir(), 'radar-bench-')), 'b.sqlite');
process.env.DATABASE_URL = '';
const { transaction, readStore } = await import('../src/server/database');
const { ingest } = await import('../src/domain/ingestion');
const { evaluate } = await import('../src/domain/engine');
const { demoStore } = await import('../src/domain/seed');
const base = demoStore().listings[0];
const states = ['QLD', 'NSW', 'VIC', 'WA', 'SA', 'NT', 'TAS', 'ACT'] as const;
const t = async (label: string, fn: () => unknown) => {
  const s = performance.now();
  const r = await fn();
  console.log(`${label.padEnd(36)} ${(performance.now() - s).toFixed(0).padStart(7)} ms`);
  return r;
};
await t(`ingest ${n} listings (one transaction)`, () =>
  transaction((s) => {
    for (let i = 0; i < n; i++) {
      const start = new Date(Date.UTC(2027, 0, 1) + (i % 300) * 86400000).toISOString().slice(0, 10);
      const end = new Date(Date.UTC(2027, 0, 8) + (i % 300) * 86400000).toISOString().slice(0, 10);
      ingest(s, {
        ...base,
        sourceId: 'manual',
        externalId: `bench-${i}`,
        facilityName: `Bench Hospital ${i % 700}`,
        town: `Town ${i % 700}`,
        state: states[i % 8],
        startDate: start,
        endDate: end,
        rawText: 'x'.repeat(1500),
      });
    }
  }),
);
await t('no-op write transaction', () => transaction(() => {}));
await t('one-field write transaction', () => transaction((s) => void (s.profile.name = 'x')));
const store = (await t('readStore', () => readStore())) as Awaited<ReturnType<typeof readStore>>;
await t('evaluate', () => evaluate(store));
console.log(`client payload (full store JSON)       ${(JSON.stringify(store).length / 1e6).toFixed(1)} MB`);
const { clientView } = await import('../src/server/views');
console.log(`client payload (feed view)             ${(JSON.stringify(clientView(store)).length / 1e6).toFixed(1)} MB`);
const view = clientView(store) as unknown as Record<string, unknown[]>;
for (const k of ['listings', 'offers', 'opportunities', 'facilities', 'events', 'reviews'])
  console.log(`  ${k.padEnd(14)} ${(JSON.stringify(view[k]).length / 1e6).toFixed(1)} MB`);
const { gzipSync } = await import('node:zlib');
console.log(`client payload (feed view, gzip)       ${(gzipSync(JSON.stringify(clientView(store))).length / 1e6).toFixed(1)} MB`);
