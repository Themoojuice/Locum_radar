# Acquisition framework and operating guide

Updated 14 October 2026. This is a personal, single-owner installation. A source recipe is a starting configuration, not a claim that its whole job board has been collected. The application distinguishes access review, technical compatibility, current scan progress and accepted vacancies.

## What this implementation does

The common collector follows a durable queue of listing pages, individual job pages, feed pages, sitemaps or API cursors. It checkpoints each page and processes at most three pages/messages per request. Discover repeatedly requests batches, shows results, and can stop after a batch. Closing Discover leaves a resumable checkpoint. The command-line worker can drain the same queue without a browser.

Each source has explicit hosts, starting URLs, path patterns, extraction selectors, request delays and page/record budgets. A record cap partway through a page preserves an offset so raising the budget resumes the remaining records. A source lease prevents simultaneous workers. Failed requests retain existing vacancies; a failed or truncated scan never establishes successful coverage. Rate limits and unavailable robots rules pause the source for 24 hours. A successful scan means the configured traversal finished, not that every role available from that organisation is known.

Original text, source URL/ID, observation time, available publication time and a content hash are stored in `acquisition_documents`. Unchanged content does not create duplicate reviews; changed content creates another evidence version. Generic collector and Gmail records enter the existing Review queue. Dedicated agency adapters and mail-drop imports retain the automatic-import option for validated records; set `COLLECTOR_AUTO_IMPORT=false` for review of those records too. Published/expiry dates are not placement dates, salary estimates are not hourly locum offers, and uncertain dates, requirements and rates remain unconfirmed. Clear a disabled source's collected evidence in Collection settings; accepted vacancies and their retained provenance are separate and can be deleted individually.

HTTP collection checks robots rules per path, limits redirects to configured hosts, pins public IPv4 DNS results, rejects private/reserved destinations, bounds responses to 4 MB and requests to 20 seconds, and observes source pacing. Access challenges are reported. There is no login/CAPTCHA bypass or automated application submission.

Dedicated Medrecruit, 1Medical, Wavelength and Adzuna adapters are also retained. They use bounded incremental scans and the live log; they do not yet share the generic engine's durable per-page resume queue. A limit, stop or early exit is shown as partial coverage. The AIHW hospital directory and recruiter-specific EML splitters support facility matching and multi-vacancy emails.

## Implemented collector families

| Family                        | Functionality now                                                                                                                                 | Remaining qualification or setup                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Public HTML + JSON-LD         | Link traversal, pagination, JobPosting extraction, detail-text fallback, stable identifiers                                                       | Site-specific selectors must match the actual board; dynamic controls are reported as incomplete |
| RSS / Atom                    | IDs, titles, links, publication dates, descriptions, Atom continuation                                                                            | Add an actual published feed URL and applicable access review; feed entries remain leads         |
| XML sitemaps                  | Sitemap indexes, allowed-host traversal, job-path filtering                                                                                       | Configure narrow paths; compressed sitemap files are not supported                               |
| Adzuna Australia              | Documented search endpoint, date query, pagination, IDs and source links                                                                          | App ID/key and current API usage/attribution conditions; not live authenticated here             |
| Gmail selected label          | Read-only OAuth + PKCE, encrypted local token storage, custom-label selector, pagination, MIME plain/HTML body reading, label recheck per message | Google client setup and owner consent; account integration not live authenticated here           |
| Recent public web/forum leads | Brave Search API, custom queries, recent date window, pagination and provider cap reporting                                                       | API key/plan; search indexing is incomplete and snippets need original-source verification       |
| Manual / email-file import    | Existing reviewed text, HTML, JSON and EML body imports                                                                                           | PDF, Word, spreadsheet and image attachments still need separate text import                     |

## Source qualification

Live worker check on 14 October: an isolated Ochre scan fetched three pages, created two evidence documents and two review records, and correctly stopped as **partial** with nine URLs still queued. No test records were accepted as vacancies or added to the owner's workspace. This validates the real HTTP → parser → durable queue → review path; it does not establish full-board coverage.

