'use client';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
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
interface LogLine {
  seq: number;
  at: string;
  sourceId: string;
  level: 'info' | 'warn' | 'error';
  text: string;
}
const clock = (value: string) =>
  new Date(value).toLocaleTimeString('en-AU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

export function CollectionProgress({
  demo,
  reload,
  onSettings,
  knownCount,
}: {
  demo: boolean;
  reload: () => Promise<void>;
  onSettings: () => void;
  knownCount: number;
}) {
  const [plan, setPlan] = useState<CollectionPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [current, setCurrent] = useState('');
  const [results, setResults] = useState<{ name: string; status: string; message: string }[]>([]);
  const [total, setTotal] = useState(0);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [incomplete, setIncomplete] = useState<string[]>([]);
  const stop = useRef(false),
    autoStarted = useRef(false),
    running = useRef(false),
    seq = useRef(0),
    logBox = useRef<HTMLOListElement>(null);
  // Poll the server's progress log while a fetch is running.
  useEffect(() => {
    if (!busy) return;
    let active = true;
    const tick = async () => {
      try {
        const response = await fetch(`/api/collection/log?since=${seq.current}`, {
          cache: 'no-store',
        });
        if (!response.ok) return;
        const data: { seq: number; lines: LogLine[] } = await response.json();
        if (!active || !Array.isArray(data.lines)) return;
        seq.current = Math.max(seq.current, data.seq ?? 0);
        if (data.lines.length) setLines((previous) => [...previous, ...data.lines].slice(-300));
      } catch {
        /* The log is a convenience; results below remain authoritative. */
      }
    };
    const timer = setInterval(tick, 1000);
    void tick();
    return () => {
      active = false;
      clearInterval(timer);
      void tick();
    };
  }, [busy]);
  useEffect(() => {
    if (logBox.current) logBox.current.scrollTop = logBox.current.scrollHeight;
  }, [lines]);
  const refreshPool = useEffectEvent(async () => {
    if (!demo && !running.current) await reload();
  });
  useEffect(() => {
    let active = true;
    getPlan()
      .then((value) => {
        if (active) setPlan(value);
      })
      .catch((error) => {
        if (active) setMessage(error.message);
      });
    const timer = setInterval(() => {
      if (document.hidden) return;
      void getPlan()
        .then((value) => {
          if (active) {
            setPlan(value);
            void refreshPool();
          }
        })
        .catch(() => {});
    }, 60000);
    return () => {
      clearInterval(timer);
      active = false;
      stop.current = true;
    };
  }, []);
  const startPublic = useEffectEvent(() => {
    void search(true);
  });
  useEffect(() => {
    if (!busy && plan && !plan.sources.some((s) => s.state === 'ready'))
      autoStarted.current = false;
    if (
      !demo &&
      plan?.automaticStarter &&
      !autoStarted.current &&
      plan.sources.some((s) => s.state === 'ready')
    ) {
      autoStarted.current = true;
      startPublic();
    }
  }, [demo, plan, busy]);
  async function search(starterOnly = false) {
    if (running.current || demo) return;
    running.current = true;
    stop.current = false;
    setBusy(true);
    setMessage(
      starterOnly
        ? 'Updating the job board from connected sources…'
        : 'Preparing: hospital directory and inbox…',
    );
    setResults([]);
    setLines([]);
    setIncomplete([]);
    setTotal(0);
    try {
      const status = await fetch('/api/collection/log?since=0', { cache: 'no-store' });
      if (status.ok) seq.current = (await status.json()).seq ?? 0;
    } catch {
      seq.current = 0;
    }
    let processed = 0,
      succeeded = 0,
      failed = 0,
      partial = 0,
      skipped = 0;
    try {
      try {
        const steps: { step: string; status: string; message: string }[] = starterOnly
          ? []
          : await api({
              command: 'prepare',
            });
        if (Array.isArray(steps))
          setResults(steps.map((s) => ({ name: s.step, status: s.status, message: s.message })));
      } catch (error) {
        setResults([{ name: 'Preparation', status: 'failed', message: (error as Error).message }]);
      }
      const fresh = await getPlan();
      setPlan(fresh);
      const notSearched = fresh.sources
        .filter((s) => s.state !== 'ready' && (!starterOnly || s.starter))
        .map(
          (s) =>
            `${s.name} (${s.state === 'waiting' ? 'refreshed recently' : s.reasons[0] || 'needs setup'})`,
        );
      const queue = fresh.sources
        .filter((s) => s.state === 'ready')
        .sort((a, b) => Number(!!a.lastSuccess) - Number(!!b.lastSuccess));
      setTotal(queue.length);
      if (!queue.length) {
        setIncomplete(notSearched);
        setMessage('No sources are ready to search. See the setup and refresh details below.');
        return;
      }
      const failedNames: string[] = [];
      for (const source of queue) {
        if (stop.current) break;
        setCurrent(source.id);
        setMessage(`Searching ${source.name} (${processed + 1} of ${queue.length})…`);
        try {
          let run: CollectionRun;
          let batches = 0;
          let resumable = true;
          do {
            run = await api({ command: 'collect', sourceId: source.id });
            batches++;
            setMessage(`${source.name}: ${run.message}`);
            const updated = await getPlan();
            setPlan(updated);
            await reload();
            resumable = updated.sources.some((s) => s.id === source.id && s.state === 'ready');
          } while (
            !stop.current &&
            resumable &&
            run.status === 'partial' &&
            !!run.remaining &&
            !run.limited &&
            batches < 200
          );
          if (run.status === 'success') succeeded++;
          else if (run.status === 'failed') {
            failed++;
            failedNames.push(`${source.name} (failed: ${run.message})`);
          } else if (run.status === 'partial') {
            partial++;
            failedNames.push(`${source.name} (partial: ${run.message})`);
          } else skipped++;
          setResults((previous) => [
            ...previous,
            { name: source.name, status: run.status, message: run.message },
          ]);
        } catch (error) {
          failed++;
          failedNames.push(`${source.name} (failed: ${(error as Error).message})`);
          setResults((previous) => [
            ...previous,
            { name: source.name, status: 'failed', message: (error as Error).message },
          ]);
        }
        processed++;
      }
      setIncomplete([
        ...failedNames,
        ...queue.slice(processed).map((s) => `${s.name} (not reached)`),
        ...notSearched,
      ]);
      setMessage(
        `${stop.current ? 'Stopped' : 'Search finished'}: ${processed} of ${queue.length} attempted · ${succeeded} succeeded · ${partial} partial · ${failed} failed · ${skipped} skipped. Results are in the job board below; filters may hide some roles.`,
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
            <Radio size={14} /> JOB BOARD UPDATES
          </p>
          <h2>Find jobs from connected sources</h2>
          <p className="small muted">
            New results appear in the job list below as each batch finishes.
          </p>
        </div>
        <div className="button-row">
          <a className="button secondary small" href="#job-board">
            View {knownCount} roles
          </a>
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
            onClick={() => void search()}
          >
            <RefreshCw size={15} />
            {busy ? 'Fetching…' : 'Fetch active vacancies'}
          </button>
          {busy && (
            <button
              className="button secondary small"
              onClick={() => {
                stop.current = true;
                void api({ command: 'stop' }).catch(() => {});
                setMessage('Stopping after the current page or small batch finishes…');
              }}
            >
              Stop after this batch
            </button>
          )}
        </div>
      </div>
      {plan && (
        <>
          <p className="small muted">
            {plan.checked} sources checked / {plan.sources.length} available; {plan.ready} ready to
            search; {plan.setup} optional sources need setup
          </p>
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
                      {source.adverts
                        ? ` · ${source.adverts} collected adverts awaiting confirmation`
                        : ''}
                    </p>
                    {source.lastAttempt && (
                      <p className="small muted">Last attempt: {when(source.lastAttempt)}</p>
                    )}
                    {source.error && <p className="small error">Last error: {source.error}</p>}
                    {source.lastResult && <p className="small muted">{source.lastResult}</p>}
                    {!!source.pages && (
                      <p className="small">
                        {source.pages} pages/messages checked · {source.remaining} queued{' '}
                        {source.partial ? '· Partial coverage' : '· Configured scan finished'}
                      </p>
                    )}
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
        <progress
          aria-label="Collection progress"
          value={results.filter((r) => plan?.sources.some((s) => s.name === r.name)).length}
          max={total || 1}
        />
      )}
      {(busy || !!lines.length) && (
        <ol className="collection-log" aria-label="Collection log" ref={logBox}>
          {!lines.length && <li className="muted">Waiting for the first collector message…</li>}
          {lines.map((line) => (
            <li key={line.seq} className={`log-${line.level}`}>
              <time dateTime={line.at}>{clock(line.at)}</time> <strong>{line.sourceId}</strong>{' '}
              {line.text}
            </li>
          ))}
        </ol>
      )}
      {!busy && !!incomplete.length && (
        <div className="collection-incomplete" role="alert">
          <strong>Your list may be incomplete.</strong> Not collected in this run:
          <ul>
            {incomplete.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
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
