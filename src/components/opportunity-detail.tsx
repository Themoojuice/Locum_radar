'use client';
import { useState } from 'react';
import { ExternalLink, Plane, House, ArrowUpRight, Split, Trash2 } from 'lucide-react';
import { stages, type Compensation, type Offer, type Stage, type Store } from '@/domain/model';
import { normalisePay, type EvaluatedJob } from '@/domain/engine';
import { api, Badge, dateLabel, Modal, money, rateLabel } from './shared';
function PayScenario({ offer }: { offer: Offer }) {
  const [c, setC] = useState<Compensation>({ ...offer.compensation });
  const pay = normalisePay(c);
  return (
    <details className="details-block">
      <summary>Explore costs & paid hours</summary>
      <p className="small muted">
        A temporary scenario. These inputs do not change the advertised terms.
      </p>
      <div className="form-grid">
        {(['paidHours', 'paidDays', 'paidShifts', 'directExpenses', 'travelHours'] as const).map(
          (key) => (
            <label key={key}>
              {
                {
                  paidHours: 'Total paid hours',
                  paidDays: 'Paid days',
                  paidShifts: 'Paid shifts',
                  directExpenses: 'Direct expenses (AUD)',
                  travelHours: 'Unpaid travel hours',
                }[key]
              }
              <input
                type="number"
                min="0"
                step="any"
                value={c[key] ?? ''}
                placeholder="Unknown"
                onChange={(e) =>
                  setC({
                    ...c,
                    [key]:
                      e.target.value === ''
                        ? null
                        : Math.max(key.startsWith('paid') ? 0.01 : 0, Number(e.target.value)),
                  })
                }
              />
            </label>
          ),
        )}
      </div>
      <dl className="facts">
        <div>
          <dt>Scenario gross</dt>
          <dd>{money(pay.gross)}</dd>
        </div>
        <div>
          <dt>After direct expenses</dt>
          <dd>{money(pay.afterExpenses)}</dd>
        </div>
        <div>
          <dt>Per committed hour</dt>
          <dd>{money(pay.committedHourly)}</dd>
        </div>
      </dl>
      <p className="small muted">
        Before personal income tax. On-call and super-inclusive amounts do not produce a cash hourly
        comparison.
      </p>
    </details>
  );
}
export function OpportunityDetail({
  job,
  store,
  onClose,
  onAction,
  onReload,
  notify,
}: {
  job: EvaluatedJob;
  store: Store;
  onClose: () => void;
  onAction: (id: string, stage: Stage, notes: string) => Promise<void>;
  onReload: () => Promise<void>;
  notify: (v: string) => void;
}) {
  const { opportunity: o, facility: f, offers } = job;
  const [stage, setStage] = useState<Stage>(job.action?.stage || 'Discovered'),
    [notes, setNotes] = useState(job.action?.notes || ''),
    [busy, setBusy] = useState(false),
    [deleting, setDeleting] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await onAction(o.id, stage, notes);
      notify('Tracker updated');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={f.name} onClose={onClose} wide>
      <div className="detail-heading">
        <div>
          <p className="eyebrow">
            {f.town}, {f.state} · {o.demo ? 'ILLUSTRATIVE EXAMPLE' : 'YOUR WORKSPACE'}
          </p>
          <h2>{o.title}</h2>
          <p>
            {dateLabel(o.startDate)} – {dateLabel(o.endDate, true)} · {f.timezone}
          </p>
        </div>
        <div className="detail-score">
          <strong>{job.ranking.score ?? '—'}</strong>
          <span>preference score</span>
        </div>
      </div>
      <div className="button-row">
        <Badge tone={job.rankable ? 'green' : 'amber'}>{job.eligibility.status}</Badge>
        <Badge>{job.freshness}</Badge>
        <Badge>{o.status}</Badge>
      </div>
      <section className="detail-section">
        <h3>Suitability & questions to resolve</h3>
        <ul className="reason-list">
          {job.eligibility.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <p className="small muted">
          A profile match is not professional credentialing or confirmation that the placement is
          still available.
        </p>
      </section>
      <section className="detail-section">
        <div className="spread">
          <h3>
            {offers.length} recruiter offer{offers.length === 1 ? '' : 's'}
          </h3>
          <span className="small muted">All amounts AUD</span>
        </div>
        <div className="offer-grid">
          {offers.map((offer) => {
            const pay = normalisePay(offer.compensation),
              listing = store.listings.find((l) => l.id === offer.listingId)!;
            return (
              <article className="offer" key={offer.id}>
                <div className="spread">
                  <strong>{store.sources.find((s) => s.id === offer.sourceId)?.name}</strong>
                  <span className="offer-price">{rateLabel(offer.compensation)}</span>
                </div>
                <dl className="facts">
                  <div>
                    <dt>Advertised gross total</dt>
                    <dd>{money(pay.gross)}</dd>
                  </div>
                  <div>
                    <dt>Comparable hourly</dt>
                    <dd>{money(pay.hourly)}</dd>
                  </div>
                  <div>
                    <dt>After direct expenses</dt>
                    <dd>{money(pay.afterExpenses)}</dd>
                  </div>
                  <div>
                    <dt>Superannuation</dt>
                    <dd>{offer.compensation.super}</dd>
                  </div>
                  <div>
                    <dt>Payment arrangement</dt>
                    <dd>{offer.compensation.arrangement}</dd>
                  </div>
                  <div>
                    <dt>On-call</dt>
                    <dd>{offer.compensation.onCall}</dd>
                  </div>
                </dl>
                <div className="perks">
                  <span>
                    <Plane size={14} />
                    Flights: {offer.flights}
                  </span>
                  <span>
                    <House size={14} />
                    Stay: {offer.accommodation}
                  </span>
                </div>
                <ul className="small muted">
                  {pay.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
                <p className="small">{offer.contact || 'Recruiter contact not recorded'}</p>
                {listing?.url && (
                  <a
                    className="button secondary"
                    href={listing.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Original advertisement <ExternalLink size={14} />
                  </a>
                )}
                <PayScenario offer={offer} />
                <p className="small">
                  <Badge tone={['withdrawn', 'filled'].includes(listing?.status) ? 'amber' : ''}>
                    {listing?.status}
                  </Badge>
                  {['withdrawn', 'filled'].includes(listing?.status) &&
                    ' · Excluded from ranking and financial filters'}
                </p>
                <details className="details-block">
                  <summary>Source evidence & observation history</summary>
                  <p className="small">
                    Source reference: {listing?.externalId}
                    <br />
                    First seen: {listing?.firstSeenAt}
                    <br />
                    Last observed: {listing?.observedAt}
                  </p>
                  <pre className="evidence">{listing?.rawText}</pre>
                  <dl className="evidence-fields">
                    {Object.entries(listing?.evidence || {}).map(([field, text]) => (
                      <div key={field}>
                        <dt>{field}</dt>
                        <dd>{text}</dd>
                      </div>
                    ))}
                  </dl>
                  {store.observations
                    .filter((v) => v.listingId === listing?.id)
                    .map((v) => (
                      <details key={v.id}>
                        <summary className="small">
                          Observed {new Date(v.observedAt).toLocaleString('en-AU')} ·{' '}
                          {rateLabel(v.snapshot.compensation)}
                        </summary>
                        <pre className="evidence">{JSON.stringify(v.snapshot, null, 2)}</pre>
                      </details>
                    ))}
                </details>
                {offers.length > 1 && !o.demo && (
                  <button
                    className="text-button small"
                    onClick={async () => {
                      try {
                        await api({ command: 'split', listingId: offer.listingId });
                        await onReload();
                        onClose();
                        notify('Listing separated; its source history was retained.');
                      } catch (e) {
                        notify((e as Error).message);
                      }
                    }}
                  >
                    <Split size={14} />
                    This is a different vacancy
                  </button>
                )}
              </article>
            );
          })}
        </div>
      </section>
      <section className="detail-section">
        <h3>Why it appears here</h3>
        <p className="muted">
          {job.ranking.evidence}% of scoring dimensions have evidence. {job.ranking.weightCoverage}%
          of your chosen weight is supported. Missing dimensions are omitted and the remaining
          weights are normalised.
        </p>
        <ul className="reason-list">
          {job.ranking.explanations.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <p className="small muted">
          Location interest: {f.adventureNote}. Clinical score measures specialty preference, not
          training accreditation.
        </p>
      </section>
      <section className="detail-section">
        <h3>Your next step</h3>
        <div className="form-grid">
          <label>
            Application status
            <select value={stage} onChange={(e) => setStage(e.target.value as Stage)}>
              {stages.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <div className="small muted align-end">
            Updating the tracker does not contact a recruiter or submit an application.
          </div>
        </div>
        <label>
          Private notes
          <textarea
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Questions, terms to confirm, or reasons this job stands out…"
          />
        </label>
        <button className="button primary" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save tracker & notes'}
          <ArrowUpRight size={16} />
        </button>
      </section>
      {!o.demo && (
        <div className="danger-zone">
          {!deleting ? (
            <button className="text-button danger" onClick={() => setDeleting(true)}>
              <Trash2 size={15} />
              Remove this opportunity and its imported records
            </button>
          ) : (
            <>
              <p>
                Delete this opportunity, its offers, notes, original text and observation history
                from your workspace?
              </p>
              <div className="button-row">
                <button
                  className="button danger"
                  onClick={async () => {
                    try {
                      await api({ command: 'delete', opportunityId: o.id });
                      await onReload();
                      onClose();
                      notify('Opportunity and its imported records deleted.');
                    } catch (e) {
                      notify((e as Error).message);
                    }
                  }}
                >
                  Delete records
                </button>
                <button className="button secondary" onClick={() => setDeleting(false)}>
                  Keep it
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