Salt's saved HTML is technically readable, but [its published terms, section 4](https://saltmedics.com/wp-content/uploads/2021/09/Salt-Medical-Website-TCs.pdf) expressly prohibit screen scraping. The recipe records that restriction and starts denied/disabled. Use labelled recruiter email or obtain specific permission. No further Salt probe is included in the research helper.

Sources → **Add / update collector recipes** installs or upgrades the catalog without overwriting saved custom configurations or approving/enabling sources. New installations retain their original source list until this action is used. Configure access and collection details per source, then use Discover → **Fetch active vacancies**. Additional feeds, boards and discovery queries can be registered with **Add a custom source**.

| Source                                                                          | Observed compatibility and limits                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ochre Recruitment                                                               | Live public index and detail HTML inspected. Five job links and normal `start=` pagination found; detail text extracted successfully. Unrelated robots exclusions must not block allowed job paths. Whole-board completeness has not been asserted.                                                                                             |
| Salt Medical                                                                    | Public index and detail HTML inspected. Job links, normal page URLs and JobPosting data found. The board also includes nursing jobs; explicit non-doctor titles are excluded from vacancy reviews.                                                                                                                                              |
| Medrecruit                                                                      | Separate `/jobs/listing` page contains 20 job links in the saved sample. Its 237-page control uses buttons, not HTML next links. The merged dedicated adapter reads structured page data using numbered URLs. Its fixtures pass; full live traversal remains unqualified. The generic HTML fallback still reports button pagination as partial. |
| Cornerstone (CMR)                                                               | Public job links and WordPress pagination observed; pagination access and detail extraction require qualification.                                                                                                                                                                                                                              |
| Skilled Medical                                                                 | Public homepage inspected. ASP.NET navigation needs a dedicated traversal qualification; generic path patterns are only a candidate.                                                                                                                                                                                                            |
| JPS Medical                                                                     | Applyflow client-rendered board observed. Ordinary HTML does not establish vacancy coverage. Seek a feed, use recruiter email, or manually import rendered page content.                                                                                                                                                                        |
| Wavelength                                                                      | A dedicated job-endpoint adapter is implemented and fixture-tested. The generic public-page recipe is incomplete; validate endpoint coverage and complement it with labelled recruiter email.                                                                                                                                                   |
| Charterhouse                                                                    | Separate Salesforce job portal requires endpoint and access review; the homepage is not full coverage.                                                                                                                                                                                                                                          |
| Global Medics, DNA, NSW Health                                                  | Candidate configurations supplied, not live-qualified end to end.                                                                                                                                                                                                                                                                               |
| Queensland Health / SmartJobs                                                   | Public search form inspected. Configure a saved result URL; visiting the search form cannot establish coverage.                                                                                                                                                                                                                                 |
| Rural Health West, RWAV, Health Workforce Queensland, NSW Rural Doctors Network | Additional rural-source candidates, requiring URL/selector qualification and individual credential checks.                                                                                                                                                                                                                                      |
| Adzuna, Gmail label, forum and rural-employer search                            | Provider adapters and test fixtures are implemented; live operation depends on owner credentials/configuration.                                                                                                                                                                                                                                 |

The research helper `scripts/probe-sources.ts` performs a small public compatibility probe and saves samples under ignored `data/research`. `scripts/validate-source-samples.ts` checks those local samples without another network request. Actual advertisements are not committed as fixtures; automated tests use synthetic data.

## Gmail setup — selected label only

