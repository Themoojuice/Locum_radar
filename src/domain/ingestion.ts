import { createHash, randomUUID } from 'node:crypto';
import {
  listingInputSchema,
  type Facility,
  type ListingInput,
  type RadarEvent,
  type Store,
} from './model';
import { normalisePay } from './engine';
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
/**
 * Lookup indexes for ingest, cached per store. National collection ingests
 * thousands of listings per transaction, so linear scans per listing are not
 * affordable. The cache is rebuilt whenever an array is replaced or resized
 * outside ingest; in-place relinking (merge, split) calls invalidateIndex.
 */
interface Index {
  listings: unknown;
  offers: unknown;
  opportunities: unknown;
  facilities: unknown;
  sizes: string;
  byExternal: Map<string, import('./model').SourceListing>;
  listingsByOpportunity: Map<string, import('./model').SourceListing[]>;
  opportunitiesBySlot: Map<string, import('./model').Opportunity[]>;
  opportunityById: Map<string, import('./model').Opportunity>;
  offerByListing: Map<string, number>;
  facilitiesByName: Map<string, Facility[]>;
}
const indexes = new WeakMap<Store, Index>();
export const invalidateIndex = (store: Store) => indexes.delete(store);
const slot = (facilityId: string, specialty: string, grade: string, start: string, end: string) =>
  `${facilityId}|${specialty}|${grade}|${start}|${end}`;
const sizes = (s: Store) =>
  `${s.listings.length}|${s.offers.length}|${s.opportunities.length}|${s.facilities.length}`;
function index(store: Store): Index {
  const cached = indexes.get(store);
  if (
    cached &&
    cached.listings === store.listings &&
    cached.offers === store.offers &&
    cached.opportunities === store.opportunities &&
    cached.facilities === store.facilities &&
    cached.sizes === sizes(store)
  )
    return cached;
  const idx: Index = {
    listings: store.listings,
    offers: store.offers,
    opportunities: store.opportunities,
    facilities: store.facilities,
    sizes: sizes(store),
    byExternal: new Map(),
    listingsByOpportunity: new Map(),
    opportunitiesBySlot: new Map(),
    opportunityById: new Map(),
    offerByListing: new Map(),
    facilitiesByName: new Map(),
  };
  for (const l of store.listings) {
    idx.byExternal.set(`${l.sourceId}|${l.externalId}`, l);
    push(idx.listingsByOpportunity, l.opportunityId, l);
  }
  for (const o of store.opportunities) idx.opportunityById.set(o.id, o);
  for (const o of store.opportunities)
    push(idx.opportunitiesBySlot, slot(o.facilityId, o.specialty, o.grade, o.startDate, o.endDate), o);
  store.offers.forEach((o, i) => idx.offerByListing.set(o.listingId, i));
  for (const f of store.facilities)
    for (const n of new Set([f.name, ...f.aliases].map(normaliseName)))
      push(idx.facilitiesByName, `${f.state}|${n}`, f);
  indexes.set(store, idx);
  return idx;
}
function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
const comparableRate = (c: ListingInput['compensation']) =>
  normalisePay(c).hourly ?? c.amount ?? null;
