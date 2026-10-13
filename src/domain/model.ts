import { z } from 'zod';

export const states = ['QLD', 'NSW', 'VIC', 'WA', 'SA', 'NT', 'TAS', 'ACT'] as const;
/**
 * Discovery is national and cross-specialty (LR-001), so the vocabulary covers
 * the specialties agencies actually advertise. 'Other' remains for anything a
 * source does not name clearly; it is never guessed into a named specialty.
 */
export const specialties = [
  'Psychiatry',
  'Emergency medicine',
  'General medicine',
  'Rural generalist',
  'Intensive care',
  'Anaesthetics',
  'Obstetrics & gynaecology',
  'Paediatrics',
  'Surgery',
  'General practice',
  'Geriatric medicine',
  'Rehabilitation',
  'Palliative care',
  'Oncology',
  'Radiology',
  'Addiction medicine',
  'Other',
] as const;
export const grades = [
  'RMO',
  'SRMO',
  'PHO',
  'Registrar',
  'CMO',
  'SMO',
  'Consultant',
  'GP',
] as const;
export const stages = [
  'Discovered',
  'Saved',
  'Enquiry sent',
  'Applied',
  'Credentialing',
  'Offered',
  'Accepted',
  'Rejected',
  'Withdrawn',
  'Declined',
  'Dismissed',
] as const;
/** Stages that remove an opportunity from the active feed; the record stays in history. */
export const archivedStages: readonly Stage[] = ['Rejected', 'Withdrawn', 'Declined', 'Dismissed'];
/** Stages where the doctor has committed time, used for clash detection. */
export const committedStages: readonly Stage[] = ['Credentialing', 'Offered', 'Accepted'];
export const availabilityKinds = [
  'available',
  'preferred',
  'approved-leave',
  'provisional-leave',
  'negotiable',
  'unavailable',
] as const;
export type AvailabilityKind = (typeof availabilityKinds)[number];
export const availabilityLabels: Record<AvailabilityKind, string> = {
  available: 'Confirmed available',
  preferred: 'Preferred working period',
  'approved-leave': 'Approved leave',
  'provisional-leave': 'Provisional leave or release',
  negotiable: 'Negotiable work commitment',
  unavailable: 'Confirmed unavailable',
};
export const dimensions = ['financial', 'adventure', 'clinical', 'logistics', 'quality'] as const;
export type Dimension = (typeof dimensions)[number];
export type Weights = Record<Dimension, number>;
export type Stage = (typeof stages)[number];
export type Eligibility =
  'Eligible' | 'Likely eligible' | 'Needs verification' | 'Ineligible' | 'Expired/unavailable';
export type Scheduling = 'Fits' | 'Fits with conditions' | 'Not set' | 'Conflict';
export type Logistics = 'Straightforward' | 'Needs arranging' | 'Tight timeline' | 'Unknown' | 'Excluded';
export type Urgency = 'Urgent' | 'Near-term' | 'Medium-term' | 'Long-term' | 'Flexible';
export type Lifecycle =
  | 'Newly discovered'
  | 'Currently advertised'
  | 'Availability unconfirmed'
  | 'Confirmed available'
  | 'Filled or withdrawn'
  | 'Expired'
  | 'Archived';
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
const nullableMoney = z.number().min(0).max(100000).nullable();
export const availabilitySchema = z
  .object({
    start: dateOnly,
    end: dateOnly,
    kind: z.enum(availabilityKinds),
    note: z.string().max(200),
  })
  .refine((v) => v.start <= v.end, 'Availability end precedes start');
