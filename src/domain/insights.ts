import { dimensionLabels, normalisePay, type EvaluatedJob } from './engine';
import { dimensions, type Profile, type Store, type Weights } from './model';

/* ---------------------------------------------------------------------- alerts */

export type AlertKind =
  'new-high' | 'rate' | 'better-offer' | 'urgent' | 'future-match' | 'saved-change';
export interface Alert {
  id: string;
  at: string;
  opportunityId: string;
  kind: AlertKind;
  title: string;
  detail: string;
  unread: boolean;
}
export const alertLabels: Record<AlertKind, string> = {
  'new-high': 'New high scorer',
  rate: 'Rate change',
  'better-offer': 'Better offer',
  urgent: 'Exceptional urgent',
  'future-match': 'Fits your plans',
  'saved-change': 'Saved job changed',
};
/** A rate move smaller than this is noise, not news. */
export const MATERIAL_RATE_CHANGE = 0.05;
const DAY = 86400000;

/**
 * In-app alerts derived from recorded events and current assessments. Each
 * opportunity yields at most one alert of each kind, so a vacancy advertised by
 * five agencies is announced once. Nothing is sent anywhere.
 */
export function deriveAlerts(store: Store, jobs: EvaluatedJob[], now = new Date()): Alert[] {
  const p = store.profile;
  const byId = new Map(jobs.map((j) => [j.opportunity.id, j]));
  const seen = p.alertsSeenAt ? Date.parse(p.alertsSeenAt) : 0;
  const recent = now.getTime() - 30 * DAY;
  const out = new Map<string, Alert>();
  const add = (job: EvaluatedJob, kind: AlertKind, at: string, detail: string) => {
    const key = `${kind}:${job.opportunity.id}`;
    const existing = out.get(key);
    if (existing && existing.at >= at) return;
    out.set(key, {
      id: key,
      at,
      opportunityId: job.opportunity.id,
      kind,
      title: `${job.opportunity.title} · ${job.facility.town || job.facility.name}`,
      detail,
      unread: Date.parse(at) > seen,
    });
  };
  const tracked = (j: EvaluatedJob) =>
    !!j.action && !['Discovered', 'Dismissed'].includes(j.action.stage);
  const good = (j: EvaluatedJob, margin = 0) =>
    j.rankable && j.ranking.score !== null && j.ranking.score >= p.alertScore + margin;

  for (const e of store.events ?? []) {
    if (Date.parse(e.at) < recent) continue;
    const job = byId.get(e.opportunityId);
    if (!job) continue;
    if (tracked(job) && e.kind !== 'new') {
      add(job, 'saved-change', e.at, e.detail);
      continue;
    }
    if (e.kind === 'new' && good(job))
      add(
        job,
        'new-high',
        e.at,
        `Scores ${job.ranking.score}. ${job.ranking.summary[0] ?? ''}`.trim(),
      );
    if (
      e.kind === 'rate-change' &&
      e.before &&
      e.after &&
      Math.abs(e.after - e.before) / e.before >= MATERIAL_RATE_CHANGE &&
      (job.rankable || tracked(job))
    )
      add(job, 'rate', e.at, e.detail);
    if (e.kind === 'new-offer' && e.after) {
      const others = job.activeOffers
        .filter((o) => o.sourceId !== e.sourceId)
        .map((o) => normalisePay(o.compensation).hourly ?? o.compensation.amount)
        .filter((v): v is number => v !== null);
      if (others.length && e.after > Math.max(...others) && (job.rankable || tracked(job)))
        add(
          job,
          'better-offer',
          e.at,
          `A second source quotes $${e.after}, above the previous best of $${Math.max(...others)}.`,
        );
    }
  }
  for (const job of jobs) {
    const first = Date.parse(job.opportunity.firstSeenAt);
    if (job.urgency === 'Urgent' && good(job, 10) && first >= now.getTime() - 7 * DAY)
      add(
        job,
        'urgent',
        job.opportunity.firstSeenAt,
        `Starts in ${Math.max(0, job.daysToStart)} days and scores ${job.ranking.score}.`,
      );
    if (
      ['Medium-term', 'Long-term'].includes(job.urgency) &&
      job.scheduling.status === 'Fits' &&
      good(job) &&
      first >= now.getTime() - 14 * DAY
    )
      add(
        job,
        'future-match',
        job.opportunity.firstSeenAt,
        'Falls entirely within your declared availability.',
      );
  }
  return [...out.values()].sort((a, b) => b.at.localeCompare(a.at));
}

/* ---------------------------------------------------------- preference learning */

export interface WeightSuggestion {
  weights: Weights;
  changes: { dimension: keyof Weights; label: string; from: number; to: number; why: string }[];
  basis: { liked: number; dismissed: number };
}
const LIKED = ['Saved', 'Enquiry sent', 'Applied', 'Credentialing', 'Offered', 'Accepted'];
/**
 * Suggests ranking weights from what the doctor saves and dismisses. The
 * dimensions on which liked jobs beat dismissed ones gain weight. This is a
 * transparent heuristic, not a trained model, and it is only ever a suggestion:
 * weights change when the doctor applies it (spec §14).
 */
