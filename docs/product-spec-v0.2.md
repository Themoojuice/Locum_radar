# LOCUM RADAR

## Product Requirements & Technical Specification

**Version:** 0.2
**Date:** 13 October 2026
**Status:** Requirements baseline — ready for technical prototyping
**Deployment:** Private, single-user application initially
**Geographic scope:** Australia-wide

---

## 1. Product vision

Locum Radar is a personalised medical recruitment intelligence system that continuously discovers, consolidates, evaluates and ranks Australian medical employment opportunities.

The platform shall provide broad national coverage while presenting the individual user with a compact, personalised and information-efficient view of opportunities worth considering.

It must support both immediate locum recruitment and longer-term planning.

### Core principles

1. Discover broadly; filter intelligently.
2. Organise records around underlying clinical opportunities, not individual advertisements.
3. Preserve meaningful differences between competing recruiters and offers.
4. Keep potentially attractive positions visible when eligibility is uncertain.
5. Distinguish professional eligibility from scheduling feasibility and personal attractiveness.
6. Prioritise objective evidence, explainable ranking and traceable source information.
7. Minimise manual work through automated acquisition and processing.
8. Preserve human control over recruiter communications, applications and employment decisions.

### Primary user experience

The user opens Locum Radar and immediately sees a ranked collection of relevant opportunities, with clear explanations of their appeal, remuneration, requirements, availability and outstanding uncertainties.

The application should make it possible to progress from discovering an opportunity to an informed recruiter enquiry without navigating multiple job boards.

---

## 2. National discovery strategy

### Decision LR-001 — Broad market discovery

**Status: Confirmed**

The acquisition engine shall collect jobs across Australian locations, medical specialties and clinical grades, subject to source access, technical feasibility and reasonable collection costs.

Discovery should not be constrained to the user's current preferred specialties.

### Two-stage processing

**Stage 1 — Market acquisition**

Collect potentially relevant Australian medical employment records from:

- Public recruitment agency websites.
- Government recruitment portals.
- Health service and hospital websites.
- Permissioned recruitment email communications.
- Authorised professional networks and private sources.
- Available APIs, RSS feeds and structured vacancy services.

**Stage 2 — Personal relevance analysis**

Evaluate each opportunity against the user's professional eligibility, availability, financial goals, career objectives, location preferences and personal interests.

Broad acquisition should not mean that obviously unsuitable jobs overwhelm the primary dashboard.

### Coverage management

Maintain a registry of recruitment sources and hospitals.

Track the source's last successful scan, access status, geographic coverage, specialty focus, contribution of unique vacancies and extraction reliability.

Coverage shall be represented honestly: a hospital without observed vacancies is not necessarily a hospital without vacancies.

---

## 3. Canonical recruitment data model

The system shall represent five related concepts separately.

### Source listing

An individual advertisement, email entry, portal record or other source observation.

### Clinical opportunity

The underlying staffing requirement at a hospital or healthcare facility.

### Recruiter offer

The specific terms offered by an agency or employer for an underlying opportunity.

### Placement or shift

The actual period of clinical work. A single opportunity may contain several shifts or separable blocks.

### Hospital or facility

A canonical healthcare organisation with stable identifiers, geographic coordinates, alternative names and service metadata.

### Deduplication rules

Potentially identical listings shall be compared using hospital identity, clinical specialty, grade, dates, roster details, job references and recruitment context.

The system must distinguish exact duplicates from overlapping but independently bookable placements.

A single underlying opportunity may have multiple recruiter offers.

When duplicate advertisements are consolidated, preserve the original advertisements and all material differences in remuneration, travel arrangements, dates and employment terms.

Potentially incorrect merges must be reversible.

---

## 4. Professional eligibility assessment

### Decision LR-002 — Uncertain eligibility remains in the feed

**Status: Confirmed**

Opportunities shall be classified into:

