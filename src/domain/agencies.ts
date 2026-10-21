import { defaultInboxSettings, type InboxSettings } from './inbox';
import type { Store } from './model';

/**
 * Australian locum agencies whose job emails the recruiter inbox searches.
 * `signup` is where a doctor registers or subscribes to job emails; domains
 * match Gmail's from: search (subdomains included).
 */
export interface Agency {
  id: string;
  name: string;
  domains: string[];
  signup: string;
  /** Built-in readers exist for this agency's layouts; others are read by Claude. */
  rules?: boolean;
  note?: string;
}
// Sign-up pages and domains checked 21 Oct 2026. Sender domains other than
// Medrecruit's and 1Medical's are inferred from each agency's website.
export const agencies: Agency[] = [
  {
    id: 'medrecruit',
    name: 'Medrecruit',
    domains: ['medrecruit.com', 'medworld.com'],
    signup: 'https://profile.medworld.com/sign-up',
    rules: true,
  },
  {
    id: '1medical',
    name: '1Medical',
    domains: ['1medical.com.au'],
    signup: 'https://www.1medical.com.au/register',
    rules: true,
  },
  {
    id: 'wavelength',
    name: 'Wavelength',
    domains: ['wave.com.au'],
    signup: 'https://wave.com.au/register',
  },
  {
    id: 'cmr',
    name: 'Cornerstone Medical Recruitment',
    domains: ['cmr.com.au'],
    signup: 'https://www.cmr.com.au/match-me-form/',
    note: 'places psychiatry registrar and PHO locums',
  },
  {
    id: 'global-medics',
    name: 'Global Medics',
    domains: ['globalmedics.com'],
    signup: 'https://apac.globalmedics.com/locumdoctors/',
  },
  {
    id: 'skilled',
    name: 'Skilled Medical',
    domains: ['skilledmedical.com.au', 'skilledmedical.com'],
    signup: 'https://www.skilledmedical.com.au/',
  },
  {
    id: 'healthcare-australia',
    name: 'Healthcare Australia',
    domains: ['healthcareaustralia.com.au'],
    signup: 'https://healthcareaustralia.com.au/our-services/doctors',
  },
  {
    id: 'jps',
    name: 'JPS Medical',
    domains: ['jpsmedical.com.au'],
    signup: 'https://www.jpsmedical.com.au/af-page/create-job-alert/',
  },
  {
    id: 'dna',
    name: 'DNA Medical Recruitment',
    domains: ['dnamedicalrecruitment.com.au', 'dnamedical.com.au'],
    signup: 'https://www.dnamedicalrecruitment.com.au/user-register/',
  },
  {
    id: 'blugibbon',
    name: 'Blugibbon',
    domains: ['blugibbon.com.au'],
    signup: 'https://www.blugibbon.com.au/#Register',
    note: 'mainly emergency registrar locums',
  },
  {
    id: 'medfuture',
    name: 'Medfuture',
    domains: ['medfuture.com.au'],
    signup: 'https://www.medfuture.com.au/',
  },
  {
    id: 'salt',
    name: 'Salt Medical',
    domains: ['saltmedics.com'],
    signup: 'https://saltmedics.com/contact-us/',
    note: 'mostly emergency and rural generalist',
  },
  {
    id: 'charterhouse',
    name: 'Charterhouse Medical',
    domains: ['charterhousemedical.com.au', 'charterhousemedical.com'],
    signup: 'https://charterhousemedical.com.au/',
  },
  {
    id: 'ochre',
    name: 'Ochre',
    domains: ['ochrerecruitment.com', 'ochrehealth.com.au'],
    signup: 'https://ochrehealth.com.au/locum-with-ochre/',
    note: 'mostly GP and rural generalist',
  },
];
export const agencyIds = () => agencies.map((a) => a.id);

/** Agency name for a sender address, or null when it is not a listed agency. */
export function agencyFor(address: string) {
  const domain = address.toLowerCase().split('@')[1] ?? '';
  return (
    agencies.find((a) => a.domains.some((d) => domain === d || domain.endsWith('.' + d))) ?? null
  );
}

export function inboxSettings(store: Pick<Store, 'settings'>): InboxSettings {
  const saved = (store.settings ?? []).find((s) => s.id === 'inbox');
  const defaults = defaultInboxSettings(agencyIds());
  if (!saved) return defaults;
  // Agencies added to the list after the owner saved settings start included.
  const known = new Set([...saved.agencies, ...(saved.knownAgencies ?? [])]);
  return {
    ...defaults,
    ...saved,
    agencies: [...saved.agencies, ...agencyIds().filter((id) => !known.has(id))],
  };
}
/** Sender domains searched for the current settings. */
export function searchDomains(settings: InboxSettings) {
  return [
    ...new Set([
      ...agencies.filter((a) => settings.agencies.includes(a.id)).flatMap((a) => a.domains),
      ...settings.extraDomains,
    ]),
  ];
}
