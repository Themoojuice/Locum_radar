# LOCUM RADAR
## Product Requirements & Technical Specification
**Version:** 0.1 — Foundational specification\
**Project status:** Proposed / pre-development\
**Primary user:** Australian registered medical practitioner\
**Initial deployment:** Private, single-user application\
**Target market:** Australian hospital-based and relevant community medical locum opportunities

---

## 1. Executive summary

**Locum Radar** is a personalised medical recruitment intelligence platform designed to discover, aggregate, reconcile, compare and rank temporary medical employment opportunities throughout Australia.

Rather than requiring doctors to search multiple recruitment agencies, hospital career portals, private forums and email distributions individually, Locum Radar will consolidate these channels into a single, continually updated database.

The system will use the doctor's qualifications, experience, availability, financial preferences, career goals and personal interests to evaluate the opportunities and present them in a ranked, interactive dashboard.

Its central purpose is not merely to find jobs, but to identify **the best opportunities available to a particular doctor, with the least possible manual effort**.

### Foundational objectives

1. **Maximum practical coverage:** Discover suitable opportunities across as many Australian hospitals, health services and recruitment channels as reasonably possible.
2. **Minimal administrative burden:** Automate vacancy collection, interpretation, comparison and monitoring wherever technically and legally feasible.
3. **Information efficiency:** Eliminate duplicate listings without discarding meaningful differences between recruiters or offers.
4. **Personal relevance:** Prioritise opportunities according to the individual doctor's eligibility, preferences, professional development and interests.
5. **Transparent comparison:** Present financial, geographic, clinical and logistical differences in an accessible interactive interface.
6. **Actionability:** Make it easy to identify an opportunity, assess its suitability, contact the recruiter and track the outcome.

### Defining success

A successful implementation allows a doctor to open one dashboard and rapidly determine:

- What suitable jobs are currently advertised?
- Which are most attractive, and why?
- What would they actually pay?
- What are their clinical and logistical requirements?
- How do competing offers compare?
- Which opportunities are new, unusual or especially lucrative?
- Which deserve immediate attention?

The dashboard should minimise the number of external websites that need to be visited and the amount of information the user must interpret manually.

---

## 2. Intended user and personalisation

Version 1 will support a single doctor, but the data model should permit additional users in the future.

### Initial user context

The initial profile is for a Cairns-based Australian medical practitioner with experience across hospital medicine, psychiatry, emergency medicine and rural clinical settings.

The application should accommodate positions including:

- Psychiatry registrar and other appropriately graded psychiatry locums.
- Emergency department RMO, registrar, PHO or CMO roles where eligible.
- General hospital and ward-based appointments.
- Rural and remote hospital work.
- Other suitable clinical positions identified through the doctor's actual qualifications and experience.

Specific registration status, postgraduate grade, independent-practice eligibility and supervision requirements must be verified during onboarding rather than inferred.

### User preference profile

The system shall maintain an editable profile containing:

| Category | Information |
|---|---|
| Professional | Registration, qualifications, PGY level, training status, previous specialties |
| Clinical eligibility | Independent-cover suitability, procedural skills, required supervision, credentials |
| Geographic | Home base, preferred states, excluded regions, maximum travel burden |
| Temporal | Available dates, minimum/maximum placement duration, shift preferences |
| Financial | Minimum acceptable remuneration, target income, preferred payment structures |
| Professional interest | Specialties, experience sought, potential training value |
| Lifestyle | Accommodation, transport, location preferences, outdoor interests |
| Personal priorities | Relative importance of income, adventure, clinical experience and convenience |

Preferences must be modifiable without restarting onboarding.

Certain preferences will function as **hard restrictions**, while others will influence the ranking.

For example, insufficient professional credentials constitute a potential hard restriction; a preference for coastal locations should generally be a soft preference.

---

## 3. Data acquisition and coverage

### 3.1 Source categories

The system shall support five complementary acquisition channels.

**A. Public locum agency boards**

Discover listings from agencies operating Australian medical recruitment platforms.

Initial candidates for investigation include Medrecruit, Global Medics, Cornerstone Medical Recruitment, JPS Medical, Ochre Recruitment, Wavelength, Skilled Medical, Charterhouse, Salt Medical, DNA Medical and other relevant services.

