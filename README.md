# Locum Radar

A private workspace that discovers Australian medical locum vacancies nationally, then ranks them for one doctor: eligibility, dates, logistics and attractiveness assessed separately, every number traceable to its source.

**Version 0.2** implements [specification v0.2](docs/product-spec-v0.2.md); see [implementation status](docs/implementation-status.md) for each acceptance criterion. Collectors are built for Medrecruit, 1Medical, Wavelength, Salt, Global Medics, JPS, DNA and Adzuna; they run on your machine once you record permission and have not been run live from the build environment. No email account, calendar account, hosted service or paid AI service is connected.

![The fictional example workspace](docs/screenshots/radar-desktop.png)

## Start here

Install **Node.js 24 or newer**, then run:

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:3000**. The server binds only to your computer's loopback interface. No account or API key is needed for local use.

1. Explore the **example workspace**. All of its jobs, rates and qualifications are fictional. Examples never enter your database.
2. Choose **Open my workspace**, then **My profile & preferences**. Registration, grades, the specialties you work in and employer approval start unknown; the app does not infer your professional eligibility. Add your calendar (available, preferred, approved leave, provisional leave, negotiable commitments, unavailable) and, optionally, cost assumptions and the nature lens.
3. Choose **Import opportunities**. Paste an advertisement, upload a `.txt`, `.html`, `.eml` or `.json` file, and review before saving. Choose the correct source.
4. Use **Review queue** for unknown requirements and possible duplicate matches. Save interesting jobs, compare up to four, and keep recruiter questions in private notes.

See [the import guide](docs/importing.md) for supported fields. Free-form extraction recognises a limited set of explicit patterns; arbitrary recruiter formats and attachments still require review or transcription.

## Fetching vacancies automatically

Add these to `.env.local`, then restart the app:

```sh
COLLECTOR_ENABLED=true
APPROVED_SOURCES=medrecruit,1medical,wavelength   # sources you have permission to collect
MAILDROP_DIR=/path/to/your/synced/mail-drop       # optional: folder filled by scripts/gmail-export.gs
```

On **Discover**, press **Fetch active vacancies**. The app loads the national hospital directory on first use, imports recent recruiter emails from the mail-drop folder, refreshes the nature lens if you turned it on, then runs every approved, enabled source that is due. A live log shows each step; if any source fails or is skipped, a warning lists it so you know the feed may be incomplete. Valid listings go straight to the feed (`COLLECTOR_AUTO_IMPORT=false` sends everything to Review queue instead); incomplete ones wait in Review queue.

Collection is national and covers every specialty (spec LR-001). Your feed then shows **your specialties** by default and says how many jobs it is not showing and why (ineligible, excluded state, below your minimum, hard date clash); one click shows them.

Before enabling a new source, use **Coverage → Test** on its row: it reads a few live pages through the same permission and robots checks and shows what the parser extracted, without saving anything.

The first run reads each source in full and takes several minutes (Medrecruit is about 190 pages; 1Medical and the sitemap collectors read up to 150 and 120 job pages per run, most relevant first). Later runs stop at listings already seen. See [source acquisition](docs/source-acquisition.md) for what each source needs.

## What works

- **Four separate assessments** on every vacancy: professional eligibility (registration, experience, credentials, fellowships, specialty competence, grade, procedures, supervision, cover, employer approval), scheduling (against six kinds of calendar entry and committed placements), logistics (distance from home, travel and stay, credentialing lead time) and attractiveness. Uncertain eligibility stays in the ranked feed, clearly labelled.
- **Explainable ranking**: six presets from the spec, adjustable weights, plain-language reasons, and "hard to assess" when less than 60% of your weighting has evidence. Missing evidence is left out, never scored as zero. Weight suggestions learnt from what you save and dismiss, applied only if you choose.
- **Money with provenance**: advertised, calculated and estimated figures are labelled separately; travel, accommodation and time costs use only assumptions you entered.
- **Reconciliation**: exact cross-agency linking; near-date adverts from different agencies queued as likely duplicates; reviewed merges keep each offer and are reversible.
- **Map** of vacancies (MapLibre, OpenStreetMap data via OpenFreeMap, offline coastline fallback) with a layer of hospitals where no vacancy has been observed.
- **Planner**: availability bands, tracked placements, the best non-overlapping run by score or earnings, and recurring hospital patterns labelled as predictions.
- **Coverage**: per-source active, unique and shared yield, parse reliability, state gaps, monthly market trends and a capture–recapture estimate of how much of the advertised market you can see.
- **Alerts** in the app for new high scorers, material rate changes, better competing offers, exceptional urgent jobs, blocks that fit your plans and changes to tracked jobs — one per vacancy, however many agencies advertise it.
- **Detail panel** with eligibility checks by dimension, every offer's terms and source evidence, hospital history, and a recruiter enquiry draft listing what the record does not establish.
- Tracker stages (saved, enquiry sent, applied, credentialing, offered, accepted, rejected, withdrawn, declined, dismissed), notes, comparison of up to four, CSV export with formula escaping, filters remembered between sessions.
- SQLite by default; optional PostgreSQL. Password-protected sessions when configured; strict mutation-origin checking and read protection on every data endpoint.