function event(
  store: Store,
  stamp: string,
  e: Omit<RadarEvent, 'id' | 'at'>,
) {
  (store.events ??= []).push({ id: randomUUID(), at: stamp, ...e });
}
function reconcileStatus(store: Store, id: string, target?: import('./model').Opportunity) {
  const related = indexes.get(store)?.listingsByOpportunity.get(id) ??
    store.listings.filter((l) => l.opportunityId === id);
  target ??= store.opportunities.find((o) => o.id === id)!;
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

/** True when this opportunity was created beside a possible duplicate awaiting review. */
const candidateFor = (store: Store, id: string) =>
  store.reviews.some((r) => r.kind === 'possible duplicate' && r.opportunityId === id && !r.resolved);
export function findFacility(store: Store, input: ListingInput): Facility {
  const named = index(store).facilitiesByName.get(
    `${input.state}|${normaliseName(input.facilityName)}`,
  ) ?? [];
  const match = named.find((f) => normaliseName(f.town) === normaliseName(input.town));
  if (match) return match;
  // Directory hospitals are unique by name within a state; their derived towns
  // are approximate, so an advertised town fills or overrides nothing else.
  const directory = named.find((f) => f.id.startsWith('aihw-'));
  if (directory) {
    if (!directory.town) directory.town = input.town;
    if (directory.coverage === 'unknown') directory.coverage = 'observed';
    return directory;
  }
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
  const idx = indexes.get(store);
  if (idx) {
    push(idx.facilitiesByName, `${facility.state}|${normaliseName(facility.name)}`, facility);
    idx.sizes = sizes(store);
  }
  return facility;
}

export function ingest(store: Store, raw: ListingInput, now = new Date()) {
  const input = listingInputSchema.parse(raw);
  if (!store.sources.some((s) => s.id === input.sourceId)) throw new Error('Unknown source');
  const stamp = now.toISOString(),
    hash = fingerprint(input);
  const idx = index(store);
  const previous = idx.byExternal.get(`${input.sourceId}|${input.externalId}`);
  const previousOpportunity = previous ? idx.opportunityById.get(previous.opportunityId) : undefined;
  if (previous?.contentHash === hash) {
    previous.observedAt = stamp;
    if (previousOpportunity) previousOpportunity.lastSeenAt = stamp;
    return { opportunityId: previous.opportunityId, unchanged: true, linked: false };
  }
  const facility = findFacility(store, input);
  // Pay and benefits never identify a vacancy. Require both a stable shared reference
  // and matching non-empty roster, alongside exact facility/role/dates.
  const similar = (
    idx.opportunitiesBySlot.get(
      slot(facility.id, input.specialty, input.grade, input.startDate, input.endDate),
    ) ?? []
  ).filter((o) => !o.demo);
  const exact = similar.find(
    (o) =>
      input.reference &&
      o.reference === input.reference &&
      input.roster &&
      normaliseName(o.roster) === normaliseName(input.roster),
  );
  const existing = previousOpportunity;
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
      flexibility: input.flexibility,
      shifts: input.shifts,
      firstSeenAt: stamp,
      lastSeenAt: stamp,
      verifiedAt: input.status === 'confirmed available' ? stamp : null,
      demo: false,
    };
    store.opportunities.push(opportunity);
    idx.opportunityById.set(opportunity.id, opportunity);
    push(
      idx.opportunitiesBySlot,
      slot(opportunity.facilityId, opportunity.specialty, opportunity.grade, opportunity.startDate, opportunity.endDate),
      opportunity,
    );
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
  if (input.flexibility === 'flexible') opportunity.flexibility = 'flexible';
  else opportunity.flexibility ??= input.flexibility;
  if (input.shifts.length && !opportunity.shifts?.length) opportunity.shifts = input.shifts;
  // Events feed alerts. Linking a second agency's advert is a new offer, not a new job.
  if (!linked && !previous && !candidateFor(store, opportunity.id))
    event(store, stamp, {
      opportunityId: opportunity.id,
      kind: 'new',
      sourceId: input.sourceId,
      detail: input.title,
    });
  else if (linked)
    event(store, stamp, {
      opportunityId: opportunity.id,
      kind: 'new-offer',
      sourceId: input.sourceId,
      detail: `Another source advertises this vacancy.`,
      after: comparableRate(input.compensation),
    });
  if (previous && previous.opportunityId === opportunity.id) {
    const was = comparableRate(previous.compensation),
      now = comparableRate(input.compensation);
    if (was !== now)
      event(store, stamp, {
        opportunityId: opportunity.id,
        kind: 'rate-change',
        sourceId: input.sourceId,
        detail:
          was === null
            ? 'A rate was published.'
            : now === null
              ? 'The advertised rate was removed.'
              : `Rate changed from $${was} to $${now}.`,
        before: was,
        after: now,
      });
    if (previous.status !== input.status)
      event(store, stamp, {
        opportunityId: opportunity.id,
        kind: 'status',
        sourceId: input.sourceId,
        detail: `Source status changed from ${previous.status} to ${input.status}.`,
      });
  }
  const listingId = previous?.id ?? randomUUID();
  const listing = {
    ...input,
    id: listingId,
    opportunityId: opportunity.id,
    observedAt: stamp,
    firstSeenAt: previous?.firstSeenAt ?? stamp,
    contentHash: hash,
  };
  const offer = {
    id: `offer-${listingId}`,
    opportunityId: opportunity.id,
    listingId,
    sourceId: input.sourceId,
    compensation: input.compensation,
    flights: input.flights,
    accommodation: input.accommodation,
    contact: input.contact,
    updatedAt: stamp,
  };
  // Replace in place so a re-observed listing keeps its position and the index stays valid.
  if (previous) {
    store.listings[store.listings.indexOf(previous)] = listing;
    const oldList = idx.listingsByOpportunity.get(previous.opportunityId) ?? [];
    oldList.splice(oldList.indexOf(previous), 1);
  } else store.listings.push(listing);
  idx.byExternal.set(`${input.sourceId}|${input.externalId}`, listing);
  push(idx.listingsByOpportunity, opportunity.id, listing);
  const offerAt = idx.offerByListing.get(listingId);
  if (offerAt !== undefined && store.offers[offerAt]?.listingId === listingId)
    store.offers[offerAt] = offer;
  else {
    store.offers.push(offer);
    idx.offerByListing.set(listingId, store.offers.length - 1);
  }
  idx.sizes = sizes(store);
  store.observations.push({
    id: randomUUID(),
    listingId,
    observedAt: stamp,
    contentHash: hash,
    snapshot: input,
  });
  // A single withdrawn advert must not withdraw an active competing offer.
  reconcileStatus(store, opportunity.id, opportunity);
  if (previous && previous.opportunityId !== opportunity.id && previousOpportunity)
    reconcileStatus(store, previousOpportunity.id, previousOpportunity);
  return { opportunityId: opportunity.id, unchanged: false, linked };
}

export function mergeOpportunities(store: Store, from: string, to: string) {
  invalidateIndex(store);
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
  invalidateIndex(store);
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
