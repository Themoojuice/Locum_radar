# Locum Radar

A private workspace for finding and comparing Australian medical locum opportunities, with 2027 planning as the initial focus.

**First draft, not a live national job aggregator.** The interface, database, reviewed imports, eligibility engine, deterministic ranking, reconciliation, comparisons, tracker and calendar work locally. Resumable acquisition supports public pages, feeds, sitemaps, Adzuna, recent web/forum leads and a selected Gmail label. Source qualification and missing setup are explicit. No email account, paid API or hosted service is connected by default.

![The fictional example workspace](docs/screenshots/radar-desktop.png)

## Start here

Install **Node.js 24 or newer**, then run:

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:3000**. The server binds only to your computer's loopback interface. No account or API key is needed for local use.

1. Explore the **example workspace**. All of its jobs, rates and qualifications are fictional. Examples never enter your database.
2. Choose **Open my workspace**, then **My profile & preferences**. Registration, grade and supervision start unknown; the app does not infer your professional eligibility.
3. Choose **Import opportunities**. Paste an advertisement, upload a `.txt`, `.html`, `.eml` or `.json` file, and review before saving. Choose the correct source.
4. Use **Review queue** for unknown requirements and possible duplicate matches. Save interesting jobs, compare up to four, and keep recruiter questions in private notes.

See [the import guide](docs/importing.md) for supported fields and [the acquisition guide](docs/acquisition-plan.md) for collector recipes, Gmail setup, API options and source qualification. Free-form extraction recognises a limited set of explicit patterns; arbitrary recruiter formats and attachments still require review or transcription.

## Public results without setup

Opening your private Discover workspace automatically scans the inspected Ochre public board when due. No API key, Gmail connection or environment file is required. Collected adverts appear progressively in Discover with source links, advertised rates and dates; missing facility and eligibility details remain unknown. The initial source refreshes daily, and an interrupted scan resumes from its saved queue. Keep Discover open while it runs, or use `npm run collect -- ochre --drain`.

The source catalog includes optional connections and unqualified candidates; its count is not a count of working feeds. Explicitly disabling a source is preserved. Set `COLLECTOR_ENABLED=false` to stop all collection.

## Adding more sources

Add these to `.env.local`, then restart the app:

```sh
COLLECTOR_ENABLED=true
APPROVED_SOURCES=medrecruit,1medical,wavelength   # sources you have permission to collect
MAILDROP_DIR=/path/to/your/synced/mail-drop       # optional: folder filled by scripts/gmail-export.gs
```

On **Discover**, press **Fetch active vacancies**. The app loads the national hospital directory on first use, imports recent recruiter emails from the mail-drop folder, then runs every approved, enabled source that is due. A live log shows each step; if any source fails or is skipped, a warning lists it so you know the feed may be incomplete. Agency-specific collectors and mail-drop imports can send validated listings to the feed (`COLLECTOR_AUTO_IMPORT=false` keeps them in Review queue). Generic collectors, search leads and Gmail body imports always enter Review queue. Agency-specific collection respects your preferred specialties and excluded states.

Agency-specific runs can take several minutes and have page/detail limits. Later runs may stop at listings already seen, which is an incremental check rather than proof of full coverage. Each source has an enforced refresh interval. See [source acquisition](docs/source-acquisition.md) for what each source needs.

## What works

- Separate facilities, underlying opportunities, source advertisements, recruiter offers and observation history.
- Exact matching only with matching facility/role/dates, nonempty shared reference and roster, and consistent requirements. Ambiguous matches go to review. Reviewed merges can be undone by separating an offer.
- Five eligibility categories; explicit credential, grade, supervision, availability and exclusion checks.
- Hourly/day/shift/placement terms, paid units, super, on-call treatment, personal expenses and temporary cost scenarios. Unknown numbers stay unknown.
- Six ranking presets and adjustable weights. Missing criteria are omitted and remaining weights normalised. Scoring evidence is displayed separately. Withdrawn offers remain in history and are excluded from ranking.
- Search and filters, shortlist, side-by-side comparison, 2027 placement timeline with overlaps, schematic geographic explorer, small starter facility directory, source registry and source health history.
- Discover shows source collection progress, last successes/errors and remaining setup. **Fetch active vacancies** prepares the facility directory and configured mail-drop, then checks ready sources with a live log. Generic collectors follow configured links in resumable batches; agency-specific adapters use bounded incremental scans. Partial coverage and stop controls are explicit. Keep Discover open, or use the command-line worker with `--drain`.
- Application stages, notes, deletion of imported opportunity records, CSV export with spreadsheet-formula escaping.
- SQLite persistence by default; optional PostgreSQL connection using the same repository contract and schema.
- Password-protected sessions when configured; strict mutation-origin checking and read protection on every data endpoint.
- A collector framework with an enabled public starter with per-source host/path rules, access review, per-path robots checks, pinned public IP, bounded responses, timeouts, retry/backoff, durable queues, content-version evidence and review-first extraction. Twenty catalog recipes distinguish inspected pages from unqualified candidates.