export type AvailabilityWindow = z.infer<typeof availabilitySchema>;
export const profileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  homeBase: z.string().max(100),
  registration: z.enum(['unknown', 'general', 'specialist', 'limited']),
  pgy: z.number().int().min(1).max(60).nullable(),
  credentials: z.array(z.string().trim().min(1).max(100)).max(30),
  credentialsConfirmed: z.boolean(),
  /** Fellowships held (e.g. FRANZCP). Empty with fellowshipsConfirmed=false means unknown. */
  fellowships: z.array(z.string().trim().min(1).max(60)).max(10),
  fellowshipsConfirmed: z.boolean(),
  /** Procedural skills the doctor will undertake independently (e.g. ECT, intubation). */
  procedures: z.array(z.string().trim().min(1).max(80)).max(30),
  independentCover: z.enum(['unknown', 'yes', 'no']),
  supervisionRequired: z.enum(['unknown', 'yes', 'no']),
  eligibleGrades: z.array(z.enum(grades)),
  /** Specialties the doctor is competent to work in: an eligibility fact, not a preference. */
  competentSpecialties: z.array(z.enum(specialties)),
  /** Secondary-employment or training-program approval for locum work. */
  employmentApproval: z.enum(['unknown', 'not needed', 'needed', 'approved']),
  restrictionNotes: z.string().max(1000),
  preferredSpecialties: z.array(z.enum(specialties)),
  preferredStates: z.array(z.enum(states)),
  excludedStates: z.array(z.enum(states)),
  availability: z.array(availabilitySchema).max(100),
  minimumHourly: z.number().min(0).max(5000),
  targetHourly: z.number().min(1).max(5000),
  maxPlacementDays: z.number().int().min(1).max(730),
  /** Days before a start date that credentialing realistically needs. */
  credentialingLeadDays: z.number().int().min(0).max(180),
  urgency: z
    .object({
      urgentDays: z.number().int().min(1).max(90),
      nearTermDays: z.number().int().min(2).max(180),
      mediumTermDays: z.number().int().min(3).max(730),
    })
    .refine(
      (u) => u.urgentDays < u.nearTermDays && u.nearTermDays < u.mediumTermDays,
      'Urgency thresholds must increase',
    ),
  /** Personal cost assumptions. Null means "do not estimate". */
  costs: z.object({
    returnFlight: nullableMoney,
    nightlyAccommodation: nullableMoney,
    hourlyValueOfTime: nullableMoney,
    assumedHoursPerDay: z.number().min(1).max(24).nullable(),
  }),
  weights: weightsSchema,
  alertScore: z.number().int().min(0).max(100),
  alertsSeenAt: z.string().max(40).nullable(),
});
export type Profile = z.infer<typeof profileSchema>;
export const requirementsSchema = z.object({
  registration: z.enum(['general', 'specialist', 'limited']).nullable(),
  minPgy: z.number().int().min(1).max(60).nullable(),
  credentials: z.array(z.string().max(100)).max(30),
  independentCover: z.boolean().nullable(),
  supervisionAvailable: z.boolean().nullable(),
  /** True when the source states a specialist fellowship is required. */
  fellowship: z.boolean().nullable().default(null),
  /** Procedural competencies the source states as required. */
  procedures: z.array(z.string().max(100)).max(20).default([]),
  complete: z.boolean(),
});
export type Requirements = z.infer<typeof requirementsSchema>;
export const shiftSchema = z.object({
  date: dateOnly,
  start: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable(),
  end: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable(),
  kind: z.enum(['day', 'evening', 'night', 'on-call', 'unknown']),
});
export type Shift = z.infer<typeof shiftSchema>;
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
    /** Whether the source says dates can move. */
    flexibility: z.enum(['fixed', 'flexible', 'unknown']).default('unknown'),
    /** Individual shifts when the source lists them; empty means a continuous block. */
    shifts: z.array(shiftSchema).max(400).default([]),
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
  /** Optional natural-history enrichment (Atlas of Living Australia occurrence data). */
  biodiversity?: {
    taxon: string;
    species: number;
    records: number;
    radiusKm: number;
    /** 0–100 relative to the richest facility checked; null until compared. */
    score: number | null;
    fetchedAt: string;
  } | null;
}
export interface Source {
  id: string;
  name: string;
  url: string;
  type: 'agency' | 'government' | 'email' | 'manual';
  method: 'manual' | 'jsonld' | 'json-api';
  /** Where the source is known to advertise; empty means national or unknown. */
  regions?: string[];
  /** What kinds of roles it mostly carries, for coverage reporting. */
  focus?: string;
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
  requirements: Requirements;
  status: ListingInput['status'];
  flexibility?: ListingInput['flexibility'];
  shifts?: Shift[];
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
  id: string;
  sourceId: string;
  startedAt: string;
  completedAt: string;
  status: 'success' | 'failed' | 'skipped';
  count: number;
  message: string;
}
export interface ReviewItem {
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
/**
 * Something that happened to an opportunity, recorded at ingest time. Alerts are
 * derived from events plus current scores, so a vacancy advertised by several
 * agencies produces one "new" event, not one per advertisement.
 */
export interface RadarEvent {
  id: string;
  at: string;
  opportunityId: string;
  kind: 'new' | 'rate-change' | 'new-offer' | 'status' | 'details';
  sourceId: string;
  detail: string;
  /** Previous and current comparable figures for rate changes. */
  before?: number | null;
  after?: number | null;
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
  events: RadarEvent[];
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
  fellowships: [],
  fellowshipsConfirmed: false,
  procedures: [],
  competentSpecialties: [],
  employmentApproval: 'unknown',
  restrictionNotes: '',
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
  credentialingLeadDays: 21,
  urgency: { urgentDays: 14, nearTermDays: 60, mediumTermDays: 180 },
  costs: {
    returnFlight: null,
    nightlyAccommodation: null,
    hourlyValueOfTime: null,
    assumedHoursPerDay: null,
  },
  weights: { financial: 30, adventure: 25, clinical: 20, logistics: 15, quality: 10 },
  alertScore: 75,
  alertsSeenAt: null,
};
/**
 * Brings a stored profile from an earlier version up to the current schema.
 * New fields start at their unknown or neutral defaults; nothing is inferred.
 */
export function migrateProfile(stored: unknown): Profile {
  const p = (stored ?? {}) as Partial<Profile> & {
    availability?: Partial<AvailabilityWindow>[];
  };
  const merged = {
    ...structuredClone(defaultProfile),
    ...p,
    costs: { ...defaultProfile.costs, ...(p.costs ?? {}) },
    urgency: { ...defaultProfile.urgency, ...(p.urgency ?? {}) },
    availability: (p.availability ?? []).map((a) => ({
      ...a,
      kind: a.kind ?? ('available' as const),
      note: a.note ?? '',
    })),
  };
  const parsed = profileSchema.safeParse(merged);
  return parsed.success ? parsed.data : (merged as Profile);
}
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
  fellowship: null,
  procedures: [],
  complete: false,
};
