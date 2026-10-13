import { describe, expect, it } from 'vitest';
import { cleanClientName, parseMedrecruitPage } from '@/server/adapters/medrecruit';
import {
  oneMedicalBlock,
  parseOneMedicalDetail,
  parseOneMedicalIndex,
} from '@/server/adapters/onemedical';
import { commitExtractions, profileRelevance, robotsDelayFor } from '@/server/collectors';
import { applyEnvironmentApprovals } from '@/server/database';
import { fromLabelledBlock } from '@/server/extraction';
import { findFacility } from '@/domain/ingestion';
import { emptyStore } from '@/domain/seed';
import { listingInputSchema, type Facility } from '@/domain/model';

// Fictional records in the sources' real page shapes.
const medrecruitHtml = (jobs: object[], page = 1, total = 40) =>
  `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { jobs: { data: jobs, page, limit: 20, total } } },
  })}</script></body></html>`;
const job = {
  jobNumber: 'JN00900001',
  title: 'Registrar - Psychiatry',
  grade: 'Registrar',
  speciality: 'Psychiatry',
  city: 'Cairns',
  location: 'Queensland',
  country: 'AU',
  clientNameMessage: 'Cairns Hospital - CHHHS (Cairns Campus QLD)',
  displayClientName: true,
  descriptionPlainText:
    'Locum cover is required from 11 - 22 January 2027. Travel and accommodation is included. Please note that all rates are inclusive of superannuation.',
  startDate: '2027-01-11',
  endDate: '2027-01-22',
  payRate: '1500',
  payInterval: 'per day',
  workType: 'Locum',
  status: 'open',
};

describe('Medrecruit adapter', () => {
  it('reads structured locum jobs from the embedded page data', () => {
    const { blocks, hasMore } = parseMedrecruitPage(
      medrecruitHtml([job, { ...job, jobNumber: 'JN2', workType: 'Permanent' }]),
    );
    expect(hasMore).toBe(true);
    expect(blocks).toHaveLength(1);
    const d = fromLabelledBlock(blocks[0], 'medrecruit', 'm').draft;
    expect(d.facilityName).toBe('Cairns Hospital');
    expect(d.state).toBe('QLD');
    expect(d.grade).toBe('Registrar');
    expect(d.specialty).toBe('Psychiatry');
    expect(d.compensation).toMatchObject({ amount: 1500, basis: 'day', super: 'included' });
    expect(d.accommodation).toBe('included');
    expect(d.externalId).toBe('medrecruit-JN00900001');
    expect(d.url).toBe('https://medrecruit.medworld.com/jobs/registrar/psychiatry/jn00900001');
    expect(listingInputSchema.safeParse(d).success).toBe(true);
  });
  it('reports the last page and a changed page shape', () => {
    expect(parseMedrecruitPage(medrecruitHtml([job], 2, 40)).hasMore).toBe(false);
    expect(() => parseMedrecruitPage('<html></html>')).toThrow(/no embedded job data/);
  });
  it('cleans client names', () => {
    expect(cleanClientName('North West Regional Hospital - NWTHS  (Burnie Campus TAS)')).toBe(
      'North West Regional Hospital',
    );
    expect(cleanClientName('Yass District Hospital NSW')).toBe('Yass District Hospital');
  });
  it('maps written-out grades', () => {
    const d = fromLabelledBlock(
      parseMedrecruitPage(
        medrecruitHtml([
          {
            ...job,
            grade: 'Resident Medical Officer',
            title: 'Resident Medical Officer - Medicine',
            speciality: 'Medicine',
          },
        ]),
      ).blocks[0],
      'medrecruit',
      'm',
    ).draft;
    expect(d.grade).toBe('RMO');
    expect(d.specialty).toBe('General medicine');
  });
});

describe('1Medical adapter', () => {
  it('reads the WordPress index titles', () => {
    const entries = parseOneMedicalIndex([
      {
        id: 1,
        link: 'https://www.1medical.com.au/doctors/jobs-board/psychiatry-job-1/',
        title: { rendered: 'Psychiatry | TAS | 30/11/2026 | 26/02/2027' },
      },
      {
        id: 2,
        link: 'https://www.1medical.com.au/doctors/jobs-board/ed-job-2/',
        title: { rendered: 'Emergency Medicine | QLD | ASAP | 31/01/2027' },
      },
      { id: 3, link: 'x', title: { rendered: 'Malformed title' } },
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      specialty: 'Psychiatry',
      state: 'TAS',
      start: '2026-11-30',
      end: '2027-02-26',
    });
    expect(entries[1].start).toBeNull();
  });
  it('reads a job page and builds a valid listing', () => {
    const html = `<h1 class="h2 white">Psychiatry <span>Consultant</span></h1>
      <div class="cms-area jobdetail-page"><div class="role_detail_box"><h5>Role details</h5><ul>
      <li><svg></svg> Exampletown, Tasmania </li><li> $2500 per day </li><li> Psychiatry </li><li> Locum </li>
      <li> Starting 30-Nov-2026 - 26-Feb-2027 </li></ul></div><p>BenefitsTravel and accommodation provided.</p></div>`;
    expect(parseOneMedicalDetail(html)).toMatchObject({
      role: 'Psychiatry Consultant',
      town: 'Exampletown',
      state: 'TAS',
      rateText: '$2500 per day',
      start: '2026-11-30',
      end: '2027-02-26',
      accommodation: true,
    });
    const [entry] = parseOneMedicalIndex([
      {
        id: 9,
        link: 'https://www.1medical.com.au/doctors/jobs-board/psychiatry-job-9/',
        title: { rendered: 'Psychiatry | TAS | 30/11/2026 | 26/02/2027' },
      },
    ]);
    const d = fromLabelledBlock(oneMedicalBlock(entry, html), '1medical', 'x').draft;
    expect(d).toMatchObject({
      grade: 'Consultant',
      specialty: 'Psychiatry',
      town: 'Exampletown',
      externalId: '1medical-9',
    });
    expect(d.compensation).toMatchObject({ amount: 2500, basis: 'day' });
    expect(listingInputSchema.safeParse(d).success).toBe(true);
  });
});