1. Create a custom Gmail label such as **Locum Radar**. Apply it only to recruitment messages you want imported, manually or using a Gmail filter.
2. In a Google Cloud project, enable the Gmail API and create a Web application OAuth client. Configure the consent screen for your own account. Register the exact redirect URI `http://127.0.0.1:3000/api/gmail/callback` for the default local installation, or your configured HTTPS origin plus `/api/gmail/callback`.
3. Store `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` and a random `SESSION_SECRET` of at least 32 characters in `.env.local`. Restart the app. Do not send secrets through chat or commit them.
4. Open Sources → Connect Gmail, complete Google's consent, add the catalog recipe, then choose the custom label in **Gmail recruitment label → Collection settings**. Record access to your own mailbox, enable the source, and choose the lookback window.
5. Set `COLLECTOR_ENABLED=true` for this installation when ready to run enabled sources. The default remains off. Discover lists any missing setup.

Google's `gmail.readonly` grant can read the mailbox; it cannot be restricted by Google to one label. Locum Radar enforces the selected label on message listing and rechecks it before parsing each fetched message. It reads label names to populate the selector. It does not send, modify, archive or delete emails. Message bodies that lose the label between listing and fetching are discarded. Attachments are named in a review warning; their contents are not fetched. Removing a label does not retroactively erase evidence already imported.

Tokens are AES-256-GCM encrypted in ignored `data/secrets/gmail.enc`, using a key derived from `SESSION_SECRET`. Keep the secret stable and protect the machine/data directory; changing it requires reconnection. Disconnect deletes the local token file; revoke Google consent separately in your Google account if desired. This is single-account local token storage, not a multi-tenant vault. Google's consent/testing policies may require periodic reconnection; check the current Google project status before treating this as unattended production integration.

