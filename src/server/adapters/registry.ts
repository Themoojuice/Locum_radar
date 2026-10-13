import { adzuna, wavelength, type SourceAdapter } from './json-sources';
import { medrecruit } from './medrecruit';
import { oneMedical } from './onemedical';

/** Every source with an automatic collector, keyed by source id. */
export const sourceAdapters: Record<string, SourceAdapter> = Object.fromEntries(
  [medrecruit, oneMedical, wavelength, adzuna].map((a) => [a.sourceId, a]),
);
