import type {
  AvailabilityWindow,
  Compensation,
  Eligibility,
  Facility,
  Lifecycle,
  Logistics,
  Offer,
  Opportunity,
  Profile,
  Scheduling,
  SourceListing,
  Store,
  Urgency,
  Weights,
} from './model';
import { archivedStages, availabilityLabels, committedStages, dimensions } from './model';

/*
 * Deterministic assessment engine. Four questions are answered separately and
 * never share a threshold (spec §4):
 *   1. Professional eligibility — is the doctor qualified?
 *   2. Scheduling feasibility — could they do these dates?
 *   3. Logistical feasibility — can travel, stay and credentialing be arranged?
 *   4. Personal attractiveness — is it worth pursuing?
 * Unknowns stay unknown. Missing evidence is never scored as zero.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();
export function localDate(now = new Date(), timezone = 'Australia/Brisbane'): string {
  let f = formatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatters.set(timezone, f);
  }
  return f.format(now);
}
export const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
export const duration = (o: Pick<Opportunity, 'startDate' | 'endDate'>) =>
  daysBetween(o.startDate, o.endDate) + 1;
export const overlaps = (
  a: { startDate: string; endDate: string },
  b: { startDate: string; endDate: string },
) => a.startDate <= b.endDate && b.startDate <= a.endDate;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
/** Days actually worked: listed shift dates, or every calendar day of a block. */
export function workDates(o: Pick<Opportunity, 'startDate' | 'endDate' | 'shifts'>): string[] {
  if (o.shifts?.length) return [...new Set(o.shifts.map((s) => s.date))].sort();
  const out: string[] = [];
  for (let d = o.startDate; d <= o.endDate && out.length < 800; d = addDays(d, 1)) out.push(d);
  return out;
}
const weekday = (d: string) => {
  const w = new Date(`${d}T00:00:00Z`).getUTCDay();
  return w !== 0 && w !== 6;
};
const shortDate = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmt = (d: string) => shortDate.format(new Date(`${d}T00:00:00Z`));
const rangeText = (dates: string[]) =>
  !dates.length
    ? ''
    : dates.length === 1
      ? fmt(dates[0])
      : `${fmt(dates[0])}–${fmt(dates[dates.length - 1])}`;

/* ------------------------------------------------------------------ geography */

export function distanceKm(
  a: { lat: number | null; lon: number | null } | null,
  b: { lat: number | null; lon: number | null } | null,
) {
  if (!a || !b || a.lat === null || a.lon === null || b.lat === null || b.lon === null)
    return null;
  const r = Math.PI / 180,
    dLat = (b.lat - a.lat) * r,
    dLon = (b.lon - a.lon) * r;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return Math.round(6371 * 2 * Math.asin(Math.sqrt(h)));
}
/** Resolves "Cairns, QLD" to coordinates from a facility in that town. */
export function homeCoordinates(profile: Profile, facilities: Facility[]) {
  const [townRaw, stateRaw] = profile.homeBase.split(',').map((v) => v.trim().toLowerCase());
  if (!townRaw) return null;
  const match = facilities.find(
    (f) =>
      f.lat !== null &&
      f.town.toLowerCase() === townRaw &&
      (!stateRaw || f.state.toLowerCase() === stateRaw),
  );
  return match ? { lat: match.lat, lon: match.lon } : null;
}
/** Within this distance the doctor can drive in; flights and accommodation are moot. */
export const LOCAL_KM = 80;

/* ---------------------------------------------------------------- eligibility */