## Important boundaries

- **Collectors have not been run live from the build environment**, which cannot reach the sites. Parsers are tested on fixtures and (for Medrecruit, 1Medical and email) on captured real samples. Use **Test** before enabling each source.
- Ochre, Medlo, StatDoctor, SEEK, Indeed and LinkedIn have no collector; use their alert emails through the mail drop.
- Shift lists are supported in the model and JSON imports, not yet parsed from recruiter prose.
- Alerts are in-app only: no push, SMS or email. No calendar sync, OAuth mailbox sync, travel routing, tax engine or automatic applications.
- The nature lens counts occurrence records, which track recording effort as much as biodiversity.
- PostgreSQL support is implemented but not exercised against a real server. One owner per installation.

## Configuration and data

Copy `.env.example` to `.env.local` if you need to change settings. Keep that file out of Git.

| Setting             | Purpose                                                                |
| ------------------- | ---------------------------------------------------------------------- |
| `APP_ORIGIN`        | Exact browser origin; default `http://127.0.0.1:3000`                  |
| `APP_PASSWORD`      | Optional local password; at least 16 characters for a remote origin    |
| `SESSION_SECRET`    | 32+ random characters; required whenever a password is set             |
| `SQLITE_PATH`       | Default `./data/locum-radar.sqlite`                                    |
| `DATABASE_URL`      | Optional dedicated PostgreSQL database; overrides SQLite               |
| `COLLECTOR_ENABLED` | Global collection gate; default false                                  |
| `APPROVED_SOURCES`  | Source ids with recorded permission, e.g. `medrecruit,1medical`        |
| `MAILDROP_DIR`      | Folder of exported recruiter `.eml` files                              |
| `*_DETAIL_LIMIT`    | Job pages per run, e.g. `ONEMEDICAL_DETAIL_LIMIT`, `SALT_DETAIL_LIMIT` |

All local records are under `data/`, which is excluded from Git. There is no browser local-storage copy of your imported advertisements. For a consistent SQLite backup, stop both the app and collectors before copying the database, or use SQLite's online backup tooling; do not copy only the main file while WAL writes are active. Exported CSV contains your job summary, not a complete backup.

To use a production build locally:

```sh
npm run build
npm start
```

Read [deployment and security](docs/deployment.md) before hosting. Runtime database files are not bundled into the build.

## Verification

Validated on 14 October 2026: 155 logic, security, database, source-adapter and v0.2 acceptance tests; TypeScript; lint; formatting; a production build; and the five production-browser scenarios on desktop and mobile (including no horizontal overflow on Discover, Planner, Coverage and Map at 390 px). The dependency audit reported no known vulnerabilities. These checks do not validate live collectors or the PostgreSQL backend.

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm run bench -- 10000   # synthetic national-scale timing
npm audit
```

The browser suite tests the production build, so run `npm run build` first. It uses installed Microsoft Edge by default. Set `PLAYWRIGHT_CHANNEL=chromium` and run `npx playwright install chromium`, or point `PLAYWRIGHT_EXECUTABLE` at any Chromium binary. Browser tests use their own isolated database.

## Design and research

- [Architecture and key decisions](docs/architecture.md)
- [Implementation status against the specification](docs/implementation-status.md)
- [Competitive landscape and features to study](docs/landscape-2026-10-13.md)
- [Source acquisition: towards national locum coverage](docs/source-acquisition.md)
- [Product specification v0.2](docs/product-spec-v0.2.md) and the [original v0.1](docs/product-spec.md)

No commercial licensing assumptions or third-party redistribution rights are inferred from this project's personal-use purpose. Source access is recorded individually; manual imports remain available independently of collectors.
