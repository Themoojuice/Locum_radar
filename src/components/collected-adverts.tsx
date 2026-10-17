'use client';
import type { Store, ReviewItem } from '@/domain/model';
import { Badge, dateLabel, rateLabel } from './shared';
const validDate = (value?: string) =>
  !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));
export function PendingJobCard({
  item,
  store,
  onReview,
}: {
  item: ReviewItem;
  store: Store;
  onReview: () => void;
}) {
  const d = item.draft || {};
  const link = d.url && /^https?:\/\//.test(d.url) ? d.url : null;
  return (
    <article className="job-card">
      <div className="card-top">
        <Badge>{d.specialty || 'Specialty unconfirmed'}</Badge>
        <Badge tone="amber">Needs verification</Badge>
      </div>
      {item.emailScreen && item.emailScreen.status !== 'offer' && (
        <p className="notice">Held for screening — {item.emailScreen.reason}</p>
      )}
      <h3>{d.title || 'Recruiter advertisement'}</h3>
      <p>
        {d.facilityName || 'Facility not confirmed'}
        {d.state ? ` · ${d.state}` : ''}
      </p>
      <p>{d.compensation ? rateLabel(d.compensation) : 'Rate on enquiry'}</p>
      <p>
        {validDate(d.startDate) && validDate(d.endDate)
          ? `${dateLabel(d.startDate!, true)} – ${dateLabel(d.endDate!, true)}`
          : 'Dates need confirmation'}
      </p>
      {store.sources.some(
        (s) => s.id === item.sourceId && (s.type === 'email' || s.collector?.kind === 'gmail'),
      ) && (
        <p className="small muted">
          Email date:{' '}
          {item.publishedAt ? new Date(item.publishedAt).toLocaleDateString('en-AU') : 'unknown'}
        </p>
      )}
      <p className="small muted">
        {store.sources.find((s) => s.id === item.sourceId)?.name || 'Imported advertisement'} ·{' '}
        {d.grade || 'Grade unconfirmed'}
      </p>
      <div className="button-row">
        {link && (
          <a
            className="button secondary small"
            href={link}
            target="_blank"
            rel="noopener noreferrer"
          >
            Original advert
          </a>
        )}
        <button className="button secondary small" onClick={onReview}>
          View details & review
        </button>
      </div>
    </article>
  );
}