Individual source availability and automated-access permissions must be verified during implementation.

**B. Government and hospital recruitment portals**

Monitor Queensland Health, NSW Health, Victorian public health recruitment services, WA Health, SA Health, NT Health, Tasmania and the ACT, together with relevant individual hospital and health-network career sites.

Temporary hospital appointments must be distinguished from conventional permanent recruitment.

**C. Private recruiter communications**

Import vacancies distributed through authorised recruitment emails, job alerts, newsletters and attachments.

This will be one of the primary mechanisms for capturing opportunities unavailable through public job boards.

**D. Authorised private communities**

Support manual or permissioned ingestion from professional forums, community groups and other closed recruitment channels.

Automated access should be used only when authorised and technically supported.

**E. Direct and specialist sources**

Investigate rural workforce agencies, directly recruiting hospitals, professional networks, hospital staffing pools, RSS feeds and authorised APIs.

### 3.2 Source registry

Each source will have a registry record containing:

- Organisation name and source URL.
- Source type and geographic coverage.
- Supported clinical specialties.
- Access method: API, RSS, public page, email, authorised login or manual import.
- Permission and access restrictions.
- Authentication requirements.
- Collection frequency.
- Last successful update.
- Reliability and completeness indicators.
- Number of unique suitable vacancies contributed.
- Source health and error history.

This will enable an explicit assessment of whether an additional agency meaningfully improves coverage.

### 3.3 Acquisition principles

The collector should prefer structured APIs and feeds, followed by permissioned email integrations, ordinary HTML extraction and browser automation where permitted.

Collection must respect rate limits, authentication controls, relevant site terms and data-handling requirements.

The system must not circumvent CAPTCHA controls, private-group permissions or access restrictions.

A failed or inaccessible source shall be identified as unavailable rather than silently represented as having no vacancies.

### 3.4 National hospital coverage

Maintain a canonical directory of Australian hospitals and relevant healthcare facilities.

Each hospital should have a persistent identifier, alternative names, location, region and available service metadata.

Public hospital datasets, including appropriate Australian Institute of Health and Welfare resources, should be evaluated as initial directory sources.

A separate coverage indicator shall distinguish:

- Hospitals with recently observed vacancies.
- Hospitals represented by monitored sources but without recently observed vacancies.
- Hospitals with incomplete or unknown source coverage.
- Hospitals intentionally excluded from monitoring.

This prevents an absence of advertisements from being interpreted as proof that no work exists.

---

## 4. Information model and deduplication

### 4.1 Four distinct entities

The data model shall distinguish between:

**Source listing:** An advertisement, email, web record or message that describes potential employment.

**Clinical opportunity:** The underlying staffing requirement at a particular facility, in a particular clinical role, over a particular period.

**Recruiter offer:** The particular remuneration, inclusions, conditions and application route offered by one source.

**Shift or placement:** An individual rostered shift or a group of shifts constituting the opportunity.

This separation is essential.

One opportunity may have several advertisements and offers. One advertisement may contain several opportunities. One opportunity may contain multiple independently bookable shifts.

### 4.2 Deduplication

The system shall compare incoming listings using:

- Hospital identity and known aliases.
- Specialty and clinical grade.
- Shift or placement dates.
- Roster details.
- Job reference numbers.
- Advertised compensation and benefits.
- Recruiter relationships.
- Geographic and contextual information.

Exact or high-confidence matches may be automatically linked.

Ambiguous matches should remain separate until adequately verified, with an optional review queue.

### 4.3 Preserve competing offers

When multiple recruiters advertise the same opportunity, the main dashboard shall show one consolidated opportunity card.

That card must preserve access to all known offers, including:

- Agency identity.
- Advertised rates.
- Flights, accommodation and transport.
- Contract conditions.
- Original listing links.
- Last-verified timestamps.
- Differences or contradictions between offers.

The system must not assume two listings are identical merely because their hospital and dates coincide.

Users must be able to correct an incorrect merge or separation.

### 4.4 Historical preservation

Changes in advertised pay, dates, requirements or availability should be recorded where practicable.

