import { createHash, randomUUID } from 'node:crypto';
import { listingInputSchema, type Facility, type ListingInput, type Store } from './model';
const canonical = (value: unknown): string =>
  value && typeof value === 'object'
    ? Array.isArray(value)
      ? `[${value.map(canonical).join(',')}]`
      : `{${Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
          .join(',')}}`
    : JSON.stringify(value);
export const fingerprint = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
export const normaliseName = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
export const zoneForState: Record<string, string> = {
  QLD: 'Australia/Brisbane',
  NSW: 'Australia/Sydney',
  VIC: 'Australia/Melbourne',
  WA: 'Australia/Perth',
  SA: 'Australia/Adelaide',
  NT: 'Australia/Darwin',
  TAS: 'Australia/Hobart',
  ACT: 'Australia/Sydney',
};
function reconcileStatus(store: Store, id: string) {
  const related = store.listings.filter((l) => l.opportunityId === id);
  const target = store.opportunities.find((o) => o.id === id)!;
  const confirmed = related.filter((l) => l.status === 'confirmed available');
  target.status = confirmed.length
    ? 'confirmed available'
    : related.some((l) => l.status === 'advertised')
      ? 'advertised'
      : related.some((l) => l.status === 'verification pending')
        ? 'verification pending'
        : related.length
          ? 'withdrawn'
          : 'verification pending';
  target.verifiedAt = confirmed.length
    ? confirmed
        .map((l) => l.observedAt)
        .sort()
        .at(-1)!
    : null;
}

export function findFacility(store: Store, input: ListingInput): Facility {
  const match = store.facilities.find(
    (f) =>
      f.state === input.state &&
      [f.name, ...f.aliases].some((n) => normaliseName(n) === normaliseName(input.facilityName)) &&
      normaliseName(f.town) === normaliseName(input.town),
  );
  if (match) return match;
  const facility: Facility = {
    id: randomUUID(),
    name: input.facilityName,
    aliases: [],
    town: input.town,
    state: input.state,
    timezone: zoneForState[input.state],
    lat: null,
    lon: null,
    adventure: null,
    adventureNote: 'Not assessed',
    coverage: 'observed',
  };
  store.facilities.push(facility);
  return facility;
}

export function ingest(store: Store, raw: ListingInput, now = new Date()) {
  const input = listingInputSchema.parse(raw);
  if (!store.sources.some((s) => s.id === input.sourceId)) throw new Error('Unknown source');
  const stamp = now.toISOString(),
    hash = fingerprint(input);
  const previous = store.listings.find(
    (l) => l.sourceId === input.sourceId && l.externalId === input.externalId,
  );
  if (previous?.contentHash === hash) {
    previous.observedAt = stamp;
    store.opportunities.find((o) => o.id === previous.opportunityId)!.lastSeenAt = stamp;
    return { opportunityId: previous.opportunityId, unchanged: true, linked: false };
  }
  const facility = findFacility(store, input);
  // Pay and benefits never identify a vacancy. Require both a stable shared reference
  // and matching non-empty roster, alongside exact facility/role/dates.
  const similar = store.opportunities.filter(
    (o) =>
      !o.demo &&
      o.facilityId === facility.id &&
      o.specialty === input.specialty &&
      o.grade === input.grade &&
      o.startDate === input.startDate &&
      o.endDate === input.endDate,
  );
  const exact = similar.find(
    (o) =>
      input.reference &&
      o.reference === input.reference &&
      input.roster &&
      normaliseName(o.roster) === normaliseName(input.roster),
  );
  const existing = previous
    ? store.opportunities.find((o) => o.id === previous.opportunityId)
    : undefined;
  let opportunity = existing ?? exact;
  if (
    existing &&
    (existing.facilityId !== facility.id ||
      existing.specialty !== input.specialty ||
      existing.grade !== input.grade ||
      existing.startDate !== input.startDate ||
      existing.endDate !== input.endDate ||
      existing.roster !== input.roster ||
      canonical(existing.requirements) !== canonical(input.requirements))
  ) {
    // Changes to identity or requirements must not silently rewrite a reconciled vacancy.
    // Detach this listing into a new opportunity; keep its observation history.
    opportunity = undefined;
  }
  if (opportunity && canonical(opportunity.requirements) !== canonical(input.requirements))
    opportunity = undefined;
  const linked = !!opportunity && !previous;
  if (!opportunity) {
    opportunity = {
      id: randomUUID(),
      facilityId: facility.id,
      title: input.title,
      specialty: input.specialty,
      grade: input.grade,
      startDate: input.startDate,
      endDate: input.endDate,
      roster: input.roster,
      reference: input.reference,
      requirements: input.requirements,
      status: input.status,
      firstSeenAt: stamp,
      lastSeenAt: stamp,
      verifiedAt: input.status === 'confirmed available' ? stamp : null,
      demo: false,
    };
    store.opportunities.push(opportunity);
    const candidate = existing ?? similar[0];
    if (candidate)
      store.reviews.push({
        id: randomUUID(),
        kind: 'possible duplicate',
        opportunityId: opportunity.id,
        candidateId: candidate.id,
        reason: existing
          ? 'A source changed the placement identity or requirements. Review both versions.'
          : 'Facility, dates and role match; reference, roster or requirements need reconciliation.',
        resolved: false,
        draft: null,
        rawText: null,
        sourceId: input.sourceId,
      });
  }
  opportunity.lastSeenAt = stamp;
  const listingId = previous?.id ?? randomUUID();
  const listing = {
    ...input,
    id: listingId,
    opportunityId: opportunity.id,
    observedAt: stamp,
    firstSeenAt: previous?.firstSeenAt ?? stamp,
    contentHash: hash,
  };
  store.listings = store.listings.filter((l) => l.id !== listingId);
  store.listings.push(listing);
  store.offers = store.offers.filter((o) => o.listingId !== listingId);
  store.offers.push({
    id: `offer-${listingId}`,
    opportunityId: opportunity.id,
    listingId,
    sourceId: input.sourceId,
    compensation: input.compensation,
    flights: input.flights,
    accommodation: input.accommodation,
    contact: input.contact,
    updatedAt: stamp,
  });
  store.observations.push({
    id: randomUUID(),
    listingId,
    observedAt: stamp,
    contentHash: hash,
    snapshot: input,
  });
  // A single withdrawn advert must not withdraw an active competing offer.
  for (const id of new Set(
    [opportunity.id, previous?.opportunityId].filter((v): v is string => !!v),
  )) {
    reconcileStatus(store, id);
  }
  return { opportunityId: opportunity.id, unchanged: false, linked };
}