| Classification         | Main feed behaviour                                     |
| ---------------------- | ------------------------------------------------------- |
| Confirmed eligible     | Display normally                                        |
| Likely eligible        | Display normally with confidence indicator              |
| Eligibility uncertain  | Display with prominent verification requirement         |
| Confirmed ineligible   | Exclude by default; accessible through optional filters |
| Unavailable or expired | Remove from active feed; preserve in history            |

An eligibility uncertainty must not automatically prevent ranking.

### Eligibility dimensions

- Medical registration.
- Qualifications and fellowships.
- Postgraduate experience.
- Specialty competence.
- Procedural requirements.
- Supervision.
- Independent clinical cover.
- Credentialing.
- Applicable training and employment restrictions.

Eligibility assessments must contain both a classification and an explanation supported by available source information.

Missing requirements are not evidence that the requirements are satisfied.

### Eligibility versus feasibility

The platform shall independently evaluate:

**Professional eligibility:** Is the doctor qualified and appropriately credentialled?

**Scheduling feasibility:** Could the doctor realistically undertake the shifts?

**Logistical feasibility:** Can travel, accommodation and related arrangements reasonably be achieved?

**Personal attractiveness:** Is the opportunity worth pursuing?

This separation prevents avoidable loss of otherwise attractive opportunities.

---

## 5. Current and future opportunity management

### Decision LR-003 — Current and future planning

**Status: Confirmed**

Locum Radar shall maintain both an active opportunity feed and a forward-planning interface.

### Temporal categories

- Urgent: short-notice vacancies requiring relatively prompt action.
- Near-term: upcoming shifts and placements.
- Medium-term: placements scheduled several weeks or months ahead.
- Long-term: extended contracts and future recruitment blocks.
- Flexible or recurring: opportunities with negotiable dates or repeated staffing requirements.

Urgency thresholds should be configurable.

### Availability modelling

A user's schedule shall distinguish:

- Confirmed unavailable dates.
- Potentially negotiable work commitments.
- Approved leave.
- Provisional leave or release.
- Preferred working periods.
- Confirmed available dates.

A roster conflict that might be resolved through leave or release must remain visible, accompanied by an appropriate warning.

The application must not infer approval of leave or release.

### Planning features

The system should support a calendar view, multi-week placement comparisons, preliminary earnings projections and identification of complementary non-overlapping blocks.

Historical and recurring opportunities may be used to inform future planning, provided that predicted vacancies are explicitly distinguished from currently advertised jobs.

---

## 6. Vacancy data requirements

Every opportunity should have the following structured data where available:

**Identity:** opportunity ID, originating source, reference numbers, hospital, recruiter.

**Clinical:** specialty, grade, duties, required competencies, supervision, setting.

**Temporal:** advertised dates, individual shifts, hours, on-call requirements, flexibility.

**Financial:** quoted pay, rate basis, guaranteed hours, overtime, superannuation treatment, expenses, payment arrangement.

**Logistical:** travel, accommodation, vehicle availability, location, transportation requirements.

**Availability:** source status, first observed, last observed, last verified, deadline.

**Eligibility:** known requirements, fit assessment, uncertainty, supporting evidence.

**User information:** scores, notes, saved status, contact history, application progress.

Fields must retain provenance and allow unknown values.

---

## 7. Financial comparison

The platform shall calculate comparable compensation metrics where adequate data are available.

Required outputs include:

- Advertised remuneration.
- Estimated gross contract earnings.
- Effective paid hourly rate.
- Travel and accommodation costs.
- Expected earnings after direct placement expenses and before personal tax.
- Optional opportunity cost of travel and unpaid commitments.

Compensation calculations shall use deterministic code.

Unspecified paid hours, overtime entitlements or superannuation arrangements must not be silently assumed.

The interface must disclose calculation assumptions and confidence.

---

## 8. Personal attractiveness ranking

Rank suitable and potentially suitable opportunities using an explainable, configurable scoring system.

### Initial scoring model

