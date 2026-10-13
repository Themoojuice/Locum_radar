import { describe, expect, it } from 'vitest';
import {
  classifyRole,
  detectEmailFormat,
  parseLongDate,
  parseShortRange,
  singleRate,
  splitRecruiterEmail,
} from '@/server/adapters/email-formats';
import { adzuna, wavelength } from '@/server/adapters/json-sources';
import {
  mergeFacilities,
  parseMyHospitals,
  resolveFacility,
  shortName,
  townFor,
} from '@/server/adapters/myhospitals';
import { fromLabelledBlock, previewImport } from '@/server/extraction';
import { allowedSourceUrl } from '@/server/collectors';
import { listingInputSchema } from '@/domain/model';

// All fixtures are fictional. They copy the layout of real recruiter emails,
// not their contents, recruiter names or contact details.
const digest = `Hi Example,
<div>Please see below for current RMO locum opportunities.</div><br><div><strong>Note:</strong> NSW rates are plus super. All other hourly rates include super unless specified.</div><br>
<div><strong>NSW</strong></div><div><strong>Exampletown – Medical SRMO</strong></div><div>2 Nov – 31 Jan | Mon–Fri, 0800–1630 | $120/hr | No T&amp;A</div><br>
<div><strong>Sampleville – ED SRMO</strong></div><div>14–24 Nov | Nights, 2230–0830 | $170/hr | T&amp;A provided</div><div>21–24 Nov | Afternoons | $150/hr | T&amp;A provided</div><br>
<div><strong>VIC</strong></div><div><strong>Fictional Base – Psychiatry Registrar (PGY4+)</strong></div><div>20 Oct – 13 Nov | Day blocks | $140/hr | T&amp;A provided</div><div>Requires recent psychiatry experience.</div><br>
<div><strong>TAS</strong></div><div><strong>Imaginary Hospital – RMO</strong></div><div>$168/hr | T&amp;A provided</div><ul><li>October: 15 (day), 20–21 (nights)</li></ul>
<div>Reply to apply or call the team.</div>`;

const table = `Hi Example,
Please see below list of highlighted jobs:
State
Start Date
End Date
Shifts
Hospital
Job Title
Pay rate
NEW SOUTH WALES
NSW
Saturday, 3 October 2026
Monday, 5 October 2026
0800 - 1800
Example Base Hospital
Gen Med Registrar
$220 p/h + super
NSW
Monday, 16 November 2026
Thursday, 29 January 2026
0800 - 1630
Sample District Hospital
Gen Med Registrar
$130 p/h + super
VICTORIA
VIC
ASAP
Sunday, 18 October 2026
Mixed roster
Fictional Hospital
Gen Med HMO
$160 -170 p/h
Best regards,`;

const single = `Hi Example,
Example Base Hospital in NSW are seeking a SURGICAL RMO - (PGY3)

0730hrs - 1600hrs Monday 16 November 2026 - Monday 1 February 2027 (incl) @ $130p/hr with Super on top

Travel and accommodation are provided.`;