export interface Check {
  dimension: string;
  status: 'met' | 'unknown' | 'conflict';
  text: string;
}
/** Professional eligibility only: credentials, competence and restrictions. */
export function assessEligibility(
  o: Opportunity,
  p: Profile,
  f: Facility,
  now = new Date(),
): { status: Eligibility; reasons: string[]; checks: Check[] } {
  if (o.endDate < localDate(now, f.timezone) || ['filled', 'withdrawn'].includes(o.status))
    return {
      status: 'Expired/unavailable',
      reasons: ['The placement has ended or the source reports it unavailable.'],
      checks: [],
    };
  const checks: Check[] = [];
  const add = (dimension: string, status: Check['status'], text: string) =>
    checks.push({ dimension, status, text });
  const r = o.requirements;

  // Registration. Specialist and general registration are not treated as interchangeable.
  if (p.registration === 'unknown') add('Registration', 'unknown', 'Confirm your registration category.');
  else if (p.registration === 'limited' && r.registration && r.registration !== 'limited')
    add('Registration', 'conflict', 'The stated registration requirement conflicts with limited registration.');
  else if (!r.registration) add('Registration', 'unknown', 'The required registration category is not stated.');
  else if (p.registration !== r.registration)
    add(
      'Registration',
      'unknown',
      `Confirm whether your ${p.registration} registration satisfies the stated ${r.registration} requirement.`,
    );
  else add('Registration', 'met', `${r.registration[0].toUpperCase()}${r.registration.slice(1)} registration matches.`);

  // Postgraduate experience.
  if (p.pgy === null) add('Experience', 'unknown', 'Your postgraduate year is not confirmed.');
  else if (r.minPgy !== null && p.pgy < r.minPgy)
    add('Experience', 'conflict', `Requires PGY${r.minPgy}; your profile is PGY${p.pgy}.`);
  else if (r.minPgy !== null) add('Experience', 'met', `PGY${p.pgy} meets the PGY${r.minPgy} minimum.`);

  // Qualifications, fellowships and credentialing items.
  for (const credential of r.credentials)
    if (!p.credentials.some((c) => c.toLowerCase() === credential.toLowerCase()))
      add(
        'Credentials',
        p.credentialsConfirmed ? 'conflict' : 'unknown',
        `Required credential: ${credential}.`,
      );
    else add('Credentials', 'met', `${credential} held.`);
  if (r.fellowship === true) {
    if (p.fellowships.length) add('Fellowship', 'met', `Fellowship required; you hold ${p.fellowships.join(', ')}.`);
    else
      add(
        'Fellowship',
        p.fellowshipsConfirmed ? 'conflict' : 'unknown',
        'A specialist fellowship is required.',
      );
  }
  if (r.fellowship === null && o.grade === 'Consultant' && !p.fellowships.length)
    add('Fellowship', 'unknown', 'Consultant roles usually require a fellowship; the source does not say.');

  // Specialty competence and grade.
  if (!p.competentSpecialties.length)
    add('Specialty', 'unknown', 'Confirm the specialties you can work in.');
  else if (o.specialty === 'Other')
    add('Specialty', 'unknown', 'The source does not name a specialty this app recognises.');
  else if (!p.competentSpecialties.includes(o.specialty))
    add('Specialty', 'conflict', `${o.specialty} is outside the specialties you work in.`);
  else add('Specialty', 'met', `${o.specialty} is within your competence.`);
  if (!p.eligibleGrades.length) add('Grade', 'unknown', 'Confirm the grades you can undertake.');
  else if (!p.eligibleGrades.includes(o.grade))
    add('Grade', 'conflict', `${o.grade} is outside your confirmed grades.`);
  else add('Grade', 'met', `${o.grade} is a grade you work at.`);

  // Procedures.
  for (const procedure of r.procedures ?? [])
    if (!p.procedures.some((v) => v.toLowerCase() === procedure.toLowerCase()))
      add('Procedures', 'unknown', `Requires ${procedure}; not listed in your procedures.`);
    else add('Procedures', 'met', `${procedure} listed.`);

  // Supervision and independent cover.
  if (r.independentCover && p.independentCover === 'no')
    add('Cover', 'conflict', 'Requires independent cover, which your profile excludes.');
  else if (r.independentCover && p.independentCover === 'unknown')
    add('Cover', 'unknown', 'Confirm independent-cover suitability.');
  if (p.supervisionRequired === 'yes' && r.supervisionAvailable === false)
    add('Supervision', 'conflict', 'Required supervision is explicitly unavailable.');
  else if (p.supervisionRequired === 'unknown')
    add('Supervision', 'unknown', 'Confirm your supervision needs.');
  else if (p.supervisionRequired === 'yes' && r.supervisionAvailable === null)
    add('Supervision', 'unknown', 'Confirm the supervision available on site.');

  // Training and employment restrictions. Approval is never inferred.
  if (p.employmentApproval === 'unknown')
    add('Restrictions', 'unknown', 'Confirm whether your employer or training program must approve locum work.');
  else if (p.employmentApproval === 'needed')
    add('Restrictions', 'unknown', 'Secondary-employment approval is needed and not yet recorded as granted.');

  const conflicts = checks.filter((c) => c.status === 'conflict').map((c) => c.text);
  const unknown = checks.filter((c) => c.status === 'unknown').map((c) => c.text);
  if (conflicts.length) return { status: 'Ineligible', reasons: [...conflicts, ...unknown], checks };
  if (unknown.length) return { status: 'Needs verification', reasons: unknown, checks };
  if (!r.complete)
    return {
      status: 'Likely eligible',
      reasons: [
        'Known requirements match; the source has not confirmed its requirement list is complete. Missing requirements are not evidence they are satisfied.',
      ],
      checks,
    };
  return {
    status: 'Eligible',
    reasons: [
      'Your declared profile satisfies the recorded requirements; final credentialing remains with the employer.',
    ],
    checks,
  };
}

/* ----------------------------------------------------------------- scheduling */

/**
 * Scheduling feasibility against declared availability and committed work.
 * Negotiable conflicts stay visible with a warning; approval of leave or
 * release is never inferred.
 */