A listing disappearing from a source shall not be immediately assumed filled.

Store both the observation history and the current best-known state.

---

## 5. Eligibility assessment

Eligibility will be evaluated before personal attractiveness.

### 5.1 Eligibility categories

Every opportunity must receive one of these classifications:

| Status | Definition | Default treatment |
|---|---|---|
| Eligible | Known requirements satisfied | Show in ranked feed |
| Likely eligible | No known conflict; some uncertainty | Show with qualification |
| Needs verification | Important requirements missing or ambiguous | Separate review view |
| Ineligible | Confirmed conflict with mandatory requirements | Hide from default feed |
| Expired/unavailable | Placement no longer actionable | Archive |

### 5.2 Assessment criteria

The eligibility engine should evaluate registration, specialty, postgraduate experience, required credentials, supervision arrangements, independent-cover requirements, procedural competency and contract dates.

It should also identify possible employment, credentialing or professional indemnity prerequisites.

An advertisement's silence on a requirement must not be treated as confirmation that the requirement is satisfied.

### 5.3 Safety requirements

A ranking score must never override a confirmed professional eligibility restriction.

AI may identify potentially relevant requirements, but must not fabricate registration rights, fellowship equivalence, procedural competency or training accreditation.

Uncertain cases should direct the user to the relevant recruiter, health service or professional authority for clarification.

---

## 6. Financial normalisation

Remuneration must be compared on a consistent basis wherever the underlying data permit.

### Core calculations

The system should calculate:

1. Advertised rate in its original units.
2. Expected gross remuneration for the placement.
3. Effective paid hourly rate where comparable paid hours are known.
4. Travel and accommodation costs borne by the doctor.
5. Expected cash remaining after direct placement expenses, before personal income tax.
6. Optional estimates for unpaid travel time and total time committed.

### Required remuneration metadata

- Currency and original rate.
- Hourly, daily, per-shift or contract basis.
- Paid hours and guaranteed hours.
- Ordinary-hours versus overtime rules.
- Overnight and on-call payments.
- Superannuation inclusion or exclusion.
- Employee versus contractor arrangement.
- Reimbursable expenses.
- Uncertain or undisclosed components.

The interface must clearly distinguish confirmed figures from estimates.

Where assumptions are necessary, they must be visible and editable.

Income comparisons must not convert an unspecified daily payment into a supposedly precise hourly rate.

---

## 7. Personalised attractiveness ranking

### 7.1 General structure

Ranking shall operate on clinically suitable, actionable opportunities.

The user's personal preferences will determine the relative attractiveness of those opportunities.

Suggested initial scoring dimensions:

| Dimension | Initial weighting |
|---|---:|
| Financial attractiveness | 30% |
| Location and adventure | 25% |
| Clinical interest and career value | 20% |
| Logistics and availability compatibility | 15% |
| Flexibility and opportunity quality | 10% |

These are initial calibration values, not permanent assumptions.

### 7.2 Ranking engine

The default scoring model should be transparent and deterministic.

**Attractiveness score = weighted combination of normalised criterion scores.**

The system should calculate an interpretable 0–100 score, but missing data must not automatically receive zero attractiveness.

Where information is incomplete, show a separate evidence-completeness or confidence indicator.

Each ranked job shall provide an explanation of the principal reasons for its position.

### 7.3 Distinct evaluation axes

To avoid conflating unrelated concepts, show:

- **Eligibility:** Can the doctor realistically undertake the position?
- **Attractiveness:** How closely does it match the doctor's preferences?
- **Evidence confidence:** How reliable and complete is the information?
- **Urgency:** How soon might action be required?

A highly attractive but poorly documented opportunity should not masquerade as a confirmed excellent offer.

### 7.4 Ranking presets

Provide editable presets:

- Highest income.
- Most exciting.
- Career advancement.
- Convenient and low-friction.
- Rural and remote adventure.
- Best overall match.

Weights should update interactively, without re-fetching or reprocessing source listings.

### 7.5 Personal preference learning

Users should be able to save, dismiss, shortlist and rank opportunities manually.

These interactions may inform suggested future preference adjustments.

Adaptive scoring should remain explainable, user-controllable and reversible.

