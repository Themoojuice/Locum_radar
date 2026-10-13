# Specification status — v0.2

Measured against [specification v0.2](product-spec-v0.2.md) on 14 October 2026. The earlier [v0.1 specification](product-spec.md) is kept for reference.

## Acceptance criteria (spec §16)

Each criterion has an automated test in `tests/spec-v02.test.ts` unless noted.

| #   | Criterion                                                     | Status | How                                                                                                                                                          |
| --- | ------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Ingest from three independently managed sources               | Met    | Medrecruit, 1Medical and Wavelength collectors, email splitters, manual import. Live runs depend on the owner's machine (this build cannot reach the sites). |
| 2   | Same vacancy from different agencies consolidated, terms kept | Met    | Exact linking by facility, role, dates, shared reference and roster; near-date cross-agency matches queued for one-click review. Offers stay separate.       |
| 3   | Different shifts or roles at one hospital stay separate       | Met    | Identity includes grade, specialty and dates; listed shifts are kept per listing.                                                                            |
| 4   | Confirmed-ineligible jobs excluded by default                 | Met    | `hiddenBy: ineligible`; revealable under Filters.                                                                                                            |
| 5   | Uncertain eligibility visible and labelled                    | Met    | **Changed from v0.1**: "Needs verification" jobs are now ranked in the main feed (LR-002) with a "Verify eligibility" chip.                                  |
| 6   | Negotiable conflicts do not remove attractive jobs            | Met    | Scheduling is separate from eligibility; negotiable commitments and provisional leave produce "Fits with conditions", never a hidden job.                    |
| 7   | Current and future placements supported                       | Met    | Configurable urgency bands, Planner with six-month windows from today.                                                                                       |
| 8   | Advertised and derived money distinguishable                  | Met    | Every figure is tagged stated / calculated / estimate / unknown; estimates use only profile assumptions the doctor entered.                                  |
| 9   | Weight changes are predictable                                | Met    | Deterministic weighted mean over evidenced dimensions; test checks ordering.                                                                                 |
| 10  | Fields traceable to sources                                   | Met    | Raw text, extraction evidence and observation history per listing, loaded on demand in the detail panel.                                                     |
| 11  | Source failures and stale vacancies communicated              | Met    | "Source unavailable" freshness; an outage never marks jobs filled; staleness becomes "Availability unconfirmed" only while the source is healthy.            |
| 12  | Save, compare, contact recruiters                             | Met    | Shortlist, comparison of up to four, enquiry draft with outstanding questions (copy or open in mail). Nothing is sent by the app.                            |

## Decisions

| Decision                                   | Status                                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| LR-001 Broad market discovery              | **Fixed in v0.2.** v0.1 collected only the profile's preferred specialties. Now everything is collected; relevance orders work only. |
| LR-002 Uncertain eligibility stays in feed | **Fixed in v0.2.** v0.1 ranked only Eligible/Likely eligible jobs.                                                                   |
| LR-003 Current and future planning         | Implemented: urgency bands, Planner, best non-overlapping run, recurring-pattern predictions labelled as predictions.                |

## Capability status

| Spec area                       | Status                                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Five-entity data model (§3)     | Listings, opportunities, offers, facilities; shifts as an optional list on listings and opportunities.                                            |
| Eligibility dimensions (§4)     | Registration, experience, credentials, fellowships, specialty competence, grade, procedures, supervision, independent cover, employment approval. |
| Eligibility vs feasibility (§4) | Four separate assessments: eligibility, scheduling, logistics, attractiveness.                                                                    |
| Availability modelling (§5)     | Six kinds: confirmed available, preferred, approved leave, provisional leave/release, negotiable commitment, confirmed unavailable.               |
| Vacancy data (§6)               | All listed groups except vehicle availability and payment-arrangement detail beyond employee/contractor.                                          |
| Financial comparison (§7)       | Advertised, gross, comparable hourly, travel and accommodation, net before tax, optional opportunity cost; assumptions and confidence shown.      |
| Ranking (§8)                    | Five dimensions, six spec presets (two apply feed lenses), plain-language reasons, "hard to assess" below 60% evidenced weight.                   |
| Dashboard (§9)                  | Ranked feed, map explorer, planner, comparison, detail, tracker stages, coverage dashboard; filters persist between sessions.                     |
| Ingestion (§10)                 | Common labelled-block contract; JSON, HTML, sitemap + JobPosting, email; RFC 9309 robots on every request; retry; first/last seen.                |
| Technology (§11)                | Next.js/React/TypeScript, SQLite (validated) or PostgreSQL (implemented, not live-tested), MapLibre + OpenStreetMap data. No n8n, no LLM.         |
| Security (§12)                  | Read-only email via mail-drop; host allowlist and IP pinning; permission recorded per source; nothing sent on the user's behalf.                  |
| Lifecycle and alerts (§13)      | Seven lifecycle states; in-app alerts for all six notification types, one per vacancy and kind. No push or email notifications.                   |
| Hospital intelligence (§14)     | Observed vacancies, months, recurrence, comparable rate range, agencies per facility.                                                             |
| Biodiversity scoring (§14)      | Optional Atlas of Living Australia species count for a chosen taxon (default jumping spiders) within a radius; log-scaled, labelled.              |
| Market trends (§14)             | Monthly volume and median comparable rate, per specialty.                                                                                         |
| Preference learning (§14)       | Weight suggestions from saves vs dismissals; never applied automatically.                                                                         |
| Coverage (§2)                   | Per-source active/unique/shared yield, parse reliability, run success, state gaps, Chapman capture–recapture estimate with interval.              |

## Not done, and why

- **Live qualification of collectors.** The build environment cannot reach recruiter sites. Every collector has a **Test** button (Coverage → source row) that reads a few live pages, applies the same permission and robots checks, and shows what was parsed without saving.
- **Ochre and Medlo collectors.** Ochre pages carry no structured data; Medlo's API is disallowed to robots. Both need page captures from a real browser before an HTML adapter is worth writing.
- **Push/email notifications, calendar sync, OAuth mailbox sync, multi-user accounts, hosted deployment.** Out of scope for this release; alerts are in-app only.
- **Shift extraction from free text.** Shifts are supported in the model and JSON imports; recruiters' shift lists are not yet parsed from prose.

## Performance at national volume

`npm run bench -- 10000` builds a synthetic 10,000-listing workspace. On the build machine, after v0.2: ingesting all 10,000 in one transaction 2.0 s, a one-field write 0.4 s, evaluating the feed 0.3 s, feed payload 1.7 MB gzipped. Before v0.2 the same machine took 11.4 s to ingest 10,000, and at only 3,000 listings a one-field write took 0.6 s, evaluation 1.0 s (it grew quadratically), and every page load shipped 19 MB of raw source text and history.
