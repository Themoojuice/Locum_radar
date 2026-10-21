import { createHash } from 'node:crypto';
import type { Facility, ListingInput, Store } from '@/domain/model';
import { emptyCompensation, grades, specialties, states } from '@/domain/model';
import { ingest, normaliseName } from '@/domain/ingestion';
import {
  INBOX_PARSER_VERSION,
  inboxQuery,
  type EmailVacancy,
  type InboxEmail,
  type InboxSettings,
} from '@/domain/inbox';
import { agencyFor, searchDomains } from '@/domain/agencies';
import { gmailRequest, type GmailPart } from '../acquisition/gmail';
import { resolveFacility } from '../adapters/myhospitals';
import { readRecruiterEmail, type RawEmail, type ReadEmail } from './recruiter-email';
import {
  askClaude,
  claudeConfigured,
  emailFromAnswer,
  emailPrompt,
  type ClaudeImage,
} from './claude-reader';

/*
 * Gmail → Inbox: list recruiter emails, read each one, keep a record per
 * email and add every complete, current vacancy to the feed as source "email".
 * Runs in small batches so the page can show progress and nothing is lost if
 * the browser is closed part-way.
 */
export const INBOX_LIMIT = 300;
export const INBOX_BATCH = 8;

interface GmailMessage {
  id: string;
  threadId: string;
  internalDate?: string;
  payload?: GmailPart;
}

/** Message ids matching the recruiter search, newest first. */
export async function listInboxIds(days: number, settings: InboxSettings) {
  const ids: string[] = [];
  let page: string | undefined;
  const q = encodeURIComponent(inboxQuery(days, searchDomains(settings), settings.label));
  do {
    const data = await gmailRequest<{ messages?: { id: string }[]; nextPageToken?: string }>(
      `/gmail/v1/users/me/messages?q=${q}&maxResults=100${page ? `&pageToken=${page}` : ''}`,
    );
    ids.push(...(data.messages ?? []).map((m) => m.id));
    page = data.nextPageToken;
  } while (page && ids.length < INBOX_LIMIT);
  return ids.slice(0, INBOX_LIMIT);
}

export function rawFromGmail(message: GmailMessage): RawEmail {
  const text: string[] = [],
    html: string[] = [];
  let nodes = 0;
  const walk = (part: GmailPart, depth = 0) => {
    if (++nodes > 200 || depth > 12 || part.filename) return;
    if (part.body?.data && part.body.data.length <= 3000000) {
      const value = Buffer.from(part.body.data, 'base64url').toString('utf8');
      if (part.mimeType === 'text/plain') text.push(value);
      else if (part.mimeType === 'text/html') html.push(value);
    }
    part.parts?.forEach((p) => walk(p, depth + 1));
  };
  walk(message.payload ?? {});
  const header = (name: string) =>
    message.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? '';
  const stamp = Number(message.internalDate);
  return {
    id: message.id,
    threadId: message.threadId,
    from: header('from'),
    subject: header('subject'),
    sentAt: Number.isFinite(stamp) && stamp > 0 ? new Date(stamp) : new Date(),
    text: text.join('\n'),
    html: html.join('\n'),
  };
}

export async function fetchEmails(ids: string[]) {
  const out: RawEmail[] = [];
  for (const id of ids) {
    if (!/^[\w-]{6,64}$/.test(id)) continue;
    out.push(
      rawFromGmail(
        await gmailRequest<GmailMessage>(`/gmail/v1/users/me/messages/${id}?format=full`),
      ),
    );
  }
  return out;
}

/**
 * Ids not yet read by the current parser, plus emails left for Claude once a
 * key is available (or every id when re-reading).
 */
export function unreadIds(store: Store, ids: string[], reread = false, claude = false) {
  if (reread) return ids;
  const known = new Map(store.inbox.map((e) => [e.id, e]));
  return ids.filter((id) => {
    const e = known.get(id);
    return !e || e.parser !== INBOX_PARSER_VERSION || (claude && !!e.claudePending);
  });
}

/* ------------------------------------------------------------- reading */

export type Reading = ReadEmail & { claudePending?: boolean; cost?: number; notice?: string };
/**
 * Built-in readers first. Claude reads emails from agencies without a built-in
 * reader, and offer-like emails the rules could not read. Network work happens
 * here, outside any database transaction.
 */
export async function readEmail(
  raw: RawEmail,
  options: { claude: boolean; today?: string; ask?: typeof askClaude },
): Promise<Reading> {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const rules = readRecruiterEmail(raw, today);
  const known = !!agencyFor(rules.fromAddress)?.rules;
  const wanted = !known || rules.kind === 'unparsed';
  if (!wanted || !options.claude) return rules;
  if (!options.ask && !claudeConfigured())
    return {
      ...rules,
      claudePending: true,
      summary: `${rules.summary} Add an Anthropic key in Settings and Claude will read it.`,
    };
  try {
    const { answer, cost } = await (options.ask ?? askClaude)(emailPrompt(raw));
    const read = emailFromAnswer(raw, answer, today);
    // Keep the built-in reading when Claude finds nothing more.
    if (!read.vacancies.length && rules.vacancies.length) return { ...rules, cost };
    return { ...read, cost };
  } catch (error) {
    return {
      ...rules,
      claudePending: true,
      notice: (error as Error).message,
      summary: `${rules.summary} Claude could not read it: ${(error as Error).message}`,
    };
  }
}