describe('recruiter email formats', () => {
  it('recognises the three multi-vacancy layouts', () => {
    expect(detectEmailFormat({ text: digest, from: 'info@connect.medrecruit.example' })).toBe(
      'medrecruit-digest',
    );
    expect(detectEmailFormat({ text: table })).toBe('1medical-table');
    expect(detectEmailFormat({ text: single, from: 'someone@1medical.example' })).toBe(
      '1medical-single',
    );
    expect(detectEmailFormat({ text: 'Title: One\nHospital: Cairns Hospital' })).toBeNull();
  });

  it('splits a digest into one block per date row and applies the stated super rule', () => {
    const blocks = splitRecruiterEmail('medrecruit-digest', {
      text: digest,
      sentAt: new Date('2026-10-12T01:50:00Z'),
    });
    expect(blocks).toHaveLength(5);
    const first = fromLabelledBlock(blocks[0], 'email', 'medrecruit-digest').draft;
    expect(first.facilityName).toBe('Exampletown');
    expect(first.state).toBe('NSW');
    expect(first.grade).toBe('SRMO');
    expect(first.specialty).toBe('General medicine');
    expect(first.startDate).toBe('2026-11-02');
    expect(first.endDate).toBe('2027-01-31');
    expect(first.compensation?.amount).toBe(120);
    expect(first.compensation?.basis).toBe('hour');
    expect(first.compensation?.super).toBe('additional');
    expect(first.accommodation).toBe('not included');
    expect(first.flights).toBe('not included');
    expect(blocks[0].notes.join(' ')).toMatch(/Year inferred/);
    // Two date rows under one heading stay separate vacancies with distinct IDs.
    const [a, b] = [blocks[1], blocks[2]].map(
      (x) => fromLabelledBlock(x, 'email', 'm').draft.externalId,
    );
    expect(a).not.toBe(b);
    const vic = fromLabelledBlock(blocks[3], 'email', 'm').draft;
    expect(vic.specialty).toBe('Psychiatry');
    expect(vic.requirements?.minPgy).toBe(4);
    expect(vic.compensation?.super).toBe('included');
    expect(vic.accommodation).toBe('included');
    expect(vic.flights).toBe('unknown');
    expect(vic.roster).toContain('Requires recent psychiatry experience');
    const tas = fromLabelledBlock(blocks[4], 'email', 'm');
    expect(tas.draft.startDate).toBeUndefined();
    expect(tas.draft.roster).toContain('October: 15');
    expect(tas.issues.join(' ')).toMatch(/shift list/);
  });

  it('prefers the price segment over side rates quoted in the roster', () => {
    const [b] = splitRecruiterEmail('medrecruit-digest', {
      text: '<div><strong>VIC</strong></div><div><strong>Example – Medical SRMO</strong></div><div>26 Oct – 27 Dec | Multiple blocks, incl. Boxing Day ($150/hr) | $126.60/hr | T&amp;A provided</div>',
      sentAt: new Date('2026-10-12T00:00:00Z'),
    });
    const d = fromLabelledBlock(b, 'email', 'm').draft;
    expect(d.compensation?.amount).toBe(126.6);
    expect(d.roster).toContain('Boxing Day ($150/hr)');
  });

  it('keeps the email block as raw text and an ID that ignores rate changes', () => {
    const anchor = new Date('2026-10-12T00:00:00Z');
    const before = splitRecruiterEmail('medrecruit-digest', { text: digest, sentAt: anchor });
    const after = splitRecruiterEmail('medrecruit-digest', {
      text: digest.replace('$120/hr', '$135/hr'),
      sentAt: anchor,
    });
    const [x, y] = [before[0], after[0]].map((b) => fromLabelledBlock(b, 'email', 'm').draft);
    expect(x.externalId).toBe(y.externalId);
    expect(y.compensation?.amount).toBe(135);
    expect(x.rawText).toContain('Exampletown – Medical SRMO');
  });

  it('reads table rows without repairing source errors', () => {
    const rows = splitRecruiterEmail('1medical-table', { text: table }).map((b) =>
      fromLabelledBlock(b, 'email', '1medical-table'),
    );
    expect(rows).toHaveLength(3);
    expect(rows[0].draft.compensation?.amount).toBe(220);
    expect(rows[0].draft.compensation?.super).toBe('additional');
    expect(rows[0].draft.startDate).toBe('2026-10-03');
    // End before start: flagged, not silently corrected.
    expect(rows[1].draft.endDate).toBe('2026-01-29');
    expect(rows[1].issues.join(' ')).toMatch(/end date before the start date/);
    expect(listingInputSchema.safeParse(rows[1].draft).success).toBe(false);
    expect(rows[2].draft.compensation?.amount).toBeNull();
    expect(rows[2].issues.join(' ')).toMatch(/ASAP/);
    expect(rows[2].draft.grade).toBe('RMO');
  });

  it('reads the HTML table when the email has one', () => {
    const html = `<table><tr><td>State</td><td>Start Date</td><td>End Date</td><td>Shifts</td><td>Hospital</td><td>Job Title</td><td>Pay rate</td></tr>
      <tr><td colspan="7">QUEENSLAND</td></tr>
      <tr><td>QLD</td><td>Monday, 19 October 2026</td><td>Sunday, 31 January 2027</td><td>Mixed roster</td><td>Cairns Hospital</td><td>Psychiatry Registrar</td><td>$1,500 p/d</td></tr></table>`;
    const rows = splitRecruiterEmail('1medical-table', { text: 'see table', html });
    expect(rows).toHaveLength(1);
    const d = fromLabelledBlock(rows[0], 'email', 'm').draft;
    expect(d.facilityName).toBe('Cairns Hospital');
    expect(d.town).toBe('Cairns');
    expect(d.compensation?.basis).toBe('day');
    expect(d.compensation?.amount).toBe(1500);
    expect(listingInputSchema.safeParse(d).success).toBe(true);
  });

  it('reads a single-vacancy alert', () => {
    const [b] = splitRecruiterEmail('1medical-single', { text: single });
    const d = fromLabelledBlock(b, 'email', 'm').draft;
    expect(d.facilityName).toBe('Example Base Hospital');
    expect(d.state).toBe('NSW');
    expect(d.grade).toBe('RMO');
    expect(d.requirements?.minPgy).toBe(3);
    expect(d.startDate).toBe('2026-11-16');
    expect(d.endDate).toBe('2027-02-01');
    expect(d.compensation?.amount).toBe(130);
    expect(d.compensation?.super).toBe('additional');
    expect(d.accommodation).toBe('included');
  });

  it('splits a recognised .eml upload end to end', async () => {
    const eml = [
      'From: Example Recruiter <info@connect.medrecruit.example>',
      'Subject: RMO opportunities',
      'Date: Mon, 12 Oct 2026 01:50:34 +0000',
      'Content-Type: text/html; charset=utf-8',
      '',
      digest,
    ].join('\r\n');
    const results = await previewImport(eml, 'email', 'eml');
    expect(results).toHaveLength(5);
    expect(results[0].draft.startDate).toBe('2026-11-02');
  });
});

