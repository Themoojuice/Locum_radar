'use client';
import { useMemo, useState } from 'react';
import { CalendarRange, ChevronLeft, ChevronRight, Sparkles, TrendingUp } from 'lucide-react';
import { availabilityLabels, type AvailabilityKind, type Store } from '@/domain/model';
import { daysBetween, localDate, overlaps, type EvaluatedJob } from '@/domain/engine';
import { bestRun, predictedVacancies } from '@/domain/planning';
import { Badge, dateLabel, Empty, money } from './shared';

/*
 * Forward planner: six months at a time, availability bands by kind, tracked
 * and suggested placements, the best non-overlapping run, and recurring
 * patterns labelled as predictions.
 */
const WINDOW_MONTHS = 6;
const monthStart = (base: Date, offset: number) =>
  new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + offset, 1))
    .toISOString()
    .slice(0, 10);
const kindClass: Record<AvailabilityKind, string> = {
  available: 'av-available',
  preferred: 'av-preferred',
  'approved-leave': 'av-approved',
  'provisional-leave': 'av-provisional',
  negotiable: 'av-negotiable',
  unavailable: 'av-unavailable',
};

export function Planner({
  jobs,
  store,
  onSelect,
}: {
  jobs: EvaluatedJob[];
  store: Store;
  onSelect: (id: string) => void;
}) {
  const now = useMemo(() => new Date(), []);
  const [offset, setOffset] = useState(0);
  const [by, setBy] = useState<'score' | 'earnings'>('score');
  const start = monthStart(now, offset),
    end = new Date(Date.parse(monthStart(now, offset + WINDOW_MONTHS)) - 86400000)
      .toISOString()
      .slice(0, 10);
  const span = daysBetween(start, end) + 1;
  const pos = (d: string) => (Math.min(span, Math.max(0, daysBetween(start, d))) / span) * 100;
  const width = (a: string, b: string) =>
    Math.max(0.6, ((daysBetween(a < start ? start : a, b > end ? end : b) + 1) / span) * 100);
  const range = { startDate: start, endDate: end };

  const plan = useMemo(
    () => bestRun(jobs, store.profile, { by, from: localDate(now) }),
    [jobs, store.profile, by, now],
  );
  const planned = new Set(plan.steps.map((s) => s.job.opportunity.id));
  const tracked = jobs.filter(
    (j) =>
      j.action &&
      !['Discovered', 'Dismissed', 'Declined', 'Rejected', 'Withdrawn'].includes(j.action.stage),
  );
  const rows = [
    ...new Map(
      [...tracked, ...plan.steps.map((s) => s.job), ...jobs.filter((j) => j.rankable).slice(0, 20)]
        .filter((j) => overlaps(j.opportunity, range))
        .map((j) => [j.opportunity.id, j]),
    ).values(),
  ].sort((a, b) => a.opportunity.startDate.localeCompare(b.opportunity.startDate));
  const predictions = useMemo(() => predictedVacancies(store, now), [store, now]);
  const months = Array.from({ length: WINDOW_MONTHS }, (_, i) => monthStart(now, offset + i));

  return (
    <>
      <div className="page-intro">
        <p className="eyebrow">TIME WELL SPENT</p>
        <h1>Make room for the right work.</h1>
        <p>
          Your availability, the placements you are tracking, and the best run of non-overlapping
          blocks. Leave and release are never assumed approved.
        </p>
      </div>
      <div className="planner-layout">
        <section className="panel planner-panel">
          <div className="spread">
            <h2>
              <CalendarRange size={20} /> {dateLabel(start, true)} – {dateLabel(end, true)}
            </h2>
            <div className="button-row">
              <button
                className="icon-button"
                aria-label="Earlier"
                disabled={offset <= -6}
                onClick={() => setOffset(offset - 3)}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                className="icon-button"
                aria-label="Later"
                disabled={offset >= 18}
                onClick={() => setOffset(offset + 3)}
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
          <div className="gantt-scroll">
            <div className="gantt">
              <div className="gantt-label" />
              <div className="gantt-months">
                {months.map((m) => (
                  <span key={m} style={{ left: `${pos(m)}%` }}>
                    {new Intl.DateTimeFormat('en-AU', { month: 'short', timeZone: 'UTC' }).format(
                      new Date(`${m}T00:00:00Z`),
                    )}
                  </span>
                ))}
              </div>
              <div className="gantt-label">
                <strong>Your availability</strong>
              </div>
              <div className="gantt-track availability">
                {store.profile.availability
                  .filter((a) => a.start <= end && a.end >= start)
                  .map((a, i) => (
                    <span
                      key={i}
                      className={`av-band ${kindClass[a.kind]}`}
                      title={`${availabilityLabels[a.kind]}: ${a.start} to ${a.end}${a.note ? ` — ${a.note}` : ''}`}
                      style={{ left: `${pos(a.start)}%`, width: `${width(a.start, a.end)}%` }}
                    />
                  ))}
                {!store.profile.availability.length && (
                  <span className="small muted">Add availability in your profile</span>
                )}
                <span className="today" style={{ left: `${pos(localDate(now))}%` }} />
              </div>
              {rows.map((j) => {
                const o = j.opportunity;
                const clash = rows.some(
                  (v) =>
                    v.opportunity.id !== o.id &&
                    (planned.has(v.opportunity.id) || tracked.includes(v)) &&
                    (planned.has(o.id) || tracked.includes(j)) &&
                    overlaps(v.opportunity, o),
                );
                return (
                  <div className="gantt-row" key={o.id}>
                    <button className="gantt-label text-button" onClick={() => onSelect(o.id)}>
                      <strong>{j.facility.town || j.facility.name}</strong>
                      <span>
                        {o.specialty} ·{' '}
                        {j.action?.stage && j.action.stage !== 'Discovered'
                          ? j.action.stage
                          : `score ${j.ranking.score ?? '—'}`}
                      </span>
                    </button>
                    <div className="gantt-track">
                      <button
                        className={`gantt-bar ${planned.has(o.id) ? 'planned' : ''} ${tracked.includes(j) ? 'tracked' : ''} ${clash ? 'clash' : ''} ${j.scheduling.status === 'Conflict' ? 'conflict' : ''}`}
                        style={{
                          left: `${pos(o.startDate)}%`,
                          width: `${width(o.startDate, o.endDate)}%`,
                        }}
                        title={`${o.title}, ${o.startDate} to ${o.endDate}. ${j.scheduling.status}${j.scheduling.reasons[0] ? `: ${j.scheduling.reasons[0]}` : ''}`}
                        onClick={() => onSelect(o.id)}
                      >
                        {o.grade}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {!rows.length && (
            <Empty title="A clear horizon">Nothing tracked or ranked falls in these months.</Empty>
          )}
          <div className="planner-legend small">
            {(Object.keys(availabilityLabels) as AvailabilityKind[]).map((k) => (
              <span key={k}>
                <i className={`av-band ${kindClass[k]}`} /> {availabilityLabels[k]}
              </span>
            ))}
            <span>
              <i className="gantt-bar planned" /> In best run
            </span>
            <span>
              <i className="gantt-bar tracked" /> Tracked
            </span>
            <span>
              <i className="gantt-bar clash" /> Overlap
            </span>
          </div>
        </section>
        <aside className="planner-side">
          <section className="panel">
            <div className="spread">
              <h2>
                <Sparkles size={18} /> Best run
              </h2>
              <div className="segmented" role="group" aria-label="Optimise for">
                <button className={by === 'score' ? 'active' : ''} onClick={() => setBy('score')}>
                  Score
                </button>
                <button
                  className={by === 'earnings' ? 'active' : ''}
                  onClick={() => setBy('earnings')}
                >
                  Earnings
                </button>
              </div>
            </div>
            <p className="small muted">
              The non-overlapping set of eligible placements with the highest total{' '}
              {by === 'score' ? 'score' : 'estimated gross pay'}, leaving a day between blocks.
              Committed placements are always included.
            </p>
            {plan.steps.length ? (
              <>
                <ol className="plan-steps">
                  {plan.steps.map((s) => (
                    <li key={s.job.opportunity.id}>
                      <button
                        className="text-button"
                        onClick={() => onSelect(s.job.opportunity.id)}
                      >
                        <strong>{s.job.facility.town || s.job.facility.name}</strong> ·{' '}
                        {s.job.opportunity.specialty}
                      </button>
                      <span className="small muted">
                        {dateLabel(s.job.opportunity.startDate)} –{' '}
                        {dateLabel(s.job.opportunity.endDate, true)}
                        {s.gross !== null &&
                          ` · ${money(s.gross)}${s.grossKind === 'estimated' ? ' est.' : ''}`}
                      </span>
                    </li>
                  ))}
                </ol>
                <dl className="plan-totals">
                  <div>
                    <dt>Days of work</dt>
                    <dd>{plan.days}</dd>
                  </div>
                  <div>
                    <dt>Gross (before tax)</dt>
                    <dd>
                      {money(plan.gross)}
                      {plan.grossKnown < plan.steps.length && (
                        <small> · {plan.steps.length - plan.grossKnown} unknown</small>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>After travel costs</dt>
                    <dd>
                      {plan.netKnown ? money(plan.net) : 'Needs cost settings'}
                      {plan.netKnown > 0 && plan.netKnown < plan.steps.length && (
                        <small> · {plan.steps.length - plan.netKnown} unknown</small>
                      )}
                    </dd>
                  </div>
                </dl>
              </>
            ) : (
              <p className="small">No ranked, schedulable placements yet.</p>
            )}
          </section>
          <section className="panel">
            <h2>
              <TrendingUp size={18} /> Recurring patterns
            </h2>
            <p className="small muted">
              Hospitals that have advertised the same specialty in three or more months. These are
              predictions from history, not advertised vacancies.
            </p>
            {predictions.length ? (
              <ul className="prediction-list">
                {predictions.slice(0, 12).map((p) => (
                  <li key={`${p.facilityId}-${p.specialty}`}>
                    <Badge tone="lavender">Predicted</Badge>
                    <strong>{p.facility}</strong>
                    <span className="small">
                      {p.specialty} ·{' '}
                      {new Intl.DateTimeFormat('en-AU', {
                        month: 'long',
                        year: 'numeric',
                        timeZone: 'UTC',
                      }).format(new Date(`${p.month}-01T00:00:00Z`))}
                    </span>
                    <span className="small muted">{p.basis}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small">Patterns appear after a few months of collection history.</p>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