export function assessScheduling(
  o: Opportunity,
  p: Profile,
  committed: { id: string; title: string; startDate: string; endDate: string }[] = [],
): { status: Scheduling; reasons: string[]; conflicts: string[] } {
  const dates = workDates(o);
  const reasons: string[] = [],
    conflicts: string[] = [];
  const within = (w: AvailabilityWindow) => dates.filter((d) => d >= w.start && d <= w.end);
  for (const kind of ['unavailable', 'negotiable', 'provisional-leave'] as const)
    for (const w of p.availability.filter((v) => v.kind === kind)) {
      const hit = within(w);
      if (!hit.length) continue;
      const text = `${hit.length} day${hit.length > 1 ? 's' : ''} (${rangeText(hit)}) fall in ${availabilityLabels[kind].toLowerCase()}${w.note ? `: ${w.note}` : ''}.`;
      if (kind === 'unavailable') conflicts.push(text);
      else reasons.push(kind === 'negotiable' ? `${text} Negotiable — check before committing.` : `${text} Approval is not assumed.`);
    }
  for (const c of committed)
    if (c.id !== o.id && overlaps(o, c))
      conflicts.push(`Clashes with your committed placement: ${c.title} (${fmt(c.startDate)}–${fmt(c.endDate)}).`);
  if (duration(o) > p.maxPlacementDays)
    reasons.push(`Runs ${duration(o)} days, longer than your ${p.maxPlacementDays}-day maximum.`);
  const declared = p.availability.length > 0;
  if (declared) {
    const covered = (d: string) =>
      p.availability.some((w) => w.kind !== 'unavailable' && d >= w.start && d <= w.end);
    const uncovered = dates.filter((d) => !covered(d));
    if (uncovered.length && uncovered.length < dates.length)
      reasons.push(`${uncovered.length} day(s) (${rangeText(uncovered)}) are outside your declared availability.`);
    else if (uncovered.length === dates.length && !conflicts.length)
      reasons.push('The whole placement is outside your declared availability.');
  }
  if (conflicts.length) {
    if (o.flexibility === 'flexible')
      return {
        status: 'Fits with conditions',
        reasons: [...reasons, 'Dates are advertised as flexible, so the conflict may be negotiable.'],
        conflicts,
      };
    return { status: 'Conflict', reasons, conflicts };
  }
  if (!declared && !reasons.length)
    return { status: 'Not set', reasons: ['Add your availability to check these dates.'], conflicts };
  if (reasons.length) return { status: 'Fits with conditions', reasons, conflicts };
  return { status: 'Fits', reasons: ['Every working day falls in your declared availability.'], conflicts };
}

/* ------------------------------------------------------------------ logistics */

export function assessLogistics(
  o: Opportunity,
  f: Facility,
  offers: Offer[],
  p: Profile,
  ctx: { now: Date; home: { lat: number | null; lon: number | null } | null; stage?: string },
): { status: Logistics; reasons: string[]; distanceKm: number | null; local: boolean } {
  const km = distanceKm(ctx.home, f);
  const local = km !== null && km <= LOCAL_KM;
  const reasons: string[] = [];
  if (p.excludedStates.includes(f.state))
    return { status: 'Excluded', reasons: [`${f.state} is excluded in your profile.`], distanceKm: km, local };
  const lead = daysBetween(localDate(ctx.now, f.timezone), o.startDate);
  const tight =
    lead < p.credentialingLeadDays &&
    !['Credentialing', 'Offered', 'Accepted'].includes(ctx.stage ?? '');
  if (tight)
    reasons.push(
      lead <= 0
        ? 'Already started or starting today; only workable if you are already credentialled there.'
        : `Starts in ${lead} day${lead === 1 ? '' : 's'}; credentialing usually needs about ${p.credentialingLeadDays}.`,
    );
  let travel: 'arranged' | 'self' | 'unknown' = 'unknown';
  if (local) {
    travel = 'arranged';
    reasons.push(`${km} km from home; no flights or accommodation needed.`);
  } else {
    const flights = offers.some((v) => v.flights === 'included'),
      stay = offers.some((v) => v.accommodation === 'included');
    const flightsNo = offers.length > 0 && offers.every((v) => v.flights === 'not included'),
      stayNo = offers.length > 0 && offers.every((v) => v.accommodation === 'not included');
    if (flights && stay) travel = 'arranged';
    else if (flightsNo || stayNo) travel = 'self';
    if (flights && stay) reasons.push('Flights and accommodation are included by at least one offer.');
    else {
      if (!flights)
        reasons.push(flightsNo ? 'Flights are not included.' : 'Flights are not confirmed as included.');
      if (!stay)
        reasons.push(
          stayNo ? 'Accommodation is not included.' : 'Accommodation is not confirmed as included.',
        );
    }
    if (km !== null) reasons.push(`${km.toLocaleString('en-AU')} km from home.`);
  }
  const status: Logistics = tight
    ? 'Tight timeline'
    : travel === 'self'
      ? 'Needs arranging'
      : travel === 'unknown'
        ? 'Unknown'
        : 'Straightforward';
  return { status, reasons, distanceKm: km, local };
}