Automatic changes to important eligibility restrictions are not permitted.

---

## 8. User interface specification

### 8.1 Main dashboard

The landing screen will contain:

**Summary header**
- Newly discovered opportunities.
- Current eligible opportunities.
- High-priority matches.
- Opportunities approaching their start date.
- Source coverage and collection health.

**Ranked vacancy feed**
- One card per underlying opportunity.
- Hospital and location.
- Specialty and grade.
- Dates and duration.
- Advertised remuneration.
- Effective-rate estimate where supported.
- Travel and accommodation arrangements.
- Eligibility status.
- Personal attractiveness score.
- Confidence and freshness.
- Number of competing offers.
- Direct links and save/contact controls.

**Interactive filters**
- Specialty and grade.
- Geographic area and distance.
- Placement dates.
- Pay and contract duration.
- Eligibility category.
- Included travel benefits.
- Preferred clinical environment.
- Advertised versus verified availability.

### 8.2 Geographic explorer

A national map shall display eligible and potentially eligible opportunities.

Map filters and visual encoding should support remuneration, attractiveness, specialty and contract duration.

Hospital clusters must remain navigable when several opportunities exist at one facility.

A second map mode should visualise source coverage rather than advertised opportunities.

### 8.3 Comparison workspace

Users should be able to select approximately two to four opportunities and compare them side by side.

Comparison fields include financial terms, clinical role, location, duration, travel burden, eligibility, training implications and attractiveness criteria.

Differences should be visually highlighted.

Unknown information must remain visibly unknown.

### 8.4 Calendar view

Provide a calendar or timeline illustrating:

- Individual shifts.
- Multi-day placements.
- Conflicting placements.
- User availability.
- Potential combinations of adjacent shifts.

An optional authorised calendar integration should enable availability checking without requiring the user to manually re-enter all commitments.

### 8.5 Opportunity detail page

Every opportunity should have a dedicated detail view containing:

- All known source listings.
- Competing agency offers.
- Original evidence and links.
- Extracted requirements.
- Compensation breakdown.
- Hospital information.
- Ranking explanation.
- Outstanding questions.
- Personal notes.
- Recruiter communications and application status.

### 8.6 Application tracker

Support a simple workflow:

**Discovered → Saved → Enquiry sent → Applied → Interview/credentialing → Offered → Accepted/declined**

Application actions should be user-controlled.

Automated applications and recruiter negotiations are excluded from the initial release.

---

## 9. Additional intelligence features

### 9.1 Hospital intelligence

Aggregate vacancies by facility to show:

- Recruitment activity observed over time.
- Advertised remuneration history.
- Typical locum position types.
- Recruiters associated with the hospital.
- Frequency of recurring opportunities.
- Known travel and accommodation patterns.

Historical source observations should not be presented as comprehensive market data.

### 9.2 Biodiversity and exploration layer

An optional personalisation feature should estimate the recreational and scientific appeal of a placement's location.

Potential data sources include biodiversity observation databases, public reserve datasets and user-supplied interests.

Example variables:

- Nearby rainforest, tropical woodland or other interesting habitats.
- Proximity to national parks and reserves.
- Recorded biodiversity and taxonomic interest.
- Relative distance from areas already explored by the user.
- Availability of potential fieldwork excursions outside working hours.

This layer should influence personal attractiveness only and must not affect professional eligibility.

### 9.3 Market intelligence

Potential later features include:

- Historical pay comparisons across agencies.
- Detection of recurring recruitment needs.
- Identification of opportunities re-advertised at increased rates.
- Discovery of hospitals poorly represented in agency listings.
- Notifications for unusually well-paid or personally relevant positions.

Care must be taken not to overinterpret incomplete market samples.

---

## 10. Technical architecture

### Preferred architecture

A private web application supported by a central structured database, independent data collectors and a small ranking service.

**Proposed stack**

