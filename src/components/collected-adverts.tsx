'use client';
import { useState } from 'react';
import type { Store, ReviewItem } from '@/domain/model';
import { Badge, dateLabel, rateLabel } from './shared';
const validDate = (value?: string) =>
  !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));

export function CollectedAdverts({
  store,
  onReview,
}: {
  store: Store;
  onReview: (item: ReviewItem) => void;
}) {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(12);
  const [past, setPast] = useState(false);
  const unique = new Map<string, ReviewItem>();
  for (const item of store.reviews) {
    if (
      item.resolved ||
      item.kind !== 'extraction' ||
      !item.draft?.url ||
      !/^https?:\/\//.test(item.draft.url)
    )
      continue;
    unique.set(`${item.sourceId}:${item.draft.externalId || item.draft.url}`, item);
  }
  const today = new Date().toISOString().slice(0, 10);
  const adverts = [...unique.values()].filter(
    (item) =>
      (past || !validDate(item.draft?.endDate) || item.draft!.endDate! >= today) &&
      `${item.draft?.title} ${item.draft?.state} ${item.draft?.rawText}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  if (!unique.size) return null;
  return (
    <section className="panel collected-adverts" aria-label="Collected public advertisements">
      <p className="eyebrow">FOUND ON PUBLIC JOB BOARDS</p>
      <h2>{adverts.length} collected advertisements</h2>
      <p>
        Browse these straight away. Advertised dates and rates are shown as published; confirm
        availability and missing details before adding a job to your ranked comparisons.
      </p>
      <div className="button-row">
        <input
          aria-label="Search collected adverts"
          placeholder="Search collected roles or locations…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(12);
          }}
        />
        <label>
          <input type="checkbox" checked={past} onChange={(e) => setPast(e.target.checked)} />{' '}
          Include past adverts
        </label>
      </div>
      <div className="collected-grid">
        {adverts.slice(0, limit).map((item) => {
          const d = item.draft!;
          return (
            <article className="job-card" key={item.id}>
              <Badge>
                {store.sources.find((s) => s.id === item.sourceId)?.name || 'Public source'}
              </Badge>
              <h3>{d.title || 'Advertisement'}</h3>
              <p>
                {d.state || 'Location needs confirmation'} ·{' '}
                {d.compensation ? rateLabel(d.compensation) : 'Rate on enquiry'}
              </p>
              <p>
                {validDate(d.startDate) && validDate(d.endDate)
                  ? `${dateLabel(d.startDate!, true)} – ${dateLabel(d.endDate!, true)}`
                  : 'Dates need confirmation'}
              </p>
              <p className="small muted">
                {d.facilityName || 'Facility not confirmed'} · Eligibility not yet assessed
              </p>
              <div className="button-row">
                <a
                  className="button secondary small"
                  href={d.url!}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Original advert
                </a>
                <button className="button secondary small" onClick={() => onReview(item)}>
                  Review & compare
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {adverts.length > limit && (
        <button className="button secondary" onClick={() => setLimit((v) => v + 24)}>
          Show more adverts
        </button>
      )}
    </section>
  );
}