export function mergeOpportunities(store: Store, from: string, to: string) {
  const a = store.opportunities.find((o) => o.id === from),
    b = store.opportunities.find((o) => o.id === to);
  if (!a || !b || from === to) throw new Error('Select two different opportunities');
  if (
    a.facilityId !== b.facilityId ||
    a.specialty !== b.specialty ||
    a.grade !== b.grade ||
    a.startDate !== b.startDate ||
    a.endDate !== b.endDate ||
    canonical(a.requirements) !== canonical(b.requirements)
  )
    throw new Error(
      'Conflicting facility, role, dates or requirements cannot be merged. Correct the source records first.',
    );
  const oldAction = store.actions.find((x) => x.opportunityId === from),
    targetAction = store.actions.find((x) => x.opportunityId === to);
  const hasHistory = (action: typeof oldAction) =>
    !!action && (!!action.notes || action.stage !== 'Discovered');
  if (hasHistory(oldAction) && hasHistory(targetAction))
    throw new Error(
      'Both opportunities have tracker history. Resolve their notes and stages before merging.',
    );
  // Validate before mutating, then keep exactly one action for the surviving vacancy.
  for (const listing of store.listings.filter((l) => l.opportunityId === from))
    listing.opportunityId = to;
  for (const offer of store.offers.filter((o) => o.opportunityId === from))
    offer.opportunityId = to;
  const retainedAction = hasHistory(oldAction) ? oldAction : (targetAction ?? oldAction);
  store.actions = store.actions.filter((x) => x.opportunityId !== from && x.opportunityId !== to);
  if (retainedAction) store.actions.push({ ...retainedAction, opportunityId: to });
  b.firstSeenAt = [a.firstSeenAt, b.firstSeenAt].sort()[0];
  b.lastSeenAt = [a.lastSeenAt, b.lastSeenAt].sort().at(-1)!;
  reconcileStatus(store, to);
  store.opportunities = store.opportunities.filter((o) => o.id !== from);
  store.reviews
    .filter((r) => r.opportunityId === from || r.candidateId === from)
    .forEach((r) => {
      r.resolved = true;
    });
}

export function splitListing(store: Store, listingId: string) {
  const listing = store.listings.find((l) => l.id === listingId);
  if (!listing) throw new Error('Listing not found');
  if (store.listings.filter((l) => l.opportunityId === listing.opportunityId).length < 2)
    throw new Error('This listing is already separate');
  const parent = store.opportunities.find((o) => o.id === listing.opportunityId)!;
  const child = {
    ...parent,
    id: randomUUID(),
    title: listing.title,
    roster: listing.roster,
    reference: listing.reference,
    requirements: listing.requirements,
    status: listing.status,
  };
  store.opportunities.push(child);
  listing.opportunityId = child.id;
  store.offers
    .filter((o) => o.listingId === listingId)
    .forEach((o) => {
      o.opportunityId = child.id;
    });
  reconcileStatus(store, parent.id);
  reconcileStatus(store, child.id);
  return child.id;
}
