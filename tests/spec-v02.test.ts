import { describe, expect, it } from 'vitest';
import { demoStore, emptyStore } from '@/domain/seed';
import {
  assessLogistics,
  assessScheduling,
  earnings,
  evaluate,
  evidenceQuality,
  lifecycleOf,
  presets,
  urgencyOf,
} from '@/domain/engine';
import { ingest } from '@/domain/ingestion';
import { deriveAlerts, enquiryDraft, outstandingQuestions, suggestWeights } from '@/domain/insights';
import {
  defaultProfile,
  emptyCompensation,
  migrateProfile,
  unknownRequirements,
  type ListingInput,
  type Profile,
  type Store,
} from '@/domain/model';

/** Specification v0.2, section 16: the twelve MVP acceptance criteria, plus v0.2 decisions. */
const now = new Date('2026-10-13T02:00:00Z');
const profile: Profile = {
  ...structuredClone(defaultProfile),
  name: 'Test doctor',
  registration: 'general',
  pgy: 4,
  credentials: ['ALS'],
  credentialsConfirmed: true,
  fellowshipsConfirmed: true,
  independentCover: 'no',
  supervisionRequired: 'yes',
  eligibleGrades: ['RMO', 'SRMO', 'Registrar'],
  competentSpecialties: ['Psychiatry', 'Emergency medicine'],
  preferredSpecialties: ['Psychiatry'],
  employmentApproval: 'approved',
  availability: [{ start: '2026-10-01', end: '2027-12-31', kind: 'available', note: '' }],
  targetHourly: 180,
};
function base(overrides: Partial<ListingInput> = {}): ListingInput {
  return {
    sourceId: 'medrecruit',
    externalId: 'A-1',
    url: 'https://example.org/job/1',
    rawText: 'Psychiatry registrar locum, Cairns Hospital. $170 per hour plus super.',
    title: 'Psychiatry Registrar',
    facilityName: 'Cairns Hospital',
    town: 'Cairns',
    state: 'QLD',
    specialty: 'Psychiatry',
    grade: 'Registrar',
    startDate: '2027-01-11',
    endDate: '2027-01-24',
    roster: 'Mon-Fri 0800-1630',
    reference: 'CHHHS-PSY-11',
    requirements: {
      ...unknownRequirements,
      registration: 'general',
      minPgy: 3,
      supervisionAvailable: true,
      independentCover: false,
      complete: true,
    },
    compensation: {
      ...emptyCompensation,
      amount: 170,
      basis: 'hour',
      paidHours: 80,
      super: 'additional',
      onCall: 'none',
    },
    flights: 'included',
    accommodation: 'included',
    status: 'advertised',
    contact: 'recruiter@example.org',
    evidence: { rate: '$170 per hour plus super' },
    flexibility: 'fixed',
    shifts: [],
    ...overrides,
  };
}
function store(): Store {
  const s = emptyStore();
  s.profile = structuredClone(profile);
  return s;
}
const job = (s: Store, id: string) => evaluate(s, now).find((j) => j.opportunity.id === id)!;

