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
import { CollectionProgress } from './collection-progress';

type View =
  'Discover' | 'Shortlist' | 'Compare' | 'Calendar' | 'Review queue' | 'Sources' | 'My profile';
const nav = [
  { name: 'Discover', icon: Compass },
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
  const [view, setView] = useState<View>('Discover'),
    [search, setSearch] = useState(''),
    [specialty, setSpecialty] = useState(''),
    [state, setState] = useState(''),
    [eligibility, setEligibility] = useState('suitable'),
    [year, setYear] = useState('2027'),
    [travel, setTravel] = useState(false),
    [grade, setGrade] = useState('');
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
          setDemo(value.opportunities.length === 0);
          setLoaded(true);
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
  const pendingReviews =
    (store?.reviews.filter((r) => !r.resolved).length || 0) +
    jobs.filter((j) => j.eligibility.status === 'Needs verification').length;
  const filtered = jobs.filter((j) => {
    const o = j.opportunity;
    if (view === 'Shortlist' && !shortlist.includes(j)) return false;
    if (view !== 'Shortlist' && ['Dismissed', 'Declined'].includes(j.action?.stage || ''))
      return false;
    if (
      search &&
      !`${j.facility.name} ${j.facility.town} ${o.title} ${o.grade}`
        .toLowerCase()
        .includes(search.toLowerCase())
    )
      return false;
    if (
      (specialty && o.specialty !== specialty) ||
      (state && j.facility.state !== state) ||
      (grade && o.grade !== grade)
    )
      return false;
    if (year && (o.startDate > `${year}-12-31` || o.endDate < `${year}-01-01`)) return false;
    if (
      travel &&
      !j.activeOffers.some((o) => o.flights === 'included' && o.accommodation === 'included')
    )
      return false;
    if (view !== 'Shortlist' && eligibility === 'suitable' && !j.rankable) return false;
    if (
      view !== 'Shortlist' &&
      eligibility !== 'all' &&
      eligibility !== 'suitable' &&
      j.eligibility.status !== eligibility
    )
      return false;
    return true;
  });
  function changeMode(value: boolean) {
    setDemo(value);
    setWeights(null);
    setSelected([]);
    setDetail(null);
    setView('Discover');
    setEligibility('suitable');
  }
  function navigate(name: View) {
    setView(name);
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
        'Hospital',
        'State',
        'Specialty',
        'Grade',
        'Start',
        'End',
        'Eligibility',
        'Preference score',
        'Scoring evidence percent',
        'Comparable hourly AUD',
        'Stage',
      ],
      ...jobs.map((j) => [
        j.facility.name,
        j.facility.state,
        j.opportunity.specialty,
        j.opportunity.grade,
        j.opportunity.startDate,
        j.opportunity.endDate,
        j.eligibility.status,
        j.ranking.score ?? '',
        j.ranking.evidence,
        j.ranking.bestHourly ?? '',
        j.action?.stage || 'Discovered',
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
              <span>{name}</span>
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
                  : 'Your records stay in your configured database. Imports are reviewed before they reach your feed.'}
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
                          : 'Find your next chapter.'}
                      </h1>
                      <p>
                        {view === 'Shortlist'
                          ? 'Your saved opportunities and the next steps that make them happen.'
                          : 'Meaningful work. Better places. A clearer picture of what’s out there.'}
                      </p>
                    </div>
                    <div className="button-row">
                      <button className="button secondary export-button" onClick={exportCsv}>
                        <Download size={16} />
                        Export
                      </button>
                      <button className="button primary" onClick={() => openImport()}>
                        <Plus size={17} />
                        Import opportunities
                      </button>
                    </div>
                  </div>
                  <div className="stats-grid">
                    <div className="stat">
                      <span>
                        Observed opportunities
                        <Compass size={17} />
                      </span>
                      <strong>
                        {jobs.filter((j) => j.eligibility.status !== 'Expired/unavailable').length}
                        <small>{demo ? 'illustrative examples' : 'from your imports'}</small>
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
                        {jobs.filter((j) => j.eligibility.status === 'Needs verification').length}
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
                  {view === 'Discover' && (
                    <CollectionProgress
                      demo={demo}
                      reload={reload}
                      onSettings={() => {
                        setDemo(false);
                        navigate('Sources');
                      }}
                    />
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
                                setYear('2027');
                                setEligibility('suitable');
                              }}
                            >
                              Reset filters
                            </button>
                          </div>
                        )}
                      </section>
                      <div className="results-toolbar">
                        <div>
                          <strong>
                            {filtered.length}{' '}
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
                        <GeographicExplorer jobs={filtered} store={store} onSelect={setDetail} />
                      ) : filtered.length ? (
                        <div className="job-grid">
                          {filtered.map((job) => (
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
                          ))}
                        </div>
                      ) : (
                        <Empty
                          title={
                            !store.opportunities.length
                              ? 'Your next chapter starts here.'
                              : 'No opportunities in this view.'
                          }
                        >
                          <p>
                            {!store.opportunities.length
                              ? 'Start with a recruiter email or a job advertisement. Review the details once, then compare everything in one place.'
                              : 'Try broader filters, or check the verification queue for jobs with missing requirements.'}
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
              {view === 'Sources' && (
                <SourcesView store={store} demo={demo} reload={reload} notify={setToast} />
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
                  {store.reviews
                    .filter((r) => !r.resolved)
                    .map((r) => (
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
                            {r.kind === 'possible duplicate'
                              ? 'Keep separate'
                              : 'Dismiss extraction'}
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
