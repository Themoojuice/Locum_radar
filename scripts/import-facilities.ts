// Adds public and private hospitals from the AIHW MyHospitals API to the
// facility directory used to resolve advertised facility names.
// Usage: npm run import-facilities   (or pass a saved JSON response path)
import { readFile } from 'node:fs/promises';
import {
  MYHOSPITALS_URL,
  mergeFacilities,
  parseMyHospitals,
} from '../src/server/adapters/myhospitals';
import { transaction } from '../src/server/database';

const body = process.argv[2]
  ? JSON.parse(await readFile(process.argv[2], 'utf8'))
  : await fetch(MYHOSPITALS_URL, {
      headers: { Accept: 'application/json', 'User-Agent': 'LocumRadar/0.1 (private research)' },
      signal: AbortSignal.timeout(30000),
    }).then((r) => {
      if (!r.ok) throw new Error(`MyHospitals returned HTTP ${r.status}`);
      return r.json();
    });
const directory = parseMyHospitals(body);
const { added, linked } = await transaction((s) => mergeFacilities(s.facilities, directory));
const version = (body as { version_information?: { data_version?: unknown } }).version_information;
console.log(
  `${directory.length} open hospitals read (data version ${String(version?.data_version ?? 'unknown')}); ${added} added, ${linked} linked to existing facilities.`,
);
console.log('Source: AIHW MyHospitals API, licensed CC BY. Towns are derived from names.');
process.exit(0);
