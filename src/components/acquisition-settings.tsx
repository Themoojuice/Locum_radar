'use client';
import { useEffect, useState } from 'react';
import type { CollectorConfig } from '@/domain/acquisition';
import type { Store, CollectionRun } from '@/domain/model';
import { collectorConfigSchema } from '@/domain/acquisition';
import { api } from './shared';
import { ProviderSetup } from './provider-setup';
import { useRef } from 'react';
const locumQuery =
  '{locum locums "locum tenens" "doctor vacancy" "medical vacancy" "registrar cover"} -in:trash -in:spam';
export function GmailConnection({ store, reload }: { store: Store; reload: () => Promise<void> }) {
  const existing = store.sources.find((s) => s.id === 'gmail-label')?.collector;
  const [status, setStatus] = useState<{
      configured: boolean;
      connected: boolean;
      labels: { id: string; name: string }[];
    } | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [setup, setSetup] = useState(false);
  const [mode, setMode] = useState<'label' | 'search'>(existing?.labelId ? 'label' : 'search'),
    [label, setLabel] = useState(existing?.labelId || ''),
    [query, setQuery] = useState(existing?.gmailMode === 'search' ? existing.query : locumQuery),
    [allHistory, setAllHistory] = useState(existing?.gmailAllHistory ?? true),
    [days, setDays] = useState(365);
  const stop = useRef(false);
  async function refresh() {
    const r = await fetch('/api/gmail', { cache: 'no-store' });
    const v = await r.json();
    if (!r.ok) throw Error(v.error);
    setStatus(v);
    if (v.error) setMessage(v.error);
  }
  useEffect(() => {
    let active = true;
    fetch('/api/gmail', { cache: 'no-store' })
      .then(async (r) => {
        const v = await r.json();
        if (!r.ok) throw Error(v.error);
        return v;
      })
      .then((v) => {
        if (active) {
          setStatus(v);
          if (v.error) setMessage(v.error);
        }
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      });
    return () => {
      active = false;
      stop.current = true;
    };
  }, []);
  async function connect(method: 'POST' | 'DELETE') {
    setBusy(true);
    try {
      const r = await fetch('/api/gmail', { method });
      const v = await r.json();
      if (!r.ok) throw Error(v.error);
      if (v.url) window.location.assign(v.url);
      else {
        await refresh();
        await reload();
        setMessage('Gmail disconnected');
      }
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function collect() {
    setBusy(true);
    stop.current = false;
    try {
      await api({ command: 'catalog' });
      await api({
        command: 'source',
        sourceId: 'gmail-label',
        enabled: true,
        permission: 'approved',
        permissionEvidence:
          'Account owner authorised read-only Gmail import using ' +
          (mode === 'label' ? 'selected label' : 'the displayed search query'),
        collector: collectorConfigSchema.parse({
          kind: 'gmail',
          gmailMode: mode,
          labelId: mode === 'label' ? label : '',
          query,
          gmailAllHistory: allHistory,
          lookbackDays: days,
          maxPages: 50000,
          maxRecords: 200000,
        }),
      });
      let run: CollectionRun;
      do {
        run = await api({ command: 'collect', sourceId: 'gmail-label' });
        setMessage(run.message);
        await reload();
      } while (!stop.current && run.status === 'partial' && !!run.remaining && !run.limited);
      if (stop.current)
        setMessage('Paused. Imported adverts are on Discover. Import again to resume.');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" id="gmail-import">
      <h2>Import from Gmail</h2>
      <p>
        Find potential locum offers and add them to your Discover board as each batch finishes.
        Choose your recruitment label or search matching emails across your mailbox, including
        archived mail.
      </p>
      <p className="small muted">
        Read-only access: no messages are sent, changed or deleted. Broad searches can include
        non-job messages. Attachments are flagged for review; their contents are not imported.
      </p>
      {!status?.configured && <ProviderSetup kind="gmail" onSaved={() => void refresh()} />}
      {status?.configured && !status.connected && (
        <button className="button primary" disabled={busy} onClick={() => connect('POST')}>
          Connect Gmail with Google
        </button>
      )}
      {status?.connected && (
        <>
          <label>
            Emails to import
            <select
              value={mode}
              disabled={busy}
              onChange={(e) => setMode(e.target.value as 'label' | 'search')}
            >
              <option value="search">Search all mail for possible locum offers</option>
              <option value="label">Only my selected recruitment label</option>
            </select>
          </label>
          {mode === 'label' ? (
            <label>
              Gmail label
              <select
                aria-label="Gmail label"
                disabled={busy}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              >
                <option value="">Choose a label</option>
                {(status.labels || []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              Gmail search
              <input disabled={busy} value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
          )}
          <label className="checkbox-row">
            <input
              type="checkbox"
              disabled={busy}
              checked={allHistory}
              onChange={(e) => setAllHistory(e.target.checked)}
            />
            Search all email history
          </label>
          {!allHistory && (
            <label>
              Days to look back
              <input
                type="number"
                min="1"
                max="365"
                value={days}
                disabled={busy}
                onChange={(e) => setDays(Number(e.target.value))}
              />
            </label>
          )}
          <div className="button-row">
            <button
              className="button primary"
              disabled={busy || (mode === 'label' ? !label : !query.trim())}
              onClick={collect}
            >
              Import from Gmail
            </button>
            {busy && (
              <button
                className="button secondary"
                onClick={() => {
                  stop.current = true;
                  setMessage('Pausing after this batch…');
                }}
              >
                Pause import
              </button>
            )}
            <button className="button secondary" disabled={busy} onClick={() => connect('DELETE')}>
              Disconnect Gmail
            </button>
          </div>
          <p className="small muted">
            Large imports resume saved batches. Keep this page open. Up to 50,000 requests / 200,000
            extracted records per scan; limits and failures are reported explicitly.
          </p>
        </>
      )}
      {status?.configured && !status.connected && (
        <button className="text-button" onClick={() => setSetup(!setup)}>
          Change Google app settings
        </button>
      )}
      {setup && status?.configured && !status.connected && (
        <ProviderSetup kind="gmail" onSaved={() => void refresh()} />
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
export function CollectorSettings({
  value,
  change,
}: {
  value: CollectorConfig;
  change: (config: CollectorConfig) => void;
}) {
  const [labels, setLabels] = useState<{ id: string; name: string }[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    if (value.kind !== 'gmail') return;
    fetch('/api/gmail', { cache: 'no-store' })
      .then((r) => r.json())
      .then((v) => {
        setLabels(v.labels || []);
        if (v.error) setError(v.error);
      })
      .catch(() => setError('Connect Gmail before choosing a label'));
  }, [value.kind]);
  const patch = (updates: Partial<CollectorConfig>) => change({ ...value, ...updates });
  const lines = (v: string) =>
    v
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean);
  return (
    <>
      <label>
        Collection method
        <select
          value={value.kind}
          onChange={(e) => patch({ kind: e.target.value as CollectorConfig['kind'] })}
        >
          <option value="web">Public job pages</option>
          <option value="feed">RSS / Atom feed</option>
          <option value="sitemap">Sitemap with job pages</option>
          <option value="adzuna">Adzuna Australia API</option>
          <option value="search">Recent web search leads</option>
          <option value="gmail">Selected Gmail label</option>
        </select>
      </label>
      {value.kind === 'gmail' && value.gmailMode !== 'search' && (
        <>
          <label>
            Import only this Gmail label
            <select value={value.labelId} onChange={(e) => patch({ labelId: e.target.value })}>
              <option value="">Choose a label (required)</option>
              {value.labelId && !labels.some((l) => l.id === value.labelId) && (
                <option value={value.labelId}>
                  Previously selected label — reconnect to verify
                </option>
              )}
              {labels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          {error && <p className="error">{error}</p>}
        </>
      )}
      {(['adzuna', 'search'].includes(value.kind) ||
        (value.kind === 'gmail' && value.gmailMode === 'search')) && (
        <label>
          Search terms
          <input value={value.query} onChange={(e) => patch({ query: e.target.value })} />
        </label>
      )}
      {['gmail', 'adzuna', 'search'].includes(value.kind) && (
        <label>
          Look back this many days
          <input
            type="number"
            min="1"
            max="365"
            value={value.lookbackDays}
            onChange={(e) => patch({ lookbackDays: Number(e.target.value) })}
          />
        </label>
      )}
      {['web', 'feed', 'sitemap'].includes(value.kind) && (
        <>
          <label>
            Starting URLs (one per line)
            <textarea
              key={value.kind + '-urls'}
              defaultValue={value.startUrls.join('\n')}
              onBlur={(e) => patch({ startUrls: lines(e.target.value) })}
            />
          </label>
          <label>
            Allowed website hosts (one per line)
            <textarea
              key={value.kind + '-hosts'}
              defaultValue={value.allowedHosts.join('\n')}
              onBlur={(e) => patch({ allowedHosts: lines(e.target.value) })}
              placeholder="example.com"
            />
          </label>
          <details>
            <summary>Page matching and extraction settings</summary>
            <label>
              Job page paths (* matches any text)
              <textarea
                key={value.kind + '-details'}
                defaultValue={value.detailPaths.join('\n')}
                onBlur={(e) => patch({ detailPaths: lines(e.target.value) })}
              />
            </label>
            <label>
              Search / pagination paths
              <textarea
                key={value.kind + '-listings'}
                defaultValue={value.listingPaths.join('\n')}
                onBlur={(e) => patch({ listingPaths: lines(e.target.value) })}
              />
            </label>
            <label>
              Next-page link selector
              <input
                value={value.nextSelector}
                onChange={(e) => patch({ nextSelector: e.target.value })}
              />
            </label>
            <label>
              Job content selector
              <input
                value={value.contentSelector}
                onChange={(e) => patch({ contentSelector: e.target.value })}
              />
            </label>
          </details>
        </>
      )}
      <label>
        Maximum pages / messages per scan
        <input
          type="number"
          min="1"
          max={value.kind === 'gmail' ? 50000 : 500}
          value={value.maxPages}
          onChange={(e) => patch({ maxPages: Number(e.target.value) })}
        />
      </label>
      <label>
        Maximum records per scan
        <input
          type="number"
          min="1"
          max={value.kind === 'gmail' ? 200000 : 2000}
          value={value.maxRecords}
          onChange={(e) => patch({ maxRecords: Number(e.target.value) })}
        />
      </label>
      <label>
        Minimum pause between requests (milliseconds)
        <input
          type="number"
          min="1000"
          max="60000"
          value={value.delayMs}
          onChange={(e) => patch({ delayMs: Number(e.target.value) })}
        />
      </label>
    </>
  );
}