describe('v0.2 acceptance criteria', () => {
  it('1. ingests vacancies from three independently managed sources', () => {
    const s = store();
    for (const [sourceId, ref, month] of [
      ['medrecruit', 'M-1', '02'],
      ['1medical', 'O-1', '03'],
      ['wavelength', 'W-1', '04'],
    ])
      ingest(
        s,
        base({ sourceId, externalId: ref, startDate: `2027-${month}-01`, endDate: `2027-${month}-14` }),
        now,
      );
    expect(new Set(s.listings.map((l) => l.sourceId)).size).toBe(3);
  });
  it('2. consolidates one vacancy advertised by two agencies, keeping both offers', () => {
    const s = store();
    const a = ingest(s, base(), now);
    const b = ingest(
      s,
      base({ sourceId: '1medical', externalId: 'X-9', compensation: { ...base().compensation, amount: 185 } }),
      now,
    );
    expect(b.opportunityId).toBe(a.opportunityId);
    expect(s.offers.map((o) => o.compensation.amount).sort()).toEqual([170, 185]);
    expect(job(s, a.opportunityId).ranking.bestHourly).toBe(185);
  });
  it('3. keeps different roles and blocks at one hospital separate', () => {
    const s = store();
    const a = ingest(s, base(), now);
    const b = ingest(s, base({ externalId: 'A-2', startDate: '2027-01-25', endDate: '2027-02-07' }), now);
    const c = ingest(s, base({ externalId: 'A-3', grade: 'SRMO', reference: 'CHHHS-PSY-12' }), now);
    expect(new Set([a.opportunityId, b.opportunityId, c.opportunityId]).size).toBe(3);
  });
  it('4. excludes confirmed-ineligible jobs from the default feed but keeps them', () => {
    const s = store();
    const { opportunityId } = ingest(s, base({ grade: 'Consultant' }), now);
    const j = job(s, opportunityId);
    expect(j.eligibility.status).toBe('Ineligible');
    expect(j.rankable).toBe(false);
    expect(j.hiddenBy).toContain('ineligible');
  });
  it('4b. specialty competence is an eligibility fact, distinct from preference', () => {
    const s = store();
    const icu = ingest(s, base({ specialty: 'Intensive care', externalId: 'I-1' }), now);
    const ed = ingest(s, base({ specialty: 'Emergency medicine', externalId: 'E-1', reference: 'ED' }), now);
    expect(job(s, icu.opportunityId).eligibility.status).toBe('Ineligible');
    // Competent but not preferred: eligible, ranked, lower clinical score.
    const e = job(s, ed.opportunityId);
    expect(e.eligibility.status).toBe('Eligible');
    expect(e.ranking.components.clinical).toBe(50);
  });
  it('5. ranks uncertain-eligibility jobs in the main feed with a clear label (LR-002)', () => {
    const s = store();
    const { opportunityId } = ingest(
      s,
      base({ requirements: { ...unknownRequirements }, externalId: 'U-1' }),
      now,
    );
    const j = job(s, opportunityId);
    expect(j.eligibility.status).toBe('Needs verification');
    expect(j.rankable).toBe(true);
    expect(j.ranking.score).not.toBeNull();
  });
  it('6. keeps a negotiable conflict ranked and conspicuous; a hard conflict is hidden', () => {
    const s = store();
    const { opportunityId } = ingest(s, base(), now);
    s.profile.availability.push({ start: '2027-01-15', end: '2027-01-16', kind: 'negotiable', note: 'Clinic' });
    let j = job(s, opportunityId);
    expect(j.scheduling.status).toBe('Fits with conditions');
    expect(j.scheduling.reasons.join(' ')).toMatch(/negotiable/i);
    expect(j.rankable).toBe(true);
    s.profile.availability.push({ start: '2027-01-20', end: '2027-01-20', kind: 'unavailable', note: 'Exam' });
    j = job(s, opportunityId);
    expect(j.scheduling.status).toBe('Conflict');
    expect(j.hiddenBy).toContain('date conflict');
    expect(j.eligibility.status).toBe('Eligible');
  });
  it('6b. never assumes provisional leave is approved', () => {
    const p = { ...profile, availability: [...profile.availability, { start: '2027-01-01', end: '2027-01-31', kind: 'provisional-leave' as const, note: '' }] };
    const s = store();
    const { opportunityId } = ingest(s, base(), now);
    const r = assessScheduling(s.opportunities.find((o) => o.id === opportunityId)!, p);
    expect(r.status).toBe('Fits with conditions');
    expect(r.reasons.join(' ')).toMatch(/not assumed/);
  });
  it('6c. a flexible-dates conflict becomes a condition rather than a block', () => {
    const s = store();
    const { opportunityId } = ingest(s, base({ flexibility: 'flexible' }), now);
    s.profile.availability.push({ start: '2027-01-20', end: '2027-01-20', kind: 'unavailable', note: '' });
    expect(job(s, opportunityId).scheduling.status).toBe('Fits with conditions');
  });
  it('7. supports current and future placements with configurable urgency', () => {
    const s = store();
    const soon = ingest(s, base({ externalId: 'S', startDate: '2026-10-20', endDate: '2026-10-27' }), now);
    const later = ingest(s, base({ externalId: 'L', startDate: '2027-09-01', endDate: '2027-09-14' }), now);
    expect(job(s, soon.opportunityId).urgency).toBe('Urgent');
    expect(job(s, later.opportunityId).urgency).toBe('Long-term');
    const o = s.opportunities.find((v) => v.id === soon.opportunityId)!;
    expect(urgencyOf(o, { ...s.profile, urgency: { urgentDays: 3, nearTermDays: 30, mediumTermDays: 90 } }, now, 'Australia/Brisbane')).toBe('Near-term');
  });
  it('8. keeps advertised, calculated and estimated figures distinguishable', () => {
    const s = store();
    const { opportunityId } = ingest(
      s,
      base({
        flights: 'not included',
        accommodation: 'unknown',
        compensation: { ...base().compensation, amount: 1600, basis: 'day', paidHours: null },
      }),
      now,
    );
    const j = job(s, opportunityId);
    const noAssumptions = earnings(j.activeOffers[0], j.opportunity, s.profile);
    expect(noAssumptions.advertised).toMatchObject({ value: 1600, kind: 'advertised' });
    expect(noAssumptions.gross.kind).toBe('estimated'); // weekdays in block, stated as an assumption
    expect(noAssumptions.flights.kind).toBe('unknown');
    expect(noAssumptions.net.value).toBeNull();
    const withCosts = earnings(j.activeOffers[0], j.opportunity, {
      ...s.profile,
      costs: { returnFlight: 600, nightlyAccommodation: 150, hourlyValueOfTime: null, assumedHoursPerDay: null },
    });
    expect(withCosts.flights).toMatchObject({ value: 600, kind: 'estimated' });
    expect(withCosts.accommodation.value).toBe(150 * 14);
    expect(withCosts.net.kind).toBe('estimated');
    expect(withCosts.assumptions.length).toBeGreaterThan(0);
  });
  it('9. user-adjusted weights produce predictable changes', () => {
    const s = store();
    const rich = ingest(s, base({ externalId: 'R', reference: 'R', compensation: { ...base().compensation, amount: 250 } }), now);
    const nice = ingest(s, base({ externalId: 'N', reference: 'N', specialty: 'Emergency medicine', compensation: { ...base().compensation, amount: 150 } }), now);
    s.profile.weights = presets['Maximum income'];
    const income = evaluate(s, now).map((j) => j.opportunity.id);
    expect(income.indexOf(rich.opportunityId)).toBeLessThan(income.indexOf(nice.opportunityId));
    // Raising only the income weight never lowers the richer job's relative score.
    s.profile.weights = { ...presets['Best overall'], financial: 90 };
    const a = job(s, rich.opportunityId).ranking.score!,
      b = job(s, nice.opportunityId).ranking.score!;
    expect(a).toBeGreaterThan(b);
  });
  it('10. important fields stay traceable to the original source', () => {
    const s = store();
    const { opportunityId } = ingest(s, base(), now);
    const l = s.listings.find((v) => v.opportunityId === opportunityId)!;
    expect(l.url).toBe('https://example.org/job/1');
    expect(l.rawText).toContain('$170');
    expect(l.evidence.rate).toContain('$170');
    expect(s.observations).toHaveLength(1);
  });
  it('11. a source outage is shown without marking known vacancies filled', () => {
    const s = store();
    const { opportunityId } = ingest(s, base(), now);
    s.sources.find((v) => v.id === 'medrecruit')!.error = 'HTTP 503';
    const later = new Date(now.getTime() + 20 * 86400000);
    const j = evaluate(s, later).find((v) => v.opportunity.id === opportunityId)!;
    expect(j.freshness).toBe('Source unavailable');
    expect(j.lifecycle).toBe('Currently advertised');
    s.sources.find((v) => v.id === 'medrecruit')!.error = null;
    expect(evaluate(s, later).find((v) => v.opportunity.id === opportunityId)!.lifecycle).toBe('Availability unconfirmed');
  });
  it('12. drafts a recruiter enquiry from the evidence without sending it', () => {
    const s = store();
    const { opportunityId } = ingest(
      s,
      base({ roster: '', compensation: { ...base().compensation, super: 'unknown' } }),
      now,
    );
    const j = job(s, opportunityId);
    const draft = enquiryDraft(j, s.profile);
    expect(draft.subject).toContain('Cairns Hospital');
    expect(draft.body).toContain('A-1');
    expect(draft.questions.join(' ')).toMatch(/superannuation/);
    expect(draft.questions.join(' ')).toMatch(/roster/);
  });
});

