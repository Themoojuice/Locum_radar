import { localDate, normalisePay } from './engine';
import { states, type Facility, type Store } from './model';

/*
 * Coverage and market intelligence (spec §2 "coverage management", §14).
 * Everything here describes what the workspace has *observed*. A hospital with
 * no observed vacancies is not a hospital without vacancies, and estimates of
 * the unobserved market carry their assumptions with them.
 */

const median = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b),
    m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const today = (now: Date) => localDate(now, 'Australia/Brisbane');

/** Active = not withdrawn/filled and not yet ended. */
/** Example records count only in a workspace made entirely of examples. */
const counts = (store: Store) => {
  const examplesOnly = store.opportunities.length > 0 && store.opportunities.every((o) => o.demo);
  return (o: { demo: boolean }) => examplesOnly || !o.demo;
};
function activeOpportunityIds(store: Store, now: Date) {
  const t = today(now);
  const include = counts(store);
  return new Set(
    store.opportunities
      .filter((o) => include(o) && o.endDate >= t && !['filled', 'withdrawn'].includes(o.status))
      .map((o) => o.id),
  );
}

/**
 * Which opportunities each source has advertised. Unresolved near-duplicate
 * reviews count as shared for estimation, because they are probably the same
 * vacancy and leaving them apart would understate overlap and inflate the
 * estimated market.
 */
function captureSets(store: Store, active: Set<string>) {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const p = parent.get(id);
    if (!p || p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  };
  for (const r of store.reviews)
    if (r.kind === 'possible duplicate' && !r.resolved && r.opportunityId && r.candidateId)
      parent.set(find(r.opportunityId), find(r.candidateId));
  const sets = new Map<string, Set<string>>();
  for (const l of store.listings) {
    if (!active.has(l.opportunityId) || l.status === 'withdrawn' || l.status === 'filled') continue;
    if (l.sourceId === 'manual') continue;
    const set = sets.get(l.sourceId) ?? new Set<string>();
    set.add(find(l.opportunityId));
    sets.set(l.sourceId, set);
  }
  return sets;
}

export interface PairEstimate {
  a: string;
  b: string;
  n1: number;
  n2: number;
  m: number;
  total: number;
  low: number;
  high: number;
}
/** Chapman's bias-corrected Lincoln–Petersen estimate with a normal-approximation interval. */
export function chapman(n1: number, n2: number, m: number) {
  const total = ((n1 + 1) * (n2 + 1)) / (m + 1) - 1;
  const variance = ((n1 + 1) * (n2 + 1) * (n1 - m) * (n2 - m)) / ((m + 1) ** 2 * (m + 2));
  const se = Math.sqrt(Math.max(0, variance));
  return {
    total,
    low: Math.max(n1 + n2 - m, total - 1.96 * se),
    high: total + 1.96 * se,
  };
}

export function coverageReport(store: Store, now = new Date()) {
  const active = activeOpportunityIds(store, now);
  const sets = captureSets(store, active);
  const sourceIds = [...sets.keys()];
  const union = new Set<string>();
  sets.forEach((s) => s.forEach((id) => union.add(id)));
  const oppById = new Map(store.opportunities.map((o) => [o.id, o]));
  const byFacility = new Map(store.facilities.map((f) => [f.id, f]));
  const sourcesOf = new Map<string, number>();
  sets.forEach((set) => set.forEach((id) => sourcesOf.set(id, (sourcesOf.get(id) ?? 0) + 1)));

  // Per-source contribution: what would be lost without this source.
  const perSource = store.sources
    .filter((s) => s.type === 'agency' || s.type === 'government' || s.type === 'email')
    .map((source) => {
      const mine = sets.get(source.id) ?? new Set<string>();
      let unique = 0;
      for (const id of mine) if (sourcesOf.get(id) === 1) unique++;
      const listings = store.listings.filter((l) => l.sourceId === source.id);
      const pending = store.reviews.filter(
        (r) => r.kind === 'extraction' && !r.resolved && r.sourceId === source.id,
      ).length;
      const imported = listings.length;
      const runs = store.runs.filter((r) => r.sourceId === source.id);
      const lastRuns = runs.slice(0, 10);
      const facilities = new Map<string, number>();
      const specialties = new Map<string, number>();
      const stateCounts = new Map<string, number>();
      for (const l of listings) {
        specialties.set(l.specialty, (specialties.get(l.specialty) ?? 0) + 1);
        stateCounts.set(l.state, (stateCounts.get(l.state) ?? 0) + 1);
      }
      for (const id of mine) {
        const o = oppById.get(id);
        if (o) facilities.set(o.facilityId, (facilities.get(o.facilityId) ?? 0) + 1);
      }
      const top = (m: Map<string, number>, n = 3) =>
        [...m.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, n)
          .map(([k, v]) => ({ name: k, count: v }));
      return {
        id: source.id,
        name: source.name,
        method: source.method,
        enabled: source.enabled,
        permission: source.permission,
        focus: source.focus ?? '',
        lastSuccess: source.lastSuccess,
        error: source.error,
        active: mine.size,
        unique,
        shared: mine.size - unique,
        imported,
        /** Share of this source's records that parsed well enough to import without review. */
        reliability: imported + pending ? imported / (imported + pending) : null,
        pendingReview: pending,
        successRate: lastRuns.length
          ? lastRuns.filter((r) => r.status === 'success').length / lastRuns.length
          : null,
        topSpecialties: top(specialties),
        topStates: top(stateCounts),
        facilities: facilities.size,
        topFacilities: top(facilities).map((f) => ({
          ...f,
          name: byFacility.get(f.name)?.name ?? f.name,
        })),
      };
    })
    .sort((a, b) => b.active - a.active);

  const pairs: PairEstimate[] = [];
  for (let i = 0; i < sourceIds.length; i++)
    for (let j = i + 1; j < sourceIds.length; j++) {
      const A = sets.get(sourceIds[i])!,
        B = sets.get(sourceIds[j])!;
      let m = 0;
      for (const id of A) if (B.has(id)) m++;
      if (A.size < 5 || B.size < 5 || m < 3) continue;
      pairs.push({
        a: sourceIds[i],
        b: sourceIds[j],
        n1: A.size,
        n2: B.size,
        m,
        ...chapman(A.size, B.size, m),
      });
    }
  // The best-supported pair (most overlap) drives the headline; others are shown alongside.
  const best = [...pairs].sort((x, y) => y.m - x.m)[0] ?? null;
  const estimate = best
    ? {
        observed: union.size,
        total: Math.round(Math.max(best.total, union.size)),
        low: Math.round(Math.max(best.low, union.size)),
        high: Math.round(Math.max(best.high, union.size)),
        coverage: union.size / Math.max(best.total, union.size),
        coverageLow: union.size / Math.max(best.high, union.size),
        coverageHigh: union.size / Math.max(best.low, union.size),
        basis: best,
      }
    : null;

  // Geographic gaps: directory hospitals per state vs hospitals with observed vacancies.
  const observedFacilities = new Set(
    store.opportunities.filter((o) => active.has(o.id)).map((o) => o.facilityId),
  );
  const gaps = states.map((state) => {
    const directory = store.facilities.filter(
      (f) => f.state === state && f.id.startsWith('aihw-') && f.sector !== 'private',
    );
    const observed = store.facilities.filter(
      (f) => f.state === state && observedFacilities.has(f.id),
    );
    return {
      state,
      publicHospitals: directory.length,
      withVacancies: observed.length,
      vacancies: store.opportunities.filter(
        (o) => active.has(o.id) && byFacility.get(o.facilityId)?.state === state,
      ).length,
    };
  });

  return {
    active: active.size,
    observed: union.size,
    perSource,
    pairs,
    estimate,
    gaps,
    caveats: [
      'Agencies answer the same hospital requests and widely advertise hard-to-fill rural roles, so sources are positively dependent. That biases the estimated market low and the coverage figure high: read coverage as an upper bound.',
      'Only advertised vacancies are counted. Hospital casual pools, direct-booking apps and unadvertised panel requests are invisible to every source.',
      'Possible duplicates still in Review queue are counted as the same vacancy for this estimate.',
    ],
  };
}
export type CoverageReport = ReturnType<typeof coverageReport>;

