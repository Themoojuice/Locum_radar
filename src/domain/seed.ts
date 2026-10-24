import {
  defaultProfile,
  emptyCompensation,
  unknownRequirements,
  type Facility,
  type Store,
  type Source,
  type Opportunity,
  type ListingInput,
} from './model';
const facilities: Facility[] = [
  [
    'cairns',
    'Cairns Hospital',
    'Cairns',
    'QLD',
    -16.92,
    145.77,
    'Australia/Brisbane',
    ['Cairns Base Hospital'],
  ],
  [
    'townsville',
    'Townsville University Hospital',
    'Townsville',
    'QLD',
    -19.32,
    146.76,
    'Australia/Brisbane',
    ['Townsville Hospital'],
  ],
  ['hervey', 'Hervey Bay Hospital', 'Hervey Bay', 'QLD', -25.3, 152.82, 'Australia/Brisbane', []],
  ['mackay', 'Mackay Base Hospital', 'Mackay', 'QLD', -21.14, 149.15, 'Australia/Brisbane', []],
  [
    'alice',
    'Alice Springs Hospital',
    'Alice Springs',
    'NT',
    -23.71,
    133.88,
    'Australia/Darwin',
    [],
  ],
  ['darwin', 'Royal Darwin Hospital', 'Darwin', 'NT', -12.36, 130.88, 'Australia/Darwin', []],
  [
    'broome',
    'Broome Hospital',
    'Broome',
    'WA',
    -17.96,
    122.24,
    'Australia/Perth',
    ['Broome Health Campus'],
  ],
  ['lismore', 'Lismore Base Hospital', 'Lismore', 'NSW', -28.81, 153.29, 'Australia/Sydney', []],
  [
    'launceston',
    'Launceston General Hospital',
    'Launceston',
    'TAS',
    -41.45,
    147.14,
    'Australia/Hobart',
    [],
  ],
  ['bendigo', 'Bendigo Hospital', 'Bendigo', 'VIC', -36.75, 144.28, 'Australia/Melbourne', []],
].map(
  ([id, name, town, state, lat, lon, timezone, aliases]) =>
    ({
      id,
      name,
      town,
      state,
      lat,
      lon,
      timezone,
      aliases,
      adventure: null,
      adventureNote: 'Not assessed',
      coverage: 'unknown',
    }) as Facility,
);
const source = (
  id: string,
  name: string,
  url: string,
  type: Source['type'] = 'agency',
  method: Source['method'] = 'manual',
): Source => ({
  id,
  name,
  url,
  type,
  method,
  permission: 'unreviewed',
  permissionEvidence: '',
  enabled: false,
  // Automatic adapters stop early on routine runs, so they can refresh more often.
  intervalHours: method === 'json-api' ? 6 : 24,
  lastSuccess: null,
  lastAttempt: null,
  error: null,
});
export function emptyStore(): Store {
  return {
    version: 1,
    profile: structuredClone(defaultProfile),
    facilities: structuredClone(facilities),
    sources: [
      source('manual', 'My saved advertisements', '', 'manual'),
      source('email', 'Recruiter email imports', '', 'email'),
      source(
        'medrecruit',
        'Medrecruit',
        'https://medrecruit.medworld.com/jobs/listing/locum/australia',
        'agency',
        'json-api',
      ),
      source(
        '1medical',
        '1Medical',
        'https://www.1medical.com.au/doctors/job-board/',
        'agency',
        'json-api',
      ),
      source(
        'ochre',
        'Ochre Recruitment',
        'https://ochrerecruitment.com/medical-jobs',
        'agency',
        'jsonld',
      ),
      source('skilled', 'Skilled Medical', 'https://skilledmedical.com/'),
      source('wavelength', 'Wavelength', 'https://wave.com.au/jobs/listing', 'agency', 'json-api'),
      source(
        'adzuna',
        'Adzuna (The Adzuna API)',
        'https://www.adzuna.com.au/',
        'agency',
        'json-api',
      ),
      source('global-medics', 'Global Medics', 'https://www.globalmedics.com/'),
      source('cmr', 'Cornerstone Medical Recruitment', 'https://www.cmr.com.au/'),
      source('jps', 'JPS Medical', 'https://www.jpsmedical.com.au/'),
      source('charterhouse', 'Charterhouse Medical', 'https://www.charterhousemedical.com/'),
      source('salt', 'Salt Medical Recruitment', 'https://saltmedics.com/'),
      source('dna', 'DNA Medical Recruitment', 'https://www.dnamedicalrecruitment.com.au/'),
      source('qld-health', 'Queensland Health', 'https://smartjobs.qld.gov.au/', 'government'),
      source('nsw-health', 'NSW Health', 'https://jobs.health.nsw.gov.au/', 'government'),
    ],
    opportunities: [],
    offers: [],
    listings: [],
    actions: [],
    observations: [],
    runs: [],
    reviews: [],
    documents: [],
    inbox: [],
    settings: [],
  };
}

