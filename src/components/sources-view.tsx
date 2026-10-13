'use client';
import { useMemo, useState } from 'react';
import {
  Activity,
  ExternalLink,
  FlaskConical,
  Gauge,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { specialties, type Source, type Store } from '@/domain/model';
import { coverageReport, marketTrends } from '@/domain/coverage';
import { api, Badge, Modal, money } from './shared';

interface SourceTest {
  ok: boolean;
  message: string;
  read: number;
  valid: number;
  samples: { title: string; valid: boolean; issues: string[]; fields: Record<string, string> }[];
}
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

/** Coverage dashboard and source registry (spec §2, §9 "Coverage dashboard", §14). */
export function SourcesView({
  store,
  demo,
  reload,
  notify,
}: {
  store: Store;
  demo: boolean;
  reload: () => Promise<void>;
  notify: (v: string) => void;
}) {
  const [edit, setEdit] = useState<Source | null>(null),
    [busy, setBusy] = useState(''),
    [test, setTest] = useState<{ name: string; result: SourceTest } | null>(null),
    [trendSpecialty, setTrendSpecialty] = useState('');
  const report = useMemo(() => coverageReport(store), [store]);
  const trend = useMemo(
    () => marketTrends(store, trendSpecialty || undefined),
    [store, trendSpecialty],
  );
  const byId = new Map(store.sources.map((s) => [s.id, s]));
  const est = report.estimate;
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  const maxCount = Math.max(1, ...trend.map((t) => t.count));
  const rates = trend.map((t) => t.medianHourly).filter((v): v is number => v !== null);
  const [rMin, rMax] = rates.length
    ? [Math.min(...rates) * 0.95, Math.max(...rates) * 1.05]
    : [0, 1];

  return (
    <>
      <div className="page-intro">
        <p className="eyebrow">KNOW YOUR BLIND SPOTS</p>
        <h1>How much of the market can you see?</h1>
        <p>
          Every number here describes what your sources have shown you. Unobserved is not the same
          as empty.
        </p>
      </div>

      <section className="coverage-hero panel">
        <div className="coverage-gauge">
          <p className="eyebrow">
            <Gauge size={14} /> ESTIMATED COVERAGE
          </p>
          {est ? (
            <>
              <strong>{pct(est.coverage)}</strong>
              <span>
                of advertised vacancies observed
                <br />
                <small>
                  range {pct(est.coverageLow)}–{pct(est.coverageHigh)} · read as an upper bound
                </small>
              </span>
            </>
          ) : (
            <span>
              An estimate needs two sources with at least three vacancies in common. Run two or more
              collectors, then resolve likely duplicates.
            </span>
          )}
        </div>
        <dl className="coverage-numbers">
          <div>
            <dt>Active vacancies observed</dt>
            <dd>{report.observed.toLocaleString('en-AU')}</dd>
          </div>
          <div>
            <dt>Estimated advertised market</dt>
            <dd>
              {est ? `${est.total.toLocaleString('en-AU')}` : '—'}
              {est && (
                <small>
                  {' '}
                  ({est.low.toLocaleString('en-AU')}–{est.high.toLocaleString('en-AU')})
                </small>
              )}
            </dd>
          </div>
          <div>
            <dt>Method</dt>
            <dd className="small">
              {est
                ? `Chapman capture–recapture on ${byId.get(est.basis.a)?.name} × ${byId.get(est.basis.b)?.name}: ${est.basis.n1} and ${est.basis.n2} vacancies, ${est.basis.m} in common.`
                : 'Capture–recapture across pairs of independent sources.'}
            </dd>
          </div>
        </dl>
        <ul className="caveats small">
          {report.caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <div className="spread">
          <h2>Sources</h2>
          <span className="small muted">Unique = vacancies you would lose without this source</span>
        </div>
        <div className="table-scroll">
          <table className="source-table">
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Active</th>
                <th scope="col">Unique</th>
                <th scope="col">Shared</th>
                <th scope="col">Parsed cleanly</th>
                <th scope="col">Recent runs OK</th>
                <th scope="col">Mostly</th>
                <th scope="col">Status</th>
                <th scope="col" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {report.perSource.map((p) => {
                const source = byId.get(p.id)!;
                const automatic = source.method !== 'manual' && source.type !== 'email';
                return (
                  <tr key={p.id}>
                    <th scope="row">
                      <span className="source-name">
                        <Activity size={15} />
                        {p.name}
                      </span>
                      <small className="muted">{p.focus}</small>
                    </th>
                    <td>{p.active}</td>
                    <td>
                      <strong>{p.unique}</strong>
                    </td>
                    <td>{p.shared}</td>
                    <td>
                      {pct(p.reliability)}
                      {p.pendingReview ? (
                        <small className="muted"> · {p.pendingReview} in review</small>
                      ) : null}
                    </td>
                    <td>{pct(p.successRate)}</td>
                    <td className="small">
                      {p.topSpecialties.map((t) => t.name).join(', ') || '—'}
                      {p.topStates.length ? (
                        <span className="muted">
                          {' '}
                          · {p.topStates.map((t) => t.name).join(', ')}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <Badge tone={source.error ? 'amber' : source.lastSuccess ? 'green' : ''}>
                        {source.error
                          ? 'Needs attention'
                          : source.lastSuccess
                            ? `OK ${new Date(source.lastSuccess).toLocaleDateString('en-AU')}`
                            : !automatic
                              ? source.type === 'email'
                                ? 'Inbox import'
                                : 'Manual only'
                              : source.permission === 'approved'
                                ? source.enabled
                                  ? 'Not yet run'
                                  : 'Approved, off'
                                : 'Access not recorded'}
                      </Badge>
                      {source.error && <p className="error small">{source.error}</p>}
                    </td>
                    <td className="row-actions">
                      {source.url && (
                        <a
                          className="icon-button"
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open ${source.name}`}
                        >
                          <ExternalLink size={16} />
                        </a>
                      )}
                      {!demo && automatic && (
                        <>
                          <button
                            className="button secondary small"
                            onClick={() => setEdit({ ...source })}
                          >
                            Access
                          </button>
                          <button
                            className="icon-button"
                            disabled={!!busy || source.permission !== 'approved'}
                            title="Test: read a few live pages and show what the parser extracts. Nothing is saved."
                            aria-label={`Test ${source.name}`}
                            onClick={() =>
                              run(`test-${source.id}`, async () => {
                                const result = (await api({
                                  command: 'test-source',
                                  sourceId: source.id,
                                })) as SourceTest;
                                setTest({ name: source.name, result });
                              })
                            }
                          >
                            <FlaskConical size={16} />
                          </button>
                          <button
                            className="icon-button"
                            disabled={!!busy || !source.enabled}
                            aria-label={`Collect ${source.name}`}
                            onClick={() =>
                              run(`collect-${source.id}`, async () => {
                                const r = await api({ command: 'collect', sourceId: source.id });
                                notify(r.message);
                                await reload();
                              })
                            }
                          >
                            <RefreshCw
                              size={16}
                              className={busy === `collect-${source.id}` ? 'spin' : ''}
                            />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {report.pairs.length > 1 && (
          <details className="pairs">
            <summary>Every pairwise estimate ({report.pairs.length})</summary>
            <p className="small muted">
              Disagreement between pairs shows how far sources depart from independence.
            </p>
            <ul>
              {report.pairs.map((p) => (
                <li key={`${p.a}-${p.b}`} className="small">
                  {byId.get(p.a)?.name} × {byId.get(p.b)?.name}: {p.n1} / {p.n2}, {p.m} shared → ~
                  {Math.round(p.total).toLocaleString('en-AU')} ({Math.round(p.low)}–
                  {Math.round(p.high)})
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <div className="coverage-grid">
        <section className="panel">
          <h2>Where you can see</h2>
          <p className="small muted">
            Public hospitals in the national directory with at least one observed vacancy.
          </p>
          {report.gaps.some((g) => g.publicHospitals) ? (
            <div className="state-bars">
              {report.gaps.map((g) => {
                const share = g.publicHospitals ? g.withVacancies / g.publicHospitals : 0;
                return (
                  <div key={g.state} className="state-bar">
                    <span>{g.state}</span>
                    <div className="bar">
                      <i style={{ width: `${Math.min(100, share * 100)}%` }} />
                    </div>
                    <span className="small">
                      {g.withVacancies}/{g.publicHospitals || '—'} · {g.vacancies} jobs
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="small">
              The national hospital directory loads on your first fetch; gaps appear once it has.
            </p>
          )}
        </section>
        <section className="panel">
          <div className="spread">
            <h2>
              <TrendingUp size={18} /> Market by placement month
            </h2>
            <select
              value={trendSpecialty}
              onChange={(e) => setTrendSpecialty(e.target.value)}
              aria-label="Trend specialty"
            >
              <option value="">All specialties</option>
              {specialties.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          {trend.length ? (
            <svg
              className="trend"
              viewBox="0 0 600 200"
              role="img"
              aria-label="Vacancies and median comparable hourly rate by month"
            >
              {trend.slice(-18).map((t, i, list) => {
                const w = 560 / list.length;
                const h = (t.count / maxCount) * 140;
                return (
                  <g key={t.month} transform={`translate(${30 + i * w}, 0)`}>
                    <rect
                      x={w * 0.15}
                      y={160 - h}
                      width={w * 0.7}
                      height={h}
                      rx="3"
                      className="trend-bar"
                    >
                      <title>{`${t.month}: ${t.count} vacancies${t.medianHourly ? `, median ${money(t.medianHourly)}/h (${t.rated} rated)` : ''}`}</title>
                    </rect>
                    <text x={w / 2} y={178} className="trend-label">
                      {t.month.slice(5)}
                    </text>
                    {i % 6 === 0 && (
                      <text x={w / 2} y={194} className="trend-label">
                        {t.month.slice(0, 4)}
                      </text>
                    )}
                  </g>
                );
              })}
              <polyline
                className="trend-line"
                points={trend
                  .slice(-18)
                  .map((t, i, list) =>
                    t.medianHourly === null
                      ? null
                      : `${30 + i * (560 / list.length) + 280 / list.length},${150 - ((t.medianHourly - rMin) / (rMax - rMin || 1)) * 130}`,
                  )
                  .filter(Boolean)
                  .join(' ')}
              />
            </svg>
          ) : (
            <p className="small">Trends appear once vacancies have been collected.</p>
          )}
          <p className="small muted">
            Bars: vacancies starting each month. Line: median best comparable hourly rate. Observed
            sources only.
          </p>
        </section>
      </div>

      <section className="panel">
        <h2>Recent collection runs</h2>
        {!store.runs.length ? (
          <p className="muted">No runs yet. An empty history does not establish live coverage.</p>
        ) : (
          store.runs.slice(0, 20).map((r) => (
            <div className="run-row" key={r.id}>
              <Badge tone={r.status === 'failed' ? 'amber' : r.status === 'success' ? 'green' : ''}>
                {r.status}
              </Badge>
              <span>{byId.get(r.sourceId)?.name}</span>
              <span className="muted small">{r.message}</span>
              <time className="small">{new Date(r.startedAt).toLocaleString('en-AU')}</time>
            </div>
          ))
        )}
      </section>

      {test && (
        <Modal title={`Test · ${test.name}`} onClose={() => setTest(null)} wide>
          <p className={test.result.ok ? '' : 'error'}>{test.result.message}</p>
          {test.result.samples.map((s, i) => (
            <article key={i} className="test-sample">
              <div className="spread">
                <strong>{s.title}</strong>
                <Badge tone={s.valid ? 'green' : 'amber'}>
                  {s.valid ? 'Imports automatically' : 'Goes to review'}
                </Badge>
              </div>
              <dl className="evidence-fields">
                {Object.entries(s.fields).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v || <span className="muted">—</span>}</dd>
                  </div>
                ))}
              </dl>
              {s.issues.length > 0 && (
                <ul className="reason-list small">
                  {s.issues.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              )}
            </article>
          ))}
          <p className="small muted">
            A test reads a few live pages through the same permission, robots and allowlist checks
            as collection. Nothing was saved.
          </p>
        </Modal>
      )}

      {edit && (
        <Modal title={`Access · ${edit.name}`} onClose={() => setEdit(null)}>
          <div className="notice">
            <ShieldCheck size={18} />
            <span>
              Record the source’s permission or applicable access terms. Personal use alone is not
              recorded as permission.
            </span>
          </div>
          <label>
            Access review
            <select
              value={edit.permission}
              onChange={(e) =>
                setEdit({ ...edit, permission: e.target.value as Source['permission'] })
              }
            >
              <option value="unreviewed">Not reviewed</option>
              <option value="approved">Permission established</option>
              <option value="denied">Automated access not permitted</option>
            </select>
          </label>
          <label>
            Permission evidence / terms reference
            <textarea
              value={edit.permissionEvidence}
              onChange={(e) => setEdit({ ...edit, permissionEvidence: e.target.value })}
              rows={5}
              placeholder="Who granted permission, when, and any limits (frequency, use)"
            />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={edit.enabled}
              onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })}
            />
            Collect automatically (every {edit.intervalHours} hours at most)
          </label>
          <p className="small muted">
            Every request is checked against the site’s robots rules and a fixed host allowlist. The
            server must also set COLLECTOR_ENABLED=true.
          </p>
          <button
            className="button primary"
            disabled={!!busy}
            onClick={() =>
              run('save', async () => {
                await api({
                  command: 'source',
                  sourceId: edit.id,
                  permission: edit.permission,
                  permissionEvidence: edit.permissionEvidence,
                  enabled: edit.enabled,
                });
                await reload();
                setEdit(null);
                notify('Source settings saved');
              })
            }
          >
            Save access settings
          </button>
        </Modal>
      )}
    </>
  );
}
