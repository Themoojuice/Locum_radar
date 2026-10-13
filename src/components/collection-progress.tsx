'use client';
import { useEffect, useRef, useState } from 'react';
import { Radio, RefreshCw, ExternalLink } from 'lucide-react';
import type { CollectionPlan } from '@/domain/collection';
import type { CollectionRun } from '@/domain/model';
import { api, Badge } from './shared';

async function getPlan(): Promise<CollectionPlan> {
  const response = await fetch('/api/collection', { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not read source progress');
  return data;
}
const when = (value: string) => new Date(value).toLocaleString('en-AU');

export function CollectionProgress({
  demo,
  reload,
  onSettings,
}: {
  demo: boolean;
  reload: () => Promise<void>;
  onSettings: () => void;
}) {
  const [plan, setPlan] = useState<CollectionPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [current, setCurrent] = useState('');
  const [results, setResults] = useState<{ name: string; status: string; message: string }[]>([]);
  const [total, setTotal] = useState(0);
  const stop = useRef(false),
    running = useRef(false);
  useEffect(() => {
    let active = true;
    getPlan()
      .then((value) => {
        if (active) setPlan(value);
      })
      .catch((error) => {
        if (active) setMessage(error.message);
      });
    return () => {
      active = false;
      stop.current = true;
    };
  }, []);
  async function search() {
    if (running.current || demo) return;
    running.current = true;
    stop.current = false;
    setBusy(true);
    setMessage('Preparing the remaining sources…');
    setResults([]);
    setTotal(0);
    let processed = 0,
      succeeded = 0,
      failed = 0,
      skipped = 0;
    try {
      const fresh = await getPlan();
      setPlan(fresh);
      const queue = fresh.sources
        .filter((s) => s.state === 'ready')
        .sort((a, b) => Number(!!a.lastSuccess) - Number(!!b.lastSuccess));
      setTotal(queue.length);
      if (!queue.length) {
        setMessage('No sources are ready to search. See the setup and refresh details below.');
        return;
      }
      for (const source of queue) {
        if (stop.current) break;
        setCurrent(source.id);
        setMessage(`Searching ${source.name} (${processed + 1} of ${queue.length})…`);
        try {
          const run: CollectionRun = await api({ command: 'collect', sourceId: source.id });
          if (run.status === 'success') succeeded++;
          else if (run.status === 'failed') failed++;
          else skipped++;
          setResults((previous) => [
            ...previous,
            { name: source.name, status: run.status, message: run.message },
          ]);
        } catch (error) {
          failed++;
          setResults((previous) => [
            ...previous,
            { name: source.name, status: 'failed', message: (error as Error).message },
          ]);
        }
        processed++;
      }
      setMessage(
        `${stop.current ? 'Stopped' : 'Search finished'}: ${processed} of ${queue.length} attempted · ${succeeded} succeeded · ${failed} failed · ${skipped} skipped. New records go to Review queue.`,
      );
      setPlan(await getPlan());
      await reload();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      running.current = false;
      setBusy(false);
      setCurrent('');
    }
  }
  return (
    <section className="panel collection-panel" aria-label="Source collection progress">
      <div className="collection-heading">
        <div>
          <p className="eyebrow">
            <Radio size={14} /> YOUR SEARCH COVERAGE
          </p>
          <h2>Which sources have been checked?</h2>
          <p className="small muted">
            Your real workspace’s collection history. Imported advertisements do not count as a
            scrape.
          </p>
        </div>
        <div className="button-row">
          <button
            className="button secondary small"
            disabled={busy}
            onClick={async () => {
              try {
                setPlan(await getPlan());
                setMessage('Source progress refreshed.');
              } catch (error) {
                setMessage((error as Error).message);
              }
            }}
          >
            Refresh status
          </button>
          <button className="button secondary small" disabled={busy} onClick={onSettings}>
            Manage sources
          </button>
          <button
            className="button primary small"
            disabled={demo || busy || !plan?.ready}
            onClick={search}
          >
            <RefreshCw size={15} />
            {busy ? 'Searching…' : 'Search remaining ready sources'}
          </button>
          {busy && (
            <button
              className="button secondary small"
              onClick={() => {
                stop.current = true;
                setMessage('Stopping after the current source finishes…');
              }}
            >
              Stop after this source
            </button>
          )}
        </div>
      </div>
      {plan && (
        <>
          <div className="collection-counts">
            <span>
              <strong>
                {plan.checked} / {plan.sources.length}
              </strong>{' '}
              successfully checked
            </span>
            <span>
              <strong>{plan.neverChecked}</strong> never successfully checked
            </span>
            <span>
              <strong>{plan.ready}</strong> ready to search
            </span>
            <span>
              <strong>{plan.waiting}</strong> waiting for refresh
            </span>
            <span>
              <strong>{plan.setup}</strong> need setup
            </span>
          </div>
          {!plan.enabled && (
            <p className="small">
              Automatic collection is switched off on this installation. Manage sources to see what
              each one needs.
            </p>
          )}
          {demo && (
            <p className="small">
              Open your workspace to run a search. These counts are real, even while you browse
              example jobs.
            </p>
          )}
          <p className="small muted">
            Search covers registered, enabled sources that are due. The current collectors check one
            configured page per source; they do not yet search every page or every possible website.
            Keep this tab open while searching; leaving Discover stops the queue after the current
            source.
          </p>
          <details className="collection-details">
            <summary>View all {plan.sources.length} sources and remaining work</summary>
            <div className="collection-rows">
              {plan.sources.map((source) => (
                <article className="collection-row" key={source.id}>
                  <div>
                    <strong>{source.name}</strong>
                    <p className="small muted">
                      {source.lastSuccess
                        ? `Last successful scrape: ${when(source.lastSuccess)}`
                        : 'Not successfully scraped yet'}
                      {source.imported ? ` · ${source.imported} imported advertisements` : ''}
                    </p>
                    {source.lastAttempt && (
                      <p className="small muted">Last attempt: {when(source.lastAttempt)}</p>
                    )}
                    {source.error && <p className="small error">Last error: {source.error}</p>}
                    {source.lastResult && <p className="small muted">{source.lastResult}</p>}
                    <p className="small">
                      {source.reasons.join(' · ') ||
                        (source.state === 'waiting' && source.nextAttempt
                          ? `Next attempt after ${when(source.nextAttempt)}`
                          : 'Ready to check')}
                    </p>
                  </div>
                  <div className="button-row">
                    <Badge tone={source.error ? 'amber' : source.state === 'ready' ? 'green' : ''}>
                      {current === source.id
                        ? 'Searching'
                        : source.state === 'ready'
                          ? 'Ready'
                          : source.state === 'waiting'
                            ? 'Waiting'
                            : 'Needs setup'}
                    </Badge>
                    <a
                      className="icon-button"
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Visit ${source.name}`}
                    >
                      <ExternalLink size={16} />
                    </a>
                  </div>
                </article>
              ))}
            </div>
          </details>
        </>
      )}
      {!plan && !message && <p role="status">Loading source progress…</p>}
      {message && (
        <p role="status" aria-live="polite" className="small">
          {message}
        </p>
      )}
      {busy && (
        <progress aria-label="Collection progress" value={results.length} max={total || 1} />
      )}
      {!!results.length && (
        <ul className="collection-results">
          {results.map((result, index) => (
            <li key={index}>
              <strong>{result.name}</strong> · {result.status} — {result.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
