'use client';
import { useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, MapPin } from 'lucide-react';
import type { Store } from '@/domain/model';
import { daysBetween, overlaps, type EvaluatedJob } from '@/domain/engine';
import { dateLabel, Empty, money, rateLabel } from './shared';
export function GeographicExplorer({
  jobs,
  store,
  onSelect,
}: {
  jobs: EvaluatedJob[];
  store: Store;
  onSelect: (id: string) => void;
}) {
  const [coverage, setCoverage] = useState(false);
  const facilities = coverage
    ? store.facilities
    : store.facilities.filter((f) => jobs.some((j) => j.facility.id === f.id));
  const project = (lat: number, lon: number) => ({
    x: 60 + ((lon - 112) / 43) * 530,
    y: 35 + ((-lat - 10) / 35) * 430,
  });
  return (
    <section className="panel map-panel">
      <div className="spread">
        <div>
          <p className="eyebrow">A LITTLE FURTHER AFIELD</p>
          <h2>A different kind of commute.</h2>
        </div>
        <button className="button secondary small" onClick={() => setCoverage(!coverage)}>
          {coverage ? 'Show opportunities' : 'Show coverage'}
        </button>
      </div>
      <div className="map-wrap">
        <svg viewBox="0 0 680 500" role="img" aria-label="Schematic map of Australian facilities">
          <defs>
            <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse">
              <path d="M 28 0 L 0 0 0 28" fill="none" stroke="#dce4df" strokeWidth="0.6" />
            </pattern>
          </defs>
          <rect width="680" height="500" fill="url(#grid)" />
          <path
            d="M89 189 126 166 150 125 193 110 225 66 261 70 285 53 311 61 337 32 348 70 373 77 394 104 419 101 433 48 445 31 459 94 482 131 503 173 541 206 564 250 562 299 547 333 521 358 504 385 476 399 451 370 423 368 400 344 368 338 335 336 309 316 278 327 248 348 218 368 186 372 158 353 128 352 115 329 100 309 89 260 76 224 Z"
            fill="#e5ebe2"
            stroke="#b7c5b6"
            strokeWidth="1.5"
          />
          <path
            d="M489 421 518 419 526 439 511 464 491 451Z"
            fill="#e5ebe2"
            stroke="#b7c5b6"
            strokeWidth="1.5"
          />
          <text x="193" y="230" className="map-state">
            WA
          </text>
          <text x="324" y="162" className="map-state">
            NT
          </text>
          <text x="453" y="204" className="map-state">
            QLD
          </text>
          <text x="347" y="280" className="map-state">
            SA
          </text>
          <text x="484" y="304" className="map-state">
            NSW
          </text>
          <text x="477" y="366" className="map-state">
            VIC
          </text>
          <text x="546" y="447" className="map-state">
            TAS
          </text>
          {facilities
            .filter((f) => f.lat !== null && f.lon !== null)
            .map((f) => {
              const p = project(f.lat!, f.lon!),
                related = jobs.filter((j) => j.facility.id === f.id),
                observed = store.opportunities.some((j) => j.facilityId === f.id);
              return (
                <g key={f.id} transform={`translate(${p.x}, ${p.y})`}>
                  <circle
                    r="13"
                    fill={coverage && !observed ? '#a7b3a4' : '#1f6150'}
                    opacity="0.12"
                  />
                  <circle r="5" fill={coverage && !observed ? '#879883' : '#1f6150'} />
                  <text x="12" y="4" className="map-label">
                    {f.town}
                    {!coverage && related.length > 1 ? ` (${related.length})` : ''}
                  </text>
                </g>
              );
            })}
        </svg>
        <p className="map-caption">
          Schematic · approximate locations ·{' '}
          {coverage ? 'green: observed records · grey: coverage unknown' : 'filtered opportunities'}
          <br />
          Starter directory: {store.facilities.length} facilities. This is not national coverage.
        </p>
      </div>
      <div className="map-results">
        {coverage
          ? facilities.map((f) => (
              <div key={f.id} className="map-result">
                <MapPin size={15} />
                <span>{f.name}</span>
                <span className="muted small">
                  {store.opportunities.some((o) => o.facilityId === f.id)
                    ? 'Observed vacancies'
                    : 'Coverage unknown'}
                </span>
              </div>
            ))
          : jobs.map((j) => (
              <button
                key={j.opportunity.id}
                className="map-result"
                onClick={() => onSelect(j.opportunity.id)}
              >
                <MapPin size={15} />
                <span>
                  {j.facility.town} · {j.opportunity.specialty}
                </span>
                <strong>{j.ranking.score ?? '—'}</strong>
              </button>
            ))}
      </div>
      {jobs.some((j) => j.facility.lat === null) && (
        <p className="small muted">
          Some imported facilities have no coordinates; their opportunities remain listed below the
          map.
        </p>
      )}
    </section>
  );
}
export function CalendarView({
  jobs,
  store,
  onSelect,
}: {
  jobs: EvaluatedJob[];
  store: Store;
  onSelect: (id: string) => void;
}) {
  const [month, setMonth] = useState(0),
    year = 2027;
  const start = `${year}-${String(month + 1).padStart(2, '0')}-01`,
    days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate(),
    end = `${year}-${String(month + 1).padStart(2, '0')}-${days}`;
  const visible = jobs.filter((j) => overlaps(j.opportunity, { startDate: start, endDate: end }));
  const offset = (d: string) => (Math.max(0, daysBetween(start, d)) / days) * 100;
  return (
    <>
      <div className="page-intro">
        <p className="eyebrow">TIME WELL SPENT</p>
        <h1>Make room for the right work.</h1>
        <p>
          Placement overlaps are flagged for review. Exact roster times and travel buffers still
          need confirmation.
        </p>
      </div>
      <section className="panel">
        <div className="spread">
          <h2>
            <CalendarDays size={21} />
            {new Intl.DateTimeFormat('en-AU', {
              month: 'long',
              year: 'numeric',
              timeZone: 'UTC',
            }).format(new Date(`${start}T00:00:00Z`))}
          </h2>
          <div className="button-row">
            <button
              className="icon-button"
              aria-label="Previous month"
              disabled={month === 0}
              onClick={() => setMonth(month - 1)}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              className="icon-button"
              aria-label="Next month"
              disabled={month === 11}
              onClick={() => setMonth(month + 1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
        <div className="calendar-scroll">
          <div className="calendar-grid">
            <div className="calendar-label">Your availability</div>
            <div className="timeline availability-track">
              {store.profile.availability
                .filter((a) => a.start <= end && a.end >= start)
                .map((a, i) => (
                  <span
                    key={i}
                    className="availability-bar"
                    style={{
                      left: `${offset(a.start)}%`,
                      width: `${Math.max(1, ((daysBetween(a.start < start ? start : a.start, a.end > end ? end : a.end) + 1) / days) * 100)}%`,
                    }}
                  />
                ))}
              {!store.profile.availability.length && (
                <span className="small muted">No availability entered</span>
              )}
            </div>
            <div />
            <div className="calendar-dates">
              {Array.from({ length: days }, (_, i) => (
                <span key={i}>{i + 1}</span>
              ))}
            </div>
            {visible.map((j) => {
              const o = j.opportunity,
                conflict = visible.some(
                  (v) => v.opportunity.id !== o.id && overlaps(v.opportunity, o),
                ),
                n =
                  daysBetween(
                    o.startDate < start ? start : o.startDate,
                    o.endDate > end ? end : o.endDate,
                  ) + 1;
              return (
                <div className="calendar-row" key={o.id}>
                  <button className="calendar-label text-button" onClick={() => onSelect(o.id)}>
                    <strong>{j.facility.town}</strong>
                    <span>{o.specialty}</span>
                  </button>
                  <div className="timeline">
                    <button
                      title={`${o.title}: ${o.startDate} to ${o.endDate}${conflict ? ' · overlaps another placement' : ''}`}
                      className={`placement-bar ${conflict ? 'overlap' : ''}`}
                      style={{ left: `${offset(o.startDate)}%`, width: `${(n / days) * 100}%` }}
                      onClick={() => onSelect(o.id)}
                    >
                      {conflict ? '↔ ' : ''}
                      {o.grade}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {!visible.length && (
          <Empty title="A little breathing room">No recorded placements overlap this month.</Empty>
        )}
        <p className="small muted">
          Green strip: declared availability. Amber placements: date overlap, not necessarily a
          shift conflict. All dates use the facility’s local calendar; no timezone conversion is
          applied to date-only placements.
        </p>
      </section>
    </>
  );
}
export function ComparisonView({
  jobs,
  onRemove,
  onSelect,
}: {
  jobs: EvaluatedJob[];
  onRemove: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  if (!jobs.length)
    return (
      <Empty title="Put your options side by side">
        Select Compare on two to four opportunity cards to see the differences.
      </Empty>
    );
  const rows: [string, (j: EvaluatedJob) => string][] = [
    ['Clinical role', (j) => `${j.opportunity.specialty} · ${j.opportunity.grade}`],
    [
      'Dates',
      (j) => `${dateLabel(j.opportunity.startDate)} – ${dateLabel(j.opportunity.endDate, true)}`,
    ],
    ['Suitability', (j) => j.eligibility.status],
    ['Preference score', (j) => String(j.ranking.score ?? 'Unknown')],
    ['Scoring evidence', (j) => `${j.ranking.evidence}%`],
    [
      'Advertised offers',
      (j) => j.offers.map((o) => rateLabel(o.compensation)).join(' · ') || 'Unknown',
    ],
    ['Best comparable hourly', (j) => money(j.ranking.bestHourly)],
    [
      'Travel & stay',
      (j) => j.offers.map((o) => `Flights ${o.flights}; stay ${o.accommodation}`).join(' / '),
    ],
    [
      'Super',
      (j) => [...new Set(j.offers.map((o) => o.compensation.super))].join(' / ') || 'Unknown',
    ],
    [
      'On-call',
      (j) => [...new Set(j.offers.map((o) => o.compensation.onCall))].join(' / ') || 'Unknown',
    ],
    ['Freshness', (j) => j.freshness],
    ['Next step', (j) => j.action?.stage || 'Discovered'],
  ];
  return (
    <>
      <div className="page-intro">
        <p className="eyebrow">THE WHOLE PICTURE</p>
        <h1>Good options. Clear differences.</h1>
        <p>Unknowns stay visible. Shaded rows differ between your selected opportunities.</p>
      </div>
      <div className="comparison-wrap">
        <table className="comparison">
          <thead>
            <tr>
              <th scope="col">At a glance</th>
              {jobs.map((j) => (
                <th key={j.opportunity.id} scope="col">
                  <button className="text-button" onClick={() => onSelect(j.opportunity.id)}>
                    {j.facility.name}
                  </button>
                  <p>{j.facility.state}</p>
                  <button
                    className="text-button small muted"
                    onClick={() => onRemove(j.opportunity.id)}
                  >
                    Remove
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label} className={new Set(jobs.map(value)).size > 1 ? 'different' : ''}>
                <th scope="row">{label}</th>
                {jobs.map((j) => (
                  <td key={j.opportunity.id}>{value(j)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
