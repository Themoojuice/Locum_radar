'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Radar,
  Compass,
  Bookmark,
  Columns3,
  CalendarRange,
  ShieldQuestion,
  Gauge,
  SlidersHorizontal,
  Search,
  Plus,
  ArrowUpRight,
  ArrowRight,
  LayoutGrid,
  Map as MapIcon,
  Check,
  X,
  Download,
  Leaf,
  ChevronDown,
  CircleHelp,
  LogOut,
  Menu,
  Bell,
  EyeOff,
  Wand2,
} from 'lucide-react';
import { demoStore } from '@/domain/seed';
import {
  archivedStages,
  dimensions,
  grades,
  specialties,
  states,
  type ListingInput,
  type Profile,
  type Stage,
  type Store,
  type Urgency,
  type Weights,
} from '@/domain/model';
import {
  dimensionLabels,
  duration,
  evaluate,
  presetDetails,
  presets,
  type HiddenReason,
} from '@/domain/engine';
import { deriveAlerts, suggestWeights } from '@/domain/insights';
import { api, Badge, Empty } from './shared';
import { ProfileForm } from './profile-form';
import { ImportDialog } from './import-dialog';
import { OpportunityDetail } from './opportunity-detail';
import { OpportunityCard } from './opportunity-card';
import { ComparisonView } from './explorer';
import { MapExplorer } from './map-explorer';
import { Planner } from './planner';
import { SourcesView } from './sources-view';
import { CollectionProgress } from './collection-progress';
import { AlertsDrawer } from './alerts-drawer';

type View =
  | 'Discover'
  | 'Shortlist'
  | 'Map'
  | 'Compare'
  | 'Planner'
  | 'Review queue'
  | 'Coverage'
  | 'My profile';
const nav = [
  { name: 'Discover', icon: Compass },
  { name: 'Shortlist', icon: Bookmark },
  { name: 'Map', icon: MapIcon },
  { name: 'Compare', icon: Columns3 },
  { name: 'Planner', icon: CalendarRange },
  { name: 'Review queue', icon: ShieldQuestion },
  { name: 'Coverage', icon: Gauge },
] as const;
const hiddenLabels: Record<HiddenReason, string> = {
  ineligible: 'ineligible',
  expired: 'ended or filled',
  archived: 'dismissed or closed',
  'below minimum': 'below your minimum rate',
  'excluded state': 'in excluded states',
  'date conflict': 'clash with unavailable dates',
  'no active offer': 'with no active offer',
};
const horizons: (Urgency | '')[] = [
  '',
  'Urgent',
  'Near-term',
  'Medium-term',
  'Long-term',
  'Flexible',
];
const trackedStage = (stage?: Stage) =>
  !!stage && !['Discovered', ...archivedStages].includes(stage);
/** Feed filters survive reloads (spec §9). Storage can be unavailable; failures are ignored. */
const FILTER_KEY = 'locum-radar:filters:v2';
interface Filters {
  search: string;
  specialty: string;
  state: string;
  horizon: string;
  grade: string;
  travel: boolean;
  reveal: HiddenReason[];
  eligibility: string;
}
const defaultFilters: Filters = {
  search: '',
  specialty: 'mine',
  state: '',
  horizon: '',
  grade: '',
  travel: false,
  reveal: [],
  eligibility: '',
};
function readFilters(): Filters {
  try {
    const raw = localStorage.getItem(FILTER_KEY);
    return raw ? { ...defaultFilters, ...JSON.parse(raw) } : defaultFilters;
  } catch {
    return defaultFilters;
  }
}