/* ------------------------------------------------------------ time and status */

export function urgencyOf(o: Opportunity, p: Profile, now: Date, timezone: string): Urgency {
  if (o.flexibility === 'flexible') return 'Flexible';
  const d = daysBetween(localDate(now, timezone), o.startDate);
  if (d <= p.urgency.urgentDays) return 'Urgent';
  if (d <= p.urgency.nearTermDays) return 'Near-term';
  if (d <= p.urgency.mediumTermDays) return 'Medium-term';
  return 'Long-term';
}
/** Days without a fresh observation before an advertised job counts as unconfirmed. */
export const STALE_DAYS = 7;
export function lifecycleOf(
  o: Opportunity,
  f: Facility,
  now: Date,
  stage: string | undefined,
  sourceDown: boolean,
): Lifecycle {
  if (stage && (archivedStages as string[]).includes(stage)) return 'Archived';
  if (['filled', 'withdrawn'].includes(o.status)) return 'Filled or withdrawn';
  if (o.endDate < localDate(now, f.timezone)) return 'Expired';
  if (o.status === 'confirmed available') return 'Confirmed available';
  const age = (now.getTime() - Date.parse(o.lastSeenAt)) / 86400000;
  // A source outage leaves known vacancies as they were; it never marks them filled.
  if (o.status === 'verification pending' || (age > STALE_DAYS && !sourceDown))
    return 'Availability unconfirmed';
  if ((now.getTime() - Date.parse(o.firstSeenAt)) / 86400000 <= 2) return 'Newly discovered';
  return 'Currently advertised';
}

/* ------------------------------------------------------------------- finance */

export function normalisePay(c: Compensation) {
  const warnings: string[] = [];
  let gross: number | null = null;
  if (c.amount !== null) {
    if (c.basis === 'placement') gross = c.amount;
    if (c.basis === 'hour' && c.paidHours !== null) gross = c.amount * c.paidHours;
    if (c.basis === 'day' && c.paidDays !== null) gross = c.amount * c.paidDays;
    if (c.basis === 'shift' && c.paidShifts !== null) gross = c.amount * c.paidShifts;
  }
  if (gross !== null && c.additionalPay !== null) gross += c.additionalPay;
  // On-call commitments make an hourly comparison misleading without total commitment hours.
  const comparable = c.onCall === 'none' && c.super !== 'included';
  const hourly = comparable
    ? gross !== null && c.paidHours !== null
      ? gross / c.paidHours
      : c.basis === 'hour'
        ? c.amount
        : null
    : null;
  const afterExpenses =
    gross !== null && c.directExpenses !== null ? gross - c.directExpenses : null;
  const committedHourly =
    afterExpenses !== null && c.paidHours !== null && c.travelHours !== null && comparable
      ? afterExpenses / (c.paidHours + c.travelHours)
      : null;
  if (c.amount === null) warnings.push('Remuneration is undisclosed.');
  if (gross === null)
    warnings.push(
      'Gross total needs a rate and confirmed paid units; calendar days are not paid days.',
    );
  if (c.onCall !== 'none')
    warnings.push(
      'On-call obligations are included, additional, or unknown; an ordinary hourly comparison is withheld.',
    );
  if (c.super === 'included')
    warnings.push(
      'Advertised amount includes super; a cash hourly comparison is withheld until its cash component is known.',
    );
  if (c.super === 'unknown')
    warnings.push('Superannuation treatment is unknown; confirm before comparing cash pay.');
  if (c.directExpenses === null) warnings.push('Personal placement expenses are unknown.');
  return {
    gross,
    hourly,
    afterExpenses,
    committedHourly,
    warnings,
    comparable,
    basis: 'Before personal income tax; advertised terms, not a payroll calculation.',
  };
}

export interface Figure {
  value: number | null;
  /** advertised: stated by the source. calculated: arithmetic on stated facts. estimated: uses your assumptions. */
  kind: 'advertised' | 'calculated' | 'estimated' | 'unknown';
  note: string;
}
/**
 * Earnings for one offer, keeping advertised, calculated and estimated figures
 * apart (acceptance criterion 8). Estimates use only assumptions the doctor
 * entered in their profile; with none entered, unknowns stay unknown.
 */