describe('v0.2 assessments', () => {
  it('flags a start inside the credentialing lead time', () => {
    const s = store();
    const { opportunityId } = ingest(s, base({ startDate: '2026-10-20', endDate: '2026-10-27' }), now);
    const j = job(s, opportunityId);
    expect(j.logistics.status).toBe('Tight timeline');
    expect(j.logistics.reasons[0]).toMatch(/credentialing/);
  });
  it('treats a job near home as local, with no travel to arrange', () => {
    const s = store();
    s.profile.homeBase = 'Cairns, QLD';
    const { opportunityId } = ingest(s, base({ flights: 'not included', accommodation: 'not included' }), now);
    const j = job(s, opportunityId);
    expect(j.logistics.local).toBe(true);
    expect(j.logistics.status).toBe('Straightforward');
  });
  it('hides excluded states as a personal preference, not ineligibility', () => {
    const s = store();
    s.profile.excludedStates = ['QLD'];
    const { opportunityId } = ingest(s, base(), now);
    const j = job(s, opportunityId);
    expect(j.eligibility.status).toBe('Eligible');
    expect(j.hiddenBy).toEqual(['excluded state']);
    const f = s.facilities.find((v) => v.id === j.facility.id)!;
    expect(assessLogistics(j.opportunity, f, j.activeOffers, s.profile, { now, home: null }).status).toBe('Excluded');
  });
  it('rates evidence quality separately from attractiveness', () => {
    const s = store();
    const strong = ingest(s, base({ status: 'confirmed available' }), now);
    const weak = ingest(
      s,
      base({ externalId: 'W', reference: 'W', roster: '', compensation: { ...emptyCompensation }, requirements: { ...unknownRequirements } }),
      now,
    );
    const q = (id: string) => {
      const j = job(s, id);
      return evidenceQuality(j.opportunity, j.facility, j.activeOffers, j.listings, now);
    };
    expect(q(strong.opportunityId).label).toBe('High');
    expect(q(weak.opportunityId).label).toBe('Low');
    expect(q(weak.opportunityId).gaps.join(' ')).toMatch(/No rate/);
  });
  it('separates a weak job from one that is hard to assess', () => {
    const s = store();
    s.profile.preferredSpecialties = [];
    const { opportunityId } = ingest(
      s,
      base({ compensation: { ...emptyCompensation }, flights: 'unknown', accommodation: 'unknown' }),
      now,
    );
    const r = job(s, opportunityId).ranking;
    expect(r.assessable).toBe(false);
    expect(r.missing).toContain('Income');
  });
  it('describes lifecycle states', () => {
    const s = store();
    const { opportunityId } = ingest(s, base(), now);
    const o = s.opportunities.find((v) => v.id === opportunityId)!;
    const f = s.facilities.find((v) => v.id === o.facilityId)!;
    expect(lifecycleOf(o, f, now, undefined, false)).toBe('Newly discovered');
    expect(lifecycleOf(o, f, now, 'Dismissed', false)).toBe('Archived');
    expect(lifecycleOf({ ...o, status: 'withdrawn' }, f, now, undefined, false)).toBe('Filled or withdrawn');
    expect(lifecycleOf(o, f, new Date('2027-03-01T00:00:00Z'), undefined, false)).toBe('Expired');
  });
  it('treats a listed shift pattern as the working days', () => {
    const s = store();
    const { opportunityId } = ingest(
      s,
      base({
        shifts: [
          { date: '2027-01-12', start: '08:00', end: '18:00', kind: 'day' },
          { date: '2027-01-19', start: '08:00', end: '18:00', kind: 'day' },
        ],
        compensation: { ...base().compensation, amount: 2000, basis: 'shift', paidHours: null },
      }),
      now,
    );
    s.profile.availability.push({ start: '2027-01-15', end: '2027-01-16', kind: 'unavailable', note: '' });
    const j = job(s, opportunityId);
    // The unavailable days fall between shifts, so there is no clash.
    expect(j.scheduling.status).toBe('Fits');
    expect(earnings(j.activeOffers[0], j.opportunity, s.profile).gross.value).toBe(4000);
  });
});