export function RadarApp() {
  const [live, setLive] = useState<Store | null>(null),
    [example, setExample] = useState<Store>(() => demoStore()),
    [demo, setDemo] = useState(true),
    [loaded, setLoaded] = useState(false),
    [loginRequired, setLoginRequired] = useState(false),
    [hasPassword, setHasPassword] = useState(false);
  const [view, setView] = useState<View>('Discover'),
    // RadarApp renders only in the browser (see page.tsx), so stored filters load on first render.
    [filters, setFilters] = useState<Filters>(readFilters),
    [alertsOpen, setAlertsOpen] = useState(false),
    [dismissedSuggestion, setDismissedSuggestion] = useState(false);
  const { search, specialty, state, horizon, grade, travel, reveal, eligibility } = filters;
  const setFilter = useCallback(
    <K extends keyof Filters>(key: K, value: Filters[K]) =>
      setFilters((prev) => {
        const next = { ...prev, [key]: value };
        try {
          localStorage.setItem(FILTER_KEY, JSON.stringify(next));
        } catch {
          /* Private windows may refuse storage; filters then last for the session. */
        }
        return next;
      }),
    [],
  );
  const [display, setDisplay] = useState<'cards' | 'list'>('cards'),
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
    [savingWeights, setSavingWeights] = useState(false),
    // National volume: render cards in pages so a phone is not asked to draw thousands.
    // Paging restarts whenever the filters, view or preset change.
    [paging, setPaging] = useState({ key: '', count: 60 });
  const pageKey = JSON.stringify([filters, view, preset]);
  const visibleCount = paging.key === pageKey ? paging.count : 60;
  const setVisibleCount = (count: number) => setPaging({ key: pageKey, count });
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
  const alerts = useMemo(() => (store ? deriveAlerts(store, jobs) : []), [store, jobs]);
  const unreadAlerts = alerts.filter((a) => a.unread).length;
  const suggestion = useMemo(
    () => (store && !weights ? suggestWeights(store.profile, jobs) : null),
    [store, jobs, weights],
  );
  const shortlist = jobs.filter((j) => trackedStage(j.action?.stage));
  const pendingReviews =
    (store?.reviews.filter((r) => !r.resolved).length || 0) +
    jobs.filter((j) => j.eligibility.status === 'Needs verification' && j.rankable).length;
  // Stage 2 (spec §2): broad discovery, but the default feed shows your specialties.
  const mySpecialties = store
    ? [...new Set([...store.profile.competentSpecialties, ...store.profile.preferredSpecialties])]
    : [];
  const lens = presetDetails[preset]?.lens;
  const hiddenCounts = new Map<HiddenReason, number>();
  const matches = (j: (typeof jobs)[number], ignoreHidden = false) => {
    const o = j.opportunity;
    if (view === 'Shortlist' && !trackedStage(j.action?.stage)) return false;
    if (
      search &&
      !`${j.facility.name} ${j.facility.town} ${o.title} ${o.grade} ${o.specialty}`
        .toLowerCase()
        .includes(search.toLowerCase())
    )
      return false;
    if (
      specialty === 'mine'
        ? mySpecialties.length > 0 && !mySpecialties.includes(o.specialty)
        : specialty && o.specialty !== specialty
    )
      return false;
    if ((state && j.facility.state !== state) || (grade && o.grade !== grade)) return false;
    if (horizon && j.urgency !== horizon) return false;
    if (lens === 'short' && duration(o) > 14) return false;
    if (lens === 'future' && !['Medium-term', 'Long-term', 'Flexible'].includes(j.urgency))
      return false;
    if (
      travel &&
      !j.logistics.local &&
      !j.activeOffers.some((v) => v.flights === 'included' && v.accommodation === 'included')
    )
      return false;
    if (eligibility && j.eligibility.status !== eligibility) return false;
    if (!ignoreHidden && view !== 'Shortlist') {
      const blocking = j.hiddenBy.filter((h) => !reveal.includes(h));
      if (blocking.length) return false;
    }
    return true;
  };
  const filtered = jobs.filter((j) => matches(j));
  if (view !== 'Shortlist')
    for (const j of jobs)
      if (matches(j, true))
        for (const h of j.hiddenBy.filter((h) => !reveal.includes(h)))
          hiddenCounts.set(h, (hiddenCounts.get(h) ?? 0) + 1);
  function changeMode(value: boolean) {
    setDemo(value);
    setWeights(null);
    setSelected([]);
    setDetail(null);
    setView('Discover');
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
  async function openImport(draft?: Partial<ListingInput>, id?: string) {
    if (demo) {
      changeMode(false);
    }
    // The feed carries a preview of long source text; fetch the full record to edit it.
    if (id && draft && !draft.rawText) {
      try {
        const r = await fetch(`/api/radar/detail?review=${encodeURIComponent(id)}`, {
          cache: 'no-store',
        });
        const v = await r.json();
        if (r.ok) draft = v.review.draft ?? draft;
      } catch {
        /* Fall back to the preview; validation will say what is missing. */
      }
    }
    setImportDraft(draft);
    setReviewId(id);
    setImporting(true);
  }
  async function markAlertsRead() {
    const at = new Date().toISOString();
    if (demo) setExample((prev) => ({ ...prev, profile: { ...prev.profile, alertsSeenAt: at } }));
    else {
      try {
        await api({ command: 'alerts-seen', at });
        await reload();
      } catch (e) {
        setToast((e as Error).message);
      }
    }
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
        'Scheduling',
        'Logistics',
        'Urgency',
        'Attractiveness score',
        'Assessable',
        'Evidence quality',
        'Comparable hourly AUD',
        'Offers',
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
        j.scheduling.status,
        j.logistics.status,
        j.urgency,
        j.ranking.score ?? '',
        j.ranking.assessable ? 'yes' : 'no',
        j.quality.label,
        j.ranking.bestHourly ?? '',
        j.activeOffers.length,
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
              {name === 'Map' && filtered.length > 0 && <b className="soft">{filtered.length}</b>}
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
              className="icon-button bell"
              aria-label={`Alerts${unreadAlerts ? `, ${unreadAlerts} new` : ''}`}
              onClick={() => setAlertsOpen(true)}
            >
              <Bell size={19} />
              {unreadAlerts > 0 && (
                <span className="bell-count">{unreadAlerts > 99 ? '99+' : unreadAlerts}</span>
              )}
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
                      <p className="eyebrow">THE WHOLE COUNTRY, RANKED FOR YOU</p>
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
                        Live vacancies
                        <Compass size={17} />
                      </span>
                      <strong>
                        {jobs
                          .filter((j) => !j.hiddenBy.includes('expired'))
                          .length.toLocaleString('en-AU')}
                        <small>{demo ? 'illustrative examples' : 'observed nationally'}</small>
                      </strong>
                      <p>
                        {store.listings.length.toLocaleString('en-AU')} advertisements from{' '}
                        {new Set(store.listings.map((l) => l.sourceId)).size} sources, reconciled
                      </p>
                    </div>
                    <div className="stat">
                      <span>
                        In your feed
                        <Check size={17} />
                      </span>
                      <strong>
                        {jobs.filter((j) => j.rankable).length.toLocaleString('en-AU')}
                        <small>ranked for you</small>
                      </strong>
                      <p>
                        {
                          jobs.filter(
                            (j) => j.rankable && j.eligibility.status === 'Needs verification',
                          ).length
                        }{' '}
                        of them need a requirement checked
                      </p>
                    </div>
                    <div className="stat">
                      <span>
                        Starting soon
                        <ShieldQuestion size={17} />
                      </span>
                      <strong>
                        {jobs.filter((j) => j.rankable && j.urgency === 'Urgent').length}
                        <small>urgent and in your feed</small>
                      </strong>
                      <button
                        className="text-button"
                        onClick={() => setFilter('horizon', 'Urgent')}
                      >
                        Show urgent jobs <ArrowRight size={13} />
                      </button>
                    </div>
                    <div className="stat">
                      <span>
                        What you can see
                        <Gauge size={17} />
                      </span>
                      <strong>
                        {store.sources.filter((s) => s.lastSuccess).length}
                        <small>sources collected</small>
                      </strong>
                      <button className="text-button" onClick={() => navigate('Coverage')}>
                        {demo ? 'Example records only' : 'Coverage & gaps'} <ArrowRight size={13} />
                      </button>
                    </div>
                  </div>
                  {view === 'Discover' && (
                    <CollectionProgress
                      demo={demo}
                      reload={reload}
                      onSettings={() => {
                        setDemo(false);
                        navigate('Coverage');
                      }}
                    />
                  )}
                  {!demo &&
                    (store.profile.registration === 'unknown' ||
                      !store.profile.competentSpecialties.length) && (
                      <div className="onboarding-note">
                        <ShieldQuestion size={21} />
                        <span>
                          <strong>Let’s establish what’s suitable for you.</strong> Confirm your
                          registration, grades and the specialties you work in. Until then every job
                          shows as “verify”, never as “eligible”.
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
                            onChange={(e) => setFilter('search', e.target.value)}
                            placeholder="Search hospitals, towns, specialties or grades…"
                          />
                        </div>
                        <div className="filter-row">
                          <label className="compact-select">
                            <span className="sr-only">Specialty</span>
                            <select
                              value={specialty}
                              onChange={(e) => setFilter('specialty', e.target.value)}
                            >
                              <option value="mine">
                                {mySpecialties.length ? 'My specialties' : 'All specialties'}
                              </option>
                              <option value="">Every specialty</option>
                              {specialties.map((s) => (
                                <option key={s}>{s}</option>
                              ))}
                            </select>
                          </label>
                          <label className="compact-select">
                            <span className="sr-only">State</span>
                            <select
                              value={state}
                              onChange={(e) => setFilter('state', e.target.value)}
                            >
                              <option value="">Anywhere in Australia</option>
                              {states.map((s) => (
                                <option key={s}>{s}</option>
                              ))}
                            </select>
                          </label>
                          <label className="compact-select">
                            <span className="sr-only">When</span>
                            <select
                              value={horizon}
                              onChange={(e) => setFilter('horizon', e.target.value)}
                            >
                              {horizons.map((h) => (
                                <option key={h} value={h}>
                                  {h ? (h === 'Flexible' ? 'Flexible dates' : h) : 'Any start date'}
                                </option>
                              ))}
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
                              Eligibility
                              <select
                                value={eligibility}
                                onChange={(e) => setFilter('eligibility', e.target.value)}
                              >
                                <option value="">Any</option>
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
                              <select
                                value={grade}
                                onChange={(e) => setFilter('grade', e.target.value)}
                              >
                                <option value="">All grades</option>
                                {grades.map((v) => (
                                  <option key={v}>{v}</option>
                                ))}
                              </select>
                            </label>
                            <label className="checkbox-row">
                              <input
                                type="checkbox"
                                checked={travel}
                                onChange={(e) => setFilter('travel', e.target.checked)}
                              />
                              Flights & stay included (or local)
                            </label>
                            <fieldset className="reveal">
                              <legend>Also show jobs that are</legend>
                              {(Object.keys(hiddenLabels) as HiddenReason[]).map((h) => (
                                <label className="checkbox-row" key={h}>
                                  <input
                                    type="checkbox"
                                    checked={reveal.includes(h)}
                                    onChange={(e) =>
                                      setFilter(
                                        'reveal',
                                        e.target.checked
                                          ? [...reveal, h]
                                          : reveal.filter((v) => v !== h),
                                      )
                                    }
                                  />
                                  {hiddenLabels[h]}
                                </label>
                              ))}
                            </fieldset>
                            <button
                              className="text-button small"
                              onClick={() => {
                                setFilters(defaultFilters);
                                try {
                                  localStorage.removeItem(FILTER_KEY);
                                } catch {
                                  /* ignore */
                                }
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
                            {filtered.length.toLocaleString('en-AU')}{' '}
                            {view === 'Shortlist' ? 'tracked opportunities' : 'opportunities'}
                          </strong>
                          <span> · ranked for you{lens ? ` · ${preset.toLowerCase()}` : ''}</span>
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
                          <button aria-label="Map view" onClick={() => navigate('Map')}>
                            <MapIcon size={16} />
                          </button>
                        </div>
                      </div>
                      {hiddenCounts.size > 0 && (
                        <p className="hidden-summary">
                          <EyeOff size={14} />
                          Not shown:{' '}
                          {[...hiddenCounts.entries()].map(([h, n], i) => (
                            <span key={h}>
                              {i > 0 && ', '}
                              <button
                                className="text-button small"
                                onClick={() => setFilter('reveal', [...reveal, h])}
                                title="Show these"
                              >
                                {n} {hiddenLabels[h]}
                              </button>
                            </span>
                          ))}
                        </p>
                      )}
                      {filtered.length ? (
                        <div className="job-grid">
                          {filtered.slice(0, visibleCount).map((job) => (
                            <OpportunityCard
                              key={job.opportunity.id}
                              job={job}
                              selected={selected.includes(job.opportunity.id)}
                              onSelect={() => setDetail(job.opportunity.id)}
                              onCompare={() => compare(job.opportunity.id)}
                              onSave={() =>
                                action(
                                  job.opportunity.id,
                                  trackedStage(job.action?.stage) ? 'Discovered' : 'Saved',
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
                              ? 'Fetch vacancies above, or start with a recruiter email or advertisement.'
                              : 'Try broader filters or show some of the hidden jobs.'}
                          </p>
                          {!store.opportunities.length && (
                            <button className="button primary" onClick={() => openImport()}>
                              Import your first opportunity
                              <ArrowRight size={16} />
                            </button>
                          )}
                        </Empty>
                      )}
                      {filtered.length > visibleCount && (
                        <button
                          className="button secondary full"
                          onClick={() => setVisibleCount(visibleCount + 60)}
                        >
                          Show more ({(filtered.length - visibleCount).toLocaleString('en-AU')}{' '}
                          remaining)
                        </button>
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
                        {presetDetails[preset] && (
                          <p className="small muted preset-note">
                            {presetDetails[preset].description}
                          </p>
                        )}
                        <div className="weight-sliders">
                          {dimensions.map((d) => (
                            <label key={d}>
                              <span>
                                {dimensionLabels[d]}
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
                          Weights are relative. Missing evidence is left out, not scored as zero.
                          Eligibility, dates and logistics are shown separately and never change the
                          score.
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
                      {suggestion && !dismissedSuggestion && (
                        <section className="panel suggestion">
                          <h3>
                            <Wand2 size={17} /> Your choices suggest a different balance
                          </h3>
                          <p className="small muted">
                            From {suggestion.basis.liked} jobs you kept and{' '}
                            {suggestion.basis.dismissed} you dismissed. Nothing changes unless you
                            apply it.
                          </p>
                          <ul className="small">
                            {suggestion.changes.map((c) => (
                              <li key={c.dimension}>
                                <strong>
                                  {c.label}: {c.from} → {c.to}
                                </strong>{' '}
                                <span className="muted">{c.why}</span>
                              </li>
                            ))}
                          </ul>
                          <div className="button-row">
                            <button
                              className="button secondary small"
                              onClick={() => {
                                setWeights(suggestion.weights);
                                setPreset('Custom');
                              }}
                            >
                              Try it
                            </button>
                            <button
                              className="text-button small"
                              onClick={() => setDismissedSuggestion(true)}
                            >
                              Not now
                            </button>
                          </div>
                        </section>
                      )}
                      <section className="adventure-note">
                        <div className="contour-lines" />
                        <Leaf size={24} />
                        <p className="eyebrow">BEYOND THE HOSPITAL</p>
                        <h3>
                          A little adventure
                          <br />
                          looks good on you.
                        </h3>
                        {store.profile.nature.enabled ? (
                          <>
                            <p>
                              Location scores include {store.profile.nature.label} species recorded
                              within {store.profile.nature.radiusKm} km of each hospital.
                            </p>
                            {!demo && (
                              <button
                                className="text-button"
                                onClick={async () => {
                                  try {
                                    const r = await api({ command: 'nature' });
                                    setToast(r.message);
                                    await reload();
                                  } catch (e) {
                                    setToast((e as Error).message);
                                  }
                                }}
                              >
                                Refresh nature data <ArrowRight size={15} />
                              </button>
                            )}
                          </>
                        ) : (
                          <>
                            <p>
                              Turn on the nature lens to fold what lives near each hospital into its
                              location score.
                            </p>
                            <button className="text-button" onClick={() => navigate('My profile')}>
                              Set up the nature lens <ArrowRight size={15} />
                            </button>
                          </>
                        )}
                        <button className="text-button" onClick={() => navigate('Map')}>
                          Explore the map <ArrowRight size={15} />
                        </button>
                        <small>
                          Atlas of Living Australia occurrence records; recording effort varies by
                          town.
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
                  store={store}
                  onRemove={compare}
                  onSelect={setDetail}
                />
              )}
              {view === 'Map' && (
                <>
                  <div className="page-intro">
                    <p className="eyebrow">THE MAP</p>
                    <h1>Where the work is.</h1>
                    <p>
                      Showing the {filtered.length.toLocaleString('en-AU')} vacancies that match
                      your Discover filters.{' '}
                      <button className="text-button" onClick={() => navigate('Discover')}>
                        Change filters
                      </button>
                    </p>
                  </div>
                  <MapExplorer jobs={filtered} store={store} onSelect={setDetail} />
                </>
              )}
              {view === 'Planner' && (
                <Planner
                  jobs={jobs.filter((j) => !j.hiddenBy.includes('expired'))}
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
              {view === 'Coverage' && (
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
                <span>Private workspace · v0.2</span>
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
      {alertsOpen && store && (
        <AlertsDrawer
          alerts={alerts}
          threshold={store.profile.alertScore}
          onClose={() => setAlertsOpen(false)}
          onOpen={(id) => {
            setAlertsOpen(false);
            setDetail(id);
          }}
          onMarkRead={markAlertsRead}
        />
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