export function earnings(
  offer: Pick<Offer, 'compensation' | 'flights' | 'accommodation'>,
  o: Pick<Opportunity, 'startDate' | 'endDate' | 'shifts'>,
  p: Profile,
  local = false,
) {
  const c = offer.compensation;
  const pay = normalisePay(c);
  const assumptions: string[] = [];
  const advertised: Figure = {
    value: c.amount,
    kind: c.amount === null ? 'unknown' : 'advertised',
    note: c.amount === null ? 'Rate on enquiry' : `per ${c.basis}`,
  };
  let gross: Figure = {
    value: pay.gross,
    kind: pay.gross === null ? 'unknown' : 'calculated',
    note: pay.gross === null ? 'Needs confirmed paid units' : 'Rate × stated paid units',
  };
  const dates = workDates(o);
  const workdays = o.shifts?.length ? dates.length : dates.filter(weekday).length;
  if (pay.gross === null && c.amount !== null) {
    if (c.basis === 'day') {
      gross = { value: c.amount * workdays, kind: 'estimated', note: `${workdays} working days assumed` };
      assumptions.push(
        o.shifts?.length
          ? `Paid days taken as the ${workdays} listed shift dates.`
          : `Paid days taken as the ${workdays} weekdays in the block; confirm the roster.`,
      );
    } else if (c.basis === 'shift' && o.shifts?.length) {
      gross = { value: c.amount * o.shifts.length, kind: 'estimated', note: `${o.shifts.length} listed shifts` };
      assumptions.push(`Paid shifts taken as the ${o.shifts.length} listed shifts.`);
    } else if (c.basis === 'hour' && p.costs.assumedHoursPerDay) {
      const hours = workdays * p.costs.assumedHoursPerDay;
      gross = { value: c.amount * hours, kind: 'estimated', note: `${hours} hours assumed` };
      assumptions.push(
        `Paid hours assumed at ${p.costs.assumedHoursPerDay} h on each of ${workdays} working days (your profile setting).`,
      );
    }
  }
  if (gross.value !== null && c.additionalPay !== null && gross.kind === 'estimated')
    gross = { ...gross, value: gross.value + c.additionalPay };
  const nights = Math.max(0, daysBetween(o.startDate, o.endDate) + 1);
  const cost = (
    included: string,
    assumption: number | null,
    label: string,
    multiplier = 1,
  ): Figure => {
    if (local) return { value: 0, kind: 'calculated', note: 'Local; not needed' };
    if (included === 'included') return { value: 0, kind: 'advertised', note: 'Included' };
    if (assumption === null)
      return { value: null, kind: 'unknown', note: included === 'not included' ? 'Not included; no estimate set' : 'Unconfirmed' };
    assumptions.push(
      `${label} ${included === 'not included' ? 'is not included' : 'is unconfirmed'}; estimated from your profile setting.`,
    );
    return { value: assumption * multiplier, kind: 'estimated', note: `${label} estimate` };
  };
  const flights = cost(offer.flights, p.costs.returnFlight, 'Return travel');
  const accommodation = cost(offer.accommodation, p.costs.nightlyAccommodation, 'Accommodation', nights);
  const listed: Figure =
    c.directExpenses === null
      ? { value: null, kind: 'unknown', note: 'Other expenses not stated' }
      : { value: c.directExpenses, kind: 'advertised', note: 'Stated expenses' };
  const travelCost =
    flights.value !== null && accommodation.value !== null ? flights.value + accommodation.value : null;
  const net: Figure =
    gross.value !== null && travelCost !== null
      ? {
          value: gross.value - travelCost - (listed.value ?? 0),
          kind:
            gross.kind === 'estimated' || flights.kind === 'estimated' || accommodation.kind === 'estimated'
              ? 'estimated'
              : 'calculated',
          note: listed.value === null ? 'Before tax; other expenses unknown' : 'Before tax',
        }
      : { value: null, kind: 'unknown', note: 'Needs gross pay and travel costs' };
  const opportunityCost: Figure =
    p.costs.hourlyValueOfTime !== null && c.travelHours !== null
      ? {
          value: p.costs.hourlyValueOfTime * c.travelHours,
          kind: 'estimated',
          note: `${c.travelHours} unpaid travel hours at your $${p.costs.hourlyValueOfTime}/h`,
        }
      : { value: null, kind: 'unknown', note: 'Set a value for your time to estimate' };
  const known = [gross, flights, accommodation].filter((f) => f.kind !== 'unknown');
  const estimated = [gross, flights, accommodation].filter((f) => f.kind === 'estimated');
  const confidence: 'High' | 'Moderate' | 'Low' =
    known.length === 3 && !estimated.length && pay.comparable
      ? 'High'
      : known.length >= 2
        ? 'Moderate'
        : 'Low';
  return {
    advertised,
    hourly: pay.hourly,
    gross,
    flights,
    accommodation,
    listed,
    net,
    opportunityCost,
    assumptions,
    warnings: pay.warnings,
    confidence,
  };
}

/* ------------------------------------------------------------- evidence quality */

/**
 * How well-evidenced the record is, independent of how attractive it is. This
 * is about the source facts, not about scoring coverage.
 */