## Important boundaries of this draft

- **The Phase 1 live-collection exit criterion is not yet met.** Synthetic examples and tested imports do not prove live multi-source discovery. Source-specific adapters need permitted access, captured real fixtures and validation.
- Gmail read-only OAuth and selected-label body collection are implemented; live account acceptance requires your Google client and consent. Known recruiter EML formats split into individual vacancies; a mail-drop importer and optional Gmail export script are also available. Attachments and Outlook integration remain pending. No mailbox was read during this build.
- `npm run import-facilities` adds the AIHW MyHospitals directory and resolves facility names against it; derived towns are approximate.
- No managed scheduling, automatic notifications, calendar sync, map tiles, biodiversity integration, travel routing, adaptive learning or automatic applications.
- Calendar entries represent placement dates, not individual rostered shifts. The map is labelled schematic; new facilities without coordinates remain in its list.
- No tax calculations, credential certification, fellowship equivalence or guarantees of vacancy availability.
- PostgreSQL support is implemented but has not been exercised against a real PostgreSQL server in this environment. SQLite is the validated local backend.
- The application has one owner. Separate friend accounts, MFA and per-user authorisation are future work. Do not treat the current owner session as a multi-user system.

## Configuration and data

Copy `.env.example` to `.env.local` if you need to change settings. Keep that file out of Git.

| Setting                                  | Purpose                                                             |
| ---------------------------------------- | ------------------------------------------------------------------- |
| `APP_ORIGIN`                             | Exact browser origin; default `http://127.0.0.1:3000`               |
| `APP_PASSWORD`                           | Optional local password; at least 16 characters for a remote origin |
| `SESSION_SECRET`                         | 32+ random characters; required whenever a password is set          |
| `SQLITE_PATH`                            | Default `./data/locum-radar.sqlite`                                 |
| `DATABASE_URL`                           | Optional dedicated PostgreSQL database; overrides SQLite            |
| `COLLECTOR_ENABLED`                      | Global collection gate; enabled unless explicitly false             |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` | Optional Google OAuth client; requires a stable `SESSION_SECRET`    |
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`        | Optional Australian job-search API                                  |
| `BRAVE_SEARCH_API_KEY`                   | Optional recent forum and employer discovery                        |

All local records are under `data/`, which is excluded from Git. There is no browser local-storage copy of your imported advertisements. For a consistent SQLite backup, stop both the app and collectors before copying the database, or use SQLite's online backup tooling; do not copy only the main file while WAL writes are active. Exported CSV contains your job summary, not a complete backup.

To use a production build locally:

```sh
npm run build
npm start
```

Read [deployment and security](docs/deployment.md) before hosting. Runtime database files are not bundled into the build.

## Verification

Validated on 15 October 2026: 137 automated tests, TypeScript, lint, formatting and the production build passed. All eight browser scenarios passed, including automatic public collection and visible unconfirmed adverts. The dependency audit reported no known vulnerabilities.

Acquisition checks include parser/provider fixtures, label privacy, durable SQLite scans and source-specific adapters, plus local samples from public boards. Browser tests use a production build. Authenticated Gmail/API operation and PostgreSQL still need live acceptance checks. See the acquisition guide for qualification boundaries.

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm audit
```

The browser suite tests the production build, so run `npm run build` first. It uses installed Microsoft Edge by default. Set `PLAYWRIGHT_CHANNEL=chromium` and install Chromium with `npx playwright install chromium` on a machine without Edge. CI does this automatically. Browser tests use their own isolated database; they do not write to your personal workspace.

## Design and research

- [Architecture and key decisions](docs/architecture.md)
- [Acquisition framework, source qualification and Gmail setup](docs/acquisition-plan.md)
- [Implementation status against the specification](docs/implementation-status.md)
- [Competitive landscape and features to study](docs/landscape-2026-10-13.md)
- [Source acquisition: towards national locum coverage](docs/source-acquisition.md)
- [Original product specification](docs/product-spec.md)

No commercial licensing assumptions or third-party redistribution rights are inferred from this project's personal-use purpose. Source access is recorded individually; manual imports remain available independently of collectors.
