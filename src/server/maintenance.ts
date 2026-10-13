import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { readStore, transaction } from './database';
import { previewImport } from './extraction';
import { commitExtractions, describeTally } from './collectors';
import { MYHOSPITALS_URL, mergeFacilities, parseMyHospitals } from './adapters/myhospitals';
import { log, requestStop } from './progress';

/** Loads the AIHW hospital directory when the workspace has none yet. */
export async function ensureFacilityDirectory(force = false) {
  const store = await readStore();
  if (!force && store.facilities.some((f) => f.id.startsWith('aihw-'))) return null;
  log('directory', 'Loading the national hospital directory (AIHW MyHospitals API)…');
  const response = await fetch(MYHOSPITALS_URL, {
    headers: { Accept: 'application/json', 'User-Agent': 'LocumRadar/0.1 (private research)' },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`MyHospitals returned HTTP ${response.status}`);
  const directory = parseMyHospitals(await response.json());
  const result = await transaction((s) => mergeFacilities(s.facilities, directory));
  log('directory', `${directory.length} hospitals read; ${result.added} added to your directory.`);
  return result;
}

/**
 * Imports recruiter emails saved as .eml files (for example by the Gmail Apps
 * Script). Files older than `days` are ignored; repeats are harmless because
 * unchanged listings and queued candidates are de-duplicated.
 */
export async function importMailFolder(folder: string, days = 45) {
  const { facilities } = await readStore();
  const files = (await readdir(folder)).filter((f) => f.toLowerCase().endsWith('.eml')).sort();
  const cutoff = Date.now() - days * 86400000;
  const tally = { files: 0, failed: 0, imported: 0, unchanged: 0, queued: 0 };
  for (const file of files) {
    const path = join(folder, file);
    const info = await stat(path);
    if (info.size > 1_000_000 || info.mtimeMs < cutoff) continue;
    tally.files++;
    try {
      const results = await previewImport(await readFile(path, 'utf8'), 'email', 'eml', facilities);
      const t = await transaction((s) => commitExtractions(s, 'email', results));
      tally.imported += t.imported;
      tally.unchanged += t.unchanged;
      tally.queued += t.queued;
    } catch (error) {
      tally.failed++;
      log('email', `${file}: ${(error as Error).message}`, 'warn');
    }
  }
  return tally;
}

/** Steps that run before the source queue: directory, then the inbox drop folder. */
export async function prepareCollection() {
  requestStop(false);
  const steps: { step: string; status: 'success' | 'failed' | 'skipped'; message: string }[] = [];
  if (process.env.COLLECTOR_ENABLED === 'true') {
    try {
      const r = await ensureFacilityDirectory();
      steps.push({
        step: 'Hospital directory',
        status: r ? 'success' : 'skipped',
        message: r ? `${r.added} hospitals added.` : 'Already loaded.',
      });
    } catch (error) {
      const message = `Hospital directory unavailable (${(error as Error).message}); facility matching uses what is already saved.`;
      log('directory', message, 'warn');
      steps.push({ step: 'Hospital directory', status: 'failed', message });
    }
  }
  const folder = process.env.MAILDROP_DIR;
  if (!folder) {
    const message = 'Inbox not connected: set MAILDROP_DIR to the folder the Gmail export fills.';
    log('email', message, 'warn');
    steps.push({ step: 'Inbox', status: 'skipped', message });
  } else {
    try {
      log('email', `Reading recruiter emails from ${folder}…`);
      const t = await importMailFolder(folder);
      const message = `${t.files} recent emails read${t.failed ? ` (${t.failed} unreadable)` : ''}. ${describeTally(t)}`;
      log('email', message, t.failed ? 'warn' : 'info');
      steps.push({ step: 'Inbox', status: 'success', message });
    } catch (error) {
      const message = `Inbox folder could not be read: ${(error as Error).message}`;
      log('email', message, 'error');
      steps.push({ step: 'Inbox', status: 'failed', message });
    }
  }
  return steps;
}