Primary references: [Gmail messages and label filtering](https://developers.google.com/workspace/gmail/api/guides/list-messages), [labels](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.labels/list), [OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).

## Scraper and page-reader choices

| Option                                               | Best use here                                                      | Trade-off and decision                                                                                                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Direct HTTP + Cheerio + structured data              | Ordinary agency pages, feeds and sitemaps                          | Implemented locally: deterministic, inexpensive and easy to inspect; cannot click JavaScript pagination                                                                           |
| [Playwright](https://playwright.dev/docs/intro)      | Public boards that require rendering, filters or next-page buttons | Precise interaction and useful browser diagnostics; needs an isolated, bounded worker and site-specific tests. Currently used for app tests, not deployed as a vacancy collector  |
| [Crawl4AI](https://docs.crawl4ai.com/)               | A separate Python crawling/extraction worker                       | Broader extraction tooling, with another runtime and browser lifecycle to maintain; an option if rendered-source volume justifies it                                              |
| [Firecrawl](https://docs.firecrawl.dev/introduction) | Hosted page-to-text/structured extraction and browser interaction  | Reduces infrastructure work but introduces a service dependency, usage costs and an external data processor. Not connected; private recruiter emails should stay out of this path |
| [Apify](https://docs.apify.com/)                     | Hosted source-specific collectors and scheduled runs               | Convenient deployment and existing actors; actor quality and site compatibility need validation. No actor was purchased or connected                                              |

These tools change how pages are retrieved, not whether the advertised dates, pay units or clinical requirements are correct. Keep the same evidence/review contract regardless of the retrieval tool. The present choice is local deterministic extraction first, then narrowly qualified rendered adapters where actual source yield warrants them.

## Queryable vacancy APIs

**Adzuna** offers documented job-search endpoints with an app ID/key. This implementation queries Australia and retains provider IDs/links. Aggregator adverts can be duplicated or stale; salary estimates are deliberately ignored. Before enabling, review the current API agreement, including any display/attribution requirements. [Official overview](https://developer.adzuna.com/overview) and [interactive documentation](https://developer.adzuna.com/activedocs).

**Jooble** offers a key-based job-search REST API. It is a credible second aggregator, but its adapter is not implemented in this change; first establish that its Australian locum results add unique vacancies beyond the primary agencies. [Official API](https://jooble.org/api/about).

**SEEK** has an API ecosystem, but the documented integration is based on partner/hirer authorisation. It should not be represented as an unrestricted public search feed for every advertised role. We have not added a pretend SEEK collector. [SEEK developer documentation](https://developer.seek.com/).

No stable, publicly documented, unrestricted vacancy-search API was established for the inspected specialist agencies. JSON-LD, published feeds and approved source exports are practical alternatives. A private browser XHR endpoint is not automatically a supported external API. For Outlook in a future version, Microsoft Graph offers per-folder message delta queries, but the current implementation follows your Gmail choice. [Graph message delta](https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0).

## Forums and less obvious leads

The catalog includes a recent public `r/ausjdocs` search and a direct rural-employer search. Add separate queries for other relevant public communities, hospital medical-workforce pages, rural training networks and published newsletters. Example queries:

```text
site:reddit.com/r/ausjdocs locum (vacancy OR cover OR hiring)
Australia hospital "locum registrar" "2027"
Queensland "medical workforce" "locum" vacancy
Australia "locum" filetype:pdf registrar
```

Use short lookback windows for community posts and longer windows for planned 2027 blocks. Publication recency is not proof that the work is still available. Keep an all-year acquisition window where practical: restricting every feed to “2027” would lose adverts whose dates exist only in attachments or a recruiter's follow-up.

The implemented [Brave Web Search API](https://api-dashboard.search.brave.com/app/documentation/web-search/query) supports date filters and up to ten result pages. Provider truncation is retained as a coverage warning. It returns indexed public leads, not private forum/group content. No direct Reddit OAuth or Devvit integration is claimed; use Reddit's current approval process before adding one. [Reddit developer guidelines](https://developers.reddit.com/docs/guidelines).

A recent [public discussion asking for GP locum agents](https://www.reddit.com/r/ausjdocs/comments/1wufeof/please_recommend_me_a_gp_locum_agent/) illustrates why referral sources belong in discovery, but a recommendation is not an available position. Closed Medlife/Facebook/WhatsApp groups are not covered by public search. If you can legitimately receive their recruitment emails, label those messages; otherwise manually import only the relevant advert. No forum accounts are contacted or posted to.

## Next acquisition improvements, in priority order

1. **Qualify your actual agencies and advertisements.** A small representative set of recruitment emails, including multi-job and attachment-heavy examples, will improve accuracy more than another generic scraper. Track reviewed-vacancy yield, missing fields, duplicate rate and unique offers per source.
2. **Attachment adapters.** Add sandboxed PDF/DOCX/CSV/XLSX extractors with file-size, decompression and page limits; OCR only when needed. Preserve attachment identity/page/row evidence, and show separate review records for each date block. The current warning avoids silently claiming these were read.
3. **Rendered boards.** Build an isolated browser worker for qualified public boards with source-specific selectors, no session cookies, network allowlisting/egress protection, robot checks, time/page budgets and the same durable queue contract. JPS/Skilled navigation are concrete candidates; Medrecruit now has a structured-page adapter that should be qualified before adding a browser fallback. Do not run arbitrary page JavaScript in the app server without that isolation.
4. **Incremental email and feed refresh.** Current repeat scans use a bounded lookback plus content deduplication. Gmail history cursors can reduce repeat reads once real mailbox behaviour is tested; cursor expiry must fall back safely to label-filtered listing.
5. **Access and source quality ledger.** Qualify more sources against actual current pages and record last known adapter behaviour. Keep candidate recipes visibly separate from proven complete traversals. Agree a private feed/export with a useful recruiter if that replaces fragile scraping.

## Running and verification

```powershell
npm run collect -- ochre
npm run collect -- ochre --drain
npm run collect -- --drain
```

One invocation without `--drain` processes one small batch per enabled source. Drain continues until the source finishes, pauses, reaches a budget or hits the worker's safety limit. Daily refresh is per source; unfinished work can resume immediately. No operating-system schedule was installed. Tests cover same-host discovery, structured/detail extraction, feeds, API pagination, label privacy, encryption, content versioning, robots rules, resumable SQLite checkpoints, concurrency leases, budget continuation, rate-limit pauses and disabling a source during a fetch. Authenticated provider operation still requires live credentials and a real-account acceptance check.
