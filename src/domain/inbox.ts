/**
 * Recruiter emails as the doctor reads them: one record per email, holding the
 * vacancies found in it. Vacancies that carry enough facts are also added to
 * the feed as ordinary opportunities (source "email"); the email record keeps
 * the link back so either view can be checked against the original.
 */
export interface EmailVacancy {
  /** Stable within the email: `${messageId}-${index}`. */
  id: string;
  hospital: string;
  town: string;
  state: string | null;
  /** The role as the email words it, e.g. "MED SRMO (Nights)". */
  role: string;
  specialty: string | null;
  grade: string | null;
  start: string | null;
  end: string | null;
  /** Exactly how the email states the dates. */
  dateText: string;
  /** Separate blocks or single shifts when the email lists more than one. */
  blocks: { start: string; end: string }[];
  /** Exactly how the email states the pay. */
  rateText: string;
  amount: number | null;
  basis: 'hour' | 'day' | 'shift' | 'unknown';
  super: 'included' | 'additional' | 'unknown';
  roster: string;
  flights: 'included' | 'unknown';
  accommodation: 'included' | 'unknown';
  positions: number | null;
  minPgy: number | null;
  /** The email line(s) this vacancy was read from. */
  excerpt: string;
  notes: string[];
  /** Fields still missing before it can join the feed. */
  missing: string[];
  /** Set once the vacancy is in the feed. */
  opportunityId: string | null;
  ended: boolean;
}
export type EmailKind = 'offers' | 'unparsed' | 'link' | 'other';
export interface InboxEmail {
  id: string;
  threadId: string;
  agency: string;
  recruiter: string;
  fromAddress: string;
  subject: string;
  receivedAt: string;
  kind: EmailKind;
  /** One-line reason for the classification, shown on the card. */
  summary: string;
  permanent: boolean;
  vacancies: EmailVacancy[];
  /** Readable body with tracking links and footers removed. */
  body: string;
  /** Useful links in the email (for example Medrecruit's hot-jobs page). */
  links: { label: string; url: string }[];
  /** Empty for pasted adverts. */
  gmailUrl: string;
  /** Where it came from: a Gmail message, or text/screenshots pasted by hand. */
  origin?: 'gmail' | 'paste';
  /** Which reader produced the vacancies. */
  reader?: 'rules' | 'claude';
  /** Claude would read this email once a key is saved. */
  claudePending?: boolean;
  /** Claude cost for this email, in US dollars. */
  cost?: number;
  parser: number;
  importedAt: string;
  status: 'new' | 'seen' | 'dismissed';
}
/** Bump when parsing changes, so a re-scan re-reads stored emails. */
export const INBOX_PARSER_VERSION = 3;
/** Agencies searched by default. Gmail's from: matches subdomains (connect.medrecruit.com). */
export const RECRUITER_DOMAINS = ['medrecruit.com', '1medical.com.au'];
export function inboxQuery(days: number, domains: string[] = RECRUITER_DOMAINS, label = '') {
  const from = domains
    .map((d) => d.trim().replace(/^@/, '').toLowerCase())
    .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))
    .join(' OR ');
  // Gmail label search uses hyphens for spaces: "Locum offers" → label:locum-offers.
  const tag = label
    .trim()
    .toLowerCase()
    .replace(/[\s/]+/g, '-')
    .replace(/[^\w&-]/g, '');
  const who = [from && `from:(${from})`, tag && `label:${tag}`].filter(Boolean);
  const scope = who.length > 1 ? `{${who.join(' ')}}` : (who[0] ?? 'from:(medrecruit.com)');
  return `${scope} newer_than:${Math.round(days)}d -in:trash -in:spam -in:sent -in:drafts`;
}

/** Owner choices for the recruiter inbox; stored as one row of the settings table. */
export interface InboxSettings {
  id: 'inbox';
  /** Agency ids (see agencies.ts) whose emails are searched. */
  agencies: string[];
  /** Agencies the owner has signed up with (checklist only). */
  signedUp: string[];
  /** Extra sender domains, e.g. a recruiter not in the list. */
  extraDomains: string[];
  /** Optional Gmail label read in addition, for forwarded or hand-labelled adverts. */
  label: string;
  days: number;
  /** Import automatically when the app opens and the last import is old. */
  autoImport: boolean;
  /** Let Claude read emails the built-in readers cannot. */
  claude: boolean;
  /** Agency ids that existed when the owner last saved, so new agencies start included. */
  knownAgencies?: string[];
}
export function defaultInboxSettings(agencyIds: string[]): InboxSettings {
  return {
    id: 'inbox',
    agencies: agencyIds,
    signedUp: ['medrecruit', '1medical'],
    extraDomains: [],
    label: '',
    days: 30,
    autoImport: true,
    claude: true,
  };
}

const STATES = ['QLD', 'NSW', 'VIC', 'WA', 'SA', 'NT', 'TAS', 'ACT'] as const;
/** Draft for the review dialog when a vacancy lacks something the feed requires. */
export function draftFromVacancy(
  email: InboxEmail,
  v: EmailVacancy,
): Partial<import('./model').ListingInput> {
  const state = STATES.find((s) => s === v.state);
  return {
    sourceId: 'email',
    externalId: `inbox-${v.id}`,
    url: email.gmailUrl || null,
    rawText: `From: ${email.recruiter} (${email.agency})\nSubject: ${email.subject}\n${v.excerpt}`,
    title: v.role,
    facilityName: v.hospital,
    town: v.town,
    ...(state ? { state } : {}),
    ...(v.specialty ? { specialty: v.specialty as never } : {}),
    ...(v.grade ? { grade: v.grade as never } : {}),
    ...(v.start ? { startDate: v.start } : {}),
    ...(v.end ? { endDate: v.end } : {}),
    roster: v.roster,
    reference: '',
    requirements: {
      registration: null,
      minPgy: v.minPgy,
      credentials: [],
      independentCover: null,
      supervisionAvailable: null,
      complete: false,
    },
    compensation: {
      amount: v.amount,
      basis: v.amount ? v.basis : 'unknown',
      currency: 'AUD',
      paidHours: null,
      paidDays: null,
      paidShifts: null,
      directExpenses: null,
      travelHours: null,
      additionalPay: null,
      super: v.super,
      arrangement: 'unknown',
      onCall: 'unknown',
      notes: v.rateText,
    },
    flights: v.flights,
    accommodation: v.accommodation,
    status: 'advertised',
    contact: `${email.recruiter} · ${email.agency} · ${email.fromAddress}`.slice(0, 300),
    evidence: {
      Email: `${email.subject} (${email.receivedAt.slice(0, 10)})`,
      'Email line': v.excerpt.slice(0, 2000),
      Dates: v.dateText.slice(0, 2000),
      ...(v.notes.length ? { Notes: v.notes.join(' ').slice(0, 2000) } : {}),
    },
  };
}
/** Links vacancies the user completed by hand ("inbox-<vacancy id>") to their feed entry. */
export function linkInboxImports(
  inbox: InboxEmail[],
  imported: { externalId: string; opportunityId: string }[],
) {
  for (const { externalId, opportunityId } of imported) {
    if (!externalId.startsWith('inbox-')) continue;
    const id = externalId.slice(6);
    for (const e of inbox)
      for (const v of e.vacancies)
        if (v.id === id) {
          v.opportunityId = opportunityId;
          v.missing = [];
        }
  }
}
