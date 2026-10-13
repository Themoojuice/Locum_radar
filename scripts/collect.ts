import { collectSource } from '../src/server/collectors';
import { readStore } from '../src/server/database';
const sources = (await readStore()).sources.filter(
  (s) => s.enabled && (!process.argv[2] || s.id === process.argv[2]),
);
for (const source of sources) console.log(await collectSource(source.id));
if (!sources.length)
  console.log(
    'No enabled sources. Review access and enable a supported source in the Sources screen first.',
  );
process.exit(0);