/** A pasted advert (text and/or screenshots), read by Claude. */
export async function readPasted(
  input: { text: string; images: ClaudeImage[] },
  now = new Date(),
  ask: typeof askClaude = askClaude,
): Promise<{ raw: RawEmail; read: Reading }> {
  const { answer, cost } = await ask(input.text, input.images);
  const text = [input.text.trim(), answer.transcript.trim()].filter(Boolean).join('\n\n');
  const raw: RawEmail = {
    id: `paste-${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    threadId: '',
    from: answer.agency || 'Pasted advert',
    subject:
      answer.summary ||
      text
        .split('\n')
        .find((l) => l.trim())
        ?.slice(0, 120) ||
      (input.images.length ? 'Screenshot' : 'Pasted advert'),
    sentAt: now,
    text,
    html: '',
  };
  const read = emailFromAnswer(raw, answer, now.toISOString().slice(0, 10), text);
  return {
    raw,
    read: {
      ...read,
      agency: answer.agency || 'Pasted',
      recruiter: answer.agency || 'Pasted advert',
      fromAddress: '',
      gmailUrl: '',
      cost,
    },
  };
}

/* ---------------------------------------------------------------- feed */

const asState = (v: string | null) =>
  (states as readonly string[]).includes(v ?? '') ? (v as (typeof states)[number]) : null;

/** Uses the hospital directory to name the site and fill a missing state. */
export function placeVacancy(v: EmailVacancy, facilities: Facility[]) {
  const label = v.hospital || v.town;
  if (!label) return v;
  const match = resolveFacility(label, asState(v.state), facilities);
  if (!match.facility) {
    if (match.note) v.notes = [...new Set([...v.notes, match.note])];
    return v;
  }
  const f = match.facility;
  v.state ??= f.state;
  if (normaliseName(f.name) !== normaliseName(v.hospital)) {
    v.notes = v.notes
      .filter((n) => !/^Medrecruit lists the town/.test(n))
      .concat(`"${label}" matched to ${f.name}; check it is the advertised site.`);
  }
  v.hospital = f.name;
  v.town = f.town || v.town;
  v.missing = v.missing.filter((m) => !(m === 'state' && v.state) && m !== 'hospital');
  return v;
}

/** Same vacancy in two weekly emails → one listing, updated in place. */
export function vacancyKey(email: InboxEmail, v: EmailVacancy) {
  const identity = [
    email.agency,
    normaliseName(v.hospital || v.town),
    v.state,
    v.grade,
    v.specialty,
    // "ASAP" is read as the email's date, which moves every week.
    /\bASAP\b/i.test(v.dateText) ? 'ASAP' : v.start,
    v.end,
    normaliseName(v.role),
  ].join('|');
  return 'gmail-' + createHash('sha256').update(identity).digest('hex').slice(0, 24);
}

const cap = (v: string, n: number) => (v.length > n ? v.slice(0, n - 1) + '…' : v);
const shortDate = (d: string) =>
  new Date(d + 'T00:00:00Z').toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

/** The listing a vacancy becomes, or null with the reason it cannot yet join the feed. */
export function listingFor(
  email: InboxEmail,
  v: EmailVacancy,
  key = vacancyKey(email, v),
): { listing: ListingInput | null; reason: string } {
  const state = asState(v.state);
  const grade = (grades as readonly string[]).includes(v.grade ?? '')
    ? (v.grade as (typeof grades)[number])
    : null;
  const specialty = (specialties as readonly string[]).includes(v.specialty ?? '')
    ? (v.specialty as (typeof specialties)[number])
    : grade
      ? 'Other'
      : null;
  const hospital = v.hospital.trim();
  if (!hospital || !state || !grade || !specialty || !v.start || !v.end)
    return { listing: null, reason: `Needs ${v.missing.join(', ') || 'details'}` };
  if (v.ended) return { listing: null, reason: 'Already ended' };
  const shifts = v.blocks.length
    ? `Shifts: ${v.blocks
        .map((b) =>
          b.start === b.end ? shortDate(b.start) : `${shortDate(b.start)}–${shortDate(b.end)}`,
        )
        .join(', ')}`
    : '';
  const listing: ListingInput = {
    sourceId: 'email',
    externalId: key,
    url: email.gmailUrl || null,
    rawText: cap(
      `From: ${email.recruiter} (${email.agency})\nSubject: ${email.subject}\n${v.excerpt}`,
      100000,
    ),
    title: cap(v.role || `${specialty} ${grade}`, 200),
    facilityName: cap(hospital, 150),
    town: cap(v.town || hospital, 100),
    state,
    specialty,
    grade,
    startDate: v.start,
    endDate: v.end,
    roster: cap([v.roster, shifts].filter(Boolean).join(' · '), 500),
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
      ...structuredClone(emptyCompensation),
      amount: v.amount,
      basis: v.amount ? v.basis : 'unknown',
      super: v.super,
      notes: cap(
        [v.rateText, ...v.notes.filter((n) => /rate|range|super/i.test(n))]
          .filter(Boolean)
          .join(' · '),
        3000,
      ),
    },
    flights: v.flights,
    accommodation: v.accommodation,
    status: 'advertised',
    contact: cap(`${email.recruiter} · ${email.agency} · ${email.fromAddress}`, 300),
    evidence: {
      Email: cap(`${email.subject} (${email.receivedAt.slice(0, 10)})`, 2000),
      'Email line': cap(v.excerpt, 2000),
      Dates: cap(v.dateText, 2000),
      ...(v.rateText ? { Rate: cap(v.rateText, 2000) } : {}),
      ...(v.notes.length ? { Notes: cap(v.notes.join(' '), 2000) } : {}),
    },
  };
  return { listing, reason: '' };
}

/** Stores the email (keeping its review status) and adds its vacancies to the feed. */
export function saveEmail(
  store: Store,
  raw: RawEmail,
  now = new Date(),
  reading?: Reading,
  origin: InboxEmail['origin'] = 'gmail',
) {
  const read = reading ?? readRecruiterEmail(raw, now.toISOString().slice(0, 10));
  const { format: _format, notice: _notice, ...fields } = read as Reading;
  void _format;
  void _notice;
  const previous = store.inbox.find((e) => e.id === raw.id);
  const email: InboxEmail = {
    ...fields,
    origin,
    importedAt: previous?.importedAt ?? now.toISOString(),
    status: previous?.status ?? 'new',
  };
  // Keep links the user made by hand ("Fix & add") when an email is re-read.
  for (const v of email.vacancies) {
    const old = previous?.vacancies.find((p) => p.id === v.id);
    if (old?.opportunityId && store.opportunities.some((o) => o.id === old.opportunityId)) {
      v.opportunityId = old.opportunityId;
      v.missing = [];
    }
  }
  let added = 0;
  // Two rows of one email that the feed cannot tell apart (e.g. "RMO or HMO", both
  // recorded as RMO) are one feed entry; the second is noted on the first.
  const identities = new Map<string, EmailVacancy>();
  for (const v of email.vacancies) {
    // Keyed on the email's own wording, so a later directory match cannot change it.
    const key = vacancyKey(email, v);
    const prior = store.listings.find((l) => l.sourceId === 'email' && l.externalId === key);
    if (prior) {
      // Already in the feed: keep the site it was filed under.
      v.hospital = prior.facilityName;
      v.town = prior.town;
      v.state ??= prior.state;
      if (/\bASAP\b/i.test(v.dateText)) v.start = prior.startDate;
      v.missing = v.missing.filter((m) => m !== 'hospital' && m !== 'state');
    } else placeVacancy(v, store.facilities);
    const { listing } = listingFor(email, v, key);
    if (!listing) continue;
    if (v.opportunityId && !prior) continue;
    const identity = [
      listing.facilityName,
      listing.state,
      listing.grade,
      listing.specialty,
      listing.startDate,
      listing.endDate,
    ].join('|');
    const first = identities.get(identity);
    if (first) {
      v.opportunityId = first.opportunityId;
      v.notes.push(`Same feed entry as "${first.role}" (${first.rateText || 'rate not stated'}).`);
      continue;
    }
    identities.set(identity, v);
    try {
      const known = !!prior;
      const result = ingest(store, listing, now);
      v.opportunityId = result.opportunityId;
      if (!known) added++;
    } catch (error) {
      v.notes.push(`Could not add to the feed: ${(error as Error).message.slice(0, 200)}`);
    }
  }
  store.inbox = store.inbox.filter((e) => e.id !== raw.id);
  store.inbox.push(email);
  return { email, added };
}

/** Earlier Gmail collection left extraction drafts in the review queue; resolve them. */
export function clearLegacyGmailReviews(store: Store) {
  const gmailSources = new Set(
    store.sources
      .filter((s) => s.id === 'gmail-label' || s.collector?.kind === 'gmail')
      .map((s) => s.id),
  );
  let cleared = 0;
  for (const r of store.reviews)
    if (!r.resolved && r.kind === 'extraction' && gmailSources.has(r.sourceId)) {
      r.resolved = true;
      cleared++;
    }
  return cleared;
}
export function legacyGmailReviewCount(store: Store) {
  return store.reviews.filter(
    (r) =>
      !r.resolved &&
      r.kind === 'extraction' &&
      (r.sourceId === 'gmail-label' ||
        store.sources.find((s) => s.id === r.sourceId)?.collector?.kind === 'gmail'),
  ).length;
}
