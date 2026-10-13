import type {
  Compensation,
  Eligibility,
  Facility,
  Offer,
  Opportunity,
  Profile,
  Store,
  Weights,
} from './model';
import { dimensions } from './model';

export function localDate(now = new Date(), timezone = 'Australia/Brisbane'): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
export const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
export const duration = (o: Pick<Opportunity, 'startDate' | 'endDate'>) =>
  daysBetween(o.startDate, o.endDate) + 1;
export const overlaps = (
  a: { startDate: string; endDate: string },
  b: { startDate: string; endDate: string },
) => a.startDate <= b.endDate && b.startDate <= a.endDate;

export function assessEligibility(
  o: Opportunity,
  p: Profile,
  f: Facility,
  now = new Date(),
): { status: Eligibility; reasons: string[] } {
  if (o.endDate < localDate(now, f.timezone) || ['filled', 'withdrawn'].includes(o.status))
    return {
      status: 'Expired/unavailable',
      reasons: ['The placement has ended or the source reports it unavailable.'],
    };
  const conflicts: string[] = [],
    unknown: string[] = [];
  const r = o.requirements;
  if (p.registration === 'unknown') unknown.push('Confirm your registration category.');
  if (!r.registration) unknown.push('The required registration category is not stated.');
  // Specialist and general registration are deliberately not treated as interchangeable.
  if (r.registration && p.registration !== 'unknown' && p.registration !== r.registration)
    unknown.push(
      `Confirm whether your ${p.registration} registration satisfies the stated ${r.registration} requirement.`,
    );
  if (p.registration === 'limited' && r.registration && r.registration !== 'limited')
    conflicts.push('The stated registration requirement conflicts with limited registration.');
  if (r.minPgy !== null && p.pgy !== null && p.pgy < r.minPgy)
    conflicts.push(`Requires PGY ${r.minPgy}; your profile is PGY ${p.pgy}.`);
  if (p.pgy === null) unknown.push('Your postgraduate year is not confirmed.');
  for (const credential of r.credentials) {
    if (!p.credentials.some((c) => c.toLowerCase() === credential.toLowerCase())) {
      (p.credentialsConfirmed ? conflicts : unknown).push(`Required credential: ${credential}.`);
    }
  }
  if (r.independentCover && p.independentCover === 'no')
    conflicts.push('Requires independent cover, which your profile excludes.');
  if (r.independentCover && p.independentCover === 'unknown')
    unknown.push('Confirm independent-cover suitability.');
  if (p.supervisionRequired === 'yes' && r.supervisionAvailable === false)
    conflicts.push('Required supervision is explicitly unavailable.');
  if (
    p.supervisionRequired === 'unknown' ||
    (p.supervisionRequired === 'yes' && r.supervisionAvailable === null)
  )
    unknown.push('Confirm your supervision needs and the available support.');
  if (!p.eligibleGrades.length) unknown.push('Confirm the grades you can undertake.');
  else if (!p.eligibleGrades.includes(o.grade))
    conflicts.push(`${o.grade} is outside your confirmed grades.`);
  if (p.excludedStates.includes(f.state)) conflicts.push(`${f.state} is excluded in your profile.`);
  if (
    p.availability.length &&
    !p.availability.some((a) => a.start <= o.startDate && a.end >= o.endDate)
  )
    conflicts.push('The whole placement does not fit a declared availability window.');
  if (duration(o) > p.maxPlacementDays) conflicts.push('Exceeds your maximum placement length.');
  if (conflicts.length) return { status: 'Ineligible', reasons: [...conflicts, ...unknown] };
  if (unknown.length) return { status: 'Needs verification', reasons: unknown };
  if (!r.complete)
    return {
      status: 'Likely eligible',
      reasons: [
        'Known requirements match; the source has not confirmed its requirement list is complete.',
      ],
    };
  return {
    status: 'Eligible',
    reasons: [
      'Your declared profile satisfies the recorded requirements; final credentialing remains with the employer.',
    ],
  };
}

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

