// Queues recruiter emails saved as .eml files for extraction review.
// Usage: npm run import-mail -- <folder>   (or set MAILDROP_DIR)
// Re-running is safe: candidates already queued or reviewed are skipped.
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { previewImport } from '../src/server/extraction';
import { queueExtractions } from '../src/server/collectors';
import { readStore, transaction } from '../src/server/database';

const folder = process.argv[2] || process.env.MAILDROP_DIR;
if (!folder) {
  console.log('Give a folder of .eml files: npm run import-mail -- <folder>');
  process.exit(1);
}
const files = (await readdir(folder)).filter((f) => f.toLowerCase().endsWith('.eml')).sort();
const { facilities } = await readStore();
let queued = 0,
  failed = 0;
for (const file of files) {
  const path = join(folder, file);
  if ((await stat(path)).size > 1_000_000) {
    console.log(`Skipped ${file}: larger than 1 MB.`);
    continue;
  }
  try {
    const results = await previewImport(await readFile(path, 'utf8'), 'email', 'eml', facilities);
    const added = await transaction((s) => queueExtractions(s, 'email', results));
    queued += added;
    if (added) console.log(`${file}: ${added} new candidate(s).`);
  } catch (error) {
    failed++;
    console.log(`${file}: ${(error as Error).message}`);
  }
}
console.log(`${files.length} file(s) read, ${queued} new candidate(s) queued, ${failed} failed.`);
process.exit(0);
