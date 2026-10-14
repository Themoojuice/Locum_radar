import { collectorConfigSchema, type CollectorConfig } from './acquisition';
import type { Source } from './model';
export interface SourceRecipe {
  id: string;
  name: string;
  url: string;
  type: Source['type'];
  config: CollectorConfig;
  qualification: string;
  accessRestriction?: string;
}
const web = (
  url: string,
  detailPaths: string[],
  listingPaths: string[],
  extra: Partial<CollectorConfig> = {},
) =>
  collectorConfigSchema.parse({
    kind: 'web',
    startUrls: [url],
    allowedHosts: [new URL(url).hostname],
    detailPaths,
    listingPaths,
    ...extra,
  });
const observed =
  'Live HTML inspected 14 Oct 2026; extraction still requires review. This is technical compatibility, not a coverage guarantee.';
const candidate =
  'Candidate recipe; fixtures cover the engine, but this board needs a live qualification run.';
export const sourceRecipes: SourceRecipe[] = [
  {
    id: 'medrecruit',
    name: 'Medrecruit',
    type: 'agency',
    url: 'https://medrecruit.medworld.com/jobs/listing',
    config: web(
      'https://medrecruit.medworld.com/jobs/listing',
      ['/jobs/*/*/jn*'],
      ['/jobs/listing', '/jobs/listing?*'],
    ),
    qualification:
      observed +
      ' A dedicated structured-page adapter supports numbered pagination. The generic HTML fallback cannot follow button controls. Full live coverage remains unqualified.',
  },
  {
    id: 'ochre',
    name: 'Ochre Recruitment',
    type: 'agency',
    url: 'https://ochrerecruitment.com/medical-jobs',
    config: web(
      'https://ochrerecruitment.com/medical-jobs',
      ['/job/*'],
      ['/medical-jobs', '/medical-jobs?start=*'],
      { nextSelector: 'a[href*="start="], a[rel="next"]' },
    ),
    qualification: observed,
  },
  {
    id: 'salt',
    name: 'Salt Medical Recruitment',
    type: 'agency',
    url: 'https://saltmedics.com/doctor-jobs/',
    config: web(
      'https://saltmedics.com/doctor-jobs/',
      ['/job/*'],
      ['/doctor-jobs/', '/doctor-jobs/page/*'],
    ),
    qualification:
      observed +
      ' Website terms prohibit scraping; use recruiter emails or obtain specific permission. Board includes non-doctor jobs.',
    accessRestriction:
      'Website terms section 4 prohibit screen scraping. Use labelled recruiter email or obtain specific permission: https://saltmedics.com/wp-content/uploads/2021/09/Salt-Medical-Website-TCs.pdf (reviewed 14 Oct 2026).',
  },
  {
    id: 'skilled',
    name: 'Skilled Medical',
    type: 'agency',
    url: 'https://www.skilledmedical.com/job-board/',
    config: web(
      'https://www.skilledmedical.com/job-board/',
      ['/job/*', '/jobs/*'],
      ['/job-board/*'],
    ),
    qualification:
      'Homepage inspected; ASP.NET navigation needs live qualification. An incomplete traversal is reported rather than assumed complete.',
  },
  {
    id: 'wavelength',
    name: 'Wavelength',
    type: 'agency',
    url: 'https://wave.com.au/doctor-jobs',
    config: web('https://wave.com.au/doctor-jobs', ['/job/*', '/doctor-jobs/*'], ['/doctor-jobs*']),
    qualification:
      'Dedicated job-endpoint adapter implemented and fixture-tested. The generic public-page fallback is incomplete; live endpoint coverage still requires qualification.',
  },
  {
    id: 'global-medics',
    name: 'Global Medics APAC',
    type: 'agency',
    url: 'https://apac.globalmedics.com/find-a-job/',
    config: web(
      'https://apac.globalmedics.com/find-a-job/',
      ['/job/*', '/jobs/*'],
      ['/find-a-job/*'],
    ),
    qualification: candidate,
  },
  {
    id: 'cmr',
    name: 'Cornerstone Medical Recruitment',
    type: 'agency',
    url: 'https://www.cmr.com.au/medical-jobs/',
    config: web('https://www.cmr.com.au/medical-jobs/', ['/job/*'], ['/medical-jobs/*'], {
      nextSelector: 'a[href*="wpv_paged"], a[rel="next"]',
    }),
    qualification:
      observed + ' Multi-profession board; pagination remains subject to robots rules.',
  },
  {
    id: 'jps',
    name: 'JPS Medical',
    type: 'agency',
    url: 'https://www.jpsmedical.com.au/jobs/',
    config: web('https://www.jpsmedical.com.au/jobs/', ['/jobview/*/*', '/job/*'], ['/jobs/*']),
    qualification:
      'Applyflow client-rendered board observed. Ordinary HTML may expose no jobs; use a feed agreement, email, or saved rendered-page import.',
  },
  {
    id: 'charterhouse',
    name: 'Charterhouse Medical',
    type: 'agency',
    url: 'https://www.charterhousemedical.com/',
    config: web('https://www.charterhousemedical.com/', ['/job/*', '/jobs/*'], ['/jobs*']),
    qualification:
      'Separate Salesforce job portal requires an explicit endpoint review; homepage alone is not job coverage.',
  },
  {
    id: 'dna',
    name: 'DNA Medical Recruitment',
    type: 'agency',
    url: 'https://www.dnamedicalrecruitment.com.au/',
    config: web('https://www.dnamedicalrecruitment.com.au/', ['/job/*', '/jobs/*'], ['/jobs*']),
    qualification: candidate,
  },
  {
    id: 'qld-health',
    name: 'Queensland Health',
    type: 'government',
    url: 'https://smartjobs.qld.gov.au/',
    config: web(
      'https://smartjobs.qld.gov.au/',
      ['/jobs/*', '/jobtools/jncustomsearch.viewFullSingle*'],
      ['/jobtools/jncustomsearch.searchResults*'],
    ),
    qualification:
      'SmartJobs form and alert service inspected. Configure a saved result URL; the search form itself has no vacancy coverage.',
  },
  {
    id: 'nsw-health',
    name: 'NSW Health',
    type: 'government',
    url: 'https://jobs.health.nsw.gov.au/',
    config: web('https://jobs.health.nsw.gov.au/', ['/jobs/*'], ['/jobs/search*']),
    qualification: candidate,
  },
  ...[
    [
      'rural-west',
      'Rural Health West',
      'https://ruralhealthwest.com.au/vacancies/gp-locums/',
      '/vacancies/*',
    ],
    ['rwav', 'RWAV', 'https://rwav.com.au/gp-locums/', '/jobs/*'],
    [
      'healthworkforce',
      'Health Workforce Queensland',
      'https://www.healthworkforce.com.au/jobs',
      '/job/*',
    ],
    [
      'rural-doctors',
      'NSW Rural Doctors Network',
      'https://www.ruraldoctors.org/site/locum-program',
      '/job/*',
    ],
  ].map(([id, name, url, detail]) => ({
    id,
    name,
    url,
    type: 'agency' as const,
    config: web(url, [detail], ['/jobs*']),
    qualification: candidate + ' Rural GP requirements need individual checking.',
  })),
  {
    id: 'adzuna',
    name: 'Adzuna Australia API',
    url: 'https://developer.adzuna.com/',
    type: 'aggregator',
    config: collectorConfigSchema.parse({ kind: 'adzuna', query: 'locum doctor', maxPages: 20 }),
    qualification:
      'Documented API; fixture-tested. Requires your app ID/key and API terms review. Salaries/estimates are not treated as hourly offers.',
  },
  {
    id: 'gmail-label',
    name: 'Gmail recruitment label',
    url: 'https://mail.google.com/',
    type: 'email',
    config: collectorConfigSchema.parse({ kind: 'gmail', maxPages: 200 }),
    qualification:
      'Read-only OAuth and selected-label collection; requires your Google client and consent. Never scans without a selected label.',
  },
  {
    id: 'forum-search',
    name: 'Recent public forum leads',
    url: 'https://search.brave.com/',
    type: 'discovery',
    config: collectorConfigSchema.parse({
      kind: 'search',
      query: 'site:reddit.com/r/ausjdocs (locum OR registrar) (vacancy OR cover OR hiring)',
      lookbackDays: 30,
      maxPages: 3,
    }),
    qualification:
      'Brave Search API discovery; needs an API key. Results are unverified leads, not vacancies or complete forum coverage.',
  },
  {
    id: 'rural-search',
    name: 'Direct rural employer leads',
    url: 'https://search.brave.com/',
    type: 'discovery',
    config: collectorConfigSchema.parse({
      kind: 'search',
      query: 'Australia hospital locum registrar vacancy rural -site:seek.com.au',
      lookbackDays: 30,
      maxPages: 3,
    }),
    qualification:
      'Recent indexed leads through Brave Search. Confirm dates and availability on the original source.',
  },
];
export function sourceFromRecipe(recipe: SourceRecipe): Source {
  return {
    id: recipe.id,
    name: recipe.name,
    url: recipe.url,
    type: recipe.type,
    method: 'collector',
    collector: structuredClone(recipe.config),
    qualification: recipe.qualification,
    permission: recipe.accessRestriction ? 'denied' : 'unreviewed',
    permissionEvidence: recipe.accessRestriction || '',
    enabled: false,
    intervalHours: 24,
    lastSuccess: null,
    lastAttempt: null,
    error: null,
  };
}
export function configForSource(source: Source): CollectorConfig | undefined {
  return source.collector ?? sourceRecipes.find((r) => r.id === source.id)?.config;
}