export const presets: Record<string, Weights> = {
  'Best overall': { financial: 30, adventure: 25, clinical: 20, logistics: 15, quality: 10 },
  'Highest income': { financial: 65, adventure: 5, clinical: 10, logistics: 10, quality: 10 },
  'Most exciting': { financial: 10, adventure: 55, clinical: 20, logistics: 5, quality: 10 },
  'Career growth': { financial: 15, adventure: 10, clinical: 55, logistics: 10, quality: 10 },
  'Easy logistics': { financial: 15, adventure: 5, clinical: 10, logistics: 60, quality: 10 },
  'Rural adventure': { financial: 15, adventure: 60, clinical: 10, logistics: 5, quality: 10 },
};
const clamp = (v: number) => Math.max(0, Math.min(100, v));
export function rankOpportunity(o: Opportunity, f: Facility, offers: Offer[], p: Profile) {
  const pays = offers.map((offer) => normalisePay(offer.compensation));
  const hourly = pays.map((x) => x.hourly).filter((v): v is number => v !== null);
  const bestHourly = hourly.length ? Math.max(...hourly) : null;
  const bestBenefits = offers.length
    ? Math.max(
        ...offers.map(
          (v) => (v.flights === 'included' ? 1 : 0) + (v.accommodation === 'included' ? 1 : 0),
        ),
      )
    : 0;
  const hasBenefits = offers.some((v) => v.flights !== 'unknown' || v.accommodation !== 'unknown');
  const components: Record<keyof Weights, number | null> = {
    financial: bestHourly === null ? null : clamp((bestHourly / p.targetHourly) * 75),
    adventure: f.adventure,
    clinical: p.preferredSpecialties.length
      ? p.preferredSpecialties.includes(o.specialty)
        ? 100
        : 30
      : null,
    logistics: hasBenefits ? 40 + bestBenefits * 30 : null,
    quality: o.status === 'confirmed available' ? 100 : o.status === 'advertised' ? 65 : 40,
  };
  if (p.preferredStates.length)
    components.adventure =
      components.adventure === null
        ? p.preferredStates.includes(f.state)
          ? 100
          : 40
        : (components.adventure + (p.preferredStates.includes(f.state) ? 100 : 40)) / 2;
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
  const explanations = dimensions
    .filter((d) => components[d] !== null)
    .sort((a, b) => p.weights[b] * (components[b] ?? 0) - p.weights[a] * (components[a] ?? 0))
    .slice(0, 3)
    .map(
      (d) =>
        `${d[0].toUpperCase() + d.slice(1)}: ${Math.round(components[d]!)} / 100 (${Math.round((p.weights[d] / total) * 100)}% weight)`,
    );
  return {
    score,
    evidence,
    weightCoverage: Math.round((observedWeight / total) * 100),
    components,
    explanations,
    bestHourly,
    belowMinimum: bestHourly !== null && bestHourly < p.minimumHourly,
  };
}

export function evaluate(store: Store, now = new Date()) {
  return store.opportunities
    .map((opportunity) => {
      const facility = store.facilities.find((f) => f.id === opportunity.facilityId)!;
      const offers = store.offers.filter((o) => o.opportunityId === opportunity.id);
      const activeOffers = offers.filter(
        (o) =>
          !['filled', 'withdrawn'].includes(
            store.listings.find((l) => l.id === o.listingId)?.status || 'verification pending',
          ),
      );
      const eligibility = assessEligibility(opportunity, store.profile, facility, now);
      const ranking = rankOpportunity(opportunity, facility, activeOffers, store.profile);
      const action = store.actions.find((a) => a.opportunityId === opportunity.id);
      const age = Math.max(0, (now.getTime() - Date.parse(opportunity.lastSeenAt)) / 86400000);
      const sourceUnavailable = offers.some(
        (o) => !!store.sources.find((s) => s.id === o.sourceId)?.error,
      );
      const rankable =
        activeOffers.length > 0 &&
        ['Eligible', 'Likely eligible'].includes(eligibility.status) &&
        !ranking.belowMinimum;
      return {
        opportunity,
        facility,
        offers,
        activeOffers,
        eligibility,
        ranking,
        rankable,
        action,
        freshness: sourceUnavailable
          ? 'Source unavailable'
          : age > 14
            ? 'Stale — verify'
            : age > 3
              ? 'Recheck availability'
              : 'Recently observed',
        ageDays: Math.floor(age),
        urgency: daysBetween(localDate(now, facility.timezone), opportunity.startDate),
      };
    })
    .sort(
      (a, b) =>
        Number(b.rankable) - Number(a.rankable) ||
        (b.ranking.score ?? -1) - (a.ranking.score ?? -1) ||
        a.opportunity.startDate.localeCompare(b.opportunity.startDate),
    );
}
export type EvaluatedJob = ReturnType<typeof evaluate>[number];
