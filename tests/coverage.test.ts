import { describe, expect, it } from 'vitest';
import { chapman, coverageReport, facilityIntelligence, marketTrends } from '@/domain/coverage';
import { ingest } from '@/domain/ingestion';
import { emptyStore } from '@/domain/seed';
import { emptyCompensation, unknownRequirements, type ListingInput } from '@/domain/model';

const now = new Date('2026-10-13T02:00:00Z');
const listing = (i: number, sourceId: string, amount = 160): ListingInput => ({
  sourceId,
  externalId: `${sourceId}-${i}`,
  url: null,
  rawText: 'x',
  title: `Job ${i}`,
  facilityName: 'Cairns Hospital',
  town: 'Cairns',
  state: 'QLD',
  specialty: 'Psychiatry',
  grade: 'Registrar',
  // Distinct dates per vacancy so blocks never look alike.
  startDate: new Date(Date.UTC(2027, 0, 1) + i * 20 * 86400000).toISOString().slice(0, 10),
  endDate: new Date(Date.UTC(2027, 0, 8) + i * 20 * 86400000).toISOString().slice(0, 10),
  roster: 'Days',
  reference: `REF-${i}`,
  requirements: { ...unknownRequirements },
  compensation: { ...emptyCompensation, amount, basis: 'hour', super: 'additional', onCall: 'none' },
  flights: 'unknown',
  accommodation: 'unknown',
  status: 'advertised',
  contact: '',
  evidence: {},
  flexibility: 'unknown',
  shifts: [],
});

describe('capture–recapture', () => {
  it("matches Chapman's estimator", () => {
    // (50+1)(40+1)/(20+1) − 1 = 98.57…
    expect(chapman(50, 40, 20).total).toBeCloseTo(98.571, 2);
    const r = chapman(50, 40, 20);
    expect(r.low).toBeLessThan(r.total);
    expect(r.high).toBeGreaterThan(r.total);
  });
  it('estimates coverage from overlapping sources and reports unique yield', () => {
    const s = emptyStore();
    // 30 vacancies: medrecruit sees 0–19, 1medical sees 10–29; overlap of 10.
    for (let i = 0; i < 20; i++) ingest(s, listing(i, 'medrecruit'), now);
    for (let i = 10; i < 30; i++) ingest(s, listing(i, '1medical', 175), now);
    const report = coverageReport(s, now);
    expect(report.observed).toBe(30);
    const mr = report.perSource.find((p) => p.id === 'medrecruit')!;
    expect(mr).toMatchObject({ active: 20, unique: 10, shared: 10 });
    expect(report.estimate!.total).toBe(Math.round(chapman(20, 20, 10).total));
    expect(report.estimate!.coverage).toBeGreaterThan(0.7);
    expect(report.estimate!.coverage).toBeLessThanOrEqual(1);
    expect(report.caveats[0]).toMatch(/upper bound/);
  });
  it('declines to estimate without enough overlap', () => {
    const s = emptyStore();
    for (let i = 0; i < 6; i++) ingest(s, listing(i, 'medrecruit'), now);
    for (let i = 6; i < 12; i++) ingest(s, listing(i, '1medical'), now);
    expect(coverageReport(s, now).estimate).toBeNull();
  });
});

describe('facility and market intelligence', () => {
  it('summarises a hospital’s observed recruitment', () => {
    const s = emptyStore();
    for (let i = 0; i < 4; i++) ingest(s, listing(i, 'medrecruit', 150 + i * 10), now);
    const f = s.facilities.find((v) => v.name === 'Cairns Hospital')!;
    const intel = facilityIntelligence(s, f, now);
    expect(intel.total).toBe(4);
    expect(intel.recurring).toBe(true);
    expect(intel.rate).toMatchObject({ min: 150, max: 180, n: 4 });
    expect(intel.sources[0]).toMatchObject({ id: 'medrecruit', count: 4 });
  });
  it('groups advertised volume and rates by placement month', () => {
    const s = emptyStore();
    ingest(s, listing(0, 'medrecruit', 150), now);
    ingest(s, listing(1, 'medrecruit', 170), now);
    const trend = marketTrends(s);
    expect(trend[0]).toMatchObject({ month: '2027-01', count: 2, medianHourly: 160 });
  });
});

describe('nature lens', async () => {
  const { alaUrl, parseAla, rescore } = await import('@/server/biodiversity');
  it('builds an Atlas of Living Australia query and counts species', () => {
    const url = new URL(
      alaUrl({ lat: -16.92, lon: 145.77 }, { enabled: true, query: 'family:Salticidae', label: 'jumping spider', radiusKm: 25 }),
    );
    expect(url.hostname).toBe('biocache-ws.ala.org.au');
    expect(url.searchParams.get('q')).toBe('family:Salticidae');
    expect(url.searchParams.get('radius')).toBe('25');
    expect(
      parseAla({
        totalRecords: 812,
        facetResults: [
          {
            fieldName: 'species',
            fieldResult: [
              { label: 'Maratus volans', count: 3 },
              { label: 'Cosmophasis bitaeniata', count: 40 },
              { label: 'Not supplied', count: 9 },
            ],
          },
        ],
      }),
    ).toEqual({ records: 812, species: 2 });
    expect(() => parseAla({ error: 'x' })).toThrow();
  });
  it('scores richness on a log scale relative to the richest hospital', () => {
    const f = (species: number) =>
      ({ biodiversity: { taxon: 'jumping spider', species, records: 0, radiusKm: 25, score: null, fetchedAt: '' } }) as never;
    const list = [f(80), f(8), f(0)];
    rescore(list, 'jumping spider');
    expect(list.map((x: { biodiversity: { score: number } }) => x.biodiversity.score)).toEqual([100, 50, 0]);
  });
});
