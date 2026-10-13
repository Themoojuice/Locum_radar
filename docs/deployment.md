# Deployment and data handling

## Validated configuration: private local use

Node 24+, a writable persistent `data` directory and the repository's `npm run dev` / `npm start` commands. Both commands bind to `127.0.0.1`. The API validates the configured host and rejects cross-site origins before mutations, including when local password protection is disabled.

Optional password setup in `.env.local`:

```dotenv
APP_ORIGIN=http://127.0.0.1:3000
APP_PASSWORD=replace-with-a-long-unique-password
SESSION_SECRET=replace-with-at-least-32-random-characters
```

Generate the session secret locally with a cryptographic password manager or Node's `crypto.randomBytes`. Do not commit it. Password verification uses scrypt plus a timing-safe comparison. Sessions are HMAC-signed, expire after eight hours, and use HttpOnly/SameSite=Strict cookies. A remote HTTPS origin additionally sets Secure cookies. Changing the session secret invalidates existing sessions.

## Private hosted use: further setup required

The app rejects non-loopback origins unless HTTPS, a password of at least 16 characters and a session secret of at least 32 characters are configured. Put it behind an identity-aware reverse proxy with MFA, rate limiting and request-body limits before remote use. Native MFA, OAuth login, individual friend accounts and multi-user data isolation are not implemented. The application password is one owner's access, not a substitute for those features.

Run the application on a Node service behind that proxy. SQLite requires a persistent volume and a single app instance; it is unsuitable for an ephemeral serverless filesystem. Alternatively provide a dedicated PostgreSQL database through `DATABASE_URL`. Use your provider's verified TLS connection settings. Never disable TLS certificate validation to make a connection work. The PostgreSQL code needs a real integration test before relying on it; it was not connected during this build.

No deployment, hosting purchase, OAuth consent or external service registration was performed.

## Data minimisation

The app stores the information you import, source snapshots, your declared professional profile and notes. It does not need credential documents, AHPRA numbers, bank details or patient information. Credential evidence storage is intentionally absent. Email attachments are not kept separately or extracted. Imported HTML is displayed as escaped text. Original links accept only HTTP/HTTPS, and open without referrer information.

API responses are private/no-store. Source text is treated only as data; there is no agent that can execute its instructions. No analytic beacon, external font, map tile service or AI service is configured by the application. Next.js may collect framework telemetry during development/build unless you disable it with `NEXT_TELEMETRY_DISABLED=1`.

The current CSP permits inline scripts/styles needed by this Next.js setup; nonce-based stricter CSP is future hardening. Login throttling is process-local; a hosted proxy must provide durable throttling. Backups, exported CSVs and server filesystem permissions are the owner's responsibility. Opportunity deletion removes its listings, offers, notes, source observations and associated duplicate reviews from the active database, but cannot remove copies already exported or backed up.

## Running a collector

1. Establish the particular source's access permission and validate a source-specific adapter against saved fixtures.
2. Record the access evidence under **Sources → Access settings** and enable a supported adapter.
3. Set `COLLECTOR_ENABLED=true` in the process environment.
4. Run `npm run collect -- source-id` from the repository. The runner loads `.env.local` if present.
5. Review extracted records. A successful request is not evidence that a vacancy is currently bookable.

An external scheduler can call the runner later; none is installed by this project. Keep a single initial migration/bootstrap process. Once source fixtures are qualified, add integration checks for redirects, robots changes, layout changes, withdrawn records and failed requests before unattended use.