describe('format helpers', () => {
  it('parses year-less ranges relative to the send date', () => {
    const dec = new Date('2026-12-20T00:00:00Z');
    expect(parseShortRange('5–9 Jan', dec)).toEqual({ start: '2027-01-05', end: '2027-01-09' });
    expect(parseShortRange('From 2 Nov', new Date('2026-10-12'))).toEqual({
      start: '2026-11-02',
      end: null,
    });
    expect(parseShortRange('Multiple blocks', dec)).toBeNull();
  });
  it('flags weekday mismatches and rejects impossible dates', () => {
    expect(parseLongDate('Saturday, 3 October 2026').note).toBeNull();
    expect(parseLongDate('Friday, 3 October 2026').note).toMatch(/wrong weekday/);
    expect(parseLongDate('31 February 2027').date).toBeNull();
  });
  it('only accepts a single unambiguous rate', () => {
    expect(singleRate('$1,100 p/d + super')).toEqual({ amount: 1100, unit: 'day' });
    expect(singleRate('Days $111.30/hr; nights $121.30/hr')).toBeNull();
    expect(singleRate('$160 -170 p/h')).toBeNull();
    expect(singleRate('enquire within')).toBeNull();
  });
  it('maps role phrases conservatively', () => {
    expect(classifyRole('After Hour Med Reg PGY5+')).toMatchObject({
      grade: 'Registrar',
      specialty: 'General medicine',
      minPgy: 5,
    });
    expect(classifyRole('Oncology Registrar').specialty).toBe('Oncology');
    expect(classifyRole('RMO Nights').specialty).toBeNull();
    // National vocabulary (LR-001): the most specific discipline wins.
    const cases: [string, string][] = [
      ['Paediatric ED Registrar', 'Emergency medicine'],
      ['Forensic Psychiatry SMO', 'Psychiatry'],
      ['Anaesthetics Registrar', 'Anaesthetics'],
      ['O&G SRMO', 'Obstetrics & gynaecology'],
      ['Orthopaedic Surgery PHO', 'Surgery'],
      ['Aboriginal Medical Service GP', 'General practice'],
      ['Cardiology Advanced Trainee', 'Medical subspecialties'],
      ['Correctional Health MO', 'Other'],
    ];
    for (const [role, specialty] of cases) expect(classifyRole(role).specialty).toBe(specialty);
    expect(classifyRole('Forensic Psychiatry SMO').grade).toBe('SMO');
  });
});

