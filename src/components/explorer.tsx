'use client';
import type { Store } from '@/domain/model';
import { earnings, type EvaluatedJob } from '@/domain/engine';
import { dateLabel, Empty, money, rateLabel } from './shared';

/**
 * Side-by-side comparison. Each offer stays visible separately, so two agencies'
 * terms for the same vacancy can be compared as easily as two vacancies.
 */
export function ComparisonView({
  jobs,
  store,
  onRemove,
  onSelect,
}: {
  jobs: EvaluatedJob[];
  store: Store;
  onRemove: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  if (!jobs.length)
    return (
      <Empty title="Put your options side by side">
        Select Compare on two to four opportunity cards to see the differences.
      </Empty>
    );
  const source = (id: string) => store.sources.find((s) => s.id === id)?.name ?? id;
  const bestNet = (j: EvaluatedJob) => {
    const nets = j.activeOffers
      .map((o) => earnings(o, j.opportunity, store.profile, j.logistics.local).net)
      .filter((n) => n.value !== null);
    const top = nets.sort((a, b) => b.value! - a.value!)[0];
    return top ? `${money(top.value)}${top.kind === 'estimated' ? ' (estimate)' : ''}` : 'Unknown';
  };
  const rows: [string, (j: EvaluatedJob) => string][] = [
    ['Clinical role', (j) => `${j.opportunity.specialty} · ${j.opportunity.grade}`],
    [
      'Dates',
      (j) => `${dateLabel(j.opportunity.startDate)} – ${dateLabel(j.opportunity.endDate, true)}`,
    ],
    ['Timing', (j) => `${j.urgency} · starts in ${j.daysToStart} days`],
    ['Eligibility', (j) => j.eligibility.status],
    ['Your dates', (j) => j.scheduling.status],
    ['Arrangements', (j) => j.logistics.status],
    [
      'Attractiveness',
      (j) =>
        j.ranking.assessable
          ? String(j.ranking.score ?? 'Unknown')
          : `Hard to assess (${j.ranking.score ?? '—'})`,
    ],
    ['Evidence quality', (j) => j.quality.label],
    [
      'Offers',
      (j) =>
        j.offers.map((o) => `${source(o.sourceId)}: ${rateLabel(o.compensation)}`).join(' · ') ||
        'Unknown',
    ],
    ['Best comparable hourly', (j) => money(j.ranking.bestHourly)],
    ['Best expected after costs', bestNet],
    [
      'Travel & stay',
      (j) =>
        j.logistics.local
          ? 'Local'
          : j.offers.map((o) => `Flights ${o.flights}; stay ${o.accommodation}`).join(' / '),
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