export function evidenceQuality(
  o: Opportunity,
  f: Facility,
  offers: Offer[],
  listings: SourceListing[],
  now: Date,
) {
  let score = 0;
  const gaps: string[] = [];
  const pays = offers.map((v) => normalisePay(v.compensation));
  if (pays.some((p) => p.hourly !== null)) score += 20;
  else if (offers.some((v) => v.compensation.amount !== null)) {
    score += 10;
    gaps.push('Rate is not directly comparable (super, on-call or units unclear).');
  } else gaps.push('No rate disclosed.');
  if (f.lat !== null) score += 15;
  else gaps.push('Facility location is not resolved to the national directory.');
  const r = o.requirements;
  if (r.complete) score += 15;
  else if (r.registration || r.minPgy !== null || r.credentials.length) {
    score += 8;
    gaps.push('Requirement list is partial.');
  } else gaps.push('Requirements are not stated.');
  const age = (now.getTime() - Date.parse(o.lastSeenAt)) / 86400000;
  if (age <= 3) score += 15;
  else if (age <= 14) {
    score += 8;
    gaps.push(`Last observed ${Math.floor(age)} days ago.`);
  } else gaps.push(`Last observed ${Math.floor(age)} days ago; may have been filled.`);
  const sources = new Set(listings.map((l) => l.sourceId));
  if (sources.size >= 2) score += 10;
  if (o.status === 'confirmed available') score += 15;
  else gaps.push('Availability not confirmed by a recruiter.');
  if (o.flexibility && o.flexibility !== 'unknown') score += 5;
  if (o.roster) score += 5;
  else gaps.push('Roster not stated.');
  score = Math.min(100, score);
  return { score, label: score >= 70 ? 'High' : score >= 45 ? 'Moderate' : 'Low', gaps, sources: sources.size };
}

/* -------------------------------------------------------------------- ranking */

export interface Preset {
  weights: Weights;
  /** Optional feed lens the preset applies alongside its weights. */
  lens?: 'short' | 'future';
  description: string;
}
export const presetDetails: Record<string, Preset> = {
  'Best overall': {
    weights: { financial: 30, adventure: 25, clinical: 20, logistics: 15, quality: 10 },
    description: 'The spec’s starting balance.',
  },
  'Maximum income': {
    weights: { financial: 65, adventure: 5, clinical: 10, logistics: 10, quality: 10 },
    description: 'Comparable pay dominates.',
  },
  'Adventure and exploration': {
    weights: { financial: 10, adventure: 60, clinical: 15, logistics: 5, quality: 10 },
    description: 'Places first; pay second.',
  },
  'Career development': {
    weights: { financial: 15, adventure: 10, clinical: 55, logistics: 10, quality: 10 },
    description: 'Your preferred specialties and grades.',
  },
  'Convenient short placements': {
    weights: { financial: 20, adventure: 5, clinical: 10, logistics: 55, quality: 10 },
    lens: 'short',
    description: 'Two weeks or less, easy to arrange.',
  },
  'Future planning': {
    weights: { financial: 30, adventure: 25, clinical: 20, logistics: 5, quality: 20 },
    lens: 'future',
    description: 'Medium- and long-term blocks for planning ahead.',
  },
};
export const presets: Record<string, Weights> = Object.fromEntries(
  Object.entries(presetDetails).map(([k, v]) => [k, v.weights]),
);
export const dimensionLabels: Record<keyof Weights, string> = {
  financial: 'Income',
  adventure: 'Location & adventure',
  clinical: 'Clinical & career',
  logistics: 'Scheduling & logistics',
  quality: 'Flexibility & quality',
};
const clamp = (v: number) => Math.max(0, Math.min(100, v));
const money = (v: number) => `$${Math.round(v).toLocaleString('en-AU')}`;