describe('JSON source adapters', () => {
  const wavePage = {
    pagination: { currentPage: 1, pageSize: 10, totalPages: 3, totalRecords: 25 },
    results: [
      {
        jobId: '900001',
        title: 'Psychiatry - Registrar - Example Base Hospital',
        jobType: 'Locum',
        link: '/jobs/psychiatry-registrar-example-base-hospital-900001',
        location: 'Cairns, QLD',
        startDate: '2027-01-11',
        endDate: '2027-01-22',
        payRate: '$165 per hour',
        excerpt: '<ul><li><strong>Dates:</strong> 11–22 Jan</li></ul>',
        locumCredentials: 'Hospital credentialing pack',
        seniorities: [{ title: 'Registrar' }],
        specialties: [{ title: 'Psychiatry' }],
      },
      { jobId: '900002', title: 'Permanent role', jobType: 'Permanent', location: 'Perth, WA' },
    ],
  };
  it('turns Wavelength locum results into reviewable drafts', () => {
    const { blocks, hasMore } = wavelength.parse(wavePage);
    expect(hasMore).toBe(true);
    expect(blocks).toHaveLength(1);
    const d = fromLabelledBlock(blocks[0], 'wavelength', 'wavelength-json').draft;
    expect(d.facilityName).toBe('Example Base Hospital');
    expect(d.town).toBe('Cairns');
    expect(d.state).toBe('QLD');
    expect(d.grade).toBe('Registrar');
    expect(d.specialty).toBe('Psychiatry');
    expect(d.compensation?.amount).toBe(165);
    expect(d.externalId).toBe('wavelength-900001');
    expect(d.url).toBe(
      'https://wave.com.au/jobs/psychiatry-registrar-example-base-hospital-900001',
    );
    expect(d.requirements?.credentials).toEqual([]);
    expect(listingInputSchema.safeParse(d).success).toBe(true);
  });
  it('rejects an unexpected response instead of reporting an empty feed', () => {
    expect(() => wavelength.parse({ error: 'maintenance' })).toThrow(/Unexpected/);
  });
  it('needs Adzuna keys and never imports predicted salaries', () => {
    expect(adzuna.pageUrl(1, {})).toBeNull();
    expect(adzuna.pageUrl(1, { ADZUNA_APP_ID: 'id', ADZUNA_APP_KEY: 'key' })).toMatch(
      /^https:\/\/api\.adzuna\.com\/v1\/api\/jobs\/au\/search\/1\?/,
    );
    const { blocks } = adzuna.parse({
      results: [
        {
          id: 42,
          title: 'Locum Psychiatry Registrar',
          description: 'Locum psychiatry registrar required for a regional service…',
          redirect_url: 'https://www.adzuna.com.au/details/42',
          salary_min: 200000,
          salary_is_predicted: '1',
          company: { display_name: 'Example Recruitment' },
          location: {
            display_name: 'Cairns, Cairns Region',
            area: ['Australia', 'Queensland', 'Cairns Region', 'Cairns'],
          },
        },
      ],
    });
    const d = fromLabelledBlock(blocks[0], 'adzuna', 'adzuna-json').draft;
    expect(d.state).toBe('QLD');
    expect(d.compensation?.amount).toBeNull();
    expect(d.contact).toBe('Example Recruitment (via Adzuna)');
  });
  it('extends the collector allowlist only to adapter hosts', () => {
    expect(allowedSourceUrl('https://cms.wave.com.au/jobs?page=1')).toBe(true);
    expect(allowedSourceUrl('https://api.adzuna.com/v1/api/jobs/au/search/1')).toBe(true);
    expect(allowedSourceUrl('https://cms.wave.com.au.evil.example/jobs')).toBe(false);
  });
});