export function demoStore(): Store {
  const s = emptyStore();
  s.profile = {
    ...s.profile,
    name: 'Example doctor',
    registration: 'general',
    pgy: 5,
    credentialsConfirmed: true,
    credentials: ['ALS'],
    independentCover: 'no',
    supervisionRequired: 'yes',
    eligibleGrades: ['RMO', 'SRMO', 'PHO', 'Registrar'],
    availability: [{ start: '2027-01-01', end: '2027-12-31' }],
  };
  s.sources = [
    source('demo-a', 'Example recruiter A', ''),
    source('demo-b', 'Example recruiter B', ''),
  ];
  const examples = [
    ['cairns', 'Psychiatry', 'Registrar', '2027-01-11', '2027-02-05', 160, 'hour', 160, 95],
    ['broome', 'Emergency medicine', 'Registrar', '2027-02-08', '2027-02-21', 190, 'hour', 80, 97],
    ['alice', 'General medicine', 'RMO', '2027-03-01', '2027-03-14', 155, 'hour', 80, 90],
    ['hervey', 'Psychiatry', 'Registrar', '2027-01-18', '2027-01-29', 170, 'hour', 80, 80],
    ['lismore', 'Emergency medicine', 'SRMO', '2027-04-05', '2027-04-18', 160, 'hour', 80, 88],
    [
      'launceston',
      'Psychiatry',
      'Registrar',
      '2027-05-03',
      '2027-05-28',
      null,
      'unknown',
      null,
      89,
    ],
    [
      'darwin',
      'Emergency medicine',
      'Registrar',
      '2027-06-07',
      '2027-06-20',
      2200,
      'day',
      null,
      93,
    ],
    ['mackay', 'Psychiatry', 'Consultant', '2027-02-01', '2027-02-12', 2800, 'day', null, 85],
    ['townsville', 'General medicine', 'PHO', '2026-09-01', '2026-09-14', 130, 'hour', 80, 78],
  ] as const;
  examples.forEach(
    (
      [facilityId, specialty, grade, startDate, endDate, amount, basis, paidHours, adventure],
      i,
    ) => {
      const f = s.facilities.find((f) => f.id === facilityId)!;
      f.adventure = adventure;
      f.adventureNote = 'Illustrative personal preference, not measured biodiversity data';
      f.coverage = 'observed';
      const stamp = '2026-10-12T22:00:00.000Z';
      const requirements =
        i === 6
          ? { ...unknownRequirements }
          : {
              registration: 'general' as const,
              minPgy: 3,
              credentials: i === 7 ? ['FRANZCP'] : [],
              independentCover: false,
              supervisionAvailable: true,
              complete: i !== 4,
            };
      const o: Opportunity = {
        id: `demo-${i}`,
        facilityId,
        title: `${specialty} ${grade}`,
        specialty,
        grade,
        startDate,
        endDate,
        roster: 'Day shifts; confirm final roster',
        reference: `EXAMPLE-${i}`,
        requirements,
        status: 'advertised',
        firstSeenAt: stamp,
        lastSeenAt: stamp,
        verifiedAt: null,
        demo: true,
      };
      s.opportunities.push(o);
      const input: ListingInput = {
        sourceId: 'demo-a',
        externalId: `EXAMPLE-${i}`,
        url: null,
        rawText:
          'FICTIONAL DEMONSTRATION. This is not an advertised job. Rates, dates, requirements and benefits are illustrative.',
        title: o.title,
        facilityName: f.name,
        town: f.town,
        state: f.state,
        specialty,
        grade,
        startDate,
        endDate,
        roster: o.roster,
        reference: o.reference,
        requirements,
        compensation: {
          ...emptyCompensation,
          amount,
          basis,
          paidHours,
          paidDays: basis === 'day' ? 10 : null,
          directExpenses: 250,
          travelHours: 6,
          super: 'additional',
          onCall: i === 6 ? 'included' : 'none',
        },
        flights: 'included',
        accommodation: 'included',
        status: 'advertised',
        contact: '',
        evidence: { all: 'Synthetic example; no real vacancy or eligibility claim.' },
      };
      const l = {
        ...input,
        id: `demo-listing-${i}`,
        opportunityId: o.id,
        firstSeenAt: stamp,
        observedAt: stamp,
        contentHash: 'demo',
      };
      s.listings.push(l);
      s.offers.push({
        id: `demo-offer-${i}`,
        opportunityId: o.id,
        listingId: l.id,
        sourceId: 'demo-a',
        compensation: l.compensation,
        flights: l.flights,
        accommodation: l.accommodation,
        contact: '',
        updatedAt: stamp,
      });
      if (i === 0 || i === 1) {
        const second = {
          ...l,
          id: `demo-listing-b-${i}`,
          sourceId: 'demo-b',
          compensation: { ...l.compensation, amount: (amount ?? 0) - 15, directExpenses: 600 },
        };
        s.listings.push(second);
        s.offers.push({
          id: `demo-offer-b-${i}`,
          opportunityId: o.id,
          listingId: second.id,
          sourceId: 'demo-b',
          compensation: second.compensation,
          flights: 'unknown',
          accommodation: 'included',
          contact: '',
          updatedAt: stamp,
        });
      }
    },
  );
  s.actions = [
    {
      opportunityId: 'demo-0',
      stage: 'Saved',
      notes: 'Example: check supervision and the final roster.',
      updatedAt: '2026-10-12T22:00:00Z',
    },
  ];
  return s;
}
