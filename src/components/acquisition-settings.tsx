'use client';
import { useEffect, useState } from 'react';
import type { CollectorConfig } from '@/domain/acquisition';
export function GmailConnection() {
  const [status, setStatus] = useState<{ configured: boolean; connected: boolean } | null>(null);
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch('/api/gmail', { cache: 'no-store' })
      .then((r) => r.json())
      .then((v) => {
        if ('configured' in v) setStatus(v);
        if (v.error) setMessage(v.error);
      })
      .catch(() => setMessage('Could not check Gmail connection'));
  }, []);
  async function change(method: 'POST' | 'DELETE') {
    setBusy(true);
    try {
      const response = await fetch('/api/gmail', { method });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (result.url) window.location.assign(result.url);
      else {
        setStatus((v) => v && { ...v, connected: false });
        setMessage(
          'Gmail disconnected from this installation. You can also revoke access in your Google account.',
        );
      }
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>Recruiter emails · Gmail</h2>
      <p>
        Choose one recruitment label in the source’s settings. Only messages carrying that label are
        imported. Google grants mailbox-wide read access; the selected-label restriction is enforced
        by Locum Radar.
      </p>
      <p className="small muted">
        Connection details stay encrypted on this installation. Email attachments are flagged for
        separate review. No messages are sent, labelled or deleted.
      </p>
      {status && (
        <p>
          {status.connected
            ? 'Gmail connected. Select your label in Gmail recruitment label → Collection settings.'
            : status.configured
              ? 'Ready to connect your Google account.'
              : 'Setup needed: add a Google OAuth client and a session secret to this installation. See docs/acquisition-plan.md.'}
        </p>
      )}
      <button
        className="button secondary"
        disabled={busy || !status?.configured}
        onClick={() => change(status?.connected ? 'DELETE' : 'POST')}
      >
        {status?.connected ? 'Disconnect Gmail' : 'Connect Gmail'}
      </button>
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
      {value.kind === 'gmail' && (
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
      {['adzuna', 'search'].includes(value.kind) && (
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
          max="500"
          value={value.maxPages}
          onChange={(e) => patch({ maxPages: Number(e.target.value) })}
        />
      </label>
      <label>
        Maximum records per scan
        <input
          type="number"
          min="1"
          max="2000"
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