describe('AIHW MyHospitals facility directory', () => {
  const unit = (
    code: string,
    name: string,
    state: string,
    extra: { private?: boolean; closed?: boolean; alternative_names?: string[] } = {},
  ) => ({
    reporting_unit_code: code,
    reporting_unit_name: name,
    reporting_unit_type: { reporting_unit_type_code: 'H' },
    latitude: -30,
    longitude: 150,
    private: false,
    closed: false,
    alternative_names: [],
    mapped_reporting_units: [
      {
        map_type: { mapped_reporting_unit_code: 'STATE_MAPPING' },
        mapped_reporting_unit: { reporting_unit_code: state },
      },
    ],
    ...extra,
  });
  // Shape copied from the public API; names are real public hospitals.
  const body = {
    result: [
      unit('H1', 'Manning Hospital', 'NSW'),
      unit('H2', 'Royal Darwin Hospital', 'NT'),
      unit('H3', 'Darwin Private Hospital', 'NT', { private: true }),
      unit('H4', 'Swan Hill District Health [Swan Hill]', 'Vic'),
      unit('H5', 'Swan Hill District Health [Nyah]', 'Vic'),
      unit('H6', 'The Bendigo Hospital', 'Vic'),
      unit('H7', 'Latrobe Regional Hospital [Traralgon]', 'Vic'),
      unit('H8', 'Coffs Harbour Hospital', 'NSW'),
      unit('H9', 'Old Closed Hospital', 'NSW', { closed: true }),
      unit('H10', 'Atherton Hospital', 'Qld', { alternative_names: ['Atherton'] }),
      unit('H11', 'Example Hospital [North Campus]', 'SA'),
      unit('H12', 'Example Hospital [South Campus]', 'SA'),
      unit('H13', 'North West Regional Hospital', 'Tas', { alternative_names: ['NWRH'] }),
      {
        ...unit('LHN1', 'Cairns and Hinterland', 'Qld'),
        reporting_unit_type: { reporting_unit_type_code: 'LHN' },
      },
    ],
  };
  const directory = parseMyHospitals(body);

  it('keeps open hospitals with state, sector, aliases and derived towns', () => {
    expect(directory.map((f) => f.id)).not.toContain('aihw-H9');
    expect(directory.map((f) => f.id)).not.toContain('aihw-LHN1');
    const byId = Object.fromEntries(directory.map((f) => [f.id, f]));
    expect(byId['aihw-H1']).toMatchObject({ town: 'Manning', state: 'NSW', sector: 'public' });
    expect(byId['aihw-H2'].town).toBe('Darwin');
    expect(byId['aihw-H4'].town).toBe('Swan Hill');
    expect(byId['aihw-H6'].aliases).toContain('Bendigo');
    expect(byId['aihw-H7']).toMatchObject({ town: 'Traralgon', timezone: 'Australia/Melbourne' });
    expect(byId['aihw-H10'].town).toBe('Atherton');
    // Acronyms and directional names are aliases, never towns.
    expect(byId['aihw-H13'].town).toBe('');
    expect(byId['aihw-H13'].aliases).toContain('NWRH');
  });
  it('derives short names conservatively', () => {
    expect(shortName('Latrobe Regional Hospital [Traralgon]')).toBe('Latrobe');
    expect(shortName('Whyalla Hospital and Health Services')).toBe('Whyalla');
    expect(shortName('Calvary Mater Newcastle')).toBe('');
    expect(townFor('Calvary Mater Newcastle', [])).toBe('');
  });
  it('resolves shorthand labels, prefers public hospitals and refuses ties', () => {
    expect(resolveFacility('Manning', 'NSW', directory).facility?.name).toBe('Manning Hospital');
    expect(resolveFacility('Darwin', 'NT', directory).facility?.name).toBe('Royal Darwin Hospital');
    expect(resolveFacility('Darwin Private', 'NT', directory).facility?.name).toBe(
      'Darwin Private Hospital',
    );
    expect(resolveFacility('Swan Hill', 'VIC', directory).facility?.id).toBe('aihw-H4');
    expect(resolveFacility('Bendigo', 'VIC', directory).facility?.name).toBe(
      'The Bendigo Hospital',
    );
    expect(resolveFacility('Manning', 'QLD', directory).facility).toBeNull();
    expect(resolveFacility('Swan Hill District Health', 'VIC', directory).facility?.id).toBe(
      'aihw-H4',
    );
    expect(resolveFacility('Coffs Harbour', 'NSW', directory).facility?.id).toBe('aihw-H8');
    const tie = resolveFacility('Example', 'SA', directory);
    expect(tie.facility).toBeNull();
    expect(tie.note).toMatch(/several hospitals/);
  });
  it('turns an email shorthand into a complete, valid listing', () => {
    const [b] = splitRecruiterEmail('medrecruit-digest', {
      text: '<div><strong>NSW</strong></div><div><strong>Manning – ED SRMO</strong></div><div>14–24 Nov | Nights | $170/hr | T&amp;A provided</div>',
      sentAt: new Date('2026-10-12T00:00:00Z'),
    });
    const r = fromLabelledBlock(b, 'email', 'm', directory);
    expect(r.draft.facilityName).toBe('Manning Hospital');
    expect(r.draft.town).toBe('Manning');
    expect(r.issues.join(' ')).toMatch(/resolved to Manning Hospital \(AIHW H1\)/);
    expect(listingInputSchema.safeParse(r.draft).success).toBe(true);
  });
  it('merges without overwriting curated facilities', () => {
    const curated = [
      { ...directory[0], id: 'manning-local', aliases: ['Taree hospital'], sector: undefined },
    ];
    const result = mergeFacilities(curated, directory);
    expect(result.linked).toBe(1);
    expect(curated.find((f) => f.id === 'manning-local')?.aliases).toContain('Taree hospital');
    expect(curated.some((f) => f.id === 'aihw-H1')).toBe(false);
  });
});