| Layer | Preferred technology |
|---|---|
| Frontend | React / Next.js, TypeScript |
| Styling and UI | Accessible component library and responsive CSS |
| Backend | Python or TypeScript services |
| Database | PostgreSQL, potentially via Supabase |
| Collection | HTTP clients, HTML parsers, permitted browser automation |
| Scheduling | Managed scheduler or background workers |
| Workflow orchestration | Optional n8n integration |
| Extraction | Structured parsers and schema-constrained LLM extraction |
| Maps | MapLibre / OpenStreetMap |
| Hosting | Managed application hosting |
| Authentication | Private account authentication with MFA support |

The system should not depend on a language model to perform arithmetic, determine identity relationships or render the user interface.

LLM assistance should primarily address unstructured job advertisements, ambiguous terminology and human-readable explanations.

### 10.1 Data processing pipeline

**Step 1 — Collect**

Retrieve permitted source records and incoming recruitment messages.

**Step 2 — Preserve**

Store raw content or appropriate source references, timestamps and collection metadata.

**Step 3 — Extract**

Convert source content into validated, typed vacancy records, retaining evidence and extraction uncertainty.

**Step 4 — Resolve**

Match hospitals, jobs, recruiters and dates against canonical records.

**Step 5 — Reconcile**

Merge duplicate source listings into underlying opportunities while preserving differing offers.

**Step 6 — Assess**

Evaluate eligibility, normalise compensation and calculate ranking components.

**Step 7 — Publish**

Update dashboard views, search indexes and notification candidates.

**Step 8 — Monitor**

Track changes, withdrawn adverts, collector failures and previously observed opportunities.

### 10.2 Principal database entities

The initial schema should include:

- `users`
- `user_profiles`
- `availability`
- `facilities`
- `sources`
- `source_listings`
- `opportunities`
- `shifts`
- `recruiter_offers`
- `compensation_terms`
- `eligibility_assessments`
- `score_snapshots`
- `user_job_actions`
- `source_observations`
- `collection_runs`
- `notification_events`

Persistent identifiers and relationships are essential for reliable deduplication and longitudinal analysis.

Original source IDs and timestamps should always be retained where available.

### 10.3 Collector modularity

Each external source should have a separate collector adapter with a consistent output contract.

A broken or modified agency website must not disrupt unrelated collectors.

Collectors should support retries, incremental updates, observability and conservative rate limits.

Jobs should be processed idempotently to prevent duplicate database entries after retries.

### 10.4 Time handling

Store times in UTC, together with the originating local timezone where relevant.

Australian daylight-saving differences must be handled correctly.

Shift calendars must not assume that every state shares Queensland time.

---

## 11. Freshness, quality and verification

Every opportunity should have explicit timestamps for:

- First discovery.
- Most recent observation.
- Most recent confirmed source update.
- Most recent successful verification, where possible.

### Vacancy status

Use distinct states for:

- Currently advertised.
- Recently observed, verification pending.
- Confirmed available.
- Confirmed filled or withdrawn.
- Expired.
- Source inaccessible.

An advertisement remaining visible on a website does not, by itself, guarantee that the shift remains bookable.

### Quality controls

Implement validation for missing dates, impossible compensation values, inconsistent time ranges, grade mismatches and hospital identity conflicts.

Field-level provenance should make it possible to trace important information back to the original source.

---

## 12. Security and privacy

The initial platform is intended to be private.

### Requirements

- Secure authentication.
- Encrypted connections.
- Protected storage of API keys and recruiter credentials.
- Read-only external integrations wherever possible.
- Minimum necessary access to email and calendar information.
- User-controlled removal of personal and imported information.
- No unauthorised redistribution of private recruitment content.
- Sanitisation of imported HTML and text.
- Protection against malicious instructions contained in external content.
- Controlled use of third-party AI services, with disclosure of relevant data-sharing implications.

The system should retain employment-relevant professional information without collecting unnecessary medical, financial or other sensitive personal records.

Credential documents need not be stored in the first version; a checklist and secure references may be sufficient.

---

## 13. Automation and notifications

The system should refresh eligible sources on suitable schedules, depending on access permissions, update frequency and technical costs.

### Proposed notifications

- New opportunity matching the user's high-priority preferences.
- Material increase in advertised remuneration.
- Better competing offer discovered.
- Highly attractive short-notice vacancy.
- New information resolving previous eligibility uncertainty.
- Relevant change to a saved or applied-for position.