| Dimension                           | Starting weight |
| ----------------------------------- | --------------: |
| Financial attractiveness            |             30% |
| Geography and adventure             |             25% |
| Clinical and career interest        |             20% |
| Scheduling and logistics            |             15% |
| Flexibility and opportunity quality |             10% |

Weights are user-editable.

### Separate dimensions

The ranking system must expose:

- Attractiveness score, 0–100.
- Eligibility classification.
- Feasibility classification.
- Evidence quality.
- Opportunity urgency.

Missing information must not automatically produce a zero score. The scoring system should distinguish a weak opportunity from one whose attractiveness remains difficult to assess.

### Ranking behaviour

Uncertain-eligibility jobs shall participate in the main ranking.

They should be clearly flagged, with appropriate handling of their uncertainty and the ability to request clarification.

Confirmed ineligible jobs shall not appear by default.

An exceptional opportunity with a negotiable scheduling conflict may remain highly ranked, but the conflict must remain conspicuous.

### Presets

- Best overall.
- Maximum income.
- Adventure and exploration.
- Career development.
- Convenient short placements.
- Future planning.

---

## 9. Dashboard and interaction design

### Main ranked feed

Provide a responsive, mobile-first feed with:

- Hospital and geographic location.
- Clinical grade and specialty.
- Shift dates and duration.
- Remuneration.
- Eligibility and feasibility indicators.
- Ranking score with explanation.
- Source freshness.
- Competing offers.
- Save, compare, dismiss and enquiry actions.

### Supporting interfaces

**Map explorer:** Australian vacancies displayed geographically, with interactive filters.

**Calendar and timeline:** Current and future placements shown alongside availability and commitments.

**Comparison workspace:** Side-by-side comparison of selected opportunities, including different offers for the same vacancy.

**Opportunity detail page:** Complete source evidence, requirements, financial calculations, recruiter details and outstanding questions.

**Application tracker:** Saved, enquiry sent, applied, credentialing, offered, accepted, rejected or withdrawn.

**Coverage dashboard:** Recruitment source performance and areas of the Australian hospital market with limited observation coverage.

### User experience requirements

- Mobile-first responsive design.
- Fast filtering and sorting.
- Plain-language ranking explanations.
- Clearly distinguish confirmed from inferred information.
- Avoid duplicate cards for the same underlying opportunity.
- Allow direct inspection of original source records.
- Preserve user filters and preferences between sessions.

---

## 10. Data ingestion architecture

Use independent source connectors feeding a common ingestion service.

### Collection methods

1. APIs and RSS feeds.
2. Public structured vacancy endpoints, where access is permitted.
3. Public HTML extraction.
4. Authorised browser-based collection.
5. Email ingestion and parsing.
6. Manual forwarding/import of private-source content.

All connectors must conform to a common output schema.

### Processing pipeline

Collection → Raw-source preservation → Structured extraction → Validation → Hospital matching → Duplicate reconciliation → Eligibility assessment → Financial normalisation → Ranking → Dashboard publication.

### Reliability

Each collector shall support:

- Incremental updates.
- Retry and backoff behaviour.
- Source health monitoring.
- Failure logging.
- Rate limits and access restrictions.
- Duplicate-safe processing.
- Recording of first-seen and last-seen times.

A source outage must not automatically cause previously known vacancies to be classified as filled.

---

## 11. Technology architecture

### Recommended stack

- **Frontend:** Next.js, React and TypeScript.
- **Database:** PostgreSQL with managed hosting, potentially Supabase.
- **Backend:** Python services for acquisition, extraction and scoring.
- **Workflow orchestration:** Scheduled workers, with n8n where useful for email-related workflows.
- **AI:** Schema-constrained extraction of vacancy information, uncertainty classification and readable summaries.
- **Mapping:** MapLibre and OpenStreetMap.
- **Authentication:** Private authentication with suitable account protection.
- **Hosting:** Managed cloud hosting.

The database schema should support multiple users eventually, without requiring a multi-user interface in the initial release.

AI must not be the authoritative calculation engine or the sole source of professional eligibility determinations.

---

