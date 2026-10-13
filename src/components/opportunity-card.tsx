'use client';
import {
  ArrowUpRight,
  Bookmark,
  CalendarDays,
  Check,
  Clock,
  House,
  MapPin,
  Plane,
  Plus,
  Sparkle,
} from 'lucide-react';
import { duration, normalisePay, type EvaluatedJob } from '@/domain/engine';
import { Badge, dateLabel, money, rateLabel } from './shared';

export const eligTone = (s: string) =>
  s === 'Eligible'
    ? 'green'
    : s === 'Likely eligible'
      ? 'sage'
      : s === 'Ineligible' || s === 'Expired/unavailable'
        ? 'red'
        : 'amber';
const eligShort: Record<string, string> = {
  Eligible: 'Eligible',
  'Likely eligible': 'Likely eligible',
  'Needs verification': 'Verify eligibility',
  Ineligible: 'Ineligible',
  'Expired/unavailable': 'Unavailable',
};
const specialtyTone = (s: string) =>
  s === 'Psychiatry'
    ? 'lavender'
    : s === 'Emergency medicine'
      ? 'sand'
      : s === 'Rural generalist' || s === 'General practice'
        ? 'sage'
        : 'blue';

/** The score as a ring; "hard to assess" when too little of the weight is evidenced. */
export function ScoreRing({ job, large = false }: { job: EvaluatedJob; large?: boolean }) {
  const r = job.ranking;
  const score = r.score ?? 0;
  const hard = !r.assessable;
  const c = 2 * Math.PI * 22;
  return (
    <div
      className={`score-ring ${large ? 'large' : ''} ${!job.rankable ? 'unranked' : ''} ${hard ? 'hard' : ''}`}
      title={
        hard
          ? `Only ${r.weightCoverage}% of your weighting has evidence; the score says little yet.`
          : `Attractiveness, separate from eligibility. ${r.weightCoverage}% of your weighting has evidence.`
      }
    >
      <svg viewBox="0 0 52 52" aria-hidden>
        <circle cx="26" cy="26" r="22" className="ring-bg" />
        <circle
          cx="26"
          cy="26"
          r="22"
          className="ring-fg"
          strokeDasharray={`${(score / 100) * c} ${c}`}
          strokeDashoffset={c / 4}
          style={{ opacity: Math.max(0.35, r.weightCoverage / 100) }}
        />
      </svg>
      <strong>{r.score === null ? '—' : hard ? '?' : r.score}</strong>
      <span>{hard ? 'HARD TO ASSESS' : job.rankable ? 'MATCH' : 'PREVIEW'}</span>
    </div>
  );
}

/** Eligibility, feasibility, timing and evidence as separate chips (spec §8 "separate dimensions"). */
export function Indicators({ job, compact = false }: { job: EvaluatedJob; compact?: boolean }) {
  const sched = job.scheduling.status,
    log = job.logistics.status;
  return (
    <div className={`indicators ${compact ? 'compact' : ''}`}>
      <span
        className={`chip ${eligTone(job.eligibility.status)}`}
        title={job.eligibility.reasons[0]}
      >
        {eligShort[job.eligibility.status]}
      </span>
      {sched !== 'Fits' && (
        <span
          className={`chip ${sched === 'Conflict' ? 'red' : sched === 'Not set' ? '' : 'amber'}`}
          title={[...job.scheduling.conflicts, ...job.scheduling.reasons].join(' ')}
        >
          {sched === 'Conflict'
            ? 'Date conflict'
            : sched === 'Not set'
              ? 'Availability not set'
              : /negotiable/i.test(job.scheduling.reasons.join(' '))
                ? 'Negotiable clash'
                : /leave or release/i.test(job.scheduling.reasons.join(' '))
                  ? 'Needs leave approval'
                  : 'Dates: check'}
        </span>
      )}
      {log !== 'Straightforward' && log !== 'Unknown' && (
        <span
          className={`chip ${log === 'Excluded' ? 'red' : 'amber'}`}
          title={job.logistics.reasons.join(' ')}
        >
          {log}
        </span>
      )}
      <span
        className={`chip urgency-${job.urgency.toLowerCase()}`}
        title={`Starts in ${job.daysToStart} days`}
      >
        <Clock size={11} /> {job.urgency}
      </span>
      {!compact && (
        <span
          className={`chip evidence-${job.quality.label.toLowerCase()}`}
          title={job.quality.gaps.join(' ')}
        >
          Evidence: {job.quality.label.toLowerCase()}
        </span>
      )}
    </div>
  );
}

