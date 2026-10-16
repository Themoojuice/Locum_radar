import type { Source } from './model';
import { configForSource } from './source-catalog';
const steps: Record<string, string[]> = {
  medrecruit: [
    'The prepared Medrecruit public-board adapter needs no login or API key.',
    'Enable collection and run a check. If the website refuses requests, import recruiter emails through Gmail.',
  ],
  ochre: [
    'The Australian public locum board is configured and requires no account.',
    'New and changed adverts are fetched; unchanged details are reused for up to seven days. Refreshes normally run daily.',
  ],
  '1medical': [
    'The prepared 1Medical public-board adapter needs no API key.',
    'Enable collection and run a check. The public board may contain fewer offers than recruiter emails.',
  ],
  wavelength: [
    'The prepared Wavelength job-data adapter needs no API key.',
    'Run a check. If the endpoint changes or fails, use recruiter emails while the adapter is repaired.',
  ],
  salt: [
    'Import Salt recruiter emails through Gmail or upload saved adverts.',
    'Recorded website terms prohibit scraping. Website collection requires specific permission; record it under access settings.',
  ],
  skilled: [
    'The public board uses interactive navigation; the current HTML recipe may miss vacancies.',
    'Try the prepared collector. If no jobs are recognised, use recruiter emails; changing access settings cannot fix unsupported navigation.',
  ],
  jps: [
    'This board renders jobs in the browser; the current HTML collector may find none.',
    'Use recruiter emails or saved adverts. Reliable automated coverage needs a feed or dedicated rendered-page adapter.',
  ],
  charterhouse: [
    'The homepage is not the Salesforce vacancy portal; a dedicated portal adapter is not yet qualified.',
    'Use recruiter emails or import an advert. Enabling the homepage alone will not provide vacancy coverage.',
  ],
  'qld-health': [
    'Open SmartJobs, search for locum medical roles and copy the results-page URL.',
    'Under advanced page settings, replace the starting URL with that results URL. Alternatively, import saved-search email alerts through Gmail.',
  ],
  'nsw-health': [
    'Open NSW Health jobs and find the medical search results.',
    'Try the prepared public-page collector. If interactive navigation prevents collection, import job-alert emails.',
  ],
  'global-medics': [
    'The APAC jobs URL is prefilled; no API key is required.',
    'Run an initial check. Full coverage is not yet verified; recruiter emails provide another route.',
  ],
  cmr: [
    'The CMR medical-jobs URL is prefilled; no API key is required.',
    'Run a check. This board covers multiple professions, and pagination may be restricted. Use specialty filters and recruiter emails.',
  ],
  dna: [
    'The DNA public-site recipe needs a first successful check; no API key is required.',
    'If no jobs appear, copy the actual results URL into advanced page settings or import recruiter emails.',
  ],
  'rural-west': [
    'The Rural Health West GP locum page is prefilled.',
    'Try collection. If only programme information is found, use locum vacancy emails instead.',
  ],
  rwav: [
    'The RWAV GP locum page is prefilled.',
    'Try collection. If vacancies require registration, import recruitment emails instead.',
  ],
  healthworkforce: [
    'The Health Workforce Queensland jobs page is prefilled.',
    'Try collection and filter the results; permanent and non-doctor roles may also appear.',
  ],
  'rural-doctors': [
    'This URL is a locum-programme page, not a verified vacancy feed.',
    'Use vacancy emails through Gmail. Reliable website collection needs a direct public vacancy URL.',
  ],
  'forum-search': [
    'Enter a Brave Search API key below. The prepared query searches indexed public AusJDocs posts.',
    'Results are possible leads. Private groups and unindexed or deleted posts are not covered.',
  ],
  'rural-search': [
    'Enter a Brave Search API key below to search for direct rural employer vacancies.',
    'Adjust the query if needed, then collect. Check dates and actual availability on each linked page.',
  ],
  adzuna: [
    'Create an Adzuna developer account and enter its app ID and key below.',
    'The Australian API search is prepared. Annual salary estimates are not converted into hourly locum rates.',
  ],
  'gmail-label': [
    'Use Import from Gmail above to connect your account and choose a label or mailbox search.',
    'The guided import enables this source and adds matching emails to Discover in batches.',
  ],
  manual: [
    'Use Import opportunities on Discover to paste or upload an advertisement. No connection is required.',
  ],
  email: [
    'Use Import from Gmail above, or Import opportunities on Discover for .eml files and pasted recruiter text.',
  ],
};
export function sourceSetup(source: Source) {
  return (
    steps[source.id] || [
      `Configure this ${configForSource(source)?.kind || 'manual'} source using the fields below.`,
      'Run a collection check; failures are reported. You can also import individual adverts on Discover.',
    ]
  );
}