## 12. Security and responsible acquisition

The application shall use minimal necessary permissions for external integrations.

Recruiter email access and calendar access should be read-only unless the user explicitly authorises additional operations.

Sensitive credentials must be stored securely.

External listing text and imported emails shall be treated as untrusted data.

The system must respect private platform access controls, relevant collection terms and source rate limits.

Applications, contract acceptance and communications with recruiters shall remain user-controlled in the initial release.

---

## 13. Opportunity lifecycle and alerts

Each opportunity should carry a reliable lifecycle state:

- Newly discovered.
- Currently advertised.
- Availability unconfirmed.
- Confirmed available.
- Filled or withdrawn.
- Expired.
- Archived.

Potential notifications:

- Newly discovered high-scoring jobs.
- Material remuneration changes.
- Better agency offer for a known opportunity.
- Exceptional urgent placements.
- Future blocks matching anticipated availability.
- Changes to saved opportunities.

Deduplicated opportunities should not produce repeated alerts merely because several agencies advertise them.

---

## 14. Optional intelligence extensions

### Hospital recruitment intelligence

Recruitment frequency, observed historic rates, recurring staffing patterns and agencies associated with individual facilities.

### Biodiversity and adventure scoring

Optional integration of geographic biodiversity information, protected areas and personal natural-history interests to evaluate the recreational appeal of locations.

### Market trend analysis

Compare remuneration and recruitment activity over time, while explicitly acknowledging incomplete source coverage.

### Preference learning

Use saves, dismissals, applications and manually adjusted rankings to suggest improved personal ranking weights.

User-controlled preferences and hard professional restrictions must not be silently modified.

---

## 15. Development phases

### Phase 1 — Working intelligence feed

Build the personal profile, public-board collection, recruitment email ingestion, structured database, deduplication, eligibility classification, financial calculations and ranked dashboard.

Include uncertain eligibility in the feed from the first release.

Support both near-term and future vacancies from the beginning.

### Phase 2 — National exploration and planning

Add more agencies and hospital networks, the hospital directory, map explorer, calendar integration, offer comparison and source coverage analysis.

### Phase 3 — Advanced personal intelligence

Introduce historical recruitment analytics, adaptive recommendations, biodiversity scoring, advanced alerts and more sophisticated planning.

---

## 16. Acceptance criteria

The minimum viable product must demonstrate that:

1. Vacancies from at least three independently managed sources can be ingested.
2. The same vacancy advertised by different agencies is consolidated without losing distinct offer terms.
3. Different shifts or roles at one hospital remain separately identifiable.
4. Confirmed ineligible opportunities are excluded from the default feed.
5. Uncertain-eligibility opportunities remain visible and clearly labelled.
6. Scheduling conflicts that may be negotiable do not automatically remove otherwise attractive opportunities.
7. Current and future placements are both supported.
8. Advertised remuneration and derived financial estimates remain distinguishable.
9. User-adjusted ranking weights produce predictable changes.
10. Important vacancy fields are traceable to original sources.
11. Source failures and stale vacancies are communicated accurately.
12. Users can save, compare and contact recruiters using the information supplied.

---

## 17. Immediate development priorities

1. Finalise the initial user eligibility and preference profile.
2. Design the relational schema and canonical opportunity model.
3. Implement one public job-board collector.
4. Implement the recruitment email ingestion pathway.
5. Establish hospital identity matching and duplicate reconciliation.
6. Build the deterministic eligibility and ranking services.
7. Create a responsive ranked-feed interface.
8. Test the system against actual Australian vacancies.
9. Add additional sources based on unique, suitable vacancy yield.
10. Expand into maps, calendar planning and market intelligence.

---

## 18. Project definition

**Locum Radar shall discover widely, assess cautiously, rank personally and present efficiently.**

It should not merely display what recruitment agencies advertise.

Its purpose is to reduce the information, access and comparison barriers between an individual Australian doctor and the most attractive professional opportunities available to them.

**End — Specification v0.2**
