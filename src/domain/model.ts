import { z } from 'zod';

export const states = ['QLD', 'NSW', 'VIC', 'WA', 'SA', 'NT', 'TAS', 'ACT'] as const;
export const specialties = [
  'Psychiatry',
  'Emergency medicine',
  'General medicine',
  'Rural generalist',
  'Intensive care',
  'Other',
] as const;
export const grades = ['RMO', 'SRMO', 'PHO', 'Registrar', 'CMO', 'Consultant', 'GP'] as const;
export const stages = [
  'Discovered',
  'Saved',
  'Enquiry sent',
  'Applied',
  'Credentialing',
  'Offered',
  'Accepted',
  'Declined',
  'Dismissed',
] as const;
export const dimensions = ['financial', 'adventure', 'clinical', 'logistics', 'quality'] as const;
export type Dimension = (typeof dimensions)[number];
export type Weights = Record<Dimension, number>;
export type Stage = (typeof stages)[number];
export type Eligibility =
  'Eligible' | 'Likely eligible' | 'Needs verification' | 'Ineligible' | 'Expired/unavailable';
export const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'Use a real date in YYYY-MM-DD format');
const nullablePositive = z.number().finite().positive().max(1000000).nullable();
export const safeUrl = z
  .string()
  .url()
  .refine(
    (v) => ['http:', 'https:'].includes(new URL(v).protocol),
    'Only http and https links are supported',
  );
export const weightsSchema = z
  .object({
    financial: z.number().min(0).max(100),
    adventure: z.number().min(0).max(100),
    clinical: z.number().min(0).max(100),
    logistics: z.number().min(0).max(100),
    quality: z.number().min(0).max(100),
  })
  .refine((w) => Object.values(w).some((v) => v > 0), 'At least one weight must be positive');
export const profileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  homeBase: z.string().max(100),
  registration: z.enum(['unknown', 'general', 'specialist', 'limited']),
  pgy: z.number().int().min(1).max(60).nullable(),
  credentials: z.array(z.string().trim().min(1).max(100)).max(30),
  credentialsConfirmed: z.boolean(),
  independentCover: z.enum(['unknown', 'yes', 'no']),
  supervisionRequired: z.enum(['unknown', 'yes', 'no']),
  eligibleGrades: z.array(z.enum(grades)),
  preferredSpecialties: z.array(z.enum(specialties)),
  preferredStates: z.array(z.enum(states)),
  excludedStates: z.array(z.enum(states)),
  availability: z
    .array(
      z
        .object({ start: dateOnly, end: dateOnly })
        .refine((v) => v.start <= v.end, 'Availability end precedes start'),
    )
    .max(50),
  minimumHourly: z.number().min(0).max(5000),
  targetHourly: z.number().min(1).max(5000),
  maxPlacementDays: z.number().int().min(1).max(730),
  weights: weightsSchema,
});
export type Profile = z.infer<typeof profileSchema>;
export const requirementsSchema = z.object({
  registration: z.enum(['general', 'specialist', 'limited']).nullable(),
  minPgy: z.number().int().min(1).max(60).nullable(),
  credentials: z.array(z.string().max(100)).max(30),
  independentCover: z.boolean().nullable(),
  supervisionAvailable: z.boolean().nullable(),
  complete: z.boolean(),
});
export const compensationSchema = z.object({
  amount: nullablePositive,
  basis: z.enum(['hour', 'day', 'shift', 'placement', 'unknown']),
  currency: z.literal('AUD'),
  paidHours: nullablePositive,
  paidDays: z.number().int().positive().max(730).nullable(),
  paidShifts: z.number().int().positive().max(2000).nullable(),
  directExpenses: z.number().min(0).max(1000000).nullable(),
  travelHours: z.number().min(0).max(500).nullable(),
  additionalPay: z.number().min(0).max(1000000).nullable(),
  super: z.enum(['included', 'additional', 'unknown']),
  arrangement: z.enum(['employee', 'contractor', 'unknown']),
  onCall: z.enum(['none', 'included', 'additional', 'unknown']),
  notes: z.string().max(3000),
});
export type Compensation = z.infer<typeof compensationSchema>;
export const listingInputSchema = z
  .object({
    sourceId: z.string().min(1).max(100),
    externalId: z.string().min(1).max(200),
    url: safeUrl.nullable(),
    rawText: z.string().min(1).max(100000),
    title: z.string().trim().min(1).max(200),
    facilityName: z.string().trim().min(1).max(150),
    town: z.string().trim().min(1).max(100),
    state: z.enum(states),
    specialty: z.enum(specialties),
    grade: z.enum(grades),
    startDate: dateOnly,
    endDate: dateOnly,
    roster: z.string().trim().max(500),
    reference: z.string().trim().max(100),
    requirements: requirementsSchema,
    compensation: compensationSchema,
    flights: z.enum(['included', 'not included', 'unknown']),
    accommodation: z.enum(['included', 'not included', 'unknown']),
    status: z.enum([
      'advertised',
      'verification pending',
      'confirmed available',
      'filled',
      'withdrawn',
    ]),
    contact: z.string().max(300),
    evidence: z.record(z.string(), z.string().max(2000)),
  })
  .refine((v) => v.startDate <= v.endDate, 'Placement end precedes start');
