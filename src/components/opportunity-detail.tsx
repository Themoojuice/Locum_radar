'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  CalendarCheck,
  ClipboardCopy,
  ExternalLink,
  Mail,
  Plane,
  Route,
  ShieldCheck,
  Sparkles,
  Split,
  Trash2,
} from 'lucide-react';
import {
  stages,
  type Compensation,
  type Observation,
  type Offer,
  type RadarEvent,
  type SourceListing,
  type Stage,
  type Store,
} from '@/domain/model';
import { earnings, normalisePay, type EvaluatedJob, type Figure } from '@/domain/engine';
import { facilityIntelligence } from '@/domain/coverage';
import { enquiryDraft } from '@/domain/insights';
import { api, Badge, dateLabel, Modal, money, rateLabel } from './shared';
import { eligTone, Indicators, ScoreRing } from './opportunity-card';

const kindLabel: Record<Figure['kind'], string> = {
  advertised: 'stated',
  calculated: 'calculated',
  estimated: 'estimate',
  unknown: 'unknown',
};
function FigureRow({ label, f }: { label: string; f: Figure }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {f.value === null ? <span className="muted">Unknown</span> : money(f.value)}{' '}
        <span className={`figure-kind ${f.kind}`} title={f.note}>
          {kindLabel[f.kind]}
        </span>
      </dd>
    </div>
  );
}
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
  // Full evidence is fetched per opportunity; the feed carries metadata only.
  const [evidence, setEvidence] = useState<{
    listings: SourceListing[];
    observations: Observation[];
    events: RadarEvent[];
  } | null>(o.demo ? { listings: job.listings, observations: [], events: [] } : null);
  useEffect(() => {
    if (o.demo) return;
    let live = true;
    fetch(`/api/radar/detail?opportunity=${encodeURIComponent(o.id)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => live && v && setEvidence(v))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [o.id, o.demo]);
  const intel = useMemo(() => facilityIntelligence(store, f), [store, f]);
  const enquiry = useMemo(() => enquiryDraft(job, store.profile), [job, store.profile]);
  const email = offers.map((v) => v.contact.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0]).find(Boolean);
  const sourceName = (id: string) => store.sources.find((s) => s.id === id)?.name ?? id;

  async function save(next = stage) {
    setBusy(true);
    try {
      await onAction(o.id, next, notes);
      setStage(next);
      notify('Tracker updated');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const checkGroups = job.eligibility.checks.reduce<Record<string, typeof job.eligibility.checks>>(
    (acc, c) => ({ ...acc, [c.dimension]: [...(acc[c.dimension] ?? []), c] }),
    {},
  );
  return (
    <Modal title={f.name} onClose={onClose} wide>
      <div className="detail-heading">
        <div>
          <p className="eyebrow">
            {f.town}, {f.state}
            {job.logistics.distanceKm !== null
              ? ` · ${job.logistics.distanceKm.toLocaleString('en-AU')} KM FROM HOME`
              : ''}{' '}
            · {o.demo ? 'ILLUSTRATIVE EXAMPLE' : 'YOUR WORKSPACE'}
          </p>
          <h2>{o.title}</h2>
          <p>
            {dateLabel(o.startDate)} – {dateLabel(o.endDate, true)}
            {o.shifts?.length ? ` · ${o.shifts.length} listed shifts` : ''}
            {o.flexibility === 'flexible' ? ' · flexible dates' : ''} · {job.urgency.toLowerCase()}
          </p>
        </div>
        <ScoreRing job={job} large />
      </div>
      <Indicators job={job} />

      <section className="four-questions">
        <article>
          <h3>
            <ShieldCheck size={16} /> Are you eligible?
            <Badge tone={eligTone(job.eligibility.status)}>{job.eligibility.status}</Badge>
          </h3>
          {Object.keys(checkGroups).length ? (
            <ul className="check-list">
              {Object.entries(checkGroups).map(([dimension, list]) =>
                list.map((c) => (
                  <li key={dimension + c.text} className={c.status}>
                    <span>{dimension}</span>
                    {c.text}
                  </li>
                )),
              )}
            </ul>
          ) : (
            <p className="small">{job.eligibility.reasons.join(' ')}</p>
          )}
          {job.eligibility.status === 'Likely eligible' && (
            <p className="small muted">{job.eligibility.reasons[0]}</p>
          )}
        </article>
        <article>
          <h3>
            <CalendarCheck size={16} /> Can you do the dates?
            <Badge
              tone={
                job.scheduling.status === 'Fits'
                  ? 'green'
                  : job.scheduling.status === 'Conflict'
                    ? 'red'
                    : 'amber'
              }
            >
              {job.scheduling.status}
            </Badge>
          </h3>
          <ul className="reason-list small">
            {[...job.scheduling.conflicts, ...job.scheduling.reasons].map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </article>
        <article>
          <h3>
            <Route size={16} /> Can it be arranged?
            <Badge
              tone={
                job.logistics.status === 'Straightforward'
                  ? 'green'
                  : job.logistics.status === 'Excluded'
                    ? 'red'
                    : 'amber'
              }
            >
              {job.logistics.status}
            </Badge>
          </h3>
          <ul className="reason-list small">
            {job.logistics.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </article>
        <article>
          <h3>
            <Sparkles size={16} /> Is it worth it?
            <Badge tone={job.ranking.assessable ? 'green' : 'amber'}>
              {job.ranking.assessable ? `${job.ranking.score} / 100` : 'Hard to assess'}
            </Badge>
          </h3>
          <ul className="reason-list small">
            {job.ranking.summary.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {job.ranking.missing.length > 0 && (
            <p className="small muted">
              No evidence yet for: {job.ranking.missing.join(', ').toLowerCase()}. Those weights are
              left out, not scored as zero.
            </p>
          )}
        </article>
      </section>

      <section className="detail-section">
        <div className="spread">
          <h3>
            {offers.length} recruiter offer{offers.length === 1 ? '' : 's'}
          </h3>
          <span className="small muted">AUD, before personal income tax</span>
        </div>
        <div className="offer-grid">
          {offers.map((offer) => {
            const e = earnings(offer, o, store.profile, job.logistics.local);
            const listing =
              evidence?.listings.find((l) => l.id === offer.listingId) ??
              job.listings.find((l) => l.id === offer.listingId);
            const inactive = ['withdrawn', 'filled'].includes(listing?.status ?? '');
            return (
              <article className={`offer ${inactive ? 'inactive' : ''}`} key={offer.id}>
                <div className="spread">
                  <strong>{sourceName(offer.sourceId)}</strong>
                  <span className="offer-price">{rateLabel(offer.compensation)}</span>
                </div>
                <dl className="facts">
                  <div>
                    <dt>Comparable hourly</dt>
                    <dd>{money(e.hourly)}</dd>
                  </div>
                  <FigureRow label="Gross for the placement" f={e.gross} />
                  <FigureRow label="Travel" f={e.flights} />
                  <FigureRow label="Accommodation" f={e.accommodation} />
                  <FigureRow label="Expected after costs" f={e.net} />
                  {e.opportunityCost.value !== null && (
                    <FigureRow label="Value of travel time" f={e.opportunityCost} />
                  )}
                  <div>
                    <dt>Super · on-call · arrangement</dt>
                    <dd>
                      {offer.compensation.super} · {offer.compensation.onCall} ·{' '}
                      {offer.compensation.arrangement}
                    </dd>
                  </div>
                </dl>
                <p className="small">
                  <Badge
                    tone={e.confidence === 'High' ? 'green' : e.confidence === 'Low' ? 'amber' : ''}
                  >
                    {e.confidence} confidence
                  </Badge>
                </p>
                {(e.assumptions.length > 0 || e.warnings.length > 0) && (
                  <ul className="small muted">
                    {[...e.assumptions, ...e.warnings].map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
                <div className="perks">
                  <span>
                    <Plane size={14} /> Flights: {offer.flights}
                  </span>
                  <span>Stay: {offer.accommodation}</span>
                </div>
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
                {inactive && (
                  <p className="small">
                    <Badge tone="amber">{listing?.status}</Badge> Excluded from ranking and
                    financial filters.
                  </p>
                )}
                <details className="details-block">
                  <summary>Source evidence & observation history</summary>
                  {!evidence ? (
                    <p className="small muted">Loading source evidence…</p>
                  ) : (
                    <>
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
                      {evidence.observations
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
                    </>
                  )}
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
                      } catch (err) {
                        notify((err as Error).message);
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

      <section className="detail-section two-col">
        <div>
          <h3>About this hospital</h3>
          <dl className="intel">
            <div>
              <dt>Vacancies observed here</dt>
              <dd>
                {intel.total} across {intel.months} month{intel.months === 1 ? '' : 's'}
                {intel.recurring ? ' · recurring need' : ''}
              </dd>
            </div>
            <div>
              <dt>Comparable hourly seen</dt>
              <dd>
                {intel.rate
                  ? `${money(intel.rate.min)}–${money(intel.rate.max)}, median ${money(intel.rate.median)} (${intel.rate.n})`
                  : 'None comparable yet'}
              </dd>
            </div>
            <div>
              <dt>Agencies</dt>
              <dd>{intel.sources.map((s) => `${s.name} (${s.count})`).join(', ') || '—'}</dd>
            </div>
            {f.biodiversity && (
              <div>
                <dt>Nature lens</dt>
                <dd>
                  {f.biodiversity.species} {f.biodiversity.taxon} species,{' '}
                  {f.biodiversity.records.toLocaleString('en-AU')} records within{' '}
                  {f.biodiversity.radiusKm} km (Atlas of Living Australia)
                </dd>
              </div>
            )}
          </dl>
          {evidence?.events.length ? (
            <>
              <h4>History</h4>
              <ul className="event-list small">
                {evidence.events
                  .slice(-8)
                  .reverse()
                  .map((e) => (
                    <li key={e.id}>
                      <time>{new Date(e.at).toLocaleDateString('en-AU')}</time> {e.detail}{' '}
                      <span className="muted">({sourceName(e.sourceId)})</span>
                    </li>
                  ))}
              </ul>
            </>
          ) : null}
        </div>
        <div>
          <h3>
            <Mail size={16} /> Enquiry draft
          </h3>
          <p className="small muted">
            Built from what the record does not yet establish. Nothing is sent from here.
          </p>
          <textarea
            className="enquiry"
            readOnly
            rows={10}
            value={`Subject: ${enquiry.subject}\n\n${enquiry.body}`}
          />
          <div className="button-row">
            <button
              className="button secondary small"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(`${enquiry.subject}\n\n${enquiry.body}`);
                  notify('Enquiry copied');
                } catch {
                  notify('Copy failed; select the text instead.');
                }
              }}
            >
              <ClipboardCopy size={14} /> Copy
            </button>
            {email && (
              <a
                className="button secondary small"
                href={`mailto:${email}?subject=${encodeURIComponent(enquiry.subject)}&body=${encodeURIComponent(enquiry.body)}`}
              >
                <Mail size={14} /> Open in mail
              </a>
            )}
            {!o.demo && (stage === 'Discovered' || stage === 'Saved') && (
              <button
                className="text-button small"
                disabled={busy}
                onClick={() => save('Enquiry sent')}
              >
                I sent it — mark as enquiry sent
              </button>
            )}
          </div>
        </div>
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
        <button className="button primary" disabled={busy} onClick={() => save()}>
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
