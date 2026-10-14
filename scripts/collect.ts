import { collectSource } from '../src/server/collectors';
import { readStore } from '../src/server/database';
import { collectionPlan } from '../src/domain/collection';
import { collectionEnabled } from '../src/server/public-starter';
const sourceId = process.argv.slice(2).find((v) => !v.startsWith('--'));
const drain = process.argv.includes('--drain');
const sources = (await readStore()).sources.filter(
  (s) => s.enabled && (!sourceId || s.id === sourceId),
);
for (const source of sources) {
  for (let batch = 0; batch < (drain ? 200 : 1); batch++) {
    const run = await collectSource(source.id);
    console.log(run);
    if (run.status === 'failed') process.exitCode = 1;
    if (
      run.status !== 'partial' ||
      !run.remaining ||
      run.limited ||
      !collectionPlan(await readStore(), collectionEnabled()).sources.some(
        (s) => s.id === source.id && s.state === 'ready',
      )
    )
      break;
  }
}
if (!sources.length)
  console.log(
    'No enabled sources. Review access and enable a supported source in the Sources screen first.',
  );
process.exit(process.exitCode || 0);