describe('alerts and suggestions', () => {
  it('announces a vacancy once however many agencies advertise it', () => {
    const s = store();
    ingest(s, base(), now);
    ingest(s, base({ sourceId: '1medical', externalId: 'Z' }), now);
    ingest(s, base({ sourceId: 'wavelength', externalId: 'Y' }), now);
    s.profile.alertScore = 0;
    const alerts = deriveAlerts(s, evaluate(s, now), now);
    expect(alerts.filter((a) => a.kind === 'new-high')).toHaveLength(1);
  });
  it('raises a material rate change and a better competing offer', () => {
    const s = store();
    ingest(s, base(), now);
    ingest(s, base({ compensation: { ...base().compensation, amount: 200 } }), now);
    ingest(s, base({ sourceId: '1medical', externalId: 'Q', compensation: { ...base().compensation, amount: 230 } }), now);
    const kinds = deriveAlerts(s, evaluate(s, now), now).map((a) => a.kind);
    expect(kinds).toContain('rate');
    expect(kinds).toContain('better-offer');
  });
  it('ignores trivial rate movement', () => {
    const s = store();
    ingest(s, base(), now);
    ingest(s, base({ compensation: { ...base().compensation, amount: 172 } }), now);
    expect(deriveAlerts(s, evaluate(s, now), now).map((a) => a.kind)).not.toContain('rate');
  });
  it('marks alerts read after the seen timestamp', () => {
    const s = store();
    ingest(s, base(), now);
    s.profile.alertScore = 0;
    s.profile.alertsSeenAt = new Date(now.getTime() + 1000).toISOString();
    expect(deriveAlerts(s, evaluate(s, now), now).every((a) => !a.unread)).toBe(true);
  });
  it('suggests, but never applies, weights learnt from saves and dismissals', () => {
    const s = store();
    for (let i = 0; i < 8; i++) {
      const { opportunityId } = ingest(
        s,
        base({
          externalId: `J${i}`,
          reference: `J${i}`,
          compensation: { ...base().compensation, amount: i < 4 ? 260 : 120 },
        }),
        now,
      );
      s.actions.push({ opportunityId, stage: i < 4 ? 'Saved' : 'Dismissed', notes: '', updatedAt: now.toISOString() });
    }
    const before = { ...s.profile.weights };
    const suggestion = suggestWeights(s.profile, evaluate(s, now));
    expect(suggestion).not.toBeNull();
    expect(suggestion!.weights.financial).toBeGreaterThan(before.financial);
    expect(s.profile.weights).toEqual(before);
  });
  it('lists outstanding questions only for facts not established', () => {
    const s = demoStore();
    const j = evaluate(s, now)[0];
    expect(outstandingQuestions(j)).not.toContain('What is the rate, and on what basis (hourly, daily, per shift)?');
  });
});

describe('profile migration', () => {
  it('upgrades a v0.1 profile without inventing facts', () => {
    const old = {
      name: 'Old',
      homeBase: 'Cairns, QLD',
      registration: 'general',
      pgy: 4,
      credentials: [],
      credentialsConfirmed: false,
      independentCover: 'unknown',
      supervisionRequired: 'unknown',
      eligibleGrades: ['Registrar'],
      preferredSpecialties: ['Psychiatry'],
      preferredStates: [],
      excludedStates: [],
      availability: [{ start: '2027-01-01', end: '2027-03-31' }],
      minimumHourly: 0,
      targetHourly: 180,
      maxPlacementDays: 90,
      weights: { financial: 30, adventure: 25, clinical: 20, logistics: 15, quality: 10 },
    };
    const p = migrateProfile(old);
    expect(p.availability[0]).toMatchObject({ kind: 'available', note: '' });
    expect(p.competentSpecialties).toEqual([]);
    expect(p.employmentApproval).toBe('unknown');
    expect(p.costs.returnFlight).toBeNull();
    expect(p.pgy).toBe(4);
  });
});
