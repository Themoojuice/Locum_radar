import { readStore, transaction } from './database';
import { log } from './progress';
import type { Facility, Profile } from '@/domain/model';

/**
 * Natural-history enrichment from the Atlas of Living Australia (open
 * occurrence API, no key). For each facility with live vacancies it counts the
 * species of the doctor's chosen taxon recorded within a radius. Occurrence
 * records measure recording effort as much as biodiversity — towns with active
 * naturalists look richer — so the score is a relative, labelled heuristic.
 */
export const ALA_SEARCH = 'https://biocache-ws.ala.org.au/ws/occurrences/search';
export function alaUrl(f: Pick<Facility, 'lat' | 'lon'>, nature: Profile['nature']) {
  const q = new URLSearchParams({
    q: nature.query,
    lat: String(f.lat),
    lon: String(f.lon),
    radius: String(nature.radiusKm),
    pageSize: '0',
    facets: 'species',
    flimit: '1000',
  });
  return `${ALA_SEARCH}?${q}`;
}
export function parseAla(body: unknown): { records: number; species: number } {
  const b = body as {
    totalRecords?: number;
    facetResults?: { fieldName?: string; fieldResult?: { label?: string; count?: number }[] }[];
  };
  if (!b || typeof b.totalRecords !== 'number') throw new Error('Unexpected ALA response shape');
  const facet = b.facetResults?.find((f) => f.fieldName === 'species');
  const species = (facet?.fieldResult ?? []).filter(
    (r) => r.label && r.label !== 'Not supplied',
  ).length;
  return { records: b.totalRecords, species };
}
/** Log-scaled score relative to the richest facility checked, so one hotspot does not flatten the rest. */
export function rescore(facilities: Facility[], taxon: string) {
  const checked = facilities.filter((f) => f.biodiversity && f.biodiversity.taxon === taxon);
  const max = Math.max(0, ...checked.map((f) => f.biodiversity!.species));
  for (const f of checked)
    f.biodiversity!.score = max
      ? Math.round((Math.log1p(f.biodiversity!.species) / Math.log1p(max)) * 100)
      : 0;
}

export async function enrichBiodiversity(limit = 40) {
  const store = await readStore();
  const nature = store.profile.nature;
  if (!nature.enabled) return { checked: 0, message: 'Nature lens is off in your profile.' };
  const t = new Date().toISOString().slice(0, 10);
  const live = new Set(
    store.opportunities.filter((o) => o.endDate >= t && !o.demo).map((o) => o.facilityId),
  );
  const stale = (f: Facility) =>
    !f.biodiversity ||
    f.biodiversity.taxon !== nature.label ||
    f.biodiversity.radiusKm !== nature.radiusKm ||
    Date.now() - Date.parse(f.biodiversity.fetchedAt) > 30 * 86400000;
  const due = store.facilities
    .filter((f) => live.has(f.id) && f.lat !== null && stale(f))
    .slice(0, limit);
  if (!due.length)
    return { checked: 0, message: 'Every facility with live vacancies is up to date.' };
  log(
    'nature',
    `Counting ${nature.label} species near ${due.length} hospitals (Atlas of Living Australia)…`,
  );
  const results = new Map<string, { records: number; species: number }>();
  for (const f of due) {
    try {
      const res = await fetch(alaUrl(f, nature), {
        headers: { Accept: 'application/json', 'User-Agent': 'LocumRadar/0.2 (private research)' },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      results.set(f.id, parseAla(await res.json()));
    } catch (error) {
      log('nature', `${f.name}: ${(error as Error).message}`, 'warn');
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await transaction((s) => {
    const fetchedAt = new Date().toISOString();
    for (const f of s.facilities) {
      const r = results.get(f.id);
      if (r)
        f.biodiversity = {
          taxon: nature.label,
          radiusKm: nature.radiusKm,
          ...r,
          score: null,
          fetchedAt,
        };
    }
    rescore(s.facilities, nature.label);
  });
  const message = `${results.size} of ${due.length} hospitals checked for ${nature.label} records.`;
  log('nature', message);
  return { checked: results.size, message };
}