Avoid repeat alerts for duplicate advertisements.

Provide quiet hours, digest frequency and urgency thresholds.

The initial notification channel should be email, with other notification channels considered later.

---

## 14. Development roadmap

### Phase 1 — Minimum viable product

**Goal:** A working, reliable, personally ranked feed.

Scope:
- Basic user profile and eligibility constraints.
- Initial public agency collectors.
- Recruitment email ingestion.
- Central vacancy database.
- Hospital matching and deduplication.
- Offer preservation.
- Compensation normalisation.
- Deterministic ranking.
- Filterable opportunity feed.
- Saved jobs and original source links.
- Collector health and freshness indicators.

**Exit requirement:** Real advertisements from multiple sources can be consolidated, assessed and ranked without significant manual re-entry.

### Phase 2 — Coverage and comparison

**Goal:** Extend the system beyond a basic aggregated feed.

Scope:
- Additional agencies and hospital networks.
- National hospital directory.
- Geographic exploration.
- Full comparison interface.
- Calendar integration.
- Improved salary calculations.
- Agency-offer comparisons.
- Vacancy history and change detection.
- Notification rules.

**Exit requirement:** Users can evaluate geographically distributed opportunities, compare actual competing terms and identify relevant new vacancies promptly.

### Phase 3 — Personal intelligence

**Goal:** Improve the quality of discovery and decision-making.

Scope:
- Optional preference learning.
- Advanced source coverage analytics.
- Biodiversity and adventure scoring.
- Historical recruitment insights.
- Recruiter relationship management.
- Intelligent monitoring for exceptional opportunities.

**Exit requirement:** The system demonstrates measurable improvement in the relevance of opportunities surfaced and the effort required to discover them.

---

## 15. Quality assurance and acceptance tests

The system should be tested against realistic examples, including:

**Duplicate listing test:** Two agencies advertise the same hospital, dates and role with different rates. The dashboard displays one underlying opportunity with two preserved offers.

**False-merge test:** Two different roles at the same hospital with overlapping dates remain distinct.

**Unknown eligibility test:** A poorly specified registrar listing is marked for verification rather than automatically rejected.

**Known ineligibility test:** A position explicitly requiring a qualification the user lacks is excluded from the normal ranked feed.

**Missing salary test:** A suitable position without published remuneration remains discoverable without a fabricated hourly rate.

**Pay comparison test:** An overnight on-call placement is not compared with a standard daytime shift using misleading assumptions.

**Source outage test:** Failure of a major recruitment board does not cause its historical listings to disappear or incorrectly become confirmed vacancies.

**Freshness test:** Old or withdrawn jobs are clearly distinguished from newly advertised opportunities.

**Scoring test:** Changing financial or geographic weighting predictably alters the ranking without modifying eligibility status.

**Provenance test:** The source of every material extracted claim can be inspected.

**Privacy test:** External content cannot execute instructions against the application or access unrelated personal data.

---

## 16. Success metrics

Success should be measured by the usefulness of the system rather than the raw number of advertisements collected.

| Metric | Purpose |
|---|---|
| Unique suitable opportunities | Measures actual recruitment value |
| Source contribution | Identifies productive recruitment channels |
| Duplicate detection precision | Prevents unrelated jobs from being merged |
| Duplicate detection recall | Limits repetitive listings |
| Eligibility classification quality | Prevents invalid recommendations |
| Compensation extraction accuracy | Supports meaningful comparisons |
| Median listing age | Measures freshness |
| Percentage with traceable sources | Measures auditability |
| Saved/contacted opportunity rate | Indicates personal relevance |
| Time needed to identify attractive jobs | Measures reduced administrative effort |
| Recruiter response and placement outcomes | Measures practical value over time |

National vacancy recall cannot be directly measured without a reliable external reference set. Coverage claims should therefore be limited to observed sources and defined sampling methods.

---

## 17. User setup responsibilities

The application should minimise manual responsibilities but cannot eliminate them entirely.

### Essential actions

- Confirm professional eligibility, qualifications and clinical experience.
- Establish basic location, remuneration and roster preferences.
- Authorise a recruitment email integration or dedicated inbox.
- Provide availability information or authorise an appropriate calendar connection.
- Register with selected agencies where access is restricted to verified applicants.

