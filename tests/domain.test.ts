import { describe, expect, it } from 'vitest';
import { demoStore, emptyStore } from '@/domain/seed';
import {
  assessEligibility,
  evaluate,
  localDate,
  normalisePay,
  presets,
  rankOpportunity,
  duration,
} from '@/domain/engine';
import { ingest, mergeOpportunities, splitListing } from '@/domain/ingestion';
import {
  dateOnly,
  emptyCompensation,
  listingInputSchema,
  profileSchema,
  unknownRequirements,
  type ListingInput,
} from '@/domain/model';
const now = new Date('2026-10-13T02:00:00Z');
export function input(overrides: Partial<ListingInput> = {}): ListingInput {
  const {
    id: _id,
    opportunityId: _op,
    observedAt: _at,
    firstSeenAt: _first,
    contentHash: _hash,
    ...l
  } = demoStore().listings[0];
  void [_id, _op, _at, _first, _hash];
  return {
    ...l,
    sourceId: 'manual',
    externalId: 'agency-reference-1',
    rawText: 'Test evidence',
    ...overrides,
  };
}
describe('identity, offers and history', () => {
  it('links exact vacancies while preserving competing rates', () => {
    const s = emptyStore();
    ingest(s, input(), now);
    ingest(
      s,
      input({ sourceId: 'email', compensation: { ...input().compensation, amount: 200 } }),
      now,
    );
    expect(s.opportunities).toHaveLength(1);
    expect(s.offers).toHaveLength(2);
    expect(s.offers.map((o) => o.compensation.amount)).toEqual([160, 200]);
  });
  it('does not merge different roles at the same facility', () => {
    const s = emptyStore();
    ingest(s, input(), now);
    ingest(s, input({ sourceId: 'email', grade: 'RMO' }), now);
    expect(s.opportunities).toHaveLength(2);
  });
  it('keeps uncertain duplicates in review', () => {
    const s = emptyStore();
    ingest(s, input({ reference: '' }), now);
    ingest(s, input({ sourceId: 'email', reference: '' }), now);
    expect(s.opportunities).toHaveLength(2);
    expect(s.reviews).toHaveLength(1);
  });
  it('does not merge conflicting requirements', () => {
    const s = emptyStore();
    ingest(s, input(), now);
    ingest(
      s,
      input({
        sourceId: 'email',
        requirements: { ...input().requirements, credentials: ['FRANZCP'] },
      }),
      now,
    );
    expect(s.opportunities).toHaveLength(2);
    expect(() => mergeOpportunities(s, s.opportunities[0].id, s.opportunities[1].id)).toThrow(
      /requirements/,
    );
  });
  it('is idempotent and timestamps repeated observations', () => {
    const s = emptyStore();
    const a = ingest(s, input(), now);
    const b = ingest(s, input(), new Date('2026-10-14T02:00:00Z'));
    expect(b.unchanged).toBe(true);
    expect(a.opportunityId).toBe(b.opportunityId);
    expect(s.listings).toHaveLength(1);
    expect(s.observations).toHaveLength(1);
    expect(s.listings[0].observedAt).toContain('2026-10-14');
  });
  it('preserves earlier pay on a changed advertisement', () => {
    const s = emptyStore();
    ingest(s, input(), now);
    ingest(s, input({ compensation: { ...input().compensation, amount: 210 } }), now);
    expect(s.opportunities).toHaveLength(1);
    expect(s.observations.map((o) => o.snapshot.compensation.amount)).toEqual([160, 210]);
    expect(s.offers).toHaveLength(1);
  });
  it('detaches an amended role instead of rewriting competing offers', () => {
    const s = emptyStore();
    ingest(s, input(), now);
    ingest(s, input({ sourceId: 'email' }), now);
    ingest(s, input({ startDate: '2027-01-12' }), now);
    expect(s.opportunities).toHaveLength(2);
    expect(s.reviews).toHaveLength(1);
    expect(s.listings.find((l) => l.sourceId === 'email')?.startDate).toBe('2027-01-11');
  });
  it('supports reviewed merge then split without losing source history', () => {
    const s = emptyStore();
    ingest(s, input({ reference: '' }), now);
    ingest(s, input({ sourceId: 'email', reference: '' }), now);
    mergeOpportunities(s, s.opportunities[1].id, s.opportunities[0].id);
    expect(s.opportunities).toHaveLength(1);
    splitListing(s, s.listings[1].id);
    expect(s.opportunities).toHaveLength(2);
    expect(s.observations).toHaveLength(2);
  });
  it('does not retire a vacancy when just one recruiter withdraws', () => {
    const s = emptyStore();
    ingest(s, input(), now);
    ingest(s, input({ sourceId: 'email' }), now);
    ingest(s, input({ status: 'withdrawn' }), now);
    expect(s.opportunities[0].status).toBe('advertised');
  });
  it('preserves tracker history over an empty action during a merge', () => {
    const s = emptyStore();
    ingest(s, input({ reference: '' }), now);
    ingest(s, input({ sourceId: 'email', reference: '' }), now);
    const [a, b] = s.opportunities;
    s.actions.push(
      { opportunityId: a.id, stage: 'Discovered', notes: '', updatedAt: now.toISOString() },
      {
        opportunityId: b.id,
        stage: 'Saved',
        notes: 'Ask about supervision',
        updatedAt: now.toISOString(),
      },
    );
    mergeOpportunities(s, b.id, a.id);
    expect(s.actions).toHaveLength(1);
    expect(s.actions[0]).toMatchObject({
      opportunityId: a.id,
      stage: 'Saved',
      notes: 'Ask about supervision',
    });
  });
  it('rejects conflicting tracker histories without partially moving listings', () => {
    const s = emptyStore();
    ingest(s, input({ reference: '' }), now);
    ingest(s, input({ sourceId: 'email', reference: '' }), now);
    const [a, b] = s.opportunities;
    s.actions.push(
      {
        opportunityId: a.id,
        stage: 'Saved',
        notes: 'First note',
        updatedAt: now.toISOString(),
      },
      {
        opportunityId: b.id,
        stage: 'Saved',
        notes: 'Second note',
        updatedAt: now.toISOString(),
      },
    );
    const before = structuredClone(s);
    expect(() => mergeOpportunities(s, b.id, a.id)).toThrow(/tracker history/);
    expect(s).toEqual(before);
  });
  it('updates the remaining vacancy status when the only active listing is separated', () => {
    const s = emptyStore();
    ingest(s, input(), now);
    ingest(s, input({ sourceId: 'email' }), now);
    ingest(s, input({ status: 'withdrawn' }), now);
    const originalId = s.opportunities[0].id;
    splitListing(s, s.listings.find((l) => l.sourceId === 'email')!.id);
    expect(s.opportunities.find((o) => o.id === originalId)?.status).toBe('withdrawn');
  });
  it('retains withdrawn offers as evidence but excludes them from ranking', () => {
    const s = emptyStore();
    ingest(s, input(), now);
    ingest(
      s,
      input({ sourceId: 'email', compensation: { ...input().compensation, amount: 300 } }),
      now,
    );
    ingest(
      s,
      input({
        sourceId: 'email',
        compensation: { ...input().compensation, amount: 300 },
        status: 'withdrawn',
      }),
      now,
    );
    const row = evaluate(s, now)[0];
    expect(row.offers).toHaveLength(2);
    expect(row.activeOffers).toHaveLength(1);
    expect(row.ranking.bestHourly).toBe(160);
  });
  it('recognises curated facility aliases but not a different town', () => {
    const s = emptyStore();
    ingest(s, input({ facilityName: 'Cairns Base Hospital' }), now);
    expect(s.opportunities[0].facilityId).toBe('cairns');
    ingest(s, input({ externalId: 'two', town: 'Different town' }), now);
    expect(s.opportunities[1].facilityId).not.toBe('cairns');
  });
});
describe('eligibility before ranking', () => {
  const s = demoStore(),
    o = s.opportunities[0],
    f = s.facilities[0];
  it('routes unknown registration to verification', () =>
    expect(assessEligibility(o, { ...s.profile, registration: 'unknown' }, f, now).status).toBe(
      'Needs verification',
    ));
  it('never treats a silent advertisement as confirmed eligibility', () =>
    expect(
      assessEligibility({ ...o, requirements: unknownRequirements }, s.profile, f, now).status,
    ).toBe('Needs verification'));
  it('excludes a known missing mandatory qualification', () =>
    expect(
      assessEligibility(
        { ...o, requirements: { ...o.requirements, credentials: ['FRANZCP'] } },
        s.profile,
        f,
        now,
      ).status,
    ).toBe('Ineligible'));
  it('verifies an unconfirmed credential list instead of inferring absence', () =>
    expect(
      assessEligibility(
        { ...o, requirements: { ...o.requirements, credentials: ['FRANZCP'] } },
        { ...s.profile, credentialsConfirmed: false },
        f,
        now,
      ).status,
    ).toBe('Needs verification'));
  it('excludes independent work when doctor explicitly cannot provide it', () =>
    expect(
      assessEligibility(
        { ...o, requirements: { ...o.requirements, independentCover: true } },
        s.profile,
        f,
        now,
      ).status,
    ).toBe('Ineligible'));
  it('requires supervision when the profile says so', () =>
    expect(
      assessEligibility(
        { ...o, requirements: { ...o.requirements, supervisionAvailable: false } },
        s.profile,
        f,
        now,
      ).status,
    ).toBe('Ineligible'));
  it('requires an entire placement to fit an availability window', () =>
    expect(
      assessEligibility(
        o,
        { ...s.profile, availability: [{ start: '2027-01-20', end: '2027-02-20' }] },
        f,
        now,
      ).status,
    ).toBe('Ineligible'));
  it('expires in the facility local timezone', () => {
    expect(
      assessEligibility(
        { ...o, endDate: '2027-02-05' },
        s.profile,
        f,
        new Date('2027-02-05T15:00:00Z'),
      ).status,
    ).toBe('Expired/unavailable');
  });
  it('respects Australian daylight saving differences', () => {
    expect(localDate(new Date('2027-01-01T13:30:00Z'), 'Australia/Sydney')).toBe('2027-01-02');
    expect(localDate(new Date('2027-01-01T13:30:00Z'), 'Australia/Brisbane')).toBe('2027-01-01');
  });
  it('does not alter eligibility when ranking weights change', () => {
    const before = evaluate(s, now)
      .map((j) => [j.opportunity.id, j.eligibility.status])
      .sort();
    const after = evaluate(
      { ...s, profile: { ...s.profile, weights: presets['Highest income'] } },
      now,
    )
      .map((j) => [j.opportunity.id, j.eligibility.status])
      .sort();
    expect(after).toEqual(before);
  });
  it('shows a source failure without deleting its opportunities', () => {
    const copy = structuredClone(s);
    copy.sources[0].error = 'HTTP 503';
    const rows = evaluate(copy, now);
    expect(rows).toHaveLength(s.opportunities.length);
    expect(rows[0].freshness).toBe('Source unavailable');
  });
});
describe('honest financial normalisation and scoring', () => {
  it('does not invent paid days from calendar dates', () => {
    const pay = normalisePay({ ...emptyCompensation, amount: 2000, basis: 'day', onCall: 'none' });
    expect(pay.gross).toBeNull();
    expect(pay.hourly).toBeNull();
  });
  it('calculates gross, expenses and travel-adjusted commitment separately', () => {
    const p = normalisePay({
      ...emptyCompensation,
      amount: 180,
      basis: 'hour',
      paidHours: 80,
      directExpenses: 400,
      travelHours: 8,
      onCall: 'none',
      super: 'additional',
    });
    expect(p.gross).toBe(14400);
    expect(p.afterExpenses).toBe(14000);
    expect(p.hourly).toBe(180);
    expect(p.committedHourly).toBeCloseTo(14000 / 88);
  });
  it('withholds hourly equivalents for overnight on-call commitments', () => {
    const p = normalisePay({
      ...emptyCompensation,
      amount: 2200,
      basis: 'day',
      paidDays: 10,
      paidHours: 80,
      onCall: 'included',
    });
    expect(p.gross).toBe(22000);
    expect(p.hourly).toBeNull();
  });
  it('withholds cash hourly comparison for super-inclusive pay', () =>
    expect(
      normalisePay({
        ...emptyCompensation,
        amount: 160,
        basis: 'hour',
        paidHours: 80,
        onCall: 'none',
        super: 'included',
      }).hourly,
    ).toBeNull());
  it('keeps undisclosed pay discoverable without assigning zero attractiveness', () => {
    const s = demoStore(),
      o = s.opportunities[5],
      f = s.facilities.find((f) => f.id === o.facilityId)!;
    const result = rankOpportunity(
      o,
      f,
      s.offers.filter((x) => x.opportunityId === o.id),
      s.profile,
    );
    expect(result.components.financial).toBeNull();
    expect(result.score).toBeGreaterThan(60);
    expect(result.evidence).toBeLessThan(100);
  });
  it('responds predictably to financial weight', () => {
    const s = demoStore(),
      o = s.opportunities[0],
      f = s.facilities[0],
      offers = s.offers.filter((x) => x.opportunityId === o.id);
    const income = rankOpportunity(o, f, offers, {
      ...s.profile,
      weights: { financial: 100, adventure: 0, clinical: 0, logistics: 0, quality: 0 },
    });
    expect(income.score).toBe(Math.round((160 / 180) * 75));
  });
  it('reports stale evidence without claiming it is withdrawn', () => {
    const j = evaluate(demoStore(), new Date('2026-12-01T00:00:00Z'))[0];
    expect(j.freshness).toBe('Stale — verify');
    expect(j.opportunity.status).toBe('advertised');
  });
});
describe('validation', () => {
  it.each(['2027-02-29', '2027-02-30', '2027-13-01', '2027-00-01'])(
    'rejects impossible date %s',
    (d) => expect(dateOnly.safeParse(d).success).toBe(false),
  );
  it('accepts leap years and keeps date-only durations independent of DST', () => {
    expect(dateOnly.parse('2028-02-29')).toBe('2028-02-29');
    expect(duration({ startDate: '2027-10-02', endDate: '2027-10-04' })).toBe(3);
  });
  it('rejects negative salary, reversed dates and unsafe URLs', () => {
    expect(
      listingInputSchema.safeParse(input({ compensation: { ...emptyCompensation, amount: -1 } }))
        .success,
    ).toBe(false);
    expect(listingInputSchema.safeParse(input({ startDate: '2027-05-01' })).success).toBe(false);
    expect(listingInputSchema.safeParse(input({ url: 'javascript:alert(1)' })).success).toBe(false);
  });
  it('rejects all-zero weights', () =>
    expect(
      profileSchema.safeParse({
        ...demoStore().profile,
        weights: { financial: 0, adventure: 0, clinical: 0, logistics: 0, quality: 0 },
      }).success,
    ).toBe(false));
});
