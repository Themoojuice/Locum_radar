import { daysBetween, earnings, type EvaluatedJob } from './engine';
import { committedStages, type Profile, type Store } from './model';

/*
 * Forward planning (spec §5): complementary non-overlapping blocks, earnings
 * projections and recurring-vacancy patterns. Everything here is a suggestion
 * computed from current records; nothing is booked and no approval is assumed.
 */

export interface PlanStep {
  job: EvaluatedJob;
  value: number;
  gross: number | null;
  grossKind: string;
  net: number | null;
}
export interface Plan {
  steps: PlanStep[];
  total: number;
  gross: number;
  grossKnown: number;
  net: number;
  netKnown: number;
  days: number;
  by: 'score' | 'earnings';
}
/** Days left free between placements for travel and handover. */
export const TURNAROUND_DAYS = 1;

/**
 * The best set of non-overlapping placements, by total score or by estimated
 * gross earnings: classic weighted interval scheduling, solved exactly by
 * dynamic programming over end dates. Jobs already committed in the tracker
 * are always included and their dates are blocked for everything else.
 */
export function bestRun(
  jobs: EvaluatedJob[],
  profile: Profile,
  options: { by: 'score' | 'earnings'; from?: string; to?: string; limit?: number } = {
    by: 'score',
  },
): Plan {
  const committed = jobs.filter((j) =>
    (committedStages as string[]).includes(j.action?.stage ?? ''),
  );
  const clash = (j: EvaluatedJob) =>
    committed.some(
      (c) =>
        c.opportunity.id !== j.opportunity.id &&
        j.opportunity.startDate <= c.opportunity.endDate &&
        c.opportunity.startDate <= j.opportunity.endDate,
    );
  const value = (j: EvaluatedJob) => {
    const best = j.activeOffers
      .map((o) => earnings(o, j.opportunity, profile, j.logistics.local))
      .sort((a, b) => (b.gross.value ?? 0) - (a.gross.value ?? 0))[0];
    return {
      score: j.ranking.score ?? 0,
      gross: best?.gross.value ?? null,
      grossKind: best?.gross.kind ?? 'unknown',
      net: best?.net.value ?? null,
    };
  };
  const pool = jobs
    .filter(
      (j) =>
        j.rankable &&
        !committed.includes(j) &&
        (!options.from || j.opportunity.startDate >= options.from) &&
        (!options.to || j.opportunity.endDate <= options.to) &&
        !clash(j),
    )
    .map((j) => ({ job: j, ...value(j) }))
    .filter((c) => (options.by === 'earnings' ? c.gross !== null : c.score > 0))
    .sort((a, b) => a.job.opportunity.endDate.localeCompare(b.job.opportunity.endDate))
    .slice(0, options.limit ?? 400);
  const weight = (c: { score: number; gross: number | null }) =>
    options.by === 'earnings' ? (c.gross ?? 0) : c.score;
  // p[i] = last candidate that ends before candidate i starts (with turnaround).
  const ends = pool.map((c) => c.job.opportunity.endDate);
  const previous = pool.map((c) => {
    let lo = 0,
      hi = ends.length - 1,
      found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (daysBetween(ends[mid], c.job.opportunity.startDate) > TURNAROUND_DAYS) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found;
  });
  const best: number[] = new Array(pool.length + 1).fill(0);
  for (let i = 1; i <= pool.length; i++)
    best[i] = Math.max(best[i - 1], weight(pool[i - 1]) + best[previous[i - 1] + 1]);
  const chosen: typeof pool = [];
  for (let i = pool.length; i > 0;) {
    if (weight(pool[i - 1]) + best[previous[i - 1] + 1] > best[i - 1]) {
      chosen.push(pool[i - 1]);
      i = previous[i - 1] + 1;
    } else i--;
  }
  const steps: PlanStep[] = [...committed.map((job) => ({ job, ...value(job) })), ...chosen]
    .map((c) => ({
      job: c.job,
      value: weight(c),
      gross: c.gross,
      grossKind: c.grossKind,
      net: c.net,
    }))
    .sort((a, b) => a.job.opportunity.startDate.localeCompare(b.job.opportunity.startDate));
  const sum = (f: (s: PlanStep) => number | null) => steps.reduce((t, s) => t + (f(s) ?? 0), 0);
  return {
    steps,
    total: sum((s) => s.value),
    gross: sum((s) => s.gross),
    grossKnown: steps.filter((s) => s.gross !== null).length,
    net: sum((s) => s.net),
    netKnown: steps.filter((s) => s.net !== null).length,
    days: steps.reduce(
      (t, s) => t + daysBetween(s.job.opportunity.startDate, s.job.opportunity.endDate) + 1,
      0,
    ),
    by: options.by,
  };
}

export interface Prediction {
  facilityId: string;
  facility: string;
  specialty: string;
  month: string;
  basis: string;
}
/**
 * Recurring staffing patterns: a facility and specialty seen advertising in at
 * least three different months is likely to need cover again. Predictions are
 * for months with nothing currently advertised, and are always labelled as
 * patterns, never as vacancies.
 */
export function predictedVacancies(
  store: Store,
  now = new Date(),
  horizonMonths = 6,
): Prediction[] {
  const months = new Map<string, Set<string>>();
  const current = new Map<string, Set<string>>();
  const t = now.toISOString().slice(0, 10);
  for (const o of store.opportunities) {
    if (o.demo) continue;
    const key = `${o.facilityId}|${o.specialty}`;
    const set = months.get(key) ?? new Set<string>();
    set.add(o.startDate.slice(0, 7));
    months.set(key, set);
    if (o.endDate >= t) {
      const c = current.get(key) ?? new Set<string>();
      c.add(o.startDate.slice(0, 7));
      current.set(key, c);
    }
  }
  const out: Prediction[] = [];
  const upcoming = Array.from({ length: horizonMonths }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1 + i, 1));
    return d.toISOString().slice(0, 7);
  });
  for (const [key, seen] of months) {
    if (seen.size < 3) continue;
    const [facilityId, specialty] = key.split('|');
    const facility = store.facilities.find((f) => f.id === facilityId);
    for (const month of upcoming) {
      if (current.get(key)?.has(month)) continue;
      const sameMonthBefore = [...seen].some((m) => m.slice(5) === month.slice(5) && m < month);
      out.push({
        facilityId,
        facility: facility?.name ?? 'Unknown facility',
        specialty,
        month,
        basis: sameMonthBefore
          ? `Advertised in ${seen.size} months, including this month last year.`
          : `Advertised in ${seen.size} different months.`,
      });
      break; // One prediction per facility and specialty: the next uncovered month.
    }
  }
  return out.sort((a, b) => a.month.localeCompare(b.month));
}
