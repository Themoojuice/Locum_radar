'use client';
import { useEffect, useRef, useState } from 'react';
import { Activity, ExternalLink, RefreshCw } from 'lucide-react';
import type { Store } from '@/domain/model';
import { api, Badge } from './shared';
import { jobPool } from '@/domain/job-pool';
import { ProviderSetup } from './provider-setup';

/*
 * Agency job boards with a structured feed (Medrecruit, 1Medical, Wavelength,
 * Adzuna). Everything else arrives through the Recruiter inbox: agency emails,
 * a Gmail label, or adverts pasted in. Generic page crawling is not offered in
 * the app; `npm run collect` remains for advanced use.
 */
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
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const [diagnostics, setDiagnostics] = useState<Record<string, string>>({});
  const stop = useRef(false);
  useEffect(
    () => () => {
      stop.current = true;
    },
    [],
  );
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
                s.reasons.filter((r) => !/Access review|collection is off/i.test(r)).join(' · ') ||
                  (s.state === 'waiting' && s.nextAttempt
                    ? `Next automatic check ${new Date(s.nextAttempt).toLocaleString('en-AU')}`
                    : ''),
              ],
            ),
          ),
        ),
      )
      .catch(() => {});
  }, [demo, store]);
  const pool = jobPool(store);
  const boards = store.sources.filter((s) => s.method === 'json-api');

  async function collect(id: string) {
    stop.current = false;
    let run;
    do {
      run = await api({ command: 'collect', sourceId: id });
      setProgress(run.message);
      await reload();
    } while (!stop.current && run.status === 'partial' && run.remaining && !run.limited);
    notify(run.message);
  }
  async function setEnabled(id: string, enabled: boolean) {
    setBusy(id);
    try {
      await api({
        command: 'source',
        sourceId: id,
        permission: 'approved',
        permissionEvidence:
          'Owner switched on this agency job-board feed in Locum Radar (structured public listings, paced requests).',
        enabled,
      });
      await reload();
      if (enabled) await collect(id);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <p>
        These agency job boards are checked directly, about once a day while the app is open.
        Everything else, including other agencies, recruiter texts and screenshots, comes in through
        the <strong>Recruiter inbox</strong>.
      </p>
      {progress && (
        <div className="panel" role="status">
          {progress}
        </div>
      )}
      <div className="source-list">
        {boards.map((source) => {
          const listed = pool.filter((item) => item.sources.includes(source.id)).length;
          const on = source.enabled && source.permission === 'approved';
          return (
            <article className="source-card panel" key={source.id}>
              <div className="source-symbol">
                <Activity size={21} />
              </div>
              <div className="source-main">
                <div className="button-row">
                  <h3>{source.name}</h3>
                  <Badge tone={source.error ? 'amber' : on ? 'green' : ''}>
                    {source.error ? 'Needs attention' : on ? 'On' : 'Off'}
                  </Badge>
                </div>
                <p className="small muted">
                  {listed} jobs in your list ·{' '}
                  {source.lastSuccess
                    ? `last checked ${new Date(source.lastSuccess).toLocaleString('en-AU')}`
                    : 'not checked yet'}
                </p>
                {diagnostics[source.id] && <p className="small">{diagnostics[source.id]}</p>}
                {source.error && <p className="error small">{source.error}</p>}
                {source.id === 'adzuna' && !demo && (
                  <details className="small">
                    <summary>Adzuna needs a free API key</summary>
                    <ProviderSetup kind="adzuna" />
                  </details>
                )}
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
                {!demo && (
                  <>
                    <label className="checkbox-row small">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={!!busy}
                        onChange={(e) => void setEnabled(source.id, e.target.checked)}
                        aria-label={`Check ${source.name} automatically`}
                      />
                      Check automatically
                    </label>
                    <button
                      className="button secondary small"
                      disabled={!!busy || !on}
                      onClick={async () => {
                        setBusy(source.id);
                        try {
                          await collect(source.id);
                        } catch (e) {
                          notify((e as Error).message);
                        } finally {
                          setBusy(null);
                        }
                      }}
                    >
                      <RefreshCw size={15} /> Check now
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {store.runs.length > 0 && (
        <details className="panel">
          <summary>Recent checks</summary>
          {[...store.runs]
            .filter((r) => boards.some((b) => b.id === r.sourceId))
            .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
            .slice(0, 15)
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
            ))}
        </details>
      )}
    </>
  );
}
