# Architecture

Locum Radar is a TypeScript modular monolith: Next.js/React at the edge of the application, a framework-independent domain layer, server-side extraction and collection, and a transactional persistence adapter. A single process is an appropriate starting point for one person's dataset; an always-running worker fleet is not required to use it.

```mermaid
flowchart LR
  A[Text / HTML / email / JSON] --> B[Conservative extraction]
  C[Approved structured source] --> B
  B --> D[User review + schema validation]
  D --> E[Facility resolution]
  E --> F[Opportunity reconciliation]
  F --> G[(SQLite or PostgreSQL)]
  G --> H[Eligibility]
  G --> S[Scheduling & logistics]
  G --> I[Pay & earnings]
  H --> J[Explainable ranking]
  S --> J
  I --> J
  J --> K[Feed / map / planner / comparison / coverage / alerts]
  K --> L[User-controlled tracker]
  L --> G
```

## Domain boundaries

`model.ts` defines validated import/profile contracts and entities, and migrates stored profiles. `ingestion.ts` manages identity, history, cross-agency candidates and alert events. `engine.ts` answers four separate questions — professional eligibility, scheduling feasibility, logistical feasibility and attractiveness — plus lifecycle, urgency, evidence quality and earnings. `insights.ts` derives alerts, weight suggestions and enquiry drafts; `planning.ts` finds the best non-overlapping run and recurring patterns; `coverage.ts` measures what the sources show. Browser-side rescoring uses the same pure functions; a slider does not refetch or reparse advertisements.

Eligibility never depends on dates, states, pay or preferences. Dates live in scheduling (hard conflicts hide a job; negotiable commitments and provisional leave only warn). Excluded states and minimum rates are personal limits that hide a job by default but never make it "ineligible". Each hidden job records why (`hiddenBy`), so the feed can say what it is not showing.

The four conceptual levels remain distinct: advertisement, vacancy, recruiter terms and placement dates. Individual roster shifts are not yet a separate implemented entity. One multi-block message can become multiple source records through the reviewed import pathway; future extraction must preserve a parent-message identifier when this becomes automatic.

Professional credentials are declared facts, not inferred from the user's previous rotations. Required credentials known to be absent block suitability; an unconfirmed credential list produces verification. Registration categories are not assumed interchangeable. Restrictions and scoring never share a numerical threshold.

Scores normalise the weights of dimensions with known evidence. Unknown money is not zero attractiveness. The percentage shown as **scoring evidence** is criterion coverage, not an AI probability or a claim that every job detail is verified. Financial scores use comparable active offers only. Adventure is a declared preference/illustrative fixture, not measured biodiversity. Clinical interest measures specialty preference; it does not certify training value.

## Persistence

Tables: `schema_version`, `user_profiles`, `facilities`, `sources`, `opportunities`, `source_listings`, `recruiter_offers`, `user_job_actions`, `source_observations`, `collection_runs`, `review_queue`, `radar_events`.

IDs and entity relationships are relational, with foreign keys and lookup indexes. Nested typed attributes are JSON text, identically represented in both backends. The one owner profile contains availability windows and ranking preferences. Monetary records use validated numeric values; the model has no tax engine.

SQLite uses WAL, foreign keys, a busy timeout and `BEGIN IMMEDIATE`, plus an in-process asynchronous write queue. PostgreSQL uses transactions and a locked owner row. Imports, merges, deletes, tracker changes and profile saves commit atomically. Revision snapshots retain prior source content and rates. Identical repeated observations update the observation timestamp without generating redundant history rows.

Each transaction loads the workspace and records each row's serialised payload; a save writes only rows whose payload changed and deletes only rows that disappeared. Statements are prepared once and cached. Observation history is append-only: it is written by saves but never loaded with the workspace, and is read per listing by `readObservations`. Ingest keeps lookup indexes per store, so national collection is linear rather than quadratic. The feed endpoint sends listing metadata only; full advertisement text, evidence and history come from `/api/radar/detail`. See `npm run bench`.

This still loads one owner's workspace per transaction. It is comfortable at tens of thousands of listings and **not designed for multiple independent users**. Next steps before larger deployment: incremental repositories, pagination, extracted searchable columns, owner IDs on all private records, per-user authorisation, migration files, append-only action audit events and conflict-aware client updates. Do not reuse the owner lock as a permanent multi-user design.

## Collectors

Adapters emit a common labelled-block contract that the same conservative parser turns into listings. Medrecruit (embedded page data), 1Medical (WordPress index plus job pages), Wavelength (JSON), Adzuna (documented API) and a generic **sitemap + schema.org JobPosting** collector (Salt, Global Medics APAC, JPS, DNA) are registered. None crawls link graphs or bypasses redirects or challenges. Collection is national and cross-specialty (LR-001); profile relevance only orders work when a source is read over several runs. A **Test** run reads a few live pages through the same gates without saving anything.

Every collector requires source-level permission evidence, the source enabled flag and the global server switch. Robots rules follow RFC 9309 (the LocumRadar group over `*`, longest match, Allow wins ties) and are checked for every request, not only the first. A durable collection attempt timestamp prevents concurrent workers from bypassing the interval. Responses are restricted to two hard-coded HTTPS hosts, pinned after public IPv4 validation, with a 2 MB limit and timeout. The conservative robots gate stops on applicable exclusions rather than attempting a broad crawl. A transient server error receives one delayed retry. Failures retain historical records and record an error instead of claiming an empty vacancy feed.

Only new extraction candidates enter the review queue. No LLM receives source material. Repeated identical candidates do not accumulate. Source contribution counts measure observed/exclusive records, not national recall.

## Dates and uncertainties

Observation timestamps are UTC. Placements are local date-only intervals with an IANA facility timezone for expiry checks. Inclusive duration uses UTC arithmetic on date labels, avoiding daylight-saving 23/25-hour-day errors. Calendar overlaps indicate date overlap, not guaranteed shift conflict. New facilities inherit a state timezone default and need correction before exact shift-time support, especially NSW/WA timezone exceptions.

Advertised, pending verification, confirmed available, withdrawn and filled remain distinct source states. A single withdrawn recruiter offer cannot withdraw an active competing listing. Withdrawn/filled offers remain visible as evidence but cannot boost scores or satisfy travel-benefit filters.

## Extending without rewriting

The next high-value seam is `Extraction`: add fixture-tested agency/email adapters that emit the validated listing contract, rather than making UI code parse source text. Next, replace source-state snapshots with incremental SQL queries as volume grows. The deterministic domain functions and their acceptance tests should remain stable across those changes.