export function rankOpportunity(
  o: Opportunity,
  f: Facility,
  offers: Offer[],
  p: Profile,
  ctx: { local?: boolean; tight?: boolean; distanceKm?: number | null } = {},
) {
  const pays = offers.map((offer) => normalisePay(offer.compensation));
  const hourly = pays.map((x) => x.hourly).filter((v): v is number => v !== null);
  let bestHourly = hourly.length ? Math.max(...hourly) : null;
  let estimatedHourly = false;
  if (bestHourly === null && p.costs.assumedHoursPerDay) {
    const dayRates = offers
      .filter((v) => v.compensation.basis === 'day' && v.compensation.amount !== null && v.compensation.onCall === 'none')
      .map((v) => v.compensation.amount! / p.costs.assumedHoursPerDay!);
    if (dayRates.length) {
      bestHourly = Math.max(...dayRates);
      estimatedHourly = true;
    }
  }
  const reasons: Partial<Record<keyof Weights, string>> = {};
  const components: Record<keyof Weights, number | null> = {
    financial: null,
    adventure: null,
    clinical: null,
    logistics: null,
    quality: null,
  };
  if (bestHourly !== null) {
    components.financial = clamp((bestHourly / p.targetHourly) * 75);
    const delta = Math.round(((bestHourly - p.targetHourly) / p.targetHourly) * 100);
    reasons.financial = `${estimatedHourly ? 'About ' : ''}${money(bestHourly)}/h${estimatedHourly ? ' (day rate ÷ your assumed hours)' : ' comparable'}, ${delta === 0 ? 'on' : `${Math.abs(delta)}% ${delta > 0 ? 'above' : 'below'}`} your ${money(p.targetHourly)} target.`;
  }

  // Location: curated adventure value, measured biodiversity and preferred states.
  const parts: number[] = [];
  const locationNotes: string[] = [];
  if (f.adventure !== null) {
    parts.push(f.adventure);
    locationNotes.push(f.adventureNote || 'your location rating');
  }
  if (f.biodiversity?.score != null) {
    parts.push(f.biodiversity.score);
    locationNotes.push(`${f.biodiversity.species} ${f.biodiversity.taxon} species recorded nearby`);
  }
  if (p.preferredStates.length) {
    parts.push(p.preferredStates.includes(f.state) ? 100 : 40);
    locationNotes.push(p.preferredStates.includes(f.state) ? `${f.state} is a preferred state` : `${f.state} is not a preferred state`);
  }
  if (parts.length) {
    components.adventure = parts.reduce((a, b) => a + b, 0) / parts.length;
    reasons.adventure = `${f.town || f.name}: ${locationNotes.join('; ')}.`;
  }

  if (p.preferredSpecialties.length) {
    const preferred = p.preferredSpecialties.includes(o.specialty);
    const competent = p.competentSpecialties.includes(o.specialty);
    components.clinical = preferred ? 100 : competent ? 50 : 20;
    reasons.clinical = preferred
      ? `${o.specialty} is one of your preferred specialties.`
      : competent
        ? `${o.specialty} is within your competence but not a preference.`
        : `${o.specialty} is not among your preferences.`;
  }

  // Scheduling & logistics: benefits, distance, lead time and length.
  const hasBenefits = offers.some((v) => v.flights !== 'unknown' || v.accommodation !== 'unknown');
  if (ctx.local || hasBenefits) {
    const best = ctx.local
      ? 2
      : Math.max(
          0,
          ...offers.map(
            (v) => (v.flights === 'included' ? 1 : 0) + (v.accommodation === 'included' ? 1 : 0),
          ),
        );
    let v = 40 + best * 30;
    const notes = [
      ctx.local
        ? 'Within driving distance of home'
        : best === 2
          ? 'Flights and accommodation included'
          : best === 1
            ? 'One of flights or accommodation included'
            : 'Travel and accommodation are yours to arrange',
    ];
    if (ctx.tight) {
      v -= 25;
      notes.push('tight credentialing window');
    }
    if (duration(o) > p.maxPlacementDays) {
      v -= 30;
      notes.push('longer than your maximum');
    }
    components.logistics = clamp(v);
    reasons.logistics = `${notes.join('; ')}.`;
  }

  const statusScore =
    o.status === 'confirmed available' ? 100 : o.status === 'advertised' ? 65 : 40;
  components.quality = clamp(statusScore + (o.flexibility === 'flexible' ? 15 : 0) + (offers.length > 1 ? 10 : 0));
  reasons.quality = [
    o.status === 'confirmed available' ? 'Confirmed available' : o.status === 'advertised' ? 'Advertised' : 'Awaiting verification',
    o.flexibility === 'flexible' ? 'flexible dates' : '',
    offers.length > 1 ? `${offers.length} competing offers` : '',
  ]
    .filter(Boolean)
    .join(', ') + '.';

  const total = dimensions.reduce((s, d) => s + p.weights[d], 0);
  const observedWeight = dimensions.reduce(
    (s, d) => s + (components[d] === null ? 0 : p.weights[d]),
    0,
  );
  const score = observedWeight
    ? Math.round(
        dimensions.reduce((s, d) => s + (components[d] ?? 0) * p.weights[d], 0) / observedWeight,
      )
    : null;
  const evidence = Math.round(
    (dimensions.filter((d) => components[d] !== null).length / dimensions.length) * 100,
  );
  const weightCoverage = Math.round((observedWeight / total) * 100);
  const ordered = dimensions
    .filter((d) => components[d] !== null)
    .sort((a, b) => p.weights[b] * (components[b] ?? 0) - p.weights[a] * (components[a] ?? 0));
  const explanations = ordered
    .slice(0, 3)
    .map(
      (d) =>
        `${dimensionLabels[d]}: ${Math.round(components[d]!)} / 100 (${Math.round((p.weights[d] / total) * 100)}% weight)`,
    );
  const missing = dimensions.filter((d) => components[d] === null);
  return {
    score,
    evidence,
    weightCoverage,
    /** Below 60% of the weight observed, the score says little; show "hard to assess". */
    assessable: weightCoverage >= 60,
    components,
    reasons,
    explanations,
    /** Plain-language reasons, strongest contribution first. */
    summary: ordered.slice(0, 3).map((d) => reasons[d]!).filter(Boolean),
    missing: missing.map((d) => dimensionLabels[d]),
    bestHourly,
    estimatedHourly,
    belowMinimum: bestHourly !== null && !estimatedHourly && bestHourly < p.minimumHourly,
  };
}

