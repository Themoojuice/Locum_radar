'use client';
import { useState } from 'react';
import { Activity, ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react';
import type { Source, Store } from '@/domain/model';
import { api, Badge, Modal } from './shared';
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
          Manual and email imports work now. Scheduled public collection requires recorded source
          permission, an enabled adapter and the server’s collection switch. A source with no
          successful run is <strong>not monitored</strong>.
        </span>
      </div>
      <div className="source-list">
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
                  {source.method === 'jsonld'
                    ? 'Structured-page adapter · unverified against live board'
                    : 'Manual import'}{' '}
                  · {source.permission === 'approved' ? 'Access recorded' : 'Access not approved'}
                </p>
                {source.error && <p className="error small">{source.error}</p>}
                <p className="small">
                  {unique} observed vacancies · {exclusive} unique to this source ·{' '}
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
                {!demo && source.method === 'jsonld' && (
                  <>
                    <button
                      className="button secondary small"
                      onClick={() => setEdit({ ...source })}
                    >
                      Access settings
                    </button>
                    <button
                      className="icon-button"
                      disabled={busy || !source.enabled}
                      aria-label={`Collect ${source.name}`}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const run = await api({ command: 'collect', sourceId: source.id });
                          notify(run.message);
                          await reload();
                        } catch (e) {
                          notify((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <RefreshCw size={17} />
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
          store.runs.slice(0, 20).map((r) => (
            <div className="run-row" key={r.id}>
              <Badge tone={r.status === 'failed' ? 'amber' : r.status === 'success' ? 'green' : ''}>
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
        <Modal title={`Access · ${edit.name}`} onClose={() => setEdit(null)}>
          <p className="muted">
            Record the source’s permission or applicable access terms. Personal use alone is not
            recorded as permission.
          </p>
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
              placeholder="Applicable terms URL or permission from the source, review date, and limits"
            />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={edit.enabled}
              onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })}
            />
            Enable this adapter (24-hour minimum interval)
          </label>
          <p className="small muted">
            The adapter supports JobPosting structured data only. Unsupported pages are reported as
            failures; extracted records go to review. The server must also set
            COLLECTOR_ENABLED=true.
          </p>
          <button
            className="button primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
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
              } catch (e) {
                notify((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Save access settings
          </button>
        </Modal>
      )}
    </>
  );
}
