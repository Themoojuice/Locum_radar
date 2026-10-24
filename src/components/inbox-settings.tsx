'use client';
import { useState } from 'react';
import { Copy, ExternalLink, Sparkles } from 'lucide-react';
import type { Store } from '@/domain/model';
import { agencies, inboxSettings, searchDomains } from '@/domain/agencies';
import { inboxQuery, type InboxSettings } from '@/domain/inbox';
import { api, Badge } from './shared';
import { dollars } from './inbox-import';

/*
 * Inbox settings: which agencies to search (with sign-up links for the ones not
 * yet joined), an optional Gmail label, Claude's API key, and import defaults.
 */
export function InboxSettingsPanel({
  store,
  claudeKey,
  onClaudeSaved,
  onSaved,
  spent,
}: {
  store: Store;
  claudeKey: boolean | null;
  onClaudeSaved: () => void;
  onSaved: () => Promise<void>;
  spent: number;
}) {
  const [draft, setDraft] = useState<InboxSettings>(() => inboxSettings(store));
  const [extra, setExtra] = useState(draft.extraDomains.join('\n'));
  const [checking, setChecking] = useState(false),
    [result, setResult] = useState<{
      emails: number;
      expected: number;
      matched: number;
      cost: number;
      problems: { subject: string; missed: string[]; extra: string[] }[];
    } | null>(null);
  async function check() {
    setChecking(true);
    setMessage('');
    try {
      setResult(await api({ command: 'inbox-claude-check' }));
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setChecking(false);
    }
  }
  const [key, setKey] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [copied, setCopied] = useState(false);
  const toggle = (list: 'agencies' | 'signedUp', id: string) =>
    setDraft((d) => ({
      ...d,
      [list]: d[list].includes(id) ? d[list].filter((v) => v !== id) : [...d[list], id],
    }));
  const extraDomains = extra
    .split(/[\s,]+/)
    .map((v) => v.trim().replace(/^@/, '').toLowerCase())
    .filter(Boolean);
  const invalid = extraDomains.filter((d) => !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d));
  const current = { ...draft, extraDomains };
  const filterQuery = inboxQuery(draft.days, searchDomains(current))
    .replace(/ newer_than:\d+d/, '')
    .replace(/ -in:\S+/g, '');
  const joined = agencies.filter((a) => draft.signedUp.includes(a.id)).length;

  async function save() {
    setBusy(true);
    setMessage('');
    try {
      const { id: _id, knownAgencies: _known, ...settings } = current;
      void _id;
      void _known;
      await api({ command: 'inbox-settings', settings });
      await onSaved();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveKey() {
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ANTHROPIC_API_KEY: key.trim() }),
      });
      const v = await r.json();
      if (!r.ok) throw new Error(v.error);
      setKey('');
      onClaudeSaved();
      setMessage('Claude key saved.');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel inbox-settings" aria-label="Inbox settings">
      <div className="settings-block">
        <div className="spread">
          <h2>Agencies</h2>
          <span className="small muted">
            Signed up with {joined} of {agencies.length}
          </span>
        </div>
        <p className="small muted">
          Ticked agencies are searched on every import. Sign up for job emails with the ones you
          haven’t joined. Each takes a couple of minutes, and their emails then arrive here by
          themselves.
        </p>
        <ul className="agency-list">
          {agencies.map((a) => {
            const on = draft.agencies.includes(a.id),
              joinedAgency = draft.signedUp.includes(a.id);
            return (
              <li key={a.id} className={on ? '' : 'off'}>
                <label className="agency-search">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle('agencies', a.id)}
                    aria-label={`Search ${a.name} emails`}
                  />
                  <span>
                    <strong>{a.name}</strong>
                    <small>
                      {a.domains.join(', ')}
                      {a.note ? ` · ${a.note}` : ''}
                    </small>
                  </span>
                </label>
                <Badge tone={a.rules ? 'green' : 'lavender'}>
                  {a.rules ? 'Built-in reader' : 'Read by Claude'}
                </Badge>
                <label className="agency-joined small">
                  <input
                    type="checkbox"
                    checked={joinedAgency}
                    onChange={() => toggle('signedUp', a.id)}
                  />
                  Signed up
                </label>
                <a
                  className={`button small secondary ${joinedAgency ? '' : 'sign-up'}`}
                  href={a.signup}
                  target="_blank"
                  rel="noreferrer"
                >
                  {joinedAgency ? 'Open' : 'Sign up'} <ExternalLink size={12} />
                </a>
              </li>
            );
          })}
        </ul>
        <label>
          Other recruiter domains (one per line)
          <textarea
            rows={2}
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            placeholder="e.g. somerecruiter.com.au"
          />
        </label>
        <p className="small muted">
          More agencies: the{' '}
          <a
            href="https://www.health.nsw.gov.au/business/locums/Pages/locum-register.aspx"
            target="_blank"
            rel="noreferrer"
          >
            NSW Health register of locum agencies <ExternalLink size={11} />
          </a>{' '}
          lists every approved agency; add their email domains above.
        </p>
        {invalid.length > 0 && <p className="error small">Not a domain: {invalid.join(', ')}</p>}
      </div>

      <div className="settings-block">
        <h2>Gmail label (optional)</h2>
        <p className="small muted">
          Anything under this label is read too. Use it for recruiters not listed above, or label
          (or forward to yourself and label) any advert you want imported.
        </p>
        <label>
          Label name
          <input
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder="e.g. Locums"
          />
        </label>
        <details className="small">
          <summary>Make Gmail label recruiter emails automatically</summary>
          <ol>
            <li>
              Open{' '}
              <a
                href={`https://mail.google.com/mail/u/0/#search/${encodeURIComponent(filterQuery)}`}
                target="_blank"
                rel="noreferrer"
              >
                this search in Gmail <ExternalLink size={11} />
              </a>
              .
            </li>
            <li>
              Click the sliders icon at the right of the search bar, then{' '}
              <strong>Create filter</strong>.
            </li>
            <li>
              Tick <strong>Apply the label</strong>, choose or create “{draft.label || 'Locums'}”,
              and tick <strong>Also apply filter to matching conversations</strong>.
            </li>
          </ol>
          <code className="filter-query">{filterQuery}</code>{' '}
          <button
            className="text-button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(filterQuery);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            <Copy size={12} /> {copied ? 'Copied' : 'Copy'}
          </button>
        </details>
      </div>

      <div className="settings-block">
        <h2>
          <Sparkles size={17} /> Claude reader
        </h2>
        <p className="small muted">
          Claude Haiku reads emails from agencies without a built-in reader, offer emails the
          built-in readers miss, and adverts you paste in. It only copies each field as written;
          dates and pay are worked out by the same code as everything else. Typical cost is a
          fraction of a cent per email
          {spent > 0 ? `; ${dollars(spent)} so far` : ''}.
        </p>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={draft.claude}
            onChange={(e) => setDraft({ ...draft, claude: e.target.checked })}
          />
          Use Claude for unfamiliar emails
        </label>
        <div className="key-row">
          <label>
            Anthropic API key{' '}
            {claudeKey ? <Badge tone="green">saved</Badge> : <Badge tone="amber">not set</Badge>}
            <input
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={claudeKey ? 'Saved — paste a new key to replace it' : 'sk-ant-…'}
            />
          </label>
          <button
            className="button secondary"
            disabled={busy || !key.trim()}
            onClick={() => void saveKey()}
          >
            Save key
          </button>
        </div>
        <p className="small muted">
          Create one at{' '}
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
            console.anthropic.com <ExternalLink size={11} />
          </a>{' '}
          (prepaid credit, billed separately from a Claude subscription). The key is stored
          encrypted on this computer.
        </p>
        {claudeKey && (
          <div className="claude-check">
            <button
              className="button secondary small"
              disabled={checking}
              onClick={() => void check()}
            >
              {checking ? 'Checking…' : 'Check Claude’s accuracy'}
            </button>
            <span className="small muted">
              Re-reads up to six Medrecruit and 1Medical emails and compares Claude with the
              built-in readers (about 1–2¢).
            </span>
            {result && (
              <div className="small claude-check-result" role="status">
                <strong>
                  Claude matched {result.matched} of {result.expected} vacancies (
                  {result.expected ? Math.round((result.matched / result.expected) * 100) : 0}%) in{' '}
                  {result.emails} emails · {dollars(result.cost)}
                </strong>
                <span className="muted"> Match means same dates, grade and pay.</span>
                {result.problems.map((p) => (
                  <details key={p.subject}>
                    <summary>{p.subject}</summary>
                    {p.missed.length > 0 && (
                      <p>Missed or read differently: {p.missed.join('; ')}</p>
                    )}
                    {p.extra.length > 0 && <p>Claude’s reading: {p.extra.join('; ')}</p>}
                  </details>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="settings-block">
        <h2>Importing</h2>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={draft.autoImport}
            onChange={(e) => setDraft({ ...draft, autoImport: e.target.checked })}
          />
          Import new emails automatically when the app opens (at most every 6 hours)
        </label>
        <label className="inline-select">
          Look back
          <select
            value={draft.days}
            onChange={(e) => setDraft({ ...draft, days: Number(e.target.value) })}
          >
            {[7, 14, 30, 60, 90].map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="button-row">
        <button
          className="button primary"
          disabled={busy || invalid.length > 0}
          onClick={() => void save()}
        >
          Save settings
        </button>
        {message && <span className="small">{message}</span>}
      </div>
    </section>
  );
}
