import { describe, it, expect } from 'vitest';
import { emptyStore, demoStore } from '@/domain/seed';
import { emptyCompensation, type ReviewItem } from '@/domain/model';
import { jobPool, matchesPool, poolRate, type PoolFilters } from '@/domain/job-pool';
const draft = (id: string, sourceId = 'email'): ReviewItem => ({
  id,
  sourceId,
  kind: 'extraction',
  opportunityId: null,
  candidateId: null,
  resolved: false,
  reason: '',
  rawText: '',
  draft: {
    externalId: id,
    title: 'Psychiatry registrar',
    specialty: 'Psychiatry',
    grade: 'Registrar',
    state: 'QLD',
    compensation: { ...emptyCompensation, amount: 1500, basis: 'day' },
  },
});
const filters: PoolFilters = {
  search: '',
  specialty: '',
  grade: '',
  state: '',
  year: '',
  source: '',
  minimumPay: 0,
  payUnit: 'hour',
  suitability: 'all',
  travel: false,
};
describe('one master pool', () => {
  it('includes email without URLs alongside public adverts and accepted opportunities', () => {
    const s = demoStore();
    s.reviews = [draft('mail'), draft('public', 'ochre')];
    const pool = jobPool(s);
    expect(pool).toHaveLength(s.opportunities.length + 2);
    expect(pool.find((i) => i.id === 'mail')?.review?.draft?.url).toBeUndefined();
  });
  it('keeps only the newest revision and links updates to an accepted row', () => {
    const s = demoStore(),
      l = s.listings[0];
    const old = draft(l.externalId, l.sourceId),
      latest = { ...old, id: 'revision', observedAt: '2026-10-16T00:00:00Z' };
    s.reviews = [old, latest];
    const pool = jobPool(s);
    expect(pool).toHaveLength(s.opportunities.length);
    expect(pool.find((i) => i.id === l.opportunityId)?.review?.id).toBe('revision');
  });
  it('shares filters, keeps unknowns by default and never compares daily rates to hourly thresholds', () => {
    const s = emptyStore();
    s.reviews = [draft('mail')];
    const item = jobPool(s)[0];
    expect(matchesPool(item, filters)).toBe(true);
    expect(
      matchesPool(item, {
        ...filters,
        source: 'email',
        specialty: 'Psychiatry',
        minimumPay: 1000,
        payUnit: 'day',
      }),
    ).toBe(true);
    expect(matchesPool(item, { ...filters, minimumPay: 100, payUnit: 'hour' })).toBe(false);
    expect(matchesPool(item, { ...filters, specialty: 'Emergency medicine' })).toBe(false);
    expect(matchesPool(item, { ...filters, suitability: 'suitable' })).toBe(false);
    expect(poolRate(item, 'hour')).toBe(-1);
  });
  it('does not hide a URL-less advert just because another source uses the same reference', () => {
    const s = emptyStore();
    s.reviews = [draft('same', 'email'), draft('same', 'ochre')];
    expect(jobPool(s)).toHaveLength(2);
  });
});