describe('collection pipeline', () => {
  it('honours robots rules by path and crawl delay', () => {
    const robots =
      'User-agent: *\nAllow: /\nDisallow: /cgi-bin/\nDisallow: /wp-admin/\nCrawl-delay: 5';
    expect(robotsDelayFor(robots, ['/wp-json/wp/v2/job_posts'])).toBe(5000);
    expect(robotsDelayFor(robots, ['/wp-admin/x'])).toBeNull();
    expect(robotsDelayFor('User-agent: *\nDisallow: /*/search', ['/jobs/search'])).toBeNull();
    expect(robotsDelayFor('<html>challenge</html>', ['/'])).toBeNull();
    expect(robotsDelayFor('User-agent: *\nAllow: /*', ['/jobs/listing/locum/australia'])).toBe(0);
  });
  it('imports valid records and queues the rest', () => {
    const store = emptyStore();
    const valid = fromLabelledBlock(
      parseMedrecruitPage(medrecruitHtml([job])).blocks[0],
      'medrecruit',
      'm',
    );
    const invalid = fromLabelledBlock(
      { labelled: 'Title: Mystery locum', raw: 'Mystery locum', notes: [] },
      'medrecruit',
      'm',
    );
    const first = commitExtractions(store, 'medrecruit', [valid, invalid], true);
    expect(first).toEqual({ imported: 1, unchanged: 0, queued: 1 });
    expect(store.listings).toHaveLength(1);
    expect(commitExtractions(store, 'medrecruit', [valid, invalid], true)).toEqual({
      imported: 0,
      unchanged: 1,
      queued: 0,
    });
    expect(commitExtractions(emptyStore(), 'medrecruit', [valid], false)).toEqual({
      imported: 0,
      unchanged: 0,
      queued: 1,
    });
  });
  it('never skips a listing for being outside the profile; relevance only orders work (LR-001)', () => {
    const profile = { ...emptyStore().profile, competentSpecialties: ['Intensive care' as const] };
    expect(profileRelevance(profile, 'Psychiatry', 'QLD')).toBe(3);
    expect(profileRelevance(profile, 'Intensive care', 'QLD')).toBe(2);
    expect(profileRelevance(profile, 'Other', 'QLD')).toBe(1);
    expect(profileRelevance(profile, null, 'QLD')).toBe(1);
    expect(profileRelevance({ ...profile, excludedStates: ['WA'] }, 'Psychiatry', 'WA')).toBe(0);
  });
  it('records environment approvals only for unreviewed collector sources', () => {
    const store = emptyStore();
    store.sources.find((s) => s.id === '1medical')!.permission = 'denied';
    applyEnvironmentApprovals(store, {
      APPROVED_SOURCES: 'medrecruit, 1medical,wavelength,manual',
    });
    const by = (id: string) => store.sources.find((s) => s.id === id)!;
    expect(by('medrecruit')).toMatchObject({ permission: 'approved', enabled: true });
    expect(by('wavelength').permissionEvidence).toMatch(/APPROVED_SOURCES/);
    expect(by('1medical').permission).toBe('denied');
    expect(by('manual').permission).toBe('unreviewed');
  });
  it('reuses a directory hospital and fills its missing town', () => {
    const store = emptyStore();
    const nwrh: Facility = {
      id: 'aihw-H1',
      name: 'North West Regional Hospital',
      aliases: [],
      town: '',
      state: 'TAS',
      timezone: 'Australia/Hobart',
      lat: null,
      lon: null,
      adventure: null,
      adventureNote: '',
      coverage: 'unknown',
      sector: 'public',
    };
    store.facilities.push(nwrh);
    const d = fromLabelledBlock(
      parseMedrecruitPage(
        medrecruitHtml([
          {
            ...job,
            city: 'Burnie',
            location: 'Tasmania',
            clientNameMessage: 'North West Regional Hospital - NWTHS (Burnie Campus TAS)',
          },
        ]),
      ).blocks[0],
      'medrecruit',
      'm',
      store.facilities,
    ).draft;
    const f = findFacility(store, listingInputSchema.parse(d));
    expect(f.id).toBe('aihw-H1');
    expect(f.town).toBe('Burnie');
  });
});
describe('robots rules (RFC 9309)', () => {
  it('lets a longer Allow override a shorter Disallow', () => {
    const robots =
      'User-agent: *\nDisallow: /jobview\nAllow: /jobview/*/*\n\nUser-agent: *\nDisallow: /wp-admin/';
    expect(robotsDelayFor(robots, ['/jobview/locum-gp-cairns/4fcd/'])).toBe(0);
    expect(robotsDelayFor(robots, ['/jobview'])).toBeNull();
    expect(robotsDelayFor(robots, ['/wp-admin/x'])).toBeNull();
  });
  it('prefers a group naming LocumRadar over the wildcard group', () => {
    const robots = 'User-agent: *\nDisallow: /\n\nUser-agent: LocumRadar\nAllow: /jobs\nDisallow: /';
    expect(robotsDelayFor(robots, ['/jobs/1'])).toBe(0);
    expect(robotsDelayFor(robots, ['/about'])).toBeNull();
  });
  it('treats an empty Disallow as allowing everything', () => {
    expect(robotsDelayFor('User-agent: *\nDisallow:', ['/job/x'])).toBe(0);
  });
});