/* --------------------------------------------------------- facility intelligence */

export function facilityIntelligence(store: Store, facility: Facility, now = new Date()) {
  const include = counts(store);
  const opportunities = store.opportunities.filter(
    (o) => o.facilityId === facility.id && include(o),
  );
  const ids = new Set(opportunities.map((o) => o.id));
  const offers = store.offers.filter((o) => ids.has(o.opportunityId));
  const rates = offers
    .map((o) => normalisePay(o.compensation).hourly)
    .filter((v): v is number => v !== null);
  const months = new Set(opportunities.map((o) => o.startDate.slice(0, 7)));
  const sources = new Map<string, number>();
  for (const o of offers) sources.set(o.sourceId, (sources.get(o.sourceId) ?? 0) + 1);
  const specialties = new Map<string, number>();
  for (const o of opportunities)
    specialties.set(o.specialty, (specialties.get(o.specialty) ?? 0) + 1);
  const t = today(now);
  return {
    total: opportunities.length,
    active: opportunities.filter(
      (o) => o.endDate >= t && !['filled', 'withdrawn'].includes(o.status),
    ).length,
    months: months.size,
    recurring: months.size >= 3,
    rate: rates.length
      ? {
          min: Math.min(...rates),
          median: median(rates)!,
          max: Math.max(...rates),
          n: rates.length,
        }
      : null,
    sources: [...sources.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => ({
        id,
        name: store.sources.find((s) => s.id === id)?.name ?? id,
        count,
      })),
    specialties: [...specialties.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count })),
    firstSeen: opportunities.map((o) => o.firstSeenAt).sort()[0] ?? null,
  };
}

/* ------------------------------------------------------------------ market trends */

/**
 * Advertised volume and comparable hourly rates by placement month. Built from
 * observed advertisements only; with incomplete coverage it describes the
 * sources, not the whole market.
 */
export function marketTrends(store: Store, specialty?: string) {
  const byMonth = new Map<string, { count: number; rates: number[] }>();
  const offersBy = new Map<string, number[]>();
  for (const o of store.offers) {
    const h = normalisePay(o.compensation).hourly;
    if (h === null) continue;
    const list = offersBy.get(o.opportunityId) ?? [];
    list.push(h);
    offersBy.set(o.opportunityId, list);
  }
  const include = counts(store);
  for (const o of store.opportunities) {
    if (!include(o) || (specialty && o.specialty !== specialty)) continue;
    const key = o.startDate.slice(0, 7);
    const entry = byMonth.get(key) ?? { count: 0, rates: [] };
    entry.count++;
    const r = offersBy.get(o.id);
    if (r?.length) entry.rates.push(Math.max(...r));
    byMonth.set(key, entry);
  }
  return [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, v]) => ({
      month,
      count: v.count,
      medianHourly: median(v.rates),
      rated: v.rates.length,
    }));
}
