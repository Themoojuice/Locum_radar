import { adzuna, wavelength, type SourceAdapter } from './json-sources';
import { medrecruit } from './medrecruit';
import { oneMedical } from './onemedical';
import { dna, globalMedics, jps, salt } from './sitemap-jobs';

/** Every source with an automatic collector, keyed by source id. */
export const sourceAdapters: Record<string, SourceAdapter> = Object.fromEntries(
  [medrecruit, oneMedical, wavelength, adzuna, salt, globalMedics, dna, jps].map((a) => [
    a.sourceId,
    a,
  ]),
);
