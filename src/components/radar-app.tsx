'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  Radar,
  Compass,
  Bookmark,
  Columns3,
  CalendarDays,
  ShieldQuestion,
  Radio,
  SlidersHorizontal,
  Search,
  Plus,
  ArrowUpRight,
  MapPin,
  Plane,
  House,
  ArrowRight,
  LayoutGrid,
  Map,
  Check,
  X,
  Download,
  Leaf,
  ChevronDown,
  CircleHelp,
  LogOut,
  Menu,
  Bell,
  Mail,
} from 'lucide-react';
import { demoStore } from '@/domain/seed';
import {
  dimensions,
  specialties,
  states,
  type ListingInput,
  type Profile,
  type Stage,
  type Store,
  type Weights,
} from '@/domain/model';
import { duration, evaluate, normalisePay, presets, type EvaluatedJob } from '@/domain/engine';
import { api, Badge, dateLabel, Empty, money, rateLabel } from './shared';
import { ProfileForm } from './profile-form';
import { ImportDialog } from './import-dialog';
import { OpportunityDetail } from './opportunity-detail';
import { CalendarView, ComparisonView, GeographicExplorer } from './explorer';
import { SourcesView } from './sources-view';
import { RecruiterInbox } from './recruiter-inbox';
import { InboxCard } from './inbox-card';
import { hoursSinceImport, runInboxImport, type ImportProgress } from './inbox-import';
import { inboxSettings } from '@/domain/agencies';
import { CollectionProgress } from './collection-progress';
import { PendingJobCard } from './collected-adverts';
import { jobPool, matchesPool, poolRate, olderEmail } from '@/domain/job-pool';

type View =
  | 'Discover'
  | 'Inbox'
  | 'Shortlist'
  | 'Compare'
  | 'Calendar'
  | 'Review queue'
  | 'Sources'
  | 'My profile';
const nav = [
  { name: 'Discover', icon: Compass },
  { name: 'Inbox', icon: Mail },
  { name: 'Shortlist', icon: Bookmark },
  { name: 'Compare', icon: Columns3 },
  { name: 'Calendar', icon: CalendarDays },
  { name: 'Review queue', icon: ShieldQuestion },
  { name: 'Sources', icon: Radio },
] as const;
const dimensionNames: Record<keyof Weights, string> = {
  financial: 'Income',
  adventure: 'Location & adventure',
  clinical: 'Clinical interest',
  logistics: 'Travel & logistics',
  quality: 'Availability evidence',
};

function OpportunityCard({
  job,
  selected,
  onSelect,
  onCompare,
  onSave,
}: {
  job: EvaluatedJob;
  selected: boolean;
  onSelect: () => void;
  onCompare: () => void;
  onSave: () => void;
}) {
  const o = job.opportunity,
    best =
      job.activeOffers.find(
        (offer) =>
          job.ranking.bestHourly !== null &&
          normalisePay(offer.compensation).hourly === job.ranking.bestHourly,
      ) ?? job.activeOffers[0];
  const saved = job.action && !['Discovered', 'Dismissed', 'Declined'].includes(job.action.stage);
  return (
    <article className={`job-card ${selected ? 'selected' : ''}`}>
      <div className="card-top">
        <Badge
          tone={
            o.specialty === 'Psychiatry'
              ? 'lavender'
              : o.specialty === 'Emergency medicine'
                ? 'sand'
                : 'blue'
          }
        >
          {o.specialty}
        </Badge>
        <button
          className={`icon-button save-button ${saved ? 'saved' : ''}`}
          onClick={onSave}
          aria-label={`${saved ? 'Unsave' : 'Save'} ${job.facility.name}`}
          aria-pressed={!!saved}
        >
          <Bookmark size={19} fill={saved ? 'currentColor' : 'none'} />
        </button>
      </div>
      <div className="card-heading">
        <button className="card-title" onClick={onSelect}>
          {job.facility.name}
        </button>
        <span className="grade-label">{o.grade}</span>
      </div>
      <p className="location">
        <MapPin size={14} />
        {job.facility.town}, {job.facility.state}
        <span>·</span>
        {o.demo
          ? 'Example vacancy'
          : job.ageDays === 0
            ? 'Observed today'
            : `Observed ${job.ageDays}d ago`}
      </p>
      <div className="card-dates">
        <CalendarDays size={15} />
        <span>
          {dateLabel(o.startDate)} – {dateLabel(o.endDate, true)}
        </span>
        <span className="duration">{duration(o)} days</span>
      </div>
      <div className="card-pay">
        <div>
          <strong>{best ? rateLabel(best.compensation) : 'Rate on enquiry'}</strong>
          <p>
            {job.ranking.bestHourly !== null
              ? `${money(job.ranking.bestHourly)} comparable hourly`
              : 'Hourly comparison unavailable'}
          </p>
        </div>
        <div
          className={`score-circle ${!job.rankable ? 'unranked' : ''}`}
          title={
            job.rankable
              ? 'Personal preference score, independent of eligibility'
              : 'Preference preview only; not ranked as suitable'
          }
        >
          {job.ranking.score ?? '—'}
          <span>{job.rankable ? 'MATCH' : 'PREVIEW'}</span>
        </div>
      </div>
      <div className="perks">
        <span>
          <Plane size={14} />
          {best?.flights === 'included'
            ? 'Flights included'
            : `Flights ${best?.flights || 'unknown'}`}
        </span>
        <span>
          <House size={14} />
          {best?.accommodation === 'included'
            ? 'Stay included'
            : `Stay ${best?.accommodation || 'unknown'}`}
        </span>
      </div>
      <div className="card-evidence">
        <span className={`status-dot ${job.rankable ? '' : 'amber'}`} />
        {job.eligibility.status}
        <span className="evidence-count">{job.ranking.evidence}% scoring evidence</span>
      </div>
      <footer className="card-footer">
        <button className="text-button" onClick={onSelect}>
          {job.offers.length} offer{job.offers.length === 1 ? '' : 's'}
          <ArrowUpRight size={14} />
        </button>
        <button
          className={`text-button compare-button ${selected ? 'active' : ''}`}
          onClick={onCompare}
          aria-pressed={selected}
        >
          {selected ? <Check size={14} /> : <Plus size={14} />}
          {selected ? 'Comparing' : 'Compare'}
        </button>
      </footer>
    </article>
  );
}