export function suggestWeights(profile: Profile, jobs: EvaluatedJob[]): WeightSuggestion | null {
  const liked = jobs.filter((j) => j.action && LIKED.includes(j.action.stage));
  const dismissed = jobs.filter((j) => j.action?.stage === 'Dismissed');
  if (liked.length < 4 || dismissed.length < 3) return null;
  const mean = (set: EvaluatedJob[], d: keyof Weights) => {
    const v = set.map((j) => j.ranking.components[d]).filter((x): x is number => x !== null);
    return v.length >= 2 ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const raw = { ...profile.weights };
  const notes: Partial<Record<keyof Weights, string>> = {};
  for (const d of dimensions) {
    const a = mean(liked, d),
      b = mean(dismissed, d);
    if (a === null || b === null) continue;
    const gap = a - b; // −100..100
    if (Math.abs(gap) < 10) continue;
    raw[d] = Math.max(0, profile.weights[d] * (1 + gap / 100));
    notes[d] =
      `Jobs you kept average ${Math.round(a)} here; jobs you dismissed average ${Math.round(b)}.`;
  }
  const total = dimensions.reduce((s, d) => s + raw[d], 0) || 1;
  const currentTotal = dimensions.reduce((s, d) => s + profile.weights[d], 0) || 1;
  const weights = Object.fromEntries(
    dimensions.map((d) => [d, Math.round((raw[d] / total) * currentTotal)]),
  ) as Weights;
  const changes = dimensions
    .filter((d) => Math.abs(weights[d] - profile.weights[d]) >= 2 && notes[d])
    .map((d) => ({
      dimension: d,
      label: dimensionLabels[d],
      from: profile.weights[d],
      to: weights[d],
      why: notes[d]!,
    }));
  if (!changes.length) return null;
  return { weights, changes, basis: { liked: liked.length, dismissed: dismissed.length } };
}

/* ------------------------------------------------------------------ enquiries */

/**
 * The questions worth asking a recruiter before committing, drawn from what the
 * record does not establish. Feeds the enquiry draft; nothing is sent.
 */
export function outstandingQuestions(job: EvaluatedJob): string[] {
  const q: string[] = [];
  const o = job.opportunity,
    offers = job.activeOffers;
  if (!offers.some((v) => v.compensation.amount !== null))
    q.push('What is the rate, and on what basis (hourly, daily, per shift)?');
  if (offers.some((v) => v.compensation.super === 'unknown'))
    q.push('Is the rate inclusive of superannuation, or is super paid on top?');
  if (offers.some((v) => v.compensation.onCall === 'unknown'))
    q.push('Is there on-call, and how is it paid?');
  if (offers.some((v) => v.compensation.paidHours === null && v.compensation.basis === 'hour'))
    q.push('How many paid hours are guaranteed across the placement?');
  if (!o.roster) q.push('What is the roster (shift times, weekends, nights)?');
  if (!offers.some((v) => v.flights === 'included') && !job.logistics.local)
    q.push('Are flights or travel to the site covered?');
  if (!offers.some((v) => v.accommodation === 'included') && !job.logistics.local)
    q.push('Is accommodation provided?');
  for (const c of job.eligibility.checks.filter(
    (c) => c.status === 'unknown' && !/your|you /i.test(c.text),
  ))
    q.push(c.text.replace(/\.$/, '') + ' — can you confirm?');
  if (o.requirements.supervisionAvailable === null)
    q.push('What senior support or supervision is available on site?');
  if (!o.requirements.complete)
    q.push('Could you send the full list of credentialing requirements?');
  if (o.status !== 'confirmed available') q.push('Is the placement still available?');
  return [...new Set(q)];
}
export function enquiryDraft(job: EvaluatedJob, profile: Profile) {
  const o = job.opportunity;
  const dates = `${o.startDate} to ${o.endDate}`;
  const refs = job.listings.map((l) => l.externalId).filter(Boolean);
  const subject = `Enquiry: ${o.title} at ${job.facility.name} (${dates})`;
  const questions = outstandingQuestions(job);
  const body = [
    'Hi,',
    '',
    `I'm interested in the ${o.grade} ${o.specialty.toLowerCase()} locum at ${job.facility.name}, ${job.facility.town || job.facility.state}, ${dates}${refs.length ? ` (your reference ${refs[0]})` : ''}.`,
    '',
    questions.length ? 'Before I commit, could you confirm:' : 'Could you confirm the next steps?',
    ...questions.map((v) => `- ${v}`),
    '',
    'Thanks,',
    profile.name === 'My profile' ? '' : profile.name,
  ].join('\n');
  return { subject, body, questions };
}
