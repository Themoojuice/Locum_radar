'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  ExternalLink,
  EyeOff,
  House,
  Mail,
  Plane,
  RefreshCw,
  Search,
} from 'lucide-react';
import type { ListingInput, Store } from '@/domain/model';
import {
  draftFromVacancy,
  RECRUITER_DOMAINS,
  type EmailVacancy,
  type InboxEmail,
} from '@/domain/inbox';
import { api, Badge } from './shared';
import { ProviderSetup } from './provider-setup';

/*
 * Recruiter inbox: one button reads Medrecruit and 1Medical emails from Gmail;
 * the vacancies they contain are listed by start date, each showing where, what,
 * when and how much, with its status in the feed and the email it came from.
 */
interface GmailStatus {
  configured: boolean;
  connected: boolean;
  error?: string;
}
interface Progress {
  phase: 'listing' | 'reading' | 'done' | 'stopped';
  total: number;
  todo: number;
  done: number;
  offers: number;
  vacancies: number;
  added: number;
}
interface Row {
  v: EmailVacancy;
  email: InboxEmail;
  /** Other emails advertising the same feed entry. */
  repeats: InboxEmail[];
}
const DAY = 86400000;
const fmt = (d: string, year = false) =>
  new Date(d + 'T00:00:00Z').toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    ...(year ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
const received = (iso: string) =>
  new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
function span(v: EmailVacancy) {
  if (!v.start || !v.end) return { range: v.dateText || 'Dates not given', length: '' };
  const sameYear = v.start.slice(0, 4) === v.end.slice(0, 4);
  const range =
    v.start === v.end ? fmt(v.start, true) : `${fmt(v.start, !sameYear)} – ${fmt(v.end, true)}`;
  const singles = v.blocks.length > 1 && v.blocks.every((b) => b.start === b.end);
  const days = Math.round((Date.parse(v.end) - Date.parse(v.start)) / DAY) + 1;
  const length = singles
    ? `${v.blocks.length} shifts`
    : v.blocks.length > 1
      ? `${v.blocks.length} blocks over ${days} days`
      : days >= 14
        ? `${Math.round(days / 7)} weeks`
        : `${days} day${days === 1 ? '' : 's'}`;
  return { range, length };
}
function rate(v: EmailVacancy) {
  if (!v.amount) return { main: v.rateText ? 'See email' : 'Rate not given', sub: v.rateText };
  const amount = v.amount.toLocaleString('en-AU', {
    minimumFractionDigits: Number.isInteger(v.amount) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  const unit = { hour: '/h', day: '/day', shift: '/shift', unknown: '' }[v.basis];
  const ranged = /[-–]\s*\$?\s*\d/.test(v.rateText);
  return {
    main: `${ranged ? 'from ' : ''}$${amount}${unit}`,
    sub:
      v.super === 'additional'
        ? '+ super'
        : v.super === 'included'
          ? 'incl. super'
          : 'super not stated',
  };
}
/** Sorting only: a day or shift is treated as 10 hours. */
const hourly = (v: EmailVacancy) =>
  v.amount ? (v.basis === 'hour' ? v.amount : v.amount / 10) : -1;
const specialtyTone: Record<string, string> = {
  Psychiatry: 'lavender',
  'Emergency medicine': 'amber',
  'General medicine': 'blue',
  'Intensive care': 'sand',
  'Rural generalist': 'green',
};
const monthKey = (d: string | null) =>
  d
    ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-AU', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : 'Dates not given';

export function RecruiterInbox({
  store,
  demo,
  reload,
  notify,
  onFix,
  onOpen,
  onLeaveDemo,
  autoStart,
  onAutoStarted,
}: {
  store: Store;
  demo: boolean;
  reload: () => Promise<void>;
  notify: (message: string) => void;
  onFix: (draft: Partial<ListingInput>) => void;
  onOpen: (opportunityId: string) => void;
  onLeaveDemo: () => void;
  autoStart: boolean;
  onAutoStarted: () => void;
}) {
  const inbox = useMemo(() => store.inbox ?? [], [store.inbox]);
  const [gmail, setGmail] = useState<GmailStatus | null>(null),
    [days, setDays] = useState(30),
    [progress, setProgress] = useState<Progress | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'vacancies' | 'emails'>('vacancies'),
    [agency, setAgency] = useState(''),
    [stateFilter, setStateFilter] = useState(''),
    [query, setQuery] = useState(''),
    [sort, setSort] = useState<'start' | 'rate' | 'received'>('start'),
    [showEnded, setShowEnded] = useState(false),
    [showHidden, setShowHidden] = useState(false),
    [open, setOpen] = useState<string | null>(null);
  const stop = useRef(false);

  const checkGmail = () =>
    fetch('/api/gmail', { cache: 'no-store' })
      .then(async (r) => {
        const v = await r.json();
        if (!r.ok) throw new Error(v.error);
        return v as GmailStatus;
      })
      .then((v) => {
        setGmail(v);
        if (v.error) setError(v.error);
        return v;
      })
      .catch((e: Error) => {
        setError(e.message);
        return null;
      });
  async function runImport(reread = false) {
    setBusy(true);
    setError('');
    stop.current = false;
    const p: Progress = {
      phase: 'listing',
      total: 0,
      todo: 0,
      done: 0,
      offers: 0,
      vacancies: 0,
      added: 0,
    };
    setProgress({ ...p });
    try {
      const list: { total: number; ids: string[] } = await api({
        command: 'inbox-list',
        days,
        reread,
      });
      Object.assign(p, { phase: 'reading', total: list.total, todo: list.ids.length });
      setProgress({ ...p });
      for (let i = 0; i < list.ids.length && !stop.current; i += 8) {
        const r = await api({ command: 'inbox-read', ids: list.ids.slice(i, i + 8) });
        p.done += r.read;
        p.offers += r.offers;
        p.vacancies += r.vacancies;
        p.added += r.added;
        setProgress({ ...p });
        await reload();
      }
      p.phase = stop.current ? 'stopped' : 'done';
      setProgress({ ...p });
      if (p.added)
        notify(`${p.added} new vacanc${p.added === 1 ? 'y' : 'ies'} added to your feed.`);
    } catch (e) {
      setError((e as Error).message);
      p.phase = 'stopped';
      setProgress({ ...p });
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (demo) return;
    // Opened from "Import offers" elsewhere: start once Gmail is confirmed connected.
    void checkGmail().then((v) => {
      if (v?.connected && autoStart) {
        onAutoStarted();
        void runImport();
      }
    });
    return () => {
      stop.current = true;
    };
    // Runs on entering the view; later prop changes must not restart an import.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);

  async function setStatus(ids: string[], status: InboxEmail['status']) {
    try {
      await api({ command: 'inbox-status', ids, status });
      await reload();
    } catch (e) {
      notify((e as Error).message);
    }
  }

  const visibleEmails = inbox.filter((e) => showHidden || e.status !== 'dismissed');
  const agencies = [...new Set(inbox.map((e) => e.agency))].sort();
  const rows = useMemo(() => {
    const byKey = new Map<string, Row>();
    const newest = [...visibleEmails].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    for (const email of newest)
      for (const v of email.vacancies) {
        const key = v.opportunityId ?? v.id;
        const seen = byKey.get(key);
        if (seen) seen.repeats.push(email);
        else byKey.set(key, { v, email, repeats: [] });
      }
    const q = query.trim().toLowerCase();
    return [...byKey.values()]
      .filter(({ v, email }) => {
        if (!showEnded && v.ended) return false;
        if (agency && email.agency !== agency) return false;
        if (stateFilter && v.state !== stateFilter) return false;
        if (
          q &&
          ![v.hospital, v.town, v.role, v.specialty, v.grade, email.subject, email.recruiter]
            .join(' ')
            .toLowerCase()
            .includes(q)
        )
          return false;
        return true;
      })
      .sort((a, b) =>
        sort === 'rate'
          ? hourly(b.v) - hourly(a.v)
          : sort === 'received'
            ? b.email.receivedAt.localeCompare(a.email.receivedAt)
            : (a.v.start ?? '9999').localeCompare(b.v.start ?? '9999'),
      );
  }, [visibleEmails, query, showEnded, agency, stateFilter, sort]);

  const current = inbox.flatMap((e) => e.vacancies).filter((v) => !v.ended);
  const inFeed = new Set(current.filter((v) => v.opportunityId).map((v) => v.opportunityId)).size;
  const needs = current.filter((v) => !v.opportunityId).length;
  const offerEmails = inbox.filter((e) => e.kind === 'offers').length;
  const newCount = inbox.filter((e) => e.status === 'new' && e.kind !== 'other').length;
  const legacy = store.reviews.filter(
    (r) =>
      !r.resolved &&
      r.kind === 'extraction' &&
      (r.sourceId === 'gmail-label' ||
        store.sources.find((s) => s.id === r.sourceId)?.collector?.kind === 'gmail'),
  ).length;
  const states = [...new Set(current.map((v) => v.state).filter(Boolean))].sort() as string[];

  const percent = progress && progress.todo ? Math.round((progress.done / progress.todo) * 100) : 0;

  return (
    <div className="inbox">
      <div className="page-heading">
        <div>
          <p className="eyebrow">RECRUITER EMAILS</p>
          <h1>Your offers, in one place.</h1>
          <p>
            Reads emails from {RECRUITER_DOMAINS.join(' and ')} and lists every vacancy they
            contain. Newsletters, reminders and admin emails are set aside.
          </p>
        </div>
      </div>

      <section className="panel inbox-import" aria-labelledby="inbox-import-title">
        <div className="inbox-import-main">
          <span className="inbox-import-icon">
            <Mail size={22} />
          </span>
          <div>
            <h2 id="inbox-import-title">Import from Gmail</h2>
            <p className="small muted">
              {demo
                ? 'Your recruiter emails are private to your workspace.'
                : !gmail
                  ? 'Checking your Gmail connection…'
                  : !gmail.configured
                    ? 'Add your Google client details once to connect Gmail (read-only).'
                    : !gmail.connected
                      ? 'Connect Gmail (read-only) to import recruiter offers.'
                      : inbox.length
                        ? `Last import ${received(
                            inbox
                              .map((e) => e.importedAt)
                              .sort()
                              .at(-1)!,
                          )} · ${inbox.length} emails kept · only new emails are read again.`
                        : 'Connected. Import reads only Medrecruit and 1Medical emails.'}
            </p>
          </div>
        </div>
        <div className="inbox-import-actions">
          {demo ? (
            <button className="button primary" onClick={onLeaveDemo}>
              Open my workspace
            </button>
          ) : gmail && !gmail.configured ? null : gmail && !gmail.connected ? (
            <button
              className="button primary"
              onClick={async () => {
                try {
                  const r = await fetch('/api/gmail', { method: 'POST' });
                  const v = await r.json();
                  if (!r.ok) throw new Error(v.error);
                  window.location.assign(v.url);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Connect Gmail
            </button>
          ) : (
            <>
              <label className="inbox-days">
                <span className="sr-only">Period</span>
                <select
                  value={days}
                  disabled={busy}
                  onChange={(e) => setDays(Number(e.target.value))}
                >
                  <option value={7}>Last 7 days</option>
                  <option value={14}>Last 14 days</option>
                  <option value={30}>Last 30 days</option>
                  <option value={60}>Last 60 days</option>
                  <option value={90}>Last 90 days</option>
                </select>
              </label>
              {busy ? (
                <button
                  className="button secondary"
                  onClick={() => {
                    stop.current = true;
                  }}
                >
                  Stop
                </button>
              ) : (
                <button
                  className="button primary"
                  disabled={!gmail?.connected}
                  onClick={() => runImport()}
                >
                  <RefreshCw size={15} /> Import offers
                </button>
              )}
            </>
          )}
        </div>
        {!demo && gmail && !gmail.configured && (
          <ProviderSetup kind="gmail" onSaved={() => void checkGmail()} />
        )}
        {progress && (
          <div className="inbox-progress" role="status" aria-live="polite">
            <div className="inbox-bar">
              <span
                style={{
                  width: progress.phase === 'listing' ? '8%' : `${Math.max(percent, 3)}%`,
                }}
                className={progress.phase === 'listing' || busy ? 'running' : ''}
              />
            </div>
            <p className="small">
              {progress.phase === 'listing'
                ? `Searching Gmail for the last ${days} days…`
                : progress.total === 0
                  ? `No Medrecruit or 1Medical emails in the last ${days} days.`
                  : progress.todo === 0
                    ? `All ${progress.total} emails from the last ${days} days were already read.`
                    : `${progress.phase === 'reading' ? 'Reading' : progress.phase === 'stopped' ? 'Stopped after' : 'Read'} ${progress.done} of ${progress.todo} new email${progress.todo === 1 ? '' : 's'} · ${progress.offers} with offers · ${progress.vacancies} vacancies · ${progress.added} new in your feed`}
              {progress.phase !== 'reading' &&
                progress.phase !== 'listing' &&
                progress.total > 0 && (
                  <>
                    {' '}
                    <button className="text-button" disabled={busy} onClick={() => runImport(true)}>
                      Re-read all {progress.total}
                    </button>
                  </>
                )}
            </p>
          </div>
        )}
        {error && (
          <p className="error small" role="alert">
            {error}
          </p>
        )}
      </section>

      {legacy > 0 && !demo && (
        <div className="inbox-legacy panel">
          <CircleAlert size={17} />
          <p className="small">
            The earlier Gmail search left <strong>{legacy}</strong> unconfirmed email drafts in your
            review queue and job list. This inbox replaces them.
          </p>
          <button
            className="button secondary small"
            onClick={async () => {
              try {
                const r = await api({ command: 'inbox-clear-legacy' });
                await reload();
                notify(`${r.cleared} old Gmail drafts cleared.`);
              } catch (e) {
                notify((e as Error).message);
              }
            }}
          >
            Clear old drafts
          </button>
        </div>
      )}

      {inbox.length > 0 && (
        <>
          <div className="inbox-stats">
            <div>
              <strong>{current.length}</strong>
              <span>current vacancies</span>
            </div>
            <div>
              <strong>{inFeed}</strong>
              <span>in your feed</span>
            </div>
            <div className={needs ? 'attention' : ''}>
              <strong>{needs}</strong>
              <span>need a detail</span>
            </div>
            <div>
              <strong>
                {offerEmails}
                <small>/{inbox.length}</small>
              </strong>
              <span>emails with offers</span>
            </div>
          </div>

          <div className="inbox-toolbar">
            <div className="segmented" role="tablist" aria-label="Group by">
              <button
                role="tab"
                aria-selected={mode === 'vacancies'}
                className={mode === 'vacancies' ? 'active' : ''}
                onClick={() => setMode('vacancies')}
              >
                Vacancies
              </button>
              <button
                role="tab"
                aria-selected={mode === 'emails'}
                className={mode === 'emails' ? 'active' : ''}
                onClick={() => setMode('emails')}
              >
                Emails {newCount > 0 && <b>{newCount}</b>}
              </button>
            </div>
            <label className="inbox-search">
              <Search size={15} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Hospital, town, role…"
                aria-label="Search vacancies"
              />
            </label>
            <select value={agency} onChange={(e) => setAgency(e.target.value)} aria-label="Agency">
              <option value="">All agencies</option>
              {agencies.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              aria-label="State"
            >
              <option value="">All states</option>
              {states.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            {mode === 'vacancies' && (
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
                aria-label="Sort"
              >
                <option value="start">Soonest start</option>
                <option value="rate">Highest rate</option>
                <option value="received">Newest email</option>
              </select>
            )}
            <label className="checkbox-row small">
              <input
                type="checkbox"
                checked={showEnded}
                onChange={(e) => setShowEnded(e.target.checked)}
              />
              Show ended
            </label>
          </div>

          {mode === 'vacancies' ? (
            <div className="vacancy-list">
              {!rows.length && <p className="muted small">No vacancies match these filters.</p>}
              {rows.map((row, i) => {
                const month = monthKey(row.v.start);
                const heading =
                  sort === 'start' && (i === 0 || monthKey(rows[i - 1].v.start) !== month);
                return (
                  <div key={row.v.id}>
                    {heading && <h3 className="vacancy-month">{month}</h3>}
                    <VacancyRow
                      row={row}
                      expanded={open === row.v.id}
                      toggle={() => setOpen(open === row.v.id ? null : row.v.id)}
                      onFix={() => onFix(draftFromVacancy(row.email, row.v))}
                      onOpen={onOpen}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <EmailList
              emails={visibleEmails.filter(
                (e) =>
                  (!agency || e.agency === agency) &&
                  (!stateFilter || e.vacancies.some((v) => v.state === stateFilter)) &&
                  (!query.trim() ||
                    (e.subject + ' ' + e.recruiter + ' ' + e.body)
                      .toLowerCase()
                      .includes(query.trim().toLowerCase())),
              )}
              showEnded={showEnded}
              onFix={(e, v) => onFix(draftFromVacancy(e, v))}
              onOpen={onOpen}
              setStatus={setStatus}
              showHidden={showHidden}
              setShowHidden={setShowHidden}
              hiddenCount={inbox.filter((e) => e.status === 'dismissed').length}
            />
          )}
        </>
      )}
      {!inbox.length && !demo && gmail?.connected && !busy && (
        <div className="empty-state">
          <div className="empty-radar">◎</div>
          <h2>No recruiter emails yet</h2>
          <p>Press Import offers to read the last {days} days.</p>
        </div>
      )}
    </div>
  );
}

function StatusPill({
  v,
  onFix,
  onOpen,
}: {
  v: EmailVacancy;
  onFix: () => void;
  onOpen: (id: string) => void;
}) {
  if (v.ended) return <Badge>Ended</Badge>;
  if (v.opportunityId)
    return (
      <button className="status-pill in-feed" onClick={() => onOpen(v.opportunityId!)}>
        <CircleCheck size={13} /> In feed
      </button>
    );
  return (
    <button className="status-pill needs" onClick={onFix} title="Complete the missing details">
      <CircleAlert size={13} /> Add {v.missing.join(', ') || 'details'}
    </button>
  );
}

function Perks({ v }: { v: EmailVacancy }) {
  return (
    <span className="vacancy-perks">
      {v.flights === 'included' && (
        <span title="Travel provided">
          <Plane size={13} />
        </span>
      )}
      {v.accommodation === 'included' && (
        <span title="Accommodation provided">
          <House size={13} />
        </span>
      )}
    </span>
  );
}

function VacancyRow({
  row,
  expanded,
  toggle,
  onFix,
  onOpen,
}: {
  row: Row;
  expanded: boolean;
  toggle: () => void;
  onFix: () => void;
  onOpen: (id: string) => void;
}) {
  const { v, email } = row;
  const when = span(v);
  const pay = rate(v);
  const place = v.hospital || v.town || 'Hospital not named';
  return (
    <article className={`vacancy-row ${v.ended ? 'ended' : ''} ${expanded ? 'expanded' : ''}`}>
      <button
        className="vacancy-summary"
        onClick={toggle}
        aria-expanded={expanded}
        aria-label={`${place}, ${v.role}. Show details`}
      >
        <span className="vacancy-when">
          <strong>{when.range}</strong>
          <small>{when.length}</small>
        </span>
        <span className="vacancy-what">
          <strong className={!v.hospital && !v.town ? 'muted' : ''}>
            {place}
            {v.state && <em>{v.state}</em>}
          </strong>
          <span className="vacancy-role">
            {v.specialty && v.specialty !== 'Other' && (
              <Badge tone={specialtyTone[v.specialty] ?? ''}>{v.specialty}</Badge>
            )}
            {v.grade && <Badge tone="green">{v.grade}</Badge>}
            <span className="muted">{v.role}</span>
            {v.positions && v.positions > 1 && <span className="muted">· {v.positions} posts</span>}
          </span>
        </span>
        <span className="vacancy-pay">
          <strong>{pay.main}</strong>
          <small>
            {pay.sub} <Perks v={v} />
          </small>
        </span>
        <span className="vacancy-source">
          <strong>{email.agency}</strong>
          <small>
            {received(email.receivedAt)}
            {row.repeats.length > 0 && ` · +${row.repeats.length}`}
          </small>
        </span>
      </button>
      <span className="vacancy-status">
        <StatusPill v={v} onFix={onFix} onOpen={onOpen} />
      </span>
      {expanded && <VacancyDetail row={row} />}
    </article>
  );
}

function VacancyDetail({ row }: { row: Row }) {
  const { v, email } = row;
  return (
    <div className="vacancy-detail">
      <blockquote>{v.excerpt}</blockquote>
      <dl>
        <div>
          <dt>Dates as written</dt>
          <dd>{v.dateText || '—'}</dd>
        </div>
        {v.blocks.length > 1 && (
          <div>
            <dt>{v.blocks.every((b) => b.start === b.end) ? 'Shifts' : 'Blocks'}</dt>
            <dd>
              {v.blocks
                .map((b) => (b.start === b.end ? fmt(b.start) : `${fmt(b.start)}–${fmt(b.end)}`))
                .join(', ')}
            </dd>
          </div>
        )}
        <div>
          <dt>Rate as written</dt>
          <dd>{v.rateText || '—'}</dd>
        </div>
        {v.roster && (
          <div>
            <dt>Roster</dt>
            <dd>{v.roster}</dd>
          </div>
        )}
        {v.minPgy && (
          <div>
            <dt>Experience</dt>
            <dd>PGY{v.minPgy}+</dd>
          </div>
        )}
      </dl>
      {v.notes.length > 0 && (
        <ul className="vacancy-notes">
          {v.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <p className="small muted vacancy-from">
        {email.recruiter} · {email.agency} · “{email.subject}” · {received(email.receivedAt)}
        {row.repeats.length > 0 &&
          ` · also in ${row.repeats.length} other email${row.repeats.length === 1 ? '' : 's'}`}{' '}
        <a href={email.gmailUrl} target="_blank" rel="noreferrer" className="text-button">
          Open in Gmail <ExternalLink size={12} />
        </a>
      </p>
    </div>
  );
}

const kindLabel: Record<InboxEmail['kind'], [string, string]> = {
  offers: ['Offers', 'green'],
  unparsed: ['Check email', 'amber'],
  link: ['Jobs on linked page', 'blue'],
  other: ['Not a job offer', ''],
};

function EmailList({
  emails,
  showEnded,
  onFix,
  onOpen,
  setStatus,
  showHidden,
  setShowHidden,
  hiddenCount,
}: {
  emails: InboxEmail[];
  showEnded: boolean;
  onFix: (e: InboxEmail, v: EmailVacancy) => void;
  onOpen: (id: string) => void;
  setStatus: (ids: string[], status: InboxEmail['status']) => Promise<void>;
  showHidden: boolean;
  setShowHidden: (v: boolean) => void;
  hiddenCount: number;
}) {
  const sorted = [...emails].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  const relevant = sorted.filter((e) => e.kind !== 'other');
  const other = sorted.filter((e) => e.kind === 'other');
  const unread = relevant.filter((e) => e.status === 'new').map((e) => e.id);
  return (
    <div className="email-list">
      <div className="button-row small">
        {unread.length > 0 && (
          <button className="text-button" onClick={() => setStatus(unread, 'seen')}>
            Mark {unread.length} as read
          </button>
        )}
        {hiddenCount > 0 && (
          <button className="text-button" onClick={() => setShowHidden(!showHidden)}>
            {showHidden ? 'Hide' : 'Show'} {hiddenCount} hidden
          </button>
        )}
      </div>
      {relevant.map((e) => (
        <EmailCard
          key={e.id}
          email={e}
          showEnded={showEnded}
          onFix={onFix}
          onOpen={onOpen}
          setStatus={setStatus}
        />
      ))}
      {other.length > 0 && (
        <details className="panel other-emails">
          <summary>
            {other.length} other email{other.length === 1 ? '' : 's'} from these agencies
            (newsletters, reminders, admin)
          </summary>
          {other.map((e) => (
            <EmailCard
              key={e.id}
              email={e}
              showEnded={showEnded}
              onFix={onFix}
              onOpen={onOpen}
              setStatus={setStatus}
            />
          ))}
        </details>
      )}
    </div>
  );
}

function EmailCard({
  email,
  showEnded,
  onFix,
  onOpen,
  setStatus,
}: {
  email: InboxEmail;
  showEnded: boolean;
  onFix: (e: InboxEmail, v: EmailVacancy) => void;
  onOpen: (id: string) => void;
  setStatus: (ids: string[], status: InboxEmail['status']) => Promise<void>;
}) {
  const [label, tone] = kindLabel[email.kind];
  const [all, setAll] = useState(false);
  const list = email.vacancies.filter((v) => showEnded || !v.ended);
  const shown = all ? list : list.slice(0, 8);
  const ended = email.vacancies.length - list.length;
  return (
    <article className={`email-card ${email.status === 'new' ? 'unread' : ''}`}>
      <header>
        <div>
          <p className="email-meta">
            {email.status === 'new' && email.kind !== 'other' && (
              <span className="unread-dot" aria-label="New" />
            )}
            <strong>{email.recruiter}</strong> · {email.agency} · {received(email.receivedAt)}
          </p>
          <h3>{email.subject}</h3>
          <p className="small muted">
            <Badge tone={tone}>{label}</Badge> {email.summary}
            {email.permanent && (
              <>
                {' '}
                <Badge tone="sand">Permanent role</Badge>
              </>
            )}
          </p>
        </div>
        <div className="email-actions">
          <a
            className="icon-button"
            href={email.gmailUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Open in Gmail"
            title="Open in Gmail"
          >
            <ArrowUpRight size={16} />
          </a>
          <button
            className="icon-button"
            aria-label={email.status === 'dismissed' ? 'Show again' : 'Hide this email'}
            title={email.status === 'dismissed' ? 'Show again' : 'Hide this email'}
            onClick={() =>
              setStatus([email.id], email.status === 'dismissed' ? 'seen' : 'dismissed')
            }
          >
            <EyeOff size={16} />
          </button>
        </div>
      </header>
      {list.length > 0 && (
        <ul className="email-vacancies">
          {shown.map((v) => {
            const when = span(v);
            return (
              <li key={v.id}>
                <span className="ev-place">
                  {v.hospital || v.town || <em className="muted">Hospital not named</em>}
                  {v.state && <em>{v.state}</em>}
                </span>
                <span className="ev-role">{v.role}</span>
                <span className="ev-when">
                  {when.range}
                  <small>{when.length}</small>
                </span>
                <span className="ev-pay">
                  {rate(v).main} <Perks v={v} />
                </span>
                <StatusPill v={v} onFix={() => onFix(email, v)} onOpen={onOpen} />
              </li>
            );
          })}
        </ul>
      )}
      {list.length > shown.length && (
        <button className="text-button email-more" onClick={() => setAll(true)}>
          Show all {list.length} vacancies
        </button>
      )}
      {ended > 0 && (
        <p className="small muted">
          {ended} ended vacanc{ended === 1 ? 'y' : 'ies'} hidden.
        </p>
      )}
      {email.links.length > 0 && (
        <div className="button-row">
          {email.links.map((l) => (
            <a
              key={l.url}
              className="button secondary small"
              href={l.url}
              target="_blank"
              rel="noreferrer"
            >
              {l.label} <ExternalLink size={13} />
            </a>
          ))}
        </div>
      )}
      <details className="email-body">
        <summary>Show email text</summary>
        <pre>{email.body}</pre>
      </details>
    </article>
  );
}
