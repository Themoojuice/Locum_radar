// A deliberately small, opt-in live compatibility check in an isolated, ignored database.
import path from 'node:path';
import { collectSource } from '../src/server/collectors';
import { readStore, transaction } from '../src/server/database';
import { sourceFromRecipe, sourceRecipes } from '../src/domain/source-catalog';
if (!process.argv.includes('--live'))
  throw new Error('Pass --live to make three public page requests plus robots.txt');
process.env.SQLITE_PATH = path.resolve(
  'data/research/ochre-qualification-' + Date.now() + '.sqlite',
);
process.env.DATABASE_URL = '';
process.env.COLLECTOR_ENABLED = 'true';
await transaction((s) => {
  const source = sourceFromRecipe(sourceRecipes.find((r) => r.id === 'ochre')!);
  source.enabled = true;
  source.permission = 'approved';
  source.permissionEvidence =
    'Owner-requested one-off public compatibility research, 14 Oct 2026. Terms inspected at https://ochrerecruitment.com/terms-of-use; live robots rules checked by transport. No login, bypass, redistribution or ongoing schedule.';
  source.collector!.maxPages = 3;
  source.collector!.delayMs = 2000;
  s.sources = s.sources.map((v) => (v.id === source.id ? source : v));
});
const run = await collectSource('ochre');
const store = await readStore();
console.log(
  JSON.stringify(
    {
      run,
      documents: store.documents.length,
      reviewRecords: store.reviews.length,
      acceptedVacancies: store.opportunities.length,
    },
    null,
    2,
  ),
);
if (!store.documents.length) process.exitCode = 1;