export function OpportunityCard({
  job,
  selected,
  onSelect,
  onCompare,
  onSave,
}: {
  job: EvaluatedJob;
  selected: boolean;
  onSelect: () => void;
  onCompare: () => void;
  onSave: () => void;
}) {
  const o = job.opportunity;
  const best =
    job.activeOffers.find(
      (offer) =>
        job.ranking.bestHourly !== null &&
        normalisePay(offer.compensation).hourly === job.ranking.bestHourly,
    ) ?? job.activeOffers[0];
  const saved =
    job.action &&
    !['Discovered', 'Dismissed', 'Declined', 'Rejected', 'Withdrawn'].includes(job.action.stage);
  const rates = new Set(
    job.activeOffers.map((v) => v.compensation.amount).filter((v) => v !== null),
  );
  return (
    <article
      className={`job-card ${selected ? 'selected' : ''} ${!job.rankable ? 'muted-card' : ''}`}
    >
      <div className="card-top">
        <div className="button-row tight">
          <Badge tone={specialtyTone(o.specialty)}>{o.specialty}</Badge>
          {job.lifecycle === 'Newly discovered' && (
            <span className="new-tag">
              <Sparkle size={11} /> New
            </span>
          )}
          {job.lifecycle === 'Availability unconfirmed' && (
            <span className="stale-tag">Unconfirmed</span>
          )}
        </div>
        <button
          className={`icon-button save-button ${saved ? 'saved' : ''}`}
          onClick={onSave}
          aria-label={`${saved ? 'Unsave' : 'Save'} ${job.facility.name}`}
          aria-pressed={!!saved}
        >
          <Bookmark size={19} fill={saved ? 'currentColor' : 'none'} />
        </button>
      </div>
      <div className="card-heading">
        <button className="card-title" onClick={onSelect}>
          {job.facility.name}
        </button>
        <span className="grade-label">{o.grade}</span>
      </div>
      <p className="location">
        <MapPin size={14} />
        {job.facility.town ? `${job.facility.town}, ` : ''}
        {job.facility.state}
        {job.logistics.distanceKm !== null && !job.logistics.local && (
          <>
            <span>·</span>
            {job.logistics.distanceKm.toLocaleString('en-AU')} km
          </>
        )}
        <span>·</span>
        {o.demo ? 'Example' : job.ageDays === 0 ? 'Seen today' : `Seen ${job.ageDays}d ago`}
      </p>
      <div className="card-dates">
        <CalendarDays size={15} />
        <span>
          {dateLabel(o.startDate)} – {dateLabel(o.endDate, true)}
        </span>
        <span className="duration">
          {o.shifts?.length ? `${o.shifts.length} shifts` : `${duration(o)} days`}
          {o.flexibility === 'flexible' ? ' · flexible' : ''}
        </span>
      </div>
      <div className="card-pay">
        <div>
          <strong>{best ? rateLabel(best.compensation) : 'Rate on enquiry'}</strong>
          <p>
            {job.ranking.bestHourly !== null
              ? `${money(job.ranking.bestHourly)}${job.ranking.estimatedHourly ? ' est.' : ''} comparable hourly`
              : 'Hourly comparison unavailable'}
          </p>
        </div>
        <ScoreRing job={job} />
      </div>
      {job.ranking.summary[0] && <p className="card-why">{job.ranking.summary[0]}</p>}
      <div className="perks">
        <span>
          <Plane size={14} />
          {job.logistics.local
            ? 'Local'
            : best?.flights === 'included'
              ? 'Flights included'
              : `Flights ${best?.flights || 'unknown'}`}
        </span>
        <span>
          <House size={14} />
          {job.logistics.local
            ? 'Home'
            : best?.accommodation === 'included'
              ? 'Stay included'
              : `Stay ${best?.accommodation || 'unknown'}`}
        </span>
      </div>
      <Indicators job={job} compact />
      <footer className="card-footer">
        <button className="text-button" onClick={onSelect}>
          {job.activeOffers.length} offer{job.activeOffers.length === 1 ? '' : 's'}
          {rates.size > 1 ? ` · rates differ` : ''}
          <ArrowUpRight size={14} />
        </button>
        <button
          className={`text-button compare-button ${selected ? 'active' : ''}`}
          onClick={onCompare}
          aria-pressed={selected}
        >
          {selected ? <Check size={14} /> : <Plus size={14} />}
          {selected ? 'Comparing' : 'Compare'}
        </button>
      </footer>
    </article>
  );
}