export type ListingInput = z.infer<typeof listingInputSchema>;
export interface Facility {
  id: string;
  name: string;
  aliases: string[];
  town: string;
  state: (typeof states)[number];
  timezone: string;
  lat: number | null;
  lon: number | null;
  adventure: number | null;
  adventureNote: string;
  coverage: 'observed' | 'unknown' | 'excluded';
  /** Present for directory entries; undefined for facilities added by hand or from ads. */
  sector?: 'public' | 'private';
}
export interface Source {
  id: string;
  name: string;
  url: string;
  type: 'agency' | 'government' | 'email' | 'manual' | 'discovery' | 'aggregator';
  method: 'manual' | 'jsonld' | 'json-api' | 'collector';
  collector?: import('./acquisition').CollectorConfig;
  crawl?: import('./acquisition').CrawlState;
  qualification?: string;
  detailChecks?: Record<string, { signature: string; checkedAt: string }>;
  permission: 'unreviewed' | 'approved' | 'denied';
  permissionEvidence: string;
  enabled: boolean;
  intervalHours: number;
  lastSuccess: string | null;
  lastAttempt: string | null;
  error: string | null;
}
export interface SourceListing extends ListingInput {
  id: string;
  opportunityId: string;
  observedAt: string;
  firstSeenAt: string;
  contentHash: string;
}
export interface Opportunity {
  id: string;
  facilityId: string;
  title: string;
  specialty: (typeof specialties)[number];
  grade: (typeof grades)[number];
  startDate: string;
  endDate: string;
  roster: string;
  reference: string;
  requirements: z.infer<typeof requirementsSchema>;
  status: ListingInput['status'];
  firstSeenAt: string;
  lastSeenAt: string;
  verifiedAt: string | null;
  demo: boolean;
}
export interface Offer {
  id: string;
  opportunityId: string;
  listingId: string;
  sourceId: string;
  compensation: Compensation;
  flights: ListingInput['flights'];
  accommodation: ListingInput['accommodation'];
  contact: string;
  updatedAt: string;
}
export interface JobAction {
  opportunityId: string;
  stage: Stage;
  notes: string;
  updatedAt: string;
}
export interface Observation {
  id: string;
  listingId: string;
  observedAt: string;
  contentHash: string;
  snapshot: ListingInput;
}
export interface CollectionRun {
  gmailFindings?: { id: string; title: string; status: 'offer' | 'review'; detail: string }[];
  gmailSkipped?: number;
  id: string;
  sourceId: string;
  startedAt: string;
  completedAt: string;
  status: 'success' | 'partial' | 'failed' | 'skipped';
  pages?: number;
  remaining?: number;
  limited?: boolean;
  count: number;
  scanCount?: number;
  message: string;
}
export interface ReviewItem {
  emailScreen?: import('./email-screening').EmailScreen;
  publishedAt?: string | null;
  observedAt?: string;
  id: string;
  kind: 'possible duplicate' | 'extraction';
  opportunityId: string | null;
  candidateId: string | null;
  reason: string;
  resolved: boolean;
  draft: Partial<ListingInput> | null;
  rawText: string | null;
  sourceId: string;
}
export interface Store {
  version: 1;
  profile: Profile;
  facilities: Facility[];
  sources: Source[];
  listings: SourceListing[];
  opportunities: Opportunity[];
  offers: Offer[];
  actions: JobAction[];
  observations: Observation[];
  runs: CollectionRun[];
  reviews: ReviewItem[];
  documents: import('./acquisition').AcquisitionDocument[];
  /** Recruiter emails read from Gmail, one record per email. */
  inbox: import('./inbox').InboxEmail[];
}
export const defaultProfile: Profile = {
  name: 'My profile',
  homeBase: 'Cairns, QLD',
  registration: 'unknown',
  pgy: null,
  credentials: [],
  credentialsConfirmed: false,
  independentCover: 'unknown',
  supervisionRequired: 'unknown',
  eligibleGrades: [],
  preferredSpecialties: [
    'Psychiatry',
    'Emergency medicine',
    'General medicine',
    'Rural generalist',
  ],
  preferredStates: [],
  excludedStates: [],
  availability: [],
  minimumHourly: 0,
  targetHourly: 180,
  maxPlacementDays: 90,
  weights: { financial: 30, adventure: 25, clinical: 20, logistics: 15, quality: 10 },
};
export const emptyCompensation: Compensation = {
  amount: null,
  basis: 'unknown',
  currency: 'AUD',
  paidHours: null,
  paidDays: null,
  paidShifts: null,
  directExpenses: null,
  travelHours: null,
  additionalPay: null,
  super: 'unknown',
  arrangement: 'unknown',
  onCall: 'unknown',
  notes: '',
};
export const unknownRequirements: z.infer<typeof requirementsSchema> = {
  registration: null,
  minPgy: null,
  credentials: [],
  independentCover: null,
  supervisionAvailable: null,
  complete: false,
};