/* ------------------------------------------------------------------ evaluate */

export type HiddenReason =
  | 'ineligible'
  | 'expired'
  | 'archived'
  | 'below minimum'
  | 'excluded state'
  | 'date conflict'
  | 'no active offer';
export function evaluate(store: Store, now = new Date()) {
  // Index once: national volume makes per-job scans quadratic.
  const facilities = new Map(store.facilities.map((f) => [f.id, f]));
  const sources = new Map(store.sources.map((s) => [s.id, s]));
  const listingsById = new Map(store.listings.map((l) => [l.id, l]));
  const offersBy = new Map<string, Offer[]>();
  for (const o of store.offers) {
    const list = offersBy.get(o.opportunityId) ?? [];
    list.push(o);
    offersBy.set(o.opportunityId, list);
  }
  const listingsBy = new Map<string, SourceListing[]>();
  for (const l of store.listings) {
    const list = listingsBy.get(l.opportunityId) ?? [];
    list.push(l);
    listingsBy.set(l.opportunityId, list);
  }
  const actions = new Map(store.actions.map((a) => [a.opportunityId, a]));
  const p = store.profile;
  const home = homeCoordinates(p, store.facilities);
  const committed = store.opportunities
    .filter((o) => (committedStages as string[]).includes(actions.get(o.id)?.stage ?? ''))
    .map((o) => ({ id: o.id, title: o.title, startDate: o.startDate, endDate: o.endDate }));
  const unknownFacility: Facility = {
    id: 'unknown',
    name: 'Unknown facility',
    aliases: [],
    town: '',
    state: 'QLD',
    timezone: 'Australia/Brisbane',
    lat: null,
    lon: null,
    adventure: null,
    adventureNote: '',
    coverage: 'unknown',
  };
  return store.opportunities
    .map((opportunity) => {
      const facility = facilities.get(opportunity.facilityId) ?? unknownFacility;
      const offers = offersBy.get(opportunity.id) ?? [];
      const listings = listingsBy.get(opportunity.id) ?? [];
      const activeOffers = offers.filter(
        (o) =>
          !['filled', 'withdrawn'].includes(listingsById.get(o.listingId)?.status ?? 'verification pending'),
      );
      const action = actions.get(opportunity.id);
      const sourceDown = offers.some((o) => !!sources.get(o.sourceId)?.error);
      const eligibility = assessEligibility(opportunity, p, facility, now);
      const scheduling = assessScheduling(opportunity, p, committed);
      const logistics = assessLogistics(opportunity, facility, activeOffers, p, {
        now,
        home,
        stage: action?.stage,
      });
      const ranking = rankOpportunity(opportunity, facility, activeOffers, p, {
        local: logistics.local,
        tight: logistics.status === 'Tight timeline',
        distanceKm: logistics.distanceKm,
      });
      const lifecycle = lifecycleOf(opportunity, facility, now, action?.stage, sourceDown);
      const quality = evidenceQuality(opportunity, facility, activeOffers, listings, now);
      const age = Math.max(0, (now.getTime() - Date.parse(opportunity.lastSeenAt)) / 86400000);
      const hiddenBy: HiddenReason[] = [];
      if (eligibility.status === 'Ineligible') hiddenBy.push('ineligible');
      if (lifecycle === 'Expired' || lifecycle === 'Filled or withdrawn') hiddenBy.push('expired');
      if (lifecycle === 'Archived') hiddenBy.push('archived');
      if (ranking.belowMinimum) hiddenBy.push('below minimum');
      if (logistics.status === 'Excluded') hiddenBy.push('excluded state');
      if (scheduling.status === 'Conflict') hiddenBy.push('date conflict');
      if (!activeOffers.length) hiddenBy.push('no active offer');
      // Uncertain eligibility participates in the main ranking (LR-002).
      const rankable = hiddenBy.length === 0;
      const daysToStart = daysBetween(localDate(now, facility.timezone), opportunity.startDate);
      return {
        opportunity,
        facility,
        offers,
        activeOffers,
        listings,
        eligibility,
        scheduling,
        logistics,
        ranking,
        quality,
        lifecycle,
        rankable,
        hiddenBy,
        action,
        freshness: sourceDown
          ? 'Source unavailable'
          : age > 14
            ? 'Stale — verify'
            : age > 3
              ? 'Recheck availability'
              : 'Recently observed',
        ageDays: Math.floor(age),
        daysToStart,
        urgency: urgencyOf(opportunity, p, now, facility.timezone),
      };
    })
    .sort(
      (a, b) =>
        Number(b.rankable) - Number(a.rankable) ||
        Number(b.ranking.assessable) - Number(a.ranking.assessable) ||
        (b.ranking.score ?? -1) - (a.ranking.score ?? -1) ||
        a.opportunity.startDate.localeCompare(b.opportunity.startDate),
    );
}
export type EvaluatedJob = ReturnType<typeof evaluate>[number];
