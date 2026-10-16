'use client';
import { useState, useEffect, useRef } from 'react';
import { Activity, ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react';
import type { Source, Store } from '@/domain/model';
import { api, Badge, Modal } from './shared';
import { jobPool } from '@/domain/job-pool';
import { sourceSetup } from '@/domain/source-setup';
import { ProviderSetup } from './provider-setup';
import { configForSource } from '@/domain/source-catalog';
import { collectorConfigSchema } from '@/domain/acquisition';
import { CollectorSettings, GmailConnection } from './acquisition-settings';
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
    [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false),
    [name, setName] = useState(''),
    [custom, setCustom] = useState(collectorConfigSchema.parse({ kind: 'feed' }));
  const stop = useRef(false);
  const [progress, setProgress] = useState('');
  useEffect(
    () => () => {
      stop.current = true;
    },
    [],
  );
  const pool = jobPool(store);
  const [diagnostics, setDiagnostics] = useState<Record<string, string>>({});
  useEffect(() => {
    if (demo) return;
    fetch('/api/collection')
      .then((r) => r.json())
      .then((v) =>
        setDiagnostics(
          Object.fromEntries(
            (v.sources || []).map(
              (s: { id: string; reasons: string[]; state: string; nextAttempt: string | null }) => [
                s.id,
                s.reasons.length
                  ? s.reasons.join(' · ')
                  : s.state === 'waiting'
                    ? 'Waiting for the next refresh' +
                      (s.nextAttempt ? ': ' + new Date(s.nextAttempt).toLocaleString() : '')
                    : 'Ready to collect',
              ],
            ),
          ),
        ),
      )
      .catch(() => {});
  }, [demo, store]);
  async function collectSource(id: string) {
    stop.current = false;
    let run;
    do {
      run = await api({ command: 'collect', sourceId: id });
      setProgress(run.message);
      notify(run.message);
      await reload();
    } while (!stop.current && run.status === 'partial' && run.remaining && !run.limited);
    if (stop.current) setProgress('Paused after this batch. Collect now resumes saved progress.');
  }
  return (
    <>
      <div className="page-intro">
        <p className="eyebrow">KNOW YOUR BLIND SPOTS</p>
        <h1>A clear view of your sources.</h1>
        <p>
          Public visibility, access permission, collector support and current vacancies are tracked
          separately.
        </p>
      </div>
      <div className="notice">
        <ShieldCheck size={18} />
        <span>
          Start with Gmail or a public board. Each source explains what it needs and whether its
          collector has worked. A source with no successful run is <strong>not yet verified</strong>
          .
        </span>
      </div>
      {progress && (
        <div className="panel" role="status">
          {progress}
          {busy && (
            <button
              className="button secondary"
              onClick={() => {
                stop.current = true;
                setProgress('Pausing after this batch…');
              }}
            >
              Pause collection
            </button>
          )}
        </div>
      )}
      <div className="source-list">
        {!demo && (
          <section className="panel">
            <h2>Build your source coverage</h2>
            <p>
              Add the prepared agency, rural, API, Gmail and forum-search recipes. Each shows what
              has been checked and what still needs setup.
            </p>
            <div className="button-row">
              <button
                className="button primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api({ command: 'catalog' });
                    await reload();
                    notify(
                      'Collector recipes added. Review each source’s settings before enabling.',
                    );
                  } catch (e) {
                    notify((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Add / update collector recipes
              </button>
              <button className="button secondary" onClick={() => setAdding(true)}>
                Add a custom source
              </button>
            </div>
          </section>
        )}
        {!demo && <GmailConnection store={store} reload={reload} />}
        {store.sources.map((source) => {
          const offers = store.offers.filter((o) => o.sourceId === source.id),
            unique = new Set(offers.map((o) => o.opportunityId)).size,
            exclusive = [...new Set(offers.map((o) => o.opportunityId))].filter(
              (id) => !store.offers.some((o) => o.opportunityId === id && o.sourceId !== source.id),
            ).length;
          return (
            <article className="source-card panel" key={source.id}>
              <div className="source-symbol">
                <Activity size={21} />
              </div>
              <div className="source-main">
                <div className="button-row">
                  <h3>{source.name}</h3>
                  <Badge tone={source.error ? 'amber' : source.lastSuccess ? 'green' : ''}>
                    {source.error
                      ? 'Needs attention'
                      : source.lastSuccess
                        ? 'Last run succeeded'
                        : source.type === 'manual' || source.type === 'email'
                          ? 'Import ready'
                          : 'Not monitored'}
                  </Badge>
                </div>
                <p className="small muted">
                  {source.type} ·{' '}
                  {source.method === 'json-api'
                    ? 'Source-specific agency/API adapter'
                    : source.method !== 'manual'
                      ? `${configForSource(source)?.kind || 'Structured-page'} collector`
                      : 'Manual import'}{' '}
                </p>
                <ol className="small">
                  {sourceSetup(source).map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                {diagnostics[source.id] && (
                  <p className="small">
                    <strong>Next step:</strong> {diagnostics[source.id]}
                  </p>
                )}
                {source.error && <p className="error small">{source.error}</p>}
                <p className="small">
                  {pool.filter((item) => item.sources.includes(source.id)).length} browsable adverts
                  · {unique} confirmed vacancies · {exclusive} unique to this source ·{' '}
                  {source.lastSuccess
                    ? `Last successful collection: ${new Date(source.lastSuccess).toLocaleString('en-AU')}`
                    : 'No successful collection recorded'}
                </p>
              </div>
              <div className="source-actions">
                {source.url && (
                  <a
                    className="icon-button"
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${source.name}`}
                  >
                    <ExternalLink size={17} />
                  </a>
                )}
                {!demo && (configForSource(source) || source.method !== 'manual') && (
                  <>
                    <button
                      className="button secondary small"
                      onClick={() =>
                        setEdit({
                          ...source,
                          collector:
                            source.method === 'json-api'
                              ? undefined
                              : structuredClone(configForSource(source)),
                        })
                      }
                    >
                      Set up source
                    </button>
                    <button
                      className="icon-button"
                      disabled={busy || !source.enabled}
                      aria-label={`Collect ${source.name}`}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await collectSource(source.id);
                        } catch (e) {
                          notify((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <RefreshCw size={17} /> Collect now
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
      <section className="panel">
        <h2>Recent collection runs</h2>
        {!store.runs.length ? (
          <p className="muted">No runs yet. An empty history does not establish live coverage.</p>
        ) : (
          [...store.runs]
            .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
            .slice(0, 20)
            .map((r) => (
              <div className="run-row" key={r.id}>
                <Badge
                  tone={r.status === 'failed' ? 'amber' : r.status === 'success' ? 'green' : ''}
                >
                  {r.status}
                </Badge>
                <span>{store.sources.find((s) => s.id === r.sourceId)?.name}</span>
                <span className="muted small">{r.message}</span>
                <time className="small">{new Date(r.startedAt).toLocaleString('en-AU')}</time>
              </div>
            ))
        )}
      </section>
      {edit && (
        <Modal title={`Set up · ${edit.name}`} onClose={() => setEdit(null)}>
          <ol>
            {sourceSetup(edit).map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {['adzuna', 'search'].includes(configForSource(edit)?.kind || '') && (
            <ProviderSetup kind={configForSource(edit)?.kind as 'adzuna' | 'search'} />
          )}
          {edit.id === 'gmail-label' && (
            <a className="button secondary" href="#gmail-import" onClick={() => setEdit(null)}>
              Open Gmail import
            </a>
          )}
          <details>
            <summary>
              Access settings {edit.permission === 'denied' ? '— specific permission required' : ''}
            </summary>
            <p className="small">
              Collection uses prepared source limits and honours robots rules. If automated access
              has been refused, use emails or record specific permission here.
            </p>
            <label>
              Access review
              <select
                value={edit.permission}
                onChange={(e) =>
                  setEdit({ ...edit, permission: e.target.value as Source['permission'] })
                }
              >
                <option value="unreviewed">Public-board setup</option>
                <option value="approved">Access recorded</option>
                <option value="denied">Automated access not permitted</option>
              </select>
            </label>
            <label>
              Access notes or specific permission reference
              <textarea
                value={edit.permissionEvidence}
                onChange={(e) => setEdit({ ...edit, permissionEvidence: e.target.value })}
              />
            </label>
          </details>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={edit.enabled}
              onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })}
            />
            Enable automatic collection (normally once a day)
          </label>
          <p className="small muted">
            Save & collect now enables this source and follows saved batches. New adverts appear on
            Discover. A recently refreshed source will report when it can run again.
          </p>
          {edit.collector && (
            <details>
              <summary>Advanced page and search settings</summary>
              <CollectorSettings
                value={edit.collector}
                change={(collector) => setEdit({ ...edit, collector })}
              />
            </details>
          )}
          <button
            className="button primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api({
                  command: 'source',
                  sourceId: edit.id,
                  permission: edit.permission === 'denied' ? 'denied' : 'approved',
                  permissionEvidence:
                    edit.permissionEvidence ||
                    'User enabled collection of public advertisements with prepared collector limits.',
                  enabled: true,
                  collector: edit.collector,
                });
                await reload();
                setEdit(null);
                await collectSource(edit.id);
              } catch (e) {
                notify((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Save & collect now
          </button>
          <button
            className="button secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api({
                  command: 'source',
                  sourceId: edit.id,
                  permission: edit.permission === 'denied' ? 'denied' : 'approved',
                  permissionEvidence:
                    edit.permissionEvidence || 'User configured public-board collection.',
                  enabled: edit.enabled,
                  collector: edit.collector,
                });
                await reload();
                setEdit(null);
                notify('Settings saved');
              } catch (e) {
                notify((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Save settings only
          </button>
          <button
            className="button secondary"
            disabled={busy || edit.enabled}
            onClick={async () => {
              if (
                !window.confirm(
                  'Clear this source’s collected evidence and extraction reviews? Imported vacancies and notes will remain.',
                )
              )
                return;
              try {
                await api({ command: 'clear-evidence', sourceId: edit.id });
                await reload();
                setEdit(null);
                notify('Collected evidence cleared');
              } catch (e) {
                notify((e as Error).message);
              }
            }}
          >
            Clear collected evidence
          </button>
        </Modal>
      )}
      {adding && (
        <Modal title="Add a source" onClose={() => setAdding(false)}>
          <label>
            Source name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <CollectorSettings value={custom} change={setCustom} />
          <button
            className="button primary"
            disabled={busy || !name.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await api({ command: 'add-source', name, collector: custom });
                await reload();
                setAdding(false);
                notify('Source added. Review access and enable it in Collection settings.');
              } catch (e) {
                notify((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Add source
          </button>
        </Modal>
      )}
    </>
  );
}
