# Specification status — first draft

The supplied v0.1 specification covers a multi-phase product. This release delivers the decision-making workspace and ingestion architecture. It does **not** claim Phase 1's exit requirement of validated automated collection from multiple live sources.

| Capability                                    | First-draft status                                                                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Editable profile and eligibility restrictions | Implemented; starts unknown; self-declaration only                                                                                      |
| Availability windows                          | Implemented as local dates                                                                                                              |
| Opportunity/listing/offer separation          | Implemented with relational identities and preserved source history                                                                     |
| Shift-level modelling                         | Deferred; calendar currently shows placements                                                                                           |
| Conservative duplicate handling               | Implemented; exact linking, review queue, reviewed merge and offer separation                                                           |
| Compensation normalisation                    | Implemented for known paid units; expenses and travel scenarios; no tax engine                                                          |
| Deterministic scoring                         | Implemented, six presets, adjustable weights, explanations and criterion coverage                                                       |
| Filterable feed and shortlist                 | Implemented                                                                                                                             |
| Comparison                                    | Implemented for up to four vacancies                                                                                                    |
| Map                                           | Schematic explorer and starter coverage list; 10 curated facilities, not national coverage                                              |
| Timeline                                      | 2027 month navigation, availability strips, placement overlap warnings                                                                  |
| Tracker and notes                             | Implemented; manual actions only                                                                                                        |
| Text/HTML/JSON imports                        | Implemented with review, validation and provenance                                                                                      |
| Recruitment email                             | Recruiter-specific EML splitters, mail-drop and selected-label Gmail OAuth/body collector; live consent required; attachments pending   |
| Public collectors                             | Resumable HTML/JSON-LD, feeds, sitemaps and search; native Medrecruit, 1Medical, Wavelength and Adzuna adapters; explicit qualification |
| Source registry / health                      | Implemented; explicit unmonitored, success, failure and contribution states                                                             |
| Other state health portals                    | QLD/NSW starter entries only; remaining states need research and adapters                                                               |
| Persistence                                   | SQLite validated; PostgreSQL adapter implemented but not live tested                                                                    |
| Private access                                | Local loopback default; optional password; hosted configuration gates                                                                   |
| MFA and friend accounts                       | Deferred; requires identity-aware hosting and per-user authorisation                                                                    |
| Notification scheduling                       | Deferred; no messages are sent                                                                                                          |
| National facility directory                   | AIHW MyHospitals import and name resolution implemented; derived towns approximate                                                      |
| Biodiversity / adventure                      | Demonstration preference values only; live scores unknown until configured                                                              |
| Historical market intelligence                | Source revision history implemented; market trends and benchmarking deferred                                                            |
| Preference learning                           | Deferred; ranking changes remain user-controlled                                                                                        |

## Next development sequence

1. Collect representative, authorised recruiter messages and confirm the doctor's actual profile/availability.
2. Build fixture-tested adapters for the two or three sources contributing the most **unique suitable vacancies**. Compare extraction to human review; do not optimise for advertisement count.
3. Validate one real multi-agency duplicate, one deceptive near-duplicate, one rate change, one withdrawn offer, one multi-block email and one source outage end to end.
4. Connect and validate the implemented selected-label Gmail collector, then add attachment extraction and a deduplicated digest.
5. Add exact shifts, timezone overrides, travel/credentialing buffers and a payment-reconciliation ledger.
6. Only then broaden source count, validate and enrich the national facility directory and move to a tested private hosted deployment.

The useful proof is a real job worth pursuing that the doctor would otherwise have missed—not a large demo dataset or an opaque high score.
