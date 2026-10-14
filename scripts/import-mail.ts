// Imports recruiter emails saved as .eml files. Valid vacancies go straight to
// the feed; anything incomplete waits in Review queue.
// Usage: npm run import-mail -- <folder>   (or set MAILDROP_DIR)
import { importMailFolder } from '../src/server/maintenance';
import { describeTally } from '../src/server/collectors';

const folder = process.argv[2] || process.env.MAILDROP_DIR;
if (!folder) {
  console.log('Give a folder of .eml files: npm run import-mail -- <folder>');
  process.exit(1);
}
const tally = await importMailFolder(folder, Number(process.env.MAILDROP_DAYS ?? 3650));
console.log(`${tally.files} file(s) read, ${tally.failed} failed. ${describeTally(tally)}`);
process.exit(0);
