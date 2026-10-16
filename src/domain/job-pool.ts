import type { Store, ReviewItem, Compensation } from './model';
import { evaluate, type EvaluatedJob } from './engine';

export interface PoolItem {
  id: string;
  title: string;
  specialty: string;
  grade: string;
  state: string;
  startDate: string;
  endDate: string;
  text: string;
  sources: string[];
  pay: Compensation[];
  updatedAt: string;
  job?: EvaluatedJob;
  review?: ReviewItem;
}
export const reviewIdentity = (r: ReviewItem) =>
  `${r.sourceId}:${r.draft?.externalId || r.draft?.url || r.id}`;
/** One row per known opportunity, or source advert until enough facts exist to reconcile it. */
export function jobPool(store: Store, jobs = evaluate(store)): PoolItem[] {
  const items = jobs.map((job) => ({
    id: job.opportunity.id,
    title: job.opportunity.title,
    specialty: job.opportunity.specialty,
    grade: job.opportunity.grade,
    state: job.facility.state,
    startDate: job.opportunity.startDate,
    endDate: job.opportunity.endDate,
    text: `${job.facility.name} ${job.facility.town} ${job.opportunity.title} ${job.opportunity.grade}`,
    sources: [...new Set(job.offers.map((o) => o.sourceId))],
    pay: job.activeOffers.map((o) => o.compensation),
    updatedAt: job.opportunity.lastSeenAt,
    job,
  })) as PoolItem[];
  const accepted = new Map(
    store.listings.map((l) => [`${l.sourceId}:${l.externalId}`, l.opportunityId]),
  );
  const latest = new Map<string, ReviewItem>();
  for (const r of store.reviews) {
    if (r.kind !== 'extraction' || !r.draft) continue;
    const key = reviewIdentity(r),
      previous = latest.get(key);
    if (!previous || !previous.observedAt || !r.observedAt || r.observedAt >= previous.observedAt)
      latest.set(key, r);
  }
  for (const [key, r] of latest) {
    if (r.resolved) continue;
    const existing = items.find((i) => i.id === accepted.get(key));
    if (existing) {
      existing.review = r;
      continue;
    }
    const d = r.draft!;
    items.push({
      id: r.id,
      title: d.title || 'Recruiter advertisement',
      specialty: d.specialty || '',
      grade: d.grade || '',
      state: d.state || '',
      startDate: d.startDate || '',
      endDate: d.endDate || '',
      text: `${d.title || ''} ${d.facilityName || ''} ${d.town || ''} ${d.rawText || r.rawText || ''}`,
      sources: [r.sourceId],
      pay: d.compensation ? [d.compensation] : [],
      updatedAt: r.observedAt || '',
      review: r,
    });
  }
  return items;
}
export interface PoolFilters {
  search: string;
  specialty: string;
  state: string;
  grade: string;
  year: string;
  source: string;
  minimumPay: number;
  payUnit: string;
  suitability: string;
  travel: boolean;
}
export function matchesPool(item: PoolItem, f: PoolFilters) {
  if (f.search && !item.text.toLowerCase().includes(f.search.toLowerCase())) return false;
  if (
    (f.specialty && item.specialty !== f.specialty) ||
    (f.state && item.state !== f.state) ||
    (f.grade && item.grade !== f.grade) ||
    (f.source && !item.sources.includes(f.source))
  )
    return false;
  if (
    f.year &&
    (!item.startDate ||
      !item.endDate ||
      item.startDate > `${f.year}-12-31` ||
      item.endDate < `${f.year}-01-01`)
  )
    return false;
  const relevantPay =
    item.job && f.source
      ? item.job.activeOffers.filter((o) => o.sourceId === f.source).map((o) => o.compensation)
      : item.pay;
  if (
    f.minimumPay > 0 &&
    !relevantPay.some(
      (p) =>
        p.currency === 'AUD' &&
        p.basis === f.payUnit &&
        p.amount !== null &&
        p.amount >= f.minimumPay,
    )
  )
    return false;
  if (f.suitability === 'suitable' && !item.job?.rankable) return false;
  if (
    f.suitability !== 'all' &&
    f.suitability !== 'suitable' &&
    (item.job?.eligibility.status || 'Needs verification') !== f.suitability
  )
    return false;
  if (
    f.travel &&
    !(item.job
      ? item.job.activeOffers.some(
          (o) => o.flights === 'included' && o.accommodation === 'included',
        )
      : item.review?.draft?.flights === 'included' &&
        item.review.draft.accommodation === 'included')
  )
    return false;
  return true;
}
export function poolRate(item: PoolItem, unit: string, source = '') {
  const pay =
    item.job && source
      ? item.job.activeOffers.filter((o) => o.sourceId === source).map((o) => o.compensation)
      : item.pay;
  const rates = pay
    .filter((p) => p.currency === 'AUD' && p.basis === unit && p.amount !== null)
    .map((p) => p.amount!);
  return rates.length ? Math.max(...rates) : -1;
}