### Optional actions

- Provide a current CV and credentialing details where useful.
- Join relevant authorised professional communities.
- Link additional recruiter communications channels.
- Calibrate personal ranking preferences through feedback.
- Enable biodiversity and travel personalisation.

The development team should undertake public source discovery, integration engineering, data processing and monitoring without requiring the user to register individually with every publicly accessible source.

---

## 18. Known risks and constraints

| Risk | Mitigation |
|---|---|
| Public boards change structure | Modular collectors, tests and source monitoring |
| Private vacancies are inaccessible | Authorised email and manual import pathways |
| Incomplete eligibility information | Conservative classification and verification queue |
| Incorrect duplicate matching | Evidence-based matching with reversible merges |
| Job advertisements become stale | Freshness tracking and explicit status uncertainty |
| Advertised pay is ambiguous | Preserve original remuneration and assumptions |
| AI extraction errors | Schema validation, source evidence and quality tests |
| Data ingestion becomes expensive | Prioritise high-yield sources and incremental updates |
| Too many low-value alerts | User-configured thresholds and duplicate-aware notifications |
| Geographic coverage is overstated | Separate source coverage from actual vacancy observations |

---

## 19. Initial scope exclusions

The first version will not attempt to:

- Guarantee discovery of every Australian locum vacancy.
- Circumvent private website access controls.
- Automatically submit employment applications.
- Negotiate remuneration without explicit user approval.
- Certify professional eligibility or training accreditation.
- Provide personalised tax or financial advice.
- Assume an advertised position remains available without verification.
- Guarantee that AI-derived preference rankings reflect the user's preferences without calibration.

These exclusions are deliberate reliability and scope controls, not permanent limitations.

---

## 20. Foundational product decisions

The following architectural decisions are proposed for adoption:

**Decision 1 — Opportunity-first modelling.** The system organises recruitment around underlying clinical vacancies, not advertisement count.

**Decision 2 — Preserve offer differences.** Duplicate resolution must not discard alternative recruiters, terms or remuneration.

**Decision 3 — Eligibility before attractiveness.** Professional feasibility is independent of the personalised ranking.

**Decision 4 — Uncertainty is explicit.** Missing, conflicting or unverified information must remain distinguishable from confirmed facts.

**Decision 5 — Transparent personalisation.** Ranking must be explainable, configurable and reproducible.

**Decision 6 — National coverage is measurable.** The system will track source reach and gaps rather than claim complete market coverage.

**Decision 7 — Automation with user control.** Collection and analysis should be automated, while high-consequence employment decisions remain with the doctor.

**Decision 8 — Build for practical usefulness first.** Reliable data acquisition, reconciliation and ranking take priority over sophisticated visual features.

---

## 21. Decisions remaining before implementation

The following are proposed for confirmation, with sensible defaults.

| Decision | Proposed default |
|---|---|
| Initial geographic coverage | All Australian states and territories |
| Priority specialties | Psychiatry, emergency medicine, general hospital medicine and suitable rural roles |
| Main ranking objective | Balanced personal attractiveness |
| Public versus private sources | Both, with permissioned access |
| Unknown eligibility | Separate review queue |
| Ranking calculation | Transparent weighted scoring |
| Hosting | Private cloud application |
| Initial users | One |
| Application handling | Manual, tracked within dashboard |
| Job alerts | Email digest plus exceptional-match notifications |
| Extra interests | Optional biodiversity/adventure layer |
| Commercialisation | Not required for initial design |

---

## 22. Long-term vision

Locum Radar should evolve into a personalised intelligence system that understands both the Australian medical locum market and the individual doctor using it.

Its long-term value will arise not from collecting the largest possible number of advertisements, but from identifying genuine, suitable opportunities that would otherwise be overlooked, resolving fragmented information into meaningful comparisons and making employment decisions faster and better informed.

**The product's guiding principle is:**

*Find the widest possible range of genuine opportunities. Eliminate irrelevant and redundant information. Preserve meaningful differences. Rank transparently according to the doctor's priorities. Make the next action obvious.*

**End of specification — Version 0.1.**