export function RadarApp() {
  const [live, setLive] = useState<Store | null>(null),
    [example, setExample] = useState<Store>(() => demoStore()),
    [demo, setDemo] = useState(true),
    [loaded, setLoaded] = useState(false),
    [loginRequired, setLoginRequired] = useState(false),
    [hasPassword, setHasPassword] = useState(false);
  const [sourceSettingsOpen, setSourceSettingsOpen] = useState(false);
  const [inboxAuto, setInboxAuto] = useState(false),
    [inboxPanel, setInboxPanel] = useState<'paste' | 'settings' | null>(null),
    [backgroundImport, setBackgroundImport] = useState<ImportProgress | null>(null);
  const [view, setView] = useState<View>('Discover'),
    [search, setSearch] = useState(''),
    [specialty, setSpecialty] = useState(''),
    [state, setState] = useState(''),
    [eligibility, setEligibility] = useState('all'),
    [year, setYear] = useState(''),
    [travel, setTravel] = useState(false),
    [grade, setGrade] = useState('');
  const [sourceFilter, setSourceFilter] = useState(''),
    [minimumPay, setMinimumPay] = useState(''),
    [payUnit, setPayUnit] = useState('hour'),
    [sort, setSort] = useState('recent');
  const [includeOlderEmails, setIncludeOlderEmails] = useState(false);
  const [display, setDisplay] = useState<'cards' | 'map'>('cards'),
    [selected, setSelected] = useState<string[]>([]),
    [detail, setDetail] = useState<string | null>(null),
    [importing, setImporting] = useState(false),
    [importDraft, setImportDraft] = useState<Partial<ListingInput> | undefined>(),
    [reviewId, setReviewId] = useState<string | undefined>();
  const [weights, setWeights] = useState<Weights | null>(null),
    [preset, setPreset] = useState('Best overall'),
    [toast, setToast] = useState(''),
    [menuOpen, setMenuOpen] = useState(false),
    [password, setPassword] = useState(''),
    [loginError, setLoginError] = useState('');
  const [extraFilters, setExtraFilters] = useState(false),
    [savingWeights, setSavingWeights] = useState(false);
  /** Imports new recruiter emails in the background when the last import is stale. */
  async function autoImport(value: Store) {
    const settings = inboxSettings(value);
    if (!settings.autoImport || hoursSinceImport(value.inbox ?? []) < 6) return;
    try {
      const gmail = await (await fetch('/api/gmail', { cache: 'no-store' })).json();
      if (!gmail.connected) return;
      const p = await runInboxImport({ onProgress: setBackgroundImport, onBatch: reload });
      // A first import into an empty workspace replaces the example data.
      if (p.vacancies) setDemo(false);
      if (p.added)
        setToast(
          `Recruiter inbox: ${p.added} new vacanc${p.added === 1 ? 'y' : 'ies'} added to your feed.`,
        );
    } catch {
      // Background import is best-effort; the inbox page shows errors when run by hand.
    } finally {
      setBackgroundImport(null);
    }
  }
  function openInbox(panel: 'paste' | 'settings' | null = null, start = false) {
    if (demo) changeMode(false);
    setInboxPanel(panel);
    setInboxAuto(start);
    navigate('Inbox');
  }
  async function reload() {
    const r = await fetch('/api/radar', { cache: 'no-store' });
    if (r.status === 401) {
      setLoginRequired(true);
      return;
    }
    const value = await r.json();
    if (!r.ok) throw new Error(value.error || 'Unable to load workspace');
    setLive(value);
  }
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const r = await fetch('/api/session');
        const session = await r.json();
        if (!r.ok) throw new Error(session.error);
        if (!active) return;
        setHasPassword(session.passwordRequired);
        if (!session.authenticated) {
          setLoginRequired(true);
          setLoaded(true);
          return;
        }
        const response = await fetch('/api/radar', { cache: 'no-store' });
        const value = await response.json();
        if (!response.ok) throw new Error(value.error);
        if (active) {
          setLive(value);
          const connected =
            new URLSearchParams(window.location.search).get('gmail') === 'connected';
          if (new URLSearchParams(window.location.search).has('gmail')) {
            setView(connected ? 'Inbox' : 'Discover');
            setInboxAuto(connected);
            setToast(
              connected
                ? 'Gmail connected. Importing your recruiter emails…'
                : 'Google connection was not completed. Check the setup details and try again.',
            );
          }
          setDemo(
            !value.starterAvailable &&
              value.opportunities.length === 0 &&
              !value.reviews.length &&
              !value.inbox?.length &&
              !connected,
          );
          setLoaded(true);
          if (!connected) void autoImport(value);
        }
      } catch (e) {
        if (active) {
          setToast((e as Error).message);
          setLoaded(true);
        }
      }
    })();
    return () => {
      active = false;
    };
    // Runs once on opening the workspace; autoImport only reads stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 7000);
    return () => clearTimeout(timer);
  }, [toast]);
  const base = demo ? example : live;
  const store = useMemo(
    () =>
      base
        ? { ...base, profile: { ...base.profile, weights: weights ?? base.profile.weights } }
        : null,
    [base, weights],
  );
  const jobs = useMemo(() => (store ? evaluate(store) : []), [store]);
  const shortlist = jobs.filter(
    (j) => j.action && !['Discovered', 'Dismissed', 'Declined'].includes(j.action.stage),
  );
  const [includeHeldEmails, setIncludeHeldEmails] = useState(false);
  const pool = useMemo(
    () => (store ? jobPool(store, jobs, includeHeldEmails) : []),
    [store, jobs, includeHeldEmails],
  );
  const activeReviews = (store?.reviews || []).filter(
    (r) =>
      !r.resolved &&
      (r.kind !== 'extraction' ||
        (!!r.emailScreen && r.emailScreen.status !== 'offer') ||
        pool.some((item) => item.review?.id === r.id)),
  );
  const newOffers = (store?.inbox ?? []).filter(
    (e) => e.status === 'new' && e.vacancies.some((v) => !v.ended),
  ).length;
  const pendingReviews =
    activeReviews.length + jobs.filter((j) => j.eligibility.status === 'Needs verification').length;
  const visiblePool = pool
    .filter((item) => {
      if (!includeOlderEmails && view !== 'Shortlist' && olderEmail(item)) return false;
      if (view === 'Shortlist' && (!item.job || !shortlist.includes(item.job))) return false;
      if (view !== 'Shortlist' && ['Dismissed', 'Declined'].includes(item.job?.action?.stage || ''))
        return false;
      return matchesPool(item, {
        search,
        specialty,
        state,
        grade,
        year,
        source: sourceFilter,
        minimumPay: Number(minimumPay) || 0,
        payUnit,
        suitability: view === 'Shortlist' ? 'all' : eligibility,
        travel,
      });
    })
    .sort((a, b) =>
      sort === 'pay'
        ? poolRate(b, payUnit, sourceFilter) - poolRate(a, payUnit, sourceFilter)
        : sort === 'match'
          ? (b.job?.ranking.score ?? -1) - (a.job?.ranking.score ?? -1)
          : b.updatedAt.localeCompare(a.updatedAt),
    );
  const filtered = visiblePool.flatMap((item) => (item.job ? [item.job] : []));
  function changeMode(value: boolean) {
    setDemo(value);
    setWeights(null);
    setSelected([]);
    setDetail(null);
    setView('Discover');
    setEligibility('all');
  }
  function navigate(name: View) {
    setView(name === 'Sources' ? 'Discover' : name);
    if (name === 'Sources') {
      setSourceSettingsOpen(true);
      setTimeout(
        () => document.getElementById('source-settings')?.scrollIntoView({ behavior: 'smooth' }),
        0,
      );
    }
    setMenuOpen(false);
  }
  async function action(id: string, stage: Stage, notes: string) {
    if (demo) {
      setExample((prev) => ({
        ...prev,
        actions: [
          ...prev.actions.filter((a) => a.opportunityId !== id),
          { opportunityId: id, stage, notes, updatedAt: new Date().toISOString() },
        ],
      }));
    } else {
      await api({ command: 'action', opportunityId: id, stage, notes });
      await reload();
    }
  }
  function compare(id: string) {
    if (selected.includes(id)) setSelected(selected.filter((v) => v !== id));
    else if (selected.length === 4) setToast('Compare up to four opportunities at a time.');
    else setSelected([...selected, id]);
  }
  async function saveProfile(profile: Profile) {
    if (demo) setExample((prev) => ({ ...prev, profile }));
    else {
      await api({ command: 'profile', profile });
      await reload();
    }
    setWeights(null);
    setToast(demo ? 'Example profile updated' : 'Your profile was saved');
  }
  function openImport(draft?: Partial<ListingInput>, id?: string) {
    if (demo) {
      changeMode(false);
    }
    setImportDraft(draft);
    setReviewId(id);
    setImporting(true);
  }
  function exportCsv() {
    const rows = [
      [
        'Title',
        'Facility',
        'State',
        'Specialty',
        'Grade',
        'Start',
        'End',
        'Sources',
        'Advertised rates',
        'Eligibility',
        'Comparable hourly AUD',
        'Stage',
      ],
      ...visiblePool.map((item) => [
        item.title,
        item.job?.facility.name || item.review?.draft?.facilityName || '',
        item.state,
        item.specialty,
        item.grade,
        item.startDate,
        item.endDate,
        item.sources.map((id) => store?.sources.find((s) => s.id === id)?.name || id).join('; '),
        item.pay.map(rateLabel).join('; '),
        item.job?.eligibility.status || 'Needs verification',
        item.job?.ranking.bestHourly ?? '',
        item.job?.action?.stage || 'Discovered',
      ]),
    ];
    const csv = rows
      .map((row) =>
        row
          .map((value) => {
            let s = String(value);
            if (/^[=+@\-\t\r\n]/.test(s)) s = `'${s}`;
            return `"${s.replace(/"/g, '""')}"`;
          })
          .join(','),
      )
      .join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `locum-radar-${demo ? 'examples' : 'workspace'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  if (loginRequired)
    return (
      <main className="login-shell">
        <div className="login-card">
          <div className="brand dark-brand">
            <Radar size={34} />
            <span>
              locum<span className="brand-light">radar</span>
            </span>
          </div>
          <p className="eyebrow">YOUR PRIVATE WORKSPACE</p>
          <h1>Welcome back.</h1>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const r = await fetch('/api/session', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ password }),
                });
                const result = await r.json();
                if (!r.ok) throw new Error(result.error);
                setPassword('');
                setLoginRequired(false);
                await reload();
              } catch (e) {
                setLoginError((e as Error).message);
              }
            }}
          >
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            <button className="button primary">
              Open my radar <ArrowRight size={16} />
            </button>
            {loginError && (
              <p className="error" role="alert">
                {loginError}
              </p>
            )}
          </form>
        </div>
      </main>
    );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <a className="brand" href="/" aria-label="Locum Radar home">
          <Radar size={33} strokeWidth={1.6} />
          <span>
            locum<span className="brand-light">radar</span>
            <small>A BETTER WAY TO LOCUM</small>
          </span>
        </a>
        <div className="workspace-label">
          <span className="status-dot" />
          PERSONAL WORKSPACE
        </div>
        <nav aria-label="Main navigation">
          {nav.map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={view === name ? 'nav-link active' : 'nav-link'}
              onClick={() => navigate(name)}
            >
              <Icon size={19} />
              <span>
                {name === 'Sources'
                  ? 'Source settings'
                  : name === 'Inbox'
                    ? 'Recruiter inbox'
                    : name}
              </span>
              {name === 'Inbox' && newOffers > 0 && <b>{newOffers}</b>}
              {name === 'Shortlist' && shortlist.length > 0 && <b>{shortlist.length}</b>}
              {name === 'Compare' && selected.length > 0 && <b>{selected.length}</b>}
              {name === 'Review queue' && pendingReviews > 0 && <b>{pendingReviews}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <Leaf size={22} />
          <h3>
            Work well.
            <br />
            Wander a little.
          </h3>
          <p>The right placement has more to offer than a payslip.</p>
        </div>
        <div className="sidebar-bottom">
          <button
            className={`nav-link ${view === 'My profile' ? 'active' : ''}`}
            onClick={() => navigate('My profile')}
          >
            <SlidersHorizontal size={18} />
            <span>My profile & preferences</span>
          </button>
          <div className="profile-chip">
            <span className="avatar">
              {demo ? 'EX' : (store?.profile.name || 'My').slice(0, 2).toUpperCase()}
            </span>
            <div>
              <strong>{demo ? 'Example doctor' : store?.profile.name || 'My workspace'}</strong>
              <small>{store?.profile.homeBase || 'Cairns, QLD'}</small>
            </div>
            {hasPassword && (
              <button
                className="icon-button"
                aria-label="Sign out"
                onClick={async () => {
                  await fetch('/api/session', { method: 'DELETE' });
                  setLive(null);
                  setLoginRequired(true);
                }}
              >
                <LogOut size={16} />
              </button>
            )}
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="button-row">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Toggle navigation"
            >
              <Menu size={22} />
            </button>
            <span className="breadcrumb">
              My workspace <span>/</span> <strong>{view}</strong>
            </span>
          </div>
          <div className="topbar-actions">
            <span className="private-indicator">
              <span className="status-dot" />
              Private by design
            </span>
            <button
              className="icon-button"
              aria-label="View items needing attention"
              onClick={() => navigate('Review queue')}
            >
              <Bell size={19} />
            </button>
            <span className="avatar small-avatar">{demo ? 'EX' : 'ME'}</span>
          </div>
        </header>
        <main id="main" className="main-content">
          <div className={`demo-banner ${!demo ? 'live-banner' : ''}`}>
            <div>
              <span className="demo-dot" />
              <strong>{demo ? 'Explore the example workspace' : 'Your private workspace'}</strong>
              <span>
                {demo
                  ? 'Fictional vacancies and a sample doctor profile. No live jobs or credentials are implied.'
                  : 'Your records stay in your configured database. New adverts appear immediately; review confirms missing details.'}
              </span>
            </div>
            <button onClick={() => changeMode(!demo)}>
              {demo ? 'Open my workspace' : 'Explore examples'}
              <ArrowRight size={15} />
            </button>
          </div>
          {!loaded && (
            <p role="status" className="notice">
              Opening your private workspace…
            </p>
          )}
          {loaded && !store && (
            <Empty title="Your workspace is unavailable">
              {toast || 'Check that the local server and database are available.'}
              <button
                className="button secondary"
                onClick={() => reload().catch((e) => setToast(e.message))}
              >
                Try again
              </button>
            </Empty>
          )}
          {store && (
            <>
              {(view === 'Discover' || view === 'Shortlist') && (
                <>
                  <div className="page-heading">
                    <div>
                      <p className="eyebrow">YOUR 2027, ON YOUR TERMS</p>
                      <h1>
                        {view === 'Shortlist'
                          ? 'The ones worth a closer look.'
                          : 'Find your next locum job.'}
                      </h1>
                      <p>
                        {view === 'Shortlist'
                          ? 'Your saved opportunities and the next steps that make them happen.'
                          : 'Public boards and recruiter emails, together in one searchable job list.'}
                      </p>
                    </div>
                    <div className="button-row">
                      <button className="button secondary export-button" onClick={exportCsv}>
                        <Download size={16} />
                        Export
                      </button>
                      {!demo && (
                        <button className="button secondary" onClick={() => openInbox(null, true)}>
                          Import from Gmail
                        </button>
                      )}
                      <button className="button primary" onClick={() => openImport()}>
                        <Plus size={17} />
                        Import opportunities
                      </button>
                    </div>
                  </div>
                  <details className="panel">
                    <summary>Workspace overview: {pool.length} opportunities</summary>
                    <div className="stats-grid">
                      <div className="stat">
                        <span>
                          Observed opportunities
                          <Compass size={17} />
                        </span>
                        <strong>
                          {pool.length}
                          <small>{demo ? 'illustrative examples' : 'across all sources'}</small>
                        </strong>
                        <p>{store.listings.length} advertisements, reconciled</p>
                      </div>
                      <div className="stat">
                        <span>
                          Suitable matches
                          <Check size={17} />
                        </span>
                        <strong>
                          {jobs.filter((j) => j.rankable).length}
                          <small>match your profile</small>
                        </strong>
                        <p>Eligibility comes before preference</p>
                      </div>
                      <div className="stat">
                        <span>
                          Worth verifying
                          <ShieldQuestion size={17} />
                        </span>
                        <strong>
                          {
                            pool.filter(
                              (item) =>
                                !item.job || item.job.eligibility.status === 'Needs verification',
                            ).length
                          }
                          <small>need a closer look</small>
                        </strong>
                        <button className="text-button" onClick={() => navigate('Review queue')}>
                          Open review queue <ArrowRight size={13} />
                        </button>
                      </div>
                      <div className="stat">
                        <span>
                          Source visibility
                          <Radio size={17} />
                        </span>
                        <strong>
                          {store.sources.filter((s) => s.lastSuccess).length}
                          <small>sources collected</small>
                        </strong>
                        <button className="text-button" onClick={() => navigate('Sources')}>
                          {demo ? 'Example records only' : 'See coverage & gaps'}{' '}
                          <ArrowRight size={13} />
                        </button>
                      </div>
                    </div>
                  </details>
                  <div className="acquisition-grid">
                    {view === 'Discover' && (
                      <CollectionProgress
                        knownCount={pool.length}
                        demo={demo}
                        reload={reload}
                        onSettings={() => {
                          setDemo(false);
                          navigate('Sources');
                        }}
                      />
                    )}
                    {view === 'Discover' && !demo && (
                      <InboxCard
                        store={store}
                        background={backgroundImport}
                        onImport={() => openInbox(null, true)}
                        onPaste={() => openInbox('paste')}
                        onOpen={() => openInbox()}
                      />
                    )}
                  </div>
                  {view === 'Discover' && (
                    <details
                      className="panel"
                      id="source-settings"
                      open={sourceSettingsOpen}
                      onToggle={(e) => setSourceSettingsOpen(e.currentTarget.open)}
                    >
                      <summary>Agency job boards</summary>
                      <SourcesView store={store} demo={demo} reload={reload} notify={setToast} />
                    </details>
                  )}
                  {!demo && store.profile.registration === 'unknown' && (
                    <div className="onboarding-note">
                      <ShieldQuestion size={21} />
                      <span>
                        <strong>Let’s establish what’s suitable for you.</strong> Confirm your
                        registration, grades and supervision needs to build your ranked feed.
                      </span>
                      <button
                        className="button secondary small"
                        onClick={() => navigate('My profile')}
                      >
                        Set up my profile
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  )}
                  <div className="discover-layout">
                    <div className="results-column">
                      <section className="filter-panel" aria-label="Opportunity filters">
                        <div className="search-field">
                          <Search size={18} />
                          <input
                            aria-label="Search opportunities"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search hospitals, places or roles…"
                          />
                        </div>
                        <div className="filter-row">
                          <label className="compact-select">
                            <span className="sr-only">Specialty</span>
                            <select
                              aria-label="Specialty"
                              value={specialty}
                              onChange={(e) => setSpecialty(e.target.value)}
                            >
                              <option value="">All specialties</option>
                              {specialties.map((s) => (
                                <option key={s}>{s}</option>
                              ))}
                            </select>
                          </label>
                          <label className="compact-select">
                            <span className="sr-only">State</span>
                            <select value={state} onChange={(e) => setState(e.target.value)}>
                              <option value="">Anywhere in Australia</option>
                              {states.map((s) => (
                                <option key={s}>{s}</option>
                              ))}
                            </select>
                          </label>
                          <label className="compact-select">
                            <span className="sr-only">Year</span>
                            <select value={year} onChange={(e) => setYear(e.target.value)}>
                              <option value="2027">2027 placements</option>
                              <option value="2026">2026 placements</option>
                              <option value="">All dates</option>
                            </select>
                          </label>
                          <button
                            className={`button filter-toggle ${extraFilters ? 'active' : ''}`}
                            onClick={() => setExtraFilters(!extraFilters)}
                          >
                            <SlidersHorizontal size={15} />
                            Filters
                          </button>
                        </div>
                        <div className="filter-row">
                          <label className="compact-select">
                            <span className="sr-only">Source</span>
                            <select
                              aria-label="Filter by source"
                              value={sourceFilter}
                              onChange={(e) => setSourceFilter(e.target.value)}
                            >
                              <option value="">All sources, including email</option>
                              {store.sources.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="compact-select">
                            <span className="sr-only">Pay unit</span>
                            <select
                              aria-label="Pay unit"
                              value={payUnit}
                              onChange={(e) => setPayUnit(e.target.value)}
                            >
                              <option value="hour">AUD per hour</option>
                              <option value="day">AUD per day</option>
                              <option value="shift">AUD per shift</option>
                              <option value="placement">AUD per placement</option>
                            </select>
                          </label>
                          <input
                            aria-label="Minimum advertised rate"
                            type="number"
                            min="0"
                            placeholder="Minimum rate"
                            value={minimumPay}
                            onChange={(e) => setMinimumPay(e.target.value)}
                          />
                          <label className="compact-select">
                            <span className="sr-only">Sort opportunities</span>
                            <select
                              aria-label="Sort opportunities"
                              value={sort}
                              onChange={(e) => setSort(e.target.value)}
                            >
                              <option value="recent">Recently found or updated</option>
                              <option value="pay">Highest rate in selected unit</option>
                              <option value="match">Best personal match</option>
                            </select>
                          </label>
                        </div>
                        <label className="checkbox-row">
                          <input
                            type="checkbox"
                            checked={includeOlderEmails}
                            onChange={(e) => setIncludeOlderEmails(e.target.checked)}
                          />
                          Include emails older than 30 days (
                          {pool.filter((item) => olderEmail(item)).length})
                        </label>
                        <label className="checkbox-row">
                          <input
                            type="checkbox"
                            checked={includeHeldEmails}
                            onChange={(e) => setIncludeHeldEmails(e.target.checked)}
                          />
                          Show emails held for screening (not confirmed offers)
                        </label>
                        <p className="small muted">
                          Email freshness uses the original message date, not the import date.
                          Unknown dates stay visible; recent email does not guarantee availability.
                        </p>
                        <p className="small muted">
                          One pool from public boards, connected email and imports. Unknown details
                          stay visible; a minimum rate filters only known AUD rates in the selected
                          unit.
                        </p>
                        {extraFilters && (
                          <div className="extra-filters">
                            <label>
                              Suitability
                              <select
                                value={eligibility}
                                onChange={(e) => setEligibility(e.target.value)}
                              >
                                <option value="suitable">Suitable matches</option>
                                <option value="all">All records</option>
                                {[
                                  'Eligible',
                                  'Likely eligible',
                                  'Needs verification',
                                  'Ineligible',
                                  'Expired/unavailable',
                                ].map((v) => (
                                  <option key={v}>{v}</option>
                                ))}
                              </select>
                            </label>
                            <label>
                              Grade
                              <select value={grade} onChange={(e) => setGrade(e.target.value)}>
                                <option value="">All grades</option>
                                {['RMO', 'SRMO', 'PHO', 'Registrar', 'CMO', 'Consultant', 'GP'].map(
                                  (v) => (
                                    <option key={v}>{v}</option>
                                  ),
                                )}
                              </select>
                            </label>
                            <label className="checkbox-row">
                              <input
                                type="checkbox"
                                checked={travel}
                                onChange={(e) => setTravel(e.target.checked)}
                              />
                              Flights & stay included
                            </label>
                            <button
                              className="text-button small"
                              onClick={() => {
                                setSearch('');
                                setSpecialty('');
                                setState('');
                                setGrade('');
                                setTravel(false);
                                setYear('');
                                setMinimumPay('');
                                setSourceFilter('');
                                setEligibility('all');
                              }}
                            >
                              Reset filters
                            </button>
                          </div>
                        )}
                      </section>
                      <div className="results-toolbar" id="job-board">
                        <div>
                          <strong>
                            {visiblePool.length}{' '}
                            {view === 'Shortlist' ? 'saved opportunities' : 'opportunities'}
                          </strong>
                          <span>
                            {' '}
                            · {eligibility === 'suitable' ? 'ranked for you' : 'filtered records'}
                          </span>
                        </div>
                        <div className="view-toggle" aria-label="Result display">
                          <button
                            aria-label="Card view"
                            aria-pressed={display === 'cards'}
                            className={display === 'cards' ? 'active' : ''}
                            onClick={() => setDisplay('cards')}
                          >
                            <LayoutGrid size={16} />
                          </button>
                          <button
                            aria-label="Map view"
                            aria-pressed={display === 'map'}
                            className={display === 'map' ? 'active' : ''}
                            onClick={() => setDisplay('map')}
                          >
                            <Map size={16} />
                          </button>
                        </div>
                      </div>
                      {display === 'map' ? (
                        <>
                          <p className="small muted">
                            {visiblePool.length - filtered.length} adverts need confirmed facilities
                            before they can appear on the map. All remain in card view.
                          </p>
                          <GeographicExplorer jobs={filtered} store={store} onSelect={setDetail} />
                        </>
                      ) : visiblePool.length ? (
                        <div className="job-grid" aria-label="Master opportunity pool">
                          {visiblePool.map((item) => {
                            const job = item.job;
                            return job ? (
                              <div key={item.id}>
                                {item.review && (
                                  <button
                                    className="text-button small"
                                    onClick={() =>
                                      openImport(item.review!.draft || undefined, item.review!.id)
                                    }
                                  >
                                    Updated source details — review
                                  </button>
                                )}
                                <OpportunityCard
                                  key={job.opportunity.id}
                                  job={job}
                                  selected={selected.includes(job.opportunity.id)}
                                  onSelect={() => setDetail(job.opportunity.id)}
                                  onCompare={() => compare(job.opportunity.id)}
                                  onSave={() =>
                                    action(
                                      job.opportunity.id,
                                      job.action?.stage &&
                                        !['Discovered', 'Dismissed', 'Declined'].includes(
                                          job.action.stage,
                                        )
                                        ? 'Discovered'
                                        : 'Saved',
                                      job.action?.notes || '',
                                    ).catch((e) => setToast(e.message))
                                  }
                                />
                              </div>
                            ) : (
                              <PendingJobCard
                                key={item.id}
                                item={item.review!}
                                store={store}
                                onReview={() =>
                                  openImport(item.review!.draft || undefined, item.review!.id)
                                }
                              />
                            );
                          })}
                        </div>
                      ) : (
                        <Empty
                          title={
                            !pool.length
                              ? 'Finding your first opportunities.'
                              : 'No opportunities in this view.'
                          }
                        >
                          <p>
                            {!pool.length
                              ? 'Connected sources add roles here as they are found. You can also import a recruiter email or advertisement.'
                              : 'Try broader filters. Roles with missing details are included unless a filter requires those details.'}
                          </p>
                          <button
                            className="button primary"
                            onClick={() =>
                              store.opportunities.length ? navigate('Review queue') : openImport()
                            }
                          >
                            {store.opportunities.length
                              ? 'Open review queue'
                              : 'Import your first opportunity'}
                            <ArrowRight size={16} />
                          </button>
                        </Empty>
                      )}
                      <p className="results-footnote">
                        <CircleHelp size={14} />
                        Advertised does not mean confirmed available. Verify terms with the
                        recruiter before committing.
                      </p>
                    </div>
                    <aside className="ranking-column">
                      <section className="ranking-panel">
                        <div className="spread">
                          <h2>Your kind of good.</h2>
                          <SlidersHorizontal size={18} />
                        </div>
                        <p>
                          A great job means different things to different people. Set your balance.
                        </p>
                        <label className="preset-label">
                          Ranking preset
                          <select
                            value={preset}
                            onChange={(e) => {
                              setPreset(e.target.value);
                              setWeights(presets[e.target.value]);
                            }}
                          >
                            <option value="Custom" disabled>
                              Custom balance
                            </option>
                            {Object.keys(presets).map((p) => (
                              <option key={p}>{p}</option>
                            ))}
                          </select>
                          <ChevronDown size={15} />
                        </label>
                        <div className="weight-sliders">
                          {dimensions.map((d) => (
                            <label key={d}>
                              <span>
                                {dimensionNames[d]}
                                <strong>{store.profile.weights[d]}</strong>
                              </span>
                              <input
                                type="range"
                                min="0"
                                max="100"
                                value={store.profile.weights[d]}
                                onChange={(e) => {
                                  const next = {
                                    ...store.profile.weights,
                                    [d]: Number(e.target.value),
                                  };
                                  if (Object.values(next).some((v) => v > 0)) {
                                    setWeights(next);
                                    setPreset('Custom');
                                  }
                                }}
                              />
                            </label>
                          ))}
                        </div>
                        <p className="small ranking-explainer">
                          Weights are relative. Missing evidence is shown separately. Eligibility
                          always takes priority.
                        </p>
                        <button
                          className="button secondary full"
                          disabled={!weights || savingWeights}
                          onClick={async () => {
                            setSavingWeights(true);
                            try {
                              await saveProfile(store.profile);
                            } catch (e) {
                              setToast((e as Error).message);
                            } finally {
                              setSavingWeights(false);
                            }
                          }}
                        >
                          {savingWeights ? 'Saving…' : 'Save this balance'}
                        </button>
                      </section>
                      <section className="adventure-note">
                        <div className="contour-lines" />
                        <Leaf size={24} />
                        <p className="eyebrow">BEYOND THE HOSPITAL</p>
                        <h3>
                          A little adventure
                          <br />
                          looks good on you.
                        </h3>
                        <p>
                          Explore the places around the work. Location interests are yours to
                          define.
                        </p>
                        <button className="text-button" onClick={() => setDisplay('map')}>
                          Explore the map <ArrowRight size={15} />
                        </button>
                        <small>
                          Illustrative location scores in example mode. Biodiversity data is a
                          future integration.
                        </small>
                      </section>
                      <div className="quiet-note">
                        <ShieldQuestion size={16} />
                        <p>
                          Uncertain about a requirement?
                          <br />
                          <button className="text-button" onClick={() => navigate('Review queue')}>
                            See what needs verification
                          </button>
                        </p>
                      </div>
                    </aside>
                  </div>
                </>
              )}
              {view === 'Inbox' && (
                <RecruiterInbox
                  key={`inbox-${inboxPanel ?? 'list'}`}
                  store={store}
                  demo={demo}
                  reload={reload}
                  notify={setToast}
                  onFix={(draft) => openImport(draft)}
                  onOpen={setDetail}
                  onLeaveDemo={() => {
                    changeMode(false);
                    setView('Inbox');
                  }}
                  autoStart={inboxAuto && !backgroundImport}
                  onAutoStarted={() => setInboxAuto(false)}
                  initialPanel={inboxPanel}
                />
              )}
              {view === 'Compare' && (
                <ComparisonView
                  jobs={jobs.filter((j) => selected.includes(j.opportunity.id))}
                  onRemove={compare}
                  onSelect={setDetail}
                />
              )}
              {view === 'Calendar' && (
                <CalendarView
                  jobs={jobs.filter((j) => j.eligibility.status !== 'Expired/unavailable')}
                  store={store}
                  onSelect={setDetail}
                />
              )}
              {view === 'My profile' && (
                <ProfileForm
                  key={`${demo}-${store.profile.name}`}
                  profile={store.profile}
                  demo={demo}
                  onSave={saveProfile}
                />
              )}

              {view === 'Review queue' && (
                <>
                  <div className="page-intro">
                    <p className="eyebrow">CLARITY BEFORE COMMITMENT</p>
                    <h1>A few things to verify.</h1>
                    <p>
                      Promising opportunities remain visible while their missing requirements are
                      resolved.
                    </p>
                  </div>
                  {activeReviews.map((r) => (
                    <article key={r.id} className="panel review-card">
                      <Badge tone="amber">{r.kind}</Badge>
                      <h3>
                        {r.draft?.title ||
                          jobs.find((j) => j.opportunity.id === r.opportunityId)?.opportunity
                            .title ||
                          'Possible duplicate vacancy'}
                      </h3>
                      <p>{r.reason}</p>
                      <div className="button-row">
                        {r.kind === 'extraction' ? (
                          <button
                            className="button primary small"
                            onClick={() => openImport(r.draft || undefined, r.id)}
                          >
                            Review extracted record
                          </button>
                        ) : (
                          <>
                            <button
                              className="button secondary small"
                              onClick={() => setDetail(r.opportunityId)}
                            >
                              Inspect opportunity
                            </button>
                            <button
                              className="button secondary small"
                              onClick={() => setDetail(r.candidateId)}
                            >
                              Inspect possible match
                            </button>
                            <button
                              className="button secondary small"
                              onClick={async () => {
                                try {
                                  await api({
                                    command: 'merge',
                                    from: r.opportunityId,
                                    to: r.candidateId,
                                  });
                                  await reload();
                                  setToast('Vacancies merged; recruiter offers retained.');
                                } catch (e) {
                                  setToast((e as Error).message);
                                }
                              }}
                            >
                              Confirm same vacancy
                            </button>
                          </>
                        )}
                        <button
                          className="text-button"
                          onClick={async () => {
                            try {
                              await api({ command: 'resolve', reviewId: r.id });
                              await reload();
                            } catch (e) {
                              setToast((e as Error).message);
                            }
                          }}
                        >
                          {r.kind === 'possible duplicate' ? 'Keep separate' : 'Dismiss extraction'}
                        </button>
                      </div>
                    </article>
                  ))}
                  {jobs
                    .filter((j) => j.eligibility.status === 'Needs verification')
                    .map((j) => (
                      <article className="panel review-card" key={j.opportunity.id}>
                        <div className="spread">
                          <div>
                            <Badge tone="amber">Needs verification</Badge>
                            <h3>
                              {j.facility.name} · {j.opportunity.title}
                            </h3>
                          </div>
                          <button
                            className="button secondary small"
                            onClick={() => setDetail(j.opportunity.id)}
                          >
                            Review details
                            <ArrowUpRight size={15} />
                          </button>
                        </div>
                        <ul className="reason-list">
                          {j.eligibility.reasons.map((r) => (
                            <li key={r}>{r}</li>
                          ))}
                        </ul>
                      </article>
                    ))}
                  {!pendingReviews && (
                    <Empty title="Nothing waiting for review">
                      New unknowns and possible duplicates will appear here.
                    </Empty>
                  )}
                </>
              )}
              <footer className="page-footer">
                <span>
                  <Radar size={14} /> LOCUM RADAR
                </span>
                <span>Built around the work. And the life around it.</span>
                <span>Private first draft · v0.1</span>
              </footer>
            </>
          )}
        </main>
      </div>
      {selected.length > 0 && view !== 'Compare' && (
        <div className="compare-tray">
          <Columns3 size={18} />
          <strong>{selected.length} selected</strong>
          <button className="button primary small" onClick={() => navigate('Compare')}>
            Compare opportunities
            <ArrowRight size={15} />
          </button>
          <button
            className="icon-button"
            aria-label="Clear comparison"
            onClick={() => setSelected([])}
          >
            <X size={17} />
          </button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button
            className="icon-button"
            onClick={() => setToast('')}
            aria-label="Dismiss notification"
          >
            <X size={17} />
          </button>
        </div>
      )}
      {importing && live && (
        <ImportDialog
          sources={live.sources}
          initial={importDraft}
          reviewId={reviewId}
          onClose={() => setImporting(false)}
          onImported={async () => {
            await reload();
            setDemo(false);
            setEligibility('all');
            if (view === 'Inbox') {
              setToast('Added to your feed.');
              return;
            }
            setView('Discover');
            setToast('Advertisements imported. Unknown requirements remain in the review queue.');
          }}
        />
      )}
      {detail && store && jobs.some((j) => j.opportunity.id === detail) && (
        <OpportunityDetail
          key={detail}
          job={jobs.find((j) => j.opportunity.id === detail)!}
          store={store}
          onClose={() => setDetail(null)}
          onAction={action}
          onReload={reload}
          notify={setToast}
        />
      )}
    </div>
  );
}